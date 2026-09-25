// processador-synth.js
// O "motor" de som. Roda num processo de áudio separado (AudioWorklet),
// para o som não falhar mesmo se a tela ficar lenta.
//
// Ele é o "gerente de vozes": cada nota tocada ganha uma voz completa
// (OSC A, B, C + ruído → filtros → envelope, ver dsp/voz.js). A saída é estéreo.
//
// - Poly: até N notas ao mesmo tempo. Se faltar voz, "rouba" a melhor
//   candidata (uma que já está sumindo, ou a mais antiga) sem estalo.
// - Mono: uma nota por vez (sempre a voz 1), com Legato opcional:
//   deslizar entre teclas não reinicia o envelope.
// - Glide: a nota escorrega até a nova altura (tempo igual para qualquer
//   intervalo). Por padrão só quando as notas estão emendadas; "Sempre" = toda vez.
// - Modulação: LFO 1, 2 e 3, ENV 2 e 3 ligados a controles (ver dsp/modulacao.js).
//   LFO em modo Retrig vive dentro de cada voz; em modo Livre, fica aqui
//   (um só para todas as notas, rodando sem parar).

import { Voz } from './dsp/voz.js';
import { codigoWarp, W_NENHUM } from './dsp/warp.js';
import { trechosDeRuido, TIPOS_RUIDO } from './dsp/ruido.js';
import { CoeficientesFiltro } from './dsp/filtro.js';
import { MatrizModulacao, INDICES_LFO, D_RATE_LFO, FONTES_MOD, DESTINOS_MOD, D_PRIMEIRO_EFEITO } from './dsp/modulacao.js';
import { MOD_EFEITOS, posicaoDoValor, valorDaPosicao } from './dsp/efeitos/modulaveis.js';
import { EstadoLFO, rateModulado } from './dsp/lfo.js';
import { Distorcao } from './dsp/efeitos/distorcao.js';
import { Compressor } from './dsp/efeitos/compressor.js';
import { Saturacao } from './dsp/efeitos/saturacao.js';
import { FiltroTrack } from './dsp/efeitos/filtro-track.js';
import { Eq } from './dsp/efeitos/eq.js';
import { Phaser } from './dsp/efeitos/phaser.js';
import { Flanger } from './dsp/efeitos/flanger.js';
import { Chorus } from './dsp/efeitos/chorus.js';
import { Delay } from './dsp/efeitos/delay.js';
import { Reverb } from './dsp/efeitos/reverb.js';
import { Clipper, LIMIAR_CLIPPER } from './dsp/clipper.js';

const MAX_VOZES = 16;
const PEDACO = 32; // amostras por pedaço de modulação (igual ao da voz)
// A cada quantos blocos manda os valores "ao vivo" para a tela (~30 vezes por segundo).
const BLOCOS_ENTRE_ENVIOS = Math.round(sampleRate / 128 / 30);

// Efeitos parados no silêncio: abaixo deste nível (-120 dB) é silêncio. A espera é maior que o
// maior "buraco" possível dentro de um efeito (Delay de 2 s + folga), para não parar um eco
// que ainda vai voltar.
const LIMIAR_SILENCIO = 1e-6;
const ESPERA_SILENCIO = 2.5; // segundos

// Maior valor (sem sinal) do bloco, nos dois lados
function picoDoBloco(e, d, n) {
  let pico = 0;
  for (let i = 0; i < n; i++) {
    const a = e[i] < 0 ? -e[i] : e[i];
    const b = d[i] < 0 ? -d[i] : d[i];
    if (a > pico) pico = a;
    if (b > pico) pico = b;
  }
  return pico;
}

class ProcessadorSynth extends AudioWorkletProcessor {
  // Controles que a página pode mexer de forma suave.
  static get parameterDescriptors() {
    return [
      // Oscilador: 0 = primeiro frame, 1 = último frame
      { name: 'wtPos', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Unison: Detune e Width de 0 a 1
      { name: 'detune', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'width', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Oscilador: nível de 0 a 1
      { name: 'nivelOsc', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Afinação fina do oscilador A, em centésimos de semitom (-100 a +100)
      { name: 'fineOsc', defaultValue: 0, minValue: -100, maxValue: 100, automationRate: 'k-rate' },
      // Pan (-1 = esquerda, 0 = centro, 1 = direita) e Blend (0 = só as cópias do meio,
      // 1 = todas as cópias de unison com o mesmo volume)
      { name: 'panOsc', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'blendOsc', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Warp: quantidade da deformação da onda (0 a 1); o modo é uma opção (warpModoOsc)
      { name: 'warpOsc', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // OSC B e C: os mesmos controles, com a letra no fim
      ...['B', 'C'].flatMap((letra) => [
        { name: 'fineOsc' + letra, defaultValue: 0, minValue: -100, maxValue: 100, automationRate: 'k-rate' },
        { name: 'panOsc' + letra, defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
        { name: 'blendOsc' + letra, defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'warpOsc' + letra, defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'wtPos' + letra, defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
        { name: 'detune' + letra, defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'width' + letra, defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'nivelOsc' + letra, defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      ]),
      // Ruído: nível de 0 a 1
      { name: 'ruido', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Filtro
      { name: 'cutoff', defaultValue: 2000, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'resonancia', defaultValue: 0.1, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Filtro 2
      { name: 'cutoff2', defaultValue: 2000, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'resonancia2', defaultValue: 0.1, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Volume geral (ganho, já com a curva da barra), aplicado antes do soft clipper
      { name: 'volume', defaultValue: 0.174, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Envelope de volume (tempos em segundos)
      { name: 'ataque', defaultValue: 0.005, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
      { name: 'decaimento', defaultValue: 0.5, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
      { name: 'sustentacao', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'soltura', defaultValue: 0.08, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.vozes = Array.from({ length: MAX_VOZES }, () => new Voz(sampleRate));
    this.coef = new CoeficientesFiltro(sampleRate); // Filtro 1
    this.coef2 = new CoeficientesFiltro(sampleRate); // Filtro 2
    // Rota de filtro do ruído: 'f1', 'f2', 'f12' (1 depois 2) ou 'f21' (2 depois 1)
    this.rotaRuido = 'f1';

    // Osciladores A, B, C. "ajustes" vai para as vozes a cada bloco (ver OsciladorVoz).
    // Nomes dos parâmetros: os do A sem letra (wtPos...), os do B e C com (wtPosB...).
    this.oscs = ['', 'B', 'C'].map((letra) => ({
      params: {
        wtPos: 'wtPos' + letra,
        detune: 'detune' + letra,
        width: 'width' + letra,
        nivel: 'nivelOsc' + letra,
        fine: 'fineOsc' + letra,
        pan: 'panOsc' + letra,
        blend: 'blendOsc' + letra,
        warp: 'warpOsc' + letra,
      },
      tabelaNova: null, // wavetable esperando para entrar (troca sem estalo)
      warpNovo: null, // modo de Warp esperando para entrar (troca sem estalo, igual à wavetable)
      ajustes: {
        tabela: null, // wavetable recebida da página
        posicoesWT: null,
        unison: 1,
        detune: 0,
        width: 1,
        ligado: letra === '', // só o A começa ligado
        nivel: 1,
        ganho: 1, // 0 durante a troca de wavetable
        rota: 'f1',
        oitava: 0, // afinação: oitavas (-3 a +3), semitons (-12 a +12), centésimos (-100 a +100)
        semi: 0,
        fine: 0,
        pan: 0,
        blend: 1,
        fase: 0, // ponto de início da onda (0 a 1 = 0° a 360°)
        rand: 1, // quanto o início é sorteado a cada nota (0 a 1)
        warpModo: W_NENHUM, // modo do Warp (número, ver dsp/warp.js)
        warp: 0, // quantidade do Warp (0 a 1)
      },
    }));
    this.comum = { oscs: this.oscs.map((o) => o.ajustes) };
    this.tabelas = new Map(); // wavetables recebidas da tela (id → tabela) // dados do bloco, compartilhados por todas as vozes

    // Opções (a página manda os valores escolhidos logo ao ligar)
    this.modo = 'poly';
    this.maxVozes = 8;
    this.legato = true;

    this.notasPresas = []; // (modo Mono) notas seguradas, na ordem em que foram tocadas
    this.contador = 0; // numera as notas, para saber qual é a mais antiga

    // Glide: tempo do escorregão (0 = desligado), "sempre" (mesmo sem emendar
    // as notas) e a última nota tocada (de onde a próxima escorrega no Poly).
    this.glideTempo = 0;
    this.glideSempre = false;
    this.ultimaNota = null;

    // Ruído (o nível é o parâmetro "ruido")
    this.ruidoLigado = false;
    this.ruidoTipo = 'white';
    this.ruidoModo = 'loop'; // 'loop' (contínuo) ou 'oneshot' (rajada no ataque)
    this.ruidoDuracao = 0.2; // One Shot: segundos até sumir
    this.ruidoTrack = false; // a cor acompanha a nota?
    this.ruidoPitch = 0; // semitons (-24 a +24): mais rápido = mais brilhante
    this.ruidoUnico = true; // só a nota mais recente toca ruído (acordes: 1 ruído só)
    this.ruidoDona = null; // a voz da nota mais recente
    this.trechosRuido = trechosDeRuido(sampleRate); // os "samples" de ruído (dsp/ruido.js)

    // Modulação
    this.matriz = new MatrizModulacao(sampleRate);
    this.ajustesLfo = [
      { forma: 'seno', rate: 2, modo: 'retrig' },
      { forma: 'triangulo', rate: 0.5, modo: 'retrig' },
      { forma: 'seno', rate: 1, modo: 'retrig' }, // LFO 3
    ];
    this.ajustesEnv = [
      { ataque: 0.005, decaimento: 0.3, sustentacao: 0, soltura: 0.2 },
      { ataque: 0.005, decaimento: 0.3, sustentacao: 0, soltura: 0.2 },
    ];
    // Efeitos (depois das notas somadas):
    // Saturação → Distorção → Filtro Track → EQ → Compressor → Phaser → Flanger → Chorus → Delay → Reverb
    this.filtroTrack = new FiltroTrack(sampleRate);
    this.eq = new Eq(sampleRate);
    this.saturacao = new Saturacao(sampleRate);
    this.distorcao = new Distorcao(sampleRate);
    this.phaser = new Phaser(sampleRate);
    this.flanger = new Flanger(sampleRate);
    this.chorus = new Chorus(sampleRate);
    this.delay = new Delay(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.compressor = new Compressor(sampleRate);
    this.enviouCompressor = false;
    this.efeitos = {
      saturacao: this.saturacao,
      distorcao: this.distorcao,
      filtroTrack: this.filtroTrack,
      eq: this.eq,
      compressor: this.compressor,
      phaser: this.phaser,
      flanger: this.flanger,
      chorus: this.chorus,
      delay: this.delay,
      reverb: this.reverb,
    };
    // A ordem do caminho do som (cada efeito com o seu contador de silêncio)
    this.cadeiaEfeitos = ['saturacao', 'distorcao', 'filtroTrack', 'eq', 'compressor', 'phaser', 'flanger', 'chorus', 'delay', 'reverb'].map(
      (id) => ({ efeito: this.efeitos[id], silencio: 0, parado: false })
    );
    this.esperaSilencio = ESPERA_SILENCIO * sampleRate;

    // Modulação dos knobs dos efeitos (ver modularEfeitos): o valor escolhido na tela de cada
    // knob ("base") fica guardado aqui; o efeito recebe base + modulação.
    this.basesEfeitos = {};
    for (const [id, efeito] of Object.entries(this.efeitos)) this.basesEfeitos[id] = { ...efeito.ajustes };
    this.fontesEfeitos = new Float64Array(FONTES_MOD.length);
    this.modEfeitosAlvo = new Float64Array(DESTINOS_MOD.length);
    this.modEfeitos = new Float64Array(MOD_EFEITOS.length); // suavizada (~5 ms)
    this.modulandoEfeito = new Uint8Array(MOD_EFEITOS.length); // 1 = o knob está sendo modulado
    this.suavizarModEfeitos = 1 - Math.exp(-128 / (0.005 * sampleRate));

    // Saída: volume geral → soft clipper, SEMPRE ligado (proteção fixa: nunca passa de 0 dB).
    // O motor avisa a tela do maior pico (antes de arredondar) para ela mostrar um recado
    // quando o clipper está segurando bastante.
    this.clipper = new Clipper(sampleRate);
    this.silencioSaida = 0; // amostras seguidas de silêncio na saída (clipper descansa)
    this.enviouPico = false;

    this.lfosLivres = this.ajustesLfo.map(() => new EstadoLFO());
    this.valoresLivres = this.ajustesLfo.map(() => new Float64Array(4)); // 1 valor por pedaço

    // Valores "ao vivo" para a tela (pontinhos que se mexem)
    this.blocosDesdeEnvio = 0;
    this.enviouAtivo = false;

    this.port.onmessage = (evento) => this.receberMensagem(evento.data);
  }

  receberMensagem(msg) {
    switch (msg.tipo) {
      case 'wavetable': {
        // Qual oscilador: 'A' (padrão), 'B' ou 'C'.
        // A tela manda a tabela inteira só na primeira vez (uma importada grande tem ~9 MB);
        // depois, só o id: o motor guarda as que recebeu (this.tabelas).
        if (msg.wavetable) this.tabelas.set(msg.id ?? msg.wavetable.id, msg.wavetable);
        const tabela = this.tabelas.get(msg.id ?? msg.wavetable?.id);
        if (!tabela) break;
        // Primeira tabela: entra direto. Trocas depois: passam por um "abaixa e sobe"
        // rápido só naquele oscilador (sem estalo), feito no process().
        const osc = this.oscs[{ B: 1, C: 2 }[msg.osc] || 0];
        if (!osc.ajustes.tabela) osc.ajustes.tabela = tabela;
        else osc.tabelaNova = tabela;
        break;
      }
      case 'esquecerWavetable':
        // A tela não usa mais esta tabela (libera memória; se um oscilador ainda estiver
        // tocando com ela, ele continua até trocar)
        this.tabelas.delete(msg.id);
        break;
      case 'notaOn':
        if (this.modo === 'mono') this.notaOnMono(msg.nota);
        else this.notaOnPoly(msg.nota);
        break;
      case 'notaOff':
        if (this.modo === 'mono') this.notaOffMono(msg.nota);
        else this.notaOffPoly(msg.nota);
        break;
      case 'tudoOff':
        this.soltarTudo();
        break;
      case 'opcao':
        this.definirOpcao(msg.nome, msg.valor);
        break;
      case 'modulacoes':
        this.matriz.definir(msg.lista);
        break;
      case 'fonte':
        this.definirFonte(msg.id, msg.ajustes);
        break;
      case 'efeito':
        this.efeitos[msg.id]?.definir(msg.ajustes);
        if (this.basesEfeitos[msg.id]) Object.assign(this.basesEfeitos[msg.id], msg.ajustes);
        break;
    }
  }

  // Ajustes de uma fonte de modulação (LFO: forma, rate, modo; ENV: A, D, S, R).
  definirFonte(id, ajustes) {
    const lfo = { lfo1: 0, lfo2: 1, lfo3: 2 }[id];
    if (lfo !== undefined) Object.assign(this.ajustesLfo[lfo], ajustes);
    const env = { env2: 0, env3: 1 }[id];
    if (env !== undefined) Object.assign(this.ajustesEnv[env], ajustes);
  }

  definirOpcao(nome, valor) {
    // Opções dos osciladores: A sem letra (unison, oscLigado, rotaOsc),
    // B e C com a letra (unisonB, oscBLigado, rotaOscB...)
    const ajustesOsc = (letra) => this.oscs[{ '': 0, B: 1, C: 2 }[letra]].ajustes;
    let achado = /^oitavaOsc([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).oitava = Math.min(3, Math.max(-3, Math.round(valor)));
      return;
    }
    achado = /^semiOsc([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).semi = Math.min(12, Math.max(-12, Math.round(valor)));
      return;
    }
    achado = /^warpModoOsc([BC]?)$/.exec(nome);
    if (achado) {
      // Troca de modo passa pelo "abaixa, troca e sobe" (ver process), como a wavetable.
      // Mesmo modo de agora (ex.: preset reenviando tudo): nada a fazer.
      const osc = this.oscs[{ '': 0, B: 1, C: 2 }[achado[1]]];
      const codigo = codigoWarp(valor);
      osc.warpNovo = codigo === osc.ajustes.warpModo ? null : codigo;
      return;
    }
    achado = /^faseOsc([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).fase = Math.min(1, Math.max(0, valor));
      return;
    }
    achado = /^randOsc([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).rand = Math.min(1, Math.max(0, valor));
      return;
    }
    achado = /^unison([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).unison = Math.min(16, Math.max(1, Math.round(valor) || 1));
      return;
    }
    achado = /^osc([BC]?)Ligado$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).ligado = valor;
      return;
    }
    achado = /^rotaOsc([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).rota = valor;
      return;
    }
    switch (nome) {
      case 'modo':
        if (valor !== this.modo) this.soltarTudo();
        this.modo = valor;
        break;
      case 'vozes':
        this.maxVozes = Math.min(MAX_VOZES, Math.max(1, Math.round(valor) || 1));
        break;
      case 'legato':
        this.legato = valor;
        break;
      case 'glide':
        this.glideTempo = Math.max(0, valor);
        break;
      case 'glideSempre':
        this.glideSempre = valor;
        break;
      case 'ruidoLigado':
        this.ruidoLigado = valor;
        break;
      case 'ruidoModo':
        this.ruidoModo = valor === 'oneshot' ? 'oneshot' : 'loop';
        break;
      case 'ruidoDuracao':
        this.ruidoDuracao = Math.min(2, Math.max(0.005, valor));
        break;
      case 'ruidoTrack':
        this.ruidoTrack = !!valor;
        break;
      case 'ruidoPitch':
        this.ruidoPitch = Math.min(24, Math.max(-24, valor));
        break;
      case 'ruidoUnico':
        this.ruidoUnico = !!valor;
        break;
      case 'ruidoTipo':
        // Tipo desconhecido (ex.: preset editado à mão) vira White: um tipo inválido
        // quebraria o motor na próxima nota (ele pararia de tocar até recarregar).
        this.ruidoTipo = TIPOS_RUIDO.includes(valor) ? valor : 'white';
        break;
      case 'filtroTipo':
        for (const voz of this.vozes) voz.definirFiltro(1, 'tipo', valor);
        break;
      case 'filtroLigado':
        for (const voz of this.vozes) voz.definirFiltro(1, 'ligado', valor);
        break;
      case 'filtro2Tipo':
        for (const voz of this.vozes) voz.definirFiltro(2, 'tipo', valor);
        break;
      case 'filtro2Ligado':
        for (const voz of this.vozes) voz.definirFiltro(2, 'ligado', valor);
        break;
      case 'rotaRuido':
        this.rotaRuido = valor;
        break;
    }
  }

  soltarTudo() {
    this.notasPresas = [];
    for (const voz of this.vozes) {
      voz.pendente = null;
      voz.soltar();
    }
  }

  // Decide se a nota nova escorrega, e de onde.
  // "emendada" = alguma tecla ainda estava segurada quando esta foi tocada.
  glidePara(emendada, origem) {
    if (this.glideTempo <= 0 || origem === null) return null;
    if (!emendada && !this.glideSempre) return null;
    return { de: origem, tempo: this.glideTempo };
  }

  // ---------- Modo Poly ----------

  notaOnPoly(nota) {
    const idade = ++this.contador;
    // No Poly, a nota nova escorrega a partir da última nota tocada.
    const emendada = this.vozes.some((v) => v.segurada);
    const glide = this.glidePara(emendada, this.ultimaNota);
    this.ultimaNota = nota;

    // A mesma nota ainda está soando? Reaproveita a voz dela.
    // (A voz da nota mais recente vira a "dona" do ruído: ver ruidoUnico.)
    let voz = this.vozes.find((v) => v.ativa && !v.pendente && v.nota === nota);
    if (voz) {
      this.ruidoDona = voz;
      return voz.iniciar(nota, idade, true, this.ajustesLfo, glide);
    }

    // Uma voz livre (dentro do limite de vozes escolhido)?
    const disponiveis = this.vozes.slice(0, this.maxVozes);
    voz = disponiveis.find((v) => !v.ativa);
    if (voz) {
      this.ruidoDona = voz;
      return voz.iniciar(nota, idade, true, this.ajustesLfo, glide);
    }

    // Sem voz livre: rouba. Prefere uma já solta (sumindo) e mais baixa;
    // se todas estão seguradas, rouba a mais antiga.
    let escolhida = null;
    for (const v of disponiveis) {
      if (v.pendente) continue;
      if (!escolhida) escolhida = v;
      else if (!v.segurada && (escolhida.segurada || v.nivel < escolhida.nivel)) escolhida = v;
      else if (v.segurada && escolhida.segurada && v.idade < escolhida.idade) escolhida = v;
    }
    if (!escolhida) {
      // Todas já estão trocando de nota: troca a nota que estava esperando.
      disponiveis[0].pendente = { nota, idade, glide };
      this.ruidoDona = disponiveis[0];
      return;
    }
    this.ruidoDona = escolhida;
    // Já quase muda? Começa direto. Senão, some rápido e depois toca.
    if (escolhida.nivel < 0.001) escolhida.iniciar(nota, idade, true, this.ajustesLfo, glide);
    else escolhida.roubar(nota, idade, glide);
  }

  notaOffPoly(nota) {
    for (const voz of this.vozes) {
      if (voz.pendente && voz.pendente.nota === nota) voz.pendente = null;
      else if (voz.nota === nota && voz.segurada) voz.soltar();
    }
  }

  // ---------- Modo Mono (sempre a voz 1) ----------

  notaOnMono(nota) {
    const voz = this.vozes[0];
    this.ruidoDona = voz;
    const ninguemSegurando = this.notasPresas.length === 0;
    // Se a nota já estava na lista, tira e coloca no fim (vira a mais recente).
    this.notasPresas = this.notasPresas.filter((n) => n !== nota);
    this.notasPresas.push(nota);
    // Escorrega a partir de onde o som está agora (mesmo no meio de outro escorregão).
    const origem = voz.envelope.ativo ? voz.altura : this.ultimaNota;
    const glide = this.glidePara(!ninguemSegurando, origem);
    this.ultimaNota = nota;
    // Com legato, só recomeça o envelope se nenhuma tecla estava segurada.
    voz.iniciar(nota, ++this.contador, ninguemSegurando || !this.legato, this.ajustesLfo, glide);
  }

  notaOffMono(nota) {
    const voz = this.vozes[0];
    this.notasPresas = this.notasPresas.filter((n) => n !== nota);
    if (this.notasPresas.length === 0) {
      voz.soltar(); // soltou tudo: entra a soltura (R)
    } else if (nota === voz.nota) {
      // Soltou a nota que soava, mas ainda tem outra segurada: volta para ela.
      // Com glide, escorrega de volta (as notas estão emendadas).
      const ultima = this.notasPresas[this.notasPresas.length - 1];
      const glide = this.glidePara(true, voz.altura);
      this.ultimaNota = ultima;
      voz.iniciar(ultima, ++this.contador, !this.legato, this.ajustesLfo, glide);
    }
  }

  // ---------- Som ----------

  process(entradas, saidas, parametros) {
    const saidaE = saidas[0][0];
    const saidaD = saidas[0][1];
    const tamanhoBloco = saidaE.length;
    saidaE.fill(0);
    saidaD.fill(0);

    // LFOs livres rodam sempre, mesmo em silêncio (as notas pegam eles andando).
    // Rate modulado: um LFO livre é um só para todas as notas, então segue a modulação
    // da nota tocada por último (enquanto ela soa).
    const ultima = this.ruidoDona && this.ruidoDona.envelope.ativo ? this.ruidoDona : null;
    for (let l = 0; l < this.ajustesLfo.length; l++) {
      const ajustes = this.ajustesLfo[l];
      const rate = ultima ? rateModulado(ajustes.rate, ultima.mod[D_RATE_LFO[l]]) : ajustes.rate;
      for (let pedaco = 0; pedaco * PEDACO < tamanhoBloco; pedaco++) {
        this.lfosLivres[l].avancar((rate * PEDACO) / sampleRate);
        this.valoresLivres[l][pedaco] = this.lfosLivres[l].valor(ajustes.forma);
      }
    }
    this.matriz.avancarBloco();

    // Notas (só se alguma estiver soando)
    let algumaAtiva = false;
    for (const voz of this.vozes) if (voz.ativa) algumaAtiva = true;

    // Troca de wavetable (em cada oscilador): sem notas, troca direto; com notas,
    // abaixa só aquele oscilador (ganho 0, o nível desce suave em poucos ms), troca
    // quando todas as notas chegaram no silêncio e sobe de novo.
    // O mesmo vale para a troca do modo de Warp (muda o jeito de ler a onda).
    for (let k = 0; k < this.oscs.length; k++) {
      const osc = this.oscs[k];
      if (!osc.tabelaNova && osc.warpNovo === null) continue;
      let silencio = true;
      for (const voz of this.vozes) if (voz.ativa && voz.oscs[k].nivel > 0.001) silencio = false;
      if (!algumaAtiva || silencio) {
        if (osc.tabelaNova) osc.ajustes.tabela = osc.tabelaNova;
        if (osc.warpNovo !== null) osc.ajustes.warpModo = osc.warpNovo;
        osc.tabelaNova = null;
        osc.warpNovo = null;
        osc.ajustes.ganho = 1;
      } else {
        osc.ajustes.ganho = 0;
      }
    }
    if (algumaAtiva) this.processarVozes(saidaE, saidaD, tamanhoBloco, parametros);
    this.modularEfeitos();

    // Efeitos, sempre depois das notas somadas. Rodam mesmo sem notas, para a
    // cauda do reverb e os ecos do delay terminarem (quando tudo silencia, dormem).
    // Economia (bateria): um efeito que está recebendo silêncio e soltando silêncio há mais
    // de ESPERA_SILENCIO fica "parado" (nem é chamado) até chegar som de novo. Mesmo LIGADO.
    // Filtro Track: a nota de referência é a da voz da nota tocada por último ("ruidoDona" é
    // essa voz, nos dois modos), já com o Glide (altura em semitons)
    if (this.ruidoDona) this.filtroTrack.notaReferencia = this.ruidoDona.altura;
    let pico = picoDoBloco(saidaE, saidaD, tamanhoBloco);
    for (const item of this.cadeiaEfeitos) {
      const entradaSilenciosa = pico < LIMIAR_SILENCIO;
      if (item.parado) {
        if (entradaSilenciosa) {
          // silêncio entra, silêncio sai: nada a fazer (só o LFO dos efeitos que têm um anda)
          if (!item.efeito.dormindo) item.efeito.pular?.(tamanhoBloco);
          continue;
        }
        item.parado = false; // chegou som: acorda
        item.silencio = 0;
      }
      item.efeito.processar(saidaE, saidaD, tamanhoBloco);
      pico = picoDoBloco(saidaE, saidaD, tamanhoBloco);
      item.silencio = entradaSilenciosa && pico < LIMIAR_SILENCIO ? item.silencio + tamanhoBloco : 0;
      if (item.silencio > this.esperaSilencio) item.parado = true;
    }

    // Volume geral (suave: a barra usa rampas) e soft clipper
    const volume = parametros.volume;
    if (volume.length > 1) {
      for (let i = 0; i < tamanhoBloco; i++) {
        saidaE[i] *= volume[i];
        saidaD[i] *= volume[i];
      }
    } else if (volume[0] !== 1) {
      const g = volume[0];
      for (let i = 0; i < tamanhoBloco; i++) {
        saidaE[i] *= g;
        saidaD[i] *= g;
      }
    }
    // Silêncio há um tempo (mais que o atraso do clipper): nem passa por ele
    this.silencioSaida = pico * (volume[0] || 1) < LIMIAR_SILENCIO ? this.silencioSaida + tamanhoBloco : 0;
    if (this.silencioSaida < 4 * tamanhoBloco) this.clipper.processar(saidaE, saidaD, tamanhoBloco);

    this.enviarAoVivo(); // LFOs livres continuam aparecendo andando mesmo em silêncio
    return true;
  }

  // Knobs dos efeitos ligados a LFO/ENV. Os efeitos tratam todas as notas juntas, então usam
  // as fontes da nota tocada por último (enquanto ela soa); um LFO Livre vale sempre, mesmo
  // sem nota. Sem nenhuma ligação nos efeitos, não faz nada.
  modularEfeitos() {
    const matriz = this.matriz;
    const total = MOD_EFEITOS.length;
    let algum = false;
    for (let j = 0; j < total; j++) {
      if (this.modulandoEfeito[j] || matriz.usa(D_PRIMEIRO_EFEITO + j)) {
        algum = true;
        break;
      }
    }
    if (!algum) return;

    const fontes = this.fontesEfeitos;
    const ultima = this.ruidoDona && this.ruidoDona.envelope.ativo ? this.ruidoDona : null;
    if (ultima) fontes.set(ultima.valoresFontes);
    else fontes.fill(0);
    for (let l = 0; l < INDICES_LFO.length; l++) {
      if (this.ajustesLfo[l].modo !== 'livre') continue;
      const valores = this.valoresLivres[l];
      fontes[INDICES_LFO[l]] = valores[valores.length - 1];
    }
    matriz.somar(fontes, this.modEfeitosAlvo);

    const k = this.suavizarModEfeitos;
    for (let j = 0; j < total; j++) {
      const usa = matriz.usa(D_PRIMEIRO_EFEITO + j);
      if (!usa && !this.modulandoEfeito[j]) continue;
      const m = MOD_EFEITOS[j];
      const base = this.basesEfeitos[m.efeito][m.nome];
      const ajustes = this.efeitos[m.efeito].ajustes;
      if (!usa) {
        // A ligação saiu (já sumiu suavemente): volta ao valor exato do knob
        ajustes[m.nome] = base;
        this.modEfeitos[j] = 0;
        this.modulandoEfeito[j] = 0;
        continue;
      }
      this.modEfeitos[j] += (this.modEfeitosAlvo[D_PRIMEIRO_EFEITO + j] - this.modEfeitos[j]) * k;
      ajustes[m.nome] = valorDaPosicao(m, posicaoDoValor(m, base) + this.modEfeitos[j]);
      this.modulandoEfeito[j] = 1;
    }
  }

  processarVozes(saidaE, saidaD, tamanhoBloco, parametros) {
    // Dados iguais para todas as vozes neste bloco.
    this.coef.calcular(parametros.cutoff, parametros.resonancia, tamanhoBloco);
    this.coef2.calcular(parametros.cutoff2, parametros.resonancia2, tamanhoBloco);
    const comum = this.comum;
    for (const { params, ajustes } of this.oscs) {
      ajustes.fine = parametros[params.fine][0];
      ajustes.pan = parametros[params.pan][0];
      ajustes.blend = parametros[params.blend][0];
      ajustes.warp = parametros[params.warp][0];
      ajustes.posicoesWT = parametros[params.wtPos];
      ajustes.detune = parametros[params.detune][0];
      ajustes.width = parametros[params.width][0];
      ajustes.nivel = parametros[params.nivel][0];
    }
    comum.cortes = parametros.cutoff;
    comum.resonancias = parametros.resonancia;
    comum.coef = this.coef;
    comum.cortes2 = parametros.cutoff2;
    comum.resonancias2 = parametros.resonancia2;
    comum.coef2 = this.coef2;
    comum.rotaRuido = this.rotaRuido;
    comum.ruidoLigado = this.ruidoLigado;
    comum.ruidoNivel = parametros.ruido[0];
    comum.ruidoTipo = this.ruidoTipo;
    comum.trechosRuido = this.trechosRuido;
    comum.ruidoModo = this.ruidoModo;
    // One Shot: quanto o nível cai por amostra para chegar a -60 dB no tempo da Duração
    comum.ruidoQueda = Math.exp(Math.log(0.001) / (this.ruidoDuracao * sampleRate));
    comum.ruidoDuracao = this.ruidoDuracao; // (para a Duração modulada)
    comum.ruidoTrack = this.ruidoTrack;
    comum.ruidoPitch = this.ruidoPitch;
    comum.ruidoUnico = this.ruidoUnico;
    comum.ruidoDona = this.ruidoDona;
    comum.matriz = this.matriz;
    comum.ajustesLfo = this.ajustesLfo;
    comum.lfosLivres = this.valoresLivres;

    const [env2, env3] = this.ajustesEnv;
    for (const voz of this.vozes) {
      if (!voz.ativa) continue;
      voz.envelope.definir(
        parametros.ataque[0],
        parametros.decaimento[0],
        parametros.sustentacao[0],
        parametros.soltura[0]
      );
      voz.envsMod[0].definir(env2.ataque, env2.decaimento, env2.sustentacao, env2.soltura);
      voz.envsMod[1].definir(env3.ataque, env3.decaimento, env3.sustentacao, env3.soltura);
      voz.processar(saidaE, saidaD, tamanhoBloco, comum);
    }
  }

  // Manda para a tela o que a nota mais recente está fazendo: quanto cada
  // controle está sendo modulado e onde estão os LFOs (fase e valor).
  enviarAoVivo() {
    if (++this.blocosDesdeEnvio < BLOCOS_ENTRE_ENVIOS) return;
    this.blocosDesdeEnvio = 0;

    // Medidor do compressor (quanto está abaixando, em dB). Dormindo: avisa 0 uma vez.
    if (!this.compressor.dormindo || this.enviouCompressor) {
      const dormindo = this.compressor.dormindo;
      const reducao = this.compressor.lerReducao();
      this.port.postMessage({ tipo: 'compressor', reducao: dormindo ? 0 : reducao });
      this.enviouCompressor = !dormindo;
    }

    // Soft clipper: o maior pico que chegou nele (antes de arredondar), quando passa do ponto
    // em que ele começa a agir; e um 0 quando volta a ficar abaixo (a tela para de avisar).
    const picoSaida = this.clipper.lerPico();
    if (picoSaida > LIMIAR_CLIPPER || this.enviouPico) {
      this.port.postMessage({ tipo: 'clipper', pico: picoSaida > LIMIAR_CLIPPER ? picoSaida : 0 });
      this.enviouPico = picoSaida > LIMIAR_CLIPPER;
    }

    let voz = null;
    for (const v of this.vozes) {
      if (v.envelope.ativo && (!voz || v.idade > voz.idade)) voz = v;
    }
    const algumLivre = this.ajustesLfo.some((a) => a.modo === 'livre');
    if (!voz && !algumLivre) {
      // Nada acontecendo: avisa uma vez só, para a tela esconder os pontinhos.
      if (this.enviouAtivo) this.port.postMessage({ tipo: 'aoVivo', mod: null, lfos: [null, null, null] });
      this.enviouAtivo = false;
      return;
    }

    const lfos = this.ajustesLfo.map((ajustes, l) => {
      if (ajustes.modo === 'livre') {
        return { fase: this.lfosLivres[l].fase, valor: this.valoresLivres[l][this.valoresLivres[l].length - 1] };
      }
      return voz ? { fase: voz.lfos[l].fase, valor: voz.valoresFontes[INDICES_LFO[l]] } : null;
    });
    this.port.postMessage({ tipo: 'aoVivo', mod: voz ? Array.from(voz.mod) : null, lfos });
    this.enviouAtivo = true;
  }
}

registerProcessor('processador-synth', ProcessadorSynth);
