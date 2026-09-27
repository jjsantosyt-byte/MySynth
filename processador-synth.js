// processador-synth.js
// O "motor" de som. Roda num processo de áudio separado (AudioWorklet),
// para o som não falhar mesmo se a tela ficar lenta.
//
// Ele é o "gerente de vozes": cada nota tocada ganha uma voz completa
// (OSC A, B, C + ruído → filtros → envelope). A voz é calculada inteira no motor em C++
// (motor/motor.cpp, etapas F1 e F2); aqui fica só quem toca o quê. A saída é estéreo.
// Efeitos: Saturação, Distorção, Filtro Track, EQ e Compressor também são calculados no C++
// (etapa F3a); Phaser, Flanger, Chorus, Delay e Reverb ainda em JavaScript (dsp/efeitos/).
//
// - Poly: até N notas ao mesmo tempo. Se faltar voz, "rouba" a melhor
//   candidata (uma que já está sumindo, ou a mais antiga) sem estalo.
// - Mono: uma nota por vez (sempre a voz 1), com Legato opcional:
//   deslizar entre teclas não reinicia o envelope.
// - Glide: a nota escorrega até a nova altura (tempo igual para qualquer
//   intervalo). Por padrão só quando as notas estão emendadas; "Sempre" = toda vez.
// - Modulação: LFO 1, 2 e 3, ENV 2 e 3 e Macros ligados a controles (ver dsp/modulacao.js).
//   Tudo calculado no motor em C++ (etapa F2a): LFO em modo Retrig dentro de cada voz; em
//   modo Livre, um só para todas as notas, rodando sem parar. Aqui só os ajustes vão para lá.

import { codigoWarp, W_NENHUM } from './dsp/warp.js';
import { TIPOS_RUIDO } from './dsp/ruido.js';
import { TIPOS_FILTRO } from './dsp/filtro.js';
import { DESTINOS_MOD, D_PRIMEIRO_EFEITO, ligacoesEmNumeros } from './dsp/modulacao.js';
import { MOD_EFEITOS, posicaoDoValor, valorDaPosicao } from './dsp/efeitos/modulaveis.js';
import { FORMAS_LFO } from './dsp/lfo.js';
import { Phaser } from './dsp/efeitos/phaser.js';
import { Flanger } from './dsp/efeitos/flanger.js';
import { Chorus } from './dsp/efeitos/chorus.js';
import { Delay } from './dsp/efeitos/delay.js';
import { Reverb } from './dsp/efeitos/reverb.js';
import { Clipper, LIMIAR_CLIPPER } from './dsp/clipper.js';
import { Ponte, BLOCO, CAMPOS_OSC, CAMPOS_LFO, CAMPOS_VOZ, EFEITOS_NO_MOTOR, ROTAS } from './motor/ponte.js';

const MAX_VOZES = 16;
const MAX_UNISON = 16; // cópias que o motor em C++ comporta (sorteios de início de nota)
const UNISON_MAXIMO = 8; // escolha máxima no app (decisão do dono, 27/09/2026: leveza no celular)

// Uma voz, do lado do JavaScript: só o que o gerente de vozes precisa saber (qual nota, se a
// tecla está segurada, a ordem, a nota esperando) e os sorteios do começo da nota. O som dela
// (osciladores, ruído, filtros, envelopes, modulação, glide) é todo calculado no C++.
class Voz {
  // "indice" = número desta voz (0 a 15) no C++
  constructor(indice, ponte) {
    this.indice = indice;
    this.ponte = ponte;
    this.iMod = ponte.mod(indice); // modulação desta voz no C++ (a tela mostra ao vivo)
    this.iSaida = ponte.vozSaida(indice); // som desta voz no bloco (esquerda; direita BLOCO depois)
    this.nota = null;
    this.segurada = false; // tecla ainda apertada?
    this.idade = 0; // ordem em que a nota começou (para saber qual é a mais antiga)
    this.pendente = null; // nota que vai tocar assim que esta voz terminar de sumir
    this.ruidoNovo = false; // nota nova com ataque: o ruído recomeça (ver processar)
  }

  // O ENV 1 (volume) ainda está soando?
  get envelopeAtivo() {
    return this.ponte.c.vozAtiva(this.indice) === 1;
  }

  // Está fazendo som (ou prestes a fazer)?
  get ativa() {
    return this.envelopeAtivo || this.pendente !== null;
  }

  get nivel() {
    return this.ponte.c.vozNivel(this.indice);
  }

  // Altura atual em semitons (com o glide)
  get altura() {
    return this.ponte.c.vozAltura(this.indice);
  }

  // Começa uma nota. "recomecar" = dispara os envelopes (falso no legato).
  // "ajustesLfo" diz quais LFOs estão em modo Retrig (recomeçam a cada nota).
  // "glide" (opcional): { de: altura de partida em semitons, tempo: segundos }.
  // Os sorteios ficam aqui, na mesma ordem de sempre: pontos de início das cópias de unison
  // (vindo do silêncio) e o valor inicial do S&H dos LFOs em Retrig.
  iniciar(nota, idade, recomecar = true, ajustesLfo = null, glide = null) {
    const ponte = this.ponte;
    const doSilencio = !this.envelopeAtivo;
    if (doSilencio) {
      for (let c = 0; c < MAX_UNISON; c++) ponte.f64[ponte.iFases + c] = Math.random();
    }
    this.nota = nota;
    this.segurada = true;
    this.idade = idade;
    this.pendente = null;
    let retrig = 0;
    const sorteios = [0, 0, 0];
    if (recomecar) {
      this.ruidoNovo = true;
      if (ajustesLfo) {
        for (let l = 0; l < ajustesLfo.length; l++) {
          if (ajustesLfo[l].modo !== 'retrig') continue;
          retrig |= 1 << l;
          sorteios[l] = Math.random() * 2 - 1;
        }
      }
    }
    const temGlide = glide && glide.tempo > 0;
    ponte.c.vozIniciar(this.indice, nota, temGlide ? glide.de : nota, temGlide ? glide.tempo : 0,
      doSilencio ? 1 : 0, recomecar ? 1 : 0, retrig, sorteios[0], sorteios[1], sorteios[2]);
  }

  soltar() {
    this.segurada = false;
    this.ponte.c.vozSoltar(this.indice);
  }

  // Voz roubada: some em ~4 ms e depois toca a nota nova.
  roubar(nota, idade, glide = null) {
    this.segurada = false;
    this.pendente = { nota, idade, glide };
    this.ponte.c.vozSilenciar(this.indice);
  }

  // Calcula o som desta voz (no C++) e SOMA nas saídas (esquerda e direita).
  processar(saidaE, saidaD, tamanhoBloco, comum) {
    // Terminou de sumir e tem nota esperando? Começa ela agora.
    if (this.pendente && !this.envelopeAtivo) {
      const { nota, idade, glide } = this.pendente;
      this.iniciar(nota, idade, true, comum.ajustesLfo, glide);
    }
    if (!this.envelopeAtivo) return;
    // Nota nova (com ataque): o ruído recomeça. One Shot = do início do trecho (todo ataque
    // igual); Loop = de um ponto sorteado (cada nota com um ruído diferente).
    let sorteioRuido = -1;
    if (this.ruidoNovo) {
      sorteioRuido = comum.ruidoModo === 'oneshot' ? 0 : Math.random();
      this.ruidoNovo = false;
    }
    const ponte = this.ponte;
    ponte.c.vozProcessar(this.indice, tamanhoBloco, sorteioRuido, comum.ruidoDona === this ? 1 : 0);
    const f64 = ponte.f64;
    const e = this.iSaida;
    const d = e + BLOCO;
    for (let i = 0; i < tamanhoBloco; i++) {
      saidaE[i] += f64[e + i];
      saidaD[i] += f64[d + i];
    }
  }
}

// Efeito calculado no C++ (Saturação, Distorção, Filtro Track, EQ, Compressor): esta peça só
// guarda os ajustes (a tela manda; a modulação dos knobs mexe) e os escreve na mesa do C++
// antes de cada bloco. O som já está lá dentro (ponte.somE/somD: ver process).
// Mesmo jeito dos efeitos em JavaScript (ajustes, definir, dormindo), mais "noMotor".
class EfeitoNoMotor {
  constructor(ponte, id, ajustes) {
    const { numero, campos, tipos } = EFEITOS_NO_MOTOR[id];
    this.ponte = ponte;
    this.numero = numero;
    this.campos = campos;
    this.tipos = tipos ?? null;
    this.ajustes = ajustes;
    this.noMotor = true;
    this.iAjustes = ponte.c.enderecoAjustesEfeito(numero) / 8;
  }

  get dormindo() {
    return this.ponte.c.efeitoDormindo(this.numero) === 1;
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.ligado) this.ponte.c.efeitoAcordar(this.numero);
  }

  // Memória limpa (depois de um conserto): como novo
  zerar() {
    this.ponte.c.efeitoZerar(this.numero);
  }

  // Ajustes → mesa do C++ (liga/desliga = 1/0; tipo = número na lista, desconhecido = o 1º),
  // depois processa o som que está em ponte.somE/somD. Um valor inválido (NaN, infinito,
  // texto) é ignorado: fica o último valor bom.
  processar(tamanhoBloco) {
    const f64 = this.ponte.f64;
    const a = this.ajustes;
    for (let k = 0; k < this.campos.length; k++) {
      const nome = this.campos[k];
      const v = a[nome];
      if (nome === 'tipo') f64[this.iAjustes + k] = Math.max(0, this.tipos.indexOf(v));
      else if (typeof v === 'boolean') f64[this.iAjustes + k] = v ? 1 : 0;
      else if (Number.isFinite(v)) f64[this.iAjustes + k] = v;
    }
    this.ponte.c.efeitoProcessar(this.numero, tamanhoBloco);
  }
}

// Filtro Track: a troca de tipo passa pela transição suave do filtro (ftTipo) e o Cutoff
// segue a nota de referência (a última nota tocada, com o Glide)
class FiltroTrack extends EfeitoNoMotor {
  constructor(ponte) {
    super(ponte, 'filtroTrack', { ligado: false, tipo: 'lp24', nota: 72, track: 1, reso: 0.2, mix: 1 });
    this.notaReferencia = 60; // o motor atualiza a cada bloco (última nota tocada)
    this.tipoAtual = 'lp24';
    this.iReferencia = this.iAjustes + this.campos.indexOf('referencia');
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.tipo !== this.tipoAtual) {
      this.ponte.c.ftTipo(TIPOS_FILTRO.indexOf(this.ajustes.tipo));
      this.tipoAtual = this.ajustes.tipo;
    }
    if (this.ajustes.ligado) this.ponte.c.efeitoAcordar(this.numero);
  }

  // Volta com o tipo padrão (LP 24)
  zerar() {
    super.zerar();
    this.tipoAtual = 'lp24';
  }

  processar(tamanhoBloco) {
    this.ponte.f64[this.iReferencia] = this.notaReferencia;
    super.processar(tamanhoBloco);
  }
}

// A cada quantos blocos o recado do soft clipper vai para a tela (~6 vezes por segundo; o
// pico é o maior desde a última leitura, então nada escapa).
const BLOCOS_ENTRE_ENVIOS = Math.round(sampleRate / 128 / 6);

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

// Algum valor inválido no bloco (NaN ou infinito)? "v - v" só é 0 para números normais.
function temInvalido(e, d, n) {
  for (let i = 0; i < n; i++) {
    if (e[i] - e[i] !== 0 || d[i] - d[i] !== 0) return true;
  }
  return false;
}

class ProcessadorSynth extends AudioWorkletProcessor {
  // Uma peça do motor (vozes, um efeito, o clipper) soltou valores inválidos: o bloco vira
  // silêncio (quem chamou limpa a memória da peça) e a tela é avisada de qual peça foi
  // (aparece no console: serve para achar a causa). No máximo 1 aviso por segundo por peça.
  consertar(origem, saidaE, saidaD, tamanhoBloco) {
    saidaE.fill(0, 0, tamanhoBloco);
    saidaD.fill(0, 0, tamanhoBloco);
    if ((this.ultimoConserto[origem] ?? -1) > currentTime - 1) return;
    this.ultimoConserto[origem] = currentTime;
    this.port.postMessage({ tipo: 'consertado', origem });
  }

  // Vozes recriadas do zero (depois de um conserto). No C++ elas voltam com o tipo e o
  // liga/desliga dos filtros que estavam escolhidos.
  recriarVozes() {
    for (let v = 0; v < this.vozes.length; v++) {
      Object.assign(this.vozes[v], new Voz(v, this.ponte));
      this.ponte.c.vozZerar(v);
    }
    this.ruidoDona = null;
    this.notasPresas = [];
  }

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

  constructor(opcoes) {
    super();
    // Motor em C++ (motor/motor.wasm), já compilado pela tela e entregue aqui. As partes do
    // som passam para o C++ etapa por etapa (e o JavaScript delas é apagado).
    // F1: os osciladores das notas estão no C++ (ver motor/ponte.js).
    // F2a: a modulação (LFOs, ENV 2/3, Macros, soma das ligações) e o ENV 1 também.
    this.ponte = new Ponte(opcoes.processorOptions.moduloWasm, sampleRate, DESTINOS_MOD.length);
    this.port.postMessage({ tipo: 'wasm', versao: this.ponte.c.versao() });
    this.vozes = Array.from({ length: MAX_VOZES }, (_, v) => new Voz(v, this.ponte));
    // Rota de filtro do ruído: 'f1', 'f2', 'f12' (1 depois 2) ou 'f21' (2 depois 1)
    this.rotaRuido = 'f1';
    this.ultimoConserto = {}; // hora do último aviso de conserto de cada peça

    // Osciladores A, B, C. "ajustes" vai para o C++ a cada bloco (ver processarVozes).
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
      tabelaNova: 0, // wavetable esperando para entrar (troca sem estalo; 0 = nenhuma)
      warpNovo: null, // modo de Warp esperando para entrar (troca sem estalo, igual à wavetable)
      ajustes: {
        tabela: 0, // wavetable em uso: endereço dela no C++ (0 = nenhuma ainda)
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
    this.tabelas = new Map(); // wavetables recebidas da tela (id → endereço no C++)
    this.tabelasSoltas = []; // substituídas/esquecidas: apagadas quando ninguém mais usa

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

    // Modulação (as contas estão no C++; aqui ficam os ajustes, mandados a cada bloco)
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
    // Os 5 primeiros são calculados no C++ (valores iniciais = os dos antigos em JavaScript)
    const ponte = this.ponte;
    this.saturacao = new EfeitoNoMotor(ponte, 'saturacao', { ligado: false, tipo: 'fita', drive: 0.3, tom: 1, mix: 1 });
    this.distorcao = new EfeitoNoMotor(ponte, 'distorcao', { ligado: false, tipo: 'suave', drive: 0.4, mix: 1, tom: 1, lowcut: 20 });
    this.filtroTrack = new FiltroTrack(ponte);
    this.eq = new EfeitoNoMotor(ponte, 'eq', { ligado: false, grave: 0, medio: 0, agudo: 0, freq: 1000, q: 1, saida: 0, mix: 1 });
    this.compressor = new EfeitoNoMotor(ponte, 'compressor', {
      ligado: false, threshold: -18, ratio: 4, attack: 0.01, release: 0.15, ganho: 0, mix: 1,
    });
    this.phaser = new Phaser(sampleRate);
    this.flanger = new Flanger(sampleRate);
    this.chorus = new Chorus(sampleRate);
    this.delay = new Delay(sampleRate);
    this.reverb = new Reverb(sampleRate);
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
      (id) => ({ id, efeito: this.efeitos[id], silencio: 0, parado: false })
    );
    this.esperaSilencio = ESPERA_SILENCIO * sampleRate;

    // Modulação dos knobs dos efeitos (ver modularEfeitos): o valor escolhido na tela de cada
    // knob ("base") fica guardado aqui; o efeito recebe base + modulação.
    this.basesEfeitos = {};
    for (const [id, efeito] of Object.entries(this.efeitos)) this.basesEfeitos[id] = { ...efeito.ajustes };
    this.modEfeitos = new Float64Array(MOD_EFEITOS.length); // suavizada (~5 ms)
    this.modulandoEfeito = new Uint8Array(MOD_EFEITOS.length); // 1 = o knob está sendo modulado
    this.suavizarModEfeitos = 1 - Math.exp(-128 / (0.005 * sampleRate));

    // Saída: volume geral → soft clipper, SEMPRE ligado (proteção fixa: nunca passa de 0 dB).
    // O motor avisa a tela do maior pico (antes de arredondar) para ela mostrar um recado
    // quando o clipper está segurando bastante.
    this.clipper = new Clipper(sampleRate);
    this.silencioSaida = 0; // amostras seguidas de silêncio na saída (clipper descansa)
    this.enviouPico = false;

    // Macros M1–M4: valor escolhido na tela (o C++ suaviza ~10 ms)
    this.macrosAlvo = new Float64Array(4);

    this.blocosDesdeEnvio = 0; // (recado do soft clipper: ver vigiarClipper)

    this.port.onmessage = (evento) => this.receberMensagem(evento.data);
  }

  receberMensagem(msg) {
    switch (msg.tipo) {
      case 'wavetable': {
        // Qual oscilador: 'A' (padrão), 'B' ou 'C'.
        // A tela manda a tabela inteira só na primeira vez (uma importada grande tem ~9 MB);
        // depois, só o id. As ondas são copiadas para dentro do C++ (ponte.guardarTabela):
        // o motor guarda só o endereço delas (this.tabelas: id → endereço).
        const id = msg.id ?? msg.wavetable?.id;
        if (msg.wavetable) {
          const endereco = this.ponte.guardarTabela(msg.wavetable);
          if (endereco) {
            if (this.tabelas.has(id)) this.tabelasSoltas.push(this.tabelas.get(id)); // substituída
            this.tabelas.set(id, endereco);
          }
        }
        const tabela = this.tabelas.get(id);
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
        // tocando com ela, ele continua até trocar: ver liberarTabelas)
        if (this.tabelas.has(msg.id)) this.tabelasSoltas.push(this.tabelas.get(msg.id));
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
        this.ponte.definirLigacoes(ligacoesEmNumeros(msg.lista));
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
    const macro = { macro1: 0, macro2: 1, macro3: 2, macro4: 3 }[id];
    if (macro !== undefined && typeof ajustes.valor === 'number') {
      this.macrosAlvo[macro] = Math.min(1, Math.max(0, ajustes.valor));
    }
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
      ajustesOsc(achado[1]).unison = Math.min(UNISON_MAXIMO, Math.max(1, Math.round(valor) || 1));
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
      case 'filtroLigado':
      case 'filtro2Tipo':
      case 'filtro2Ligado': {
        // No C++: Filtro 1 = 0, Filtro 2 = 1; campo 0 = tipo (número em TIPOS_FILTRO; desconhecido
        // = -1, nada muda), campo 1 = liga/desliga. Vale para todas as vozes.
        const numero = nome.startsWith('filtro2') ? 1 : 0;
        if (nome.endsWith('Tipo')) this.ponte.c.definirFiltro(numero, 0, TIPOS_FILTRO.indexOf(valor));
        else this.ponte.c.definirFiltro(numero, 1, valor ? 1 : 0);
        break;
      }
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
    const origem = voz.envelopeAtivo ? voz.altura : this.ultimaNota;
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
    this.ponte.renovar(); // (se a memória do C++ cresceu, as vistas são refeitas)

    // Ajustes da modulação → mesa do C++; lá, no começo do bloco: LFOs livres andam (rodam
    // sempre, mesmo em silêncio; com o Rate modulado, seguem a nota tocada por último),
    // quantidades das ligações andam até o alvo e os Macros andam até o valor escolhido.
    this.enviarAjustesModulacao(parametros);
    this.ponte.c.comecarBloco(this.indiceUltima(), tamanhoBloco);

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
      for (let v = 0; v < this.vozes.length; v++) {
        if (this.vozes[v].ativa && this.ponte.c.oscNivel(v, k) > 0.001) silencio = false;
      }
      if (!algumaAtiva || silencio) {
        if (osc.tabelaNova) osc.ajustes.tabela = osc.tabelaNova;
        if (osc.warpNovo !== null) osc.ajustes.warpModo = osc.warpNovo;
        osc.tabelaNova = 0;
        osc.warpNovo = null;
        osc.ajustes.ganho = 1;
      } else {
        osc.ajustes.ganho = 0;
      }
    }
    if (this.tabelasSoltas.length) this.liberarTabelas();
    if (algumaAtiva) this.processarVozes(saidaE, saidaD, tamanhoBloco, parametros);
    // Proteção: uma conta inválida (NaN/infinito) numa voz se espalharia para sempre (tudo mudo)
    if (algumaAtiva && temInvalido(saidaE, saidaD, tamanhoBloco)) {
      this.consertar('vozes', saidaE, saidaD, tamanhoBloco);
      this.recriarVozes();
    }
    this.modularEfeitos();

    // Efeitos, sempre depois das notas somadas. Rodam mesmo sem notas, para a
    // cauda do reverb e os ecos do delay terminarem (quando tudo silencia, dormem).
    // Economia (bateria): um efeito que está recebendo silêncio e soltando silêncio há mais
    // de ESPERA_SILENCIO fica "parado" (nem é chamado) até chegar som de novo. Mesmo LIGADO.
    // Filtro Track: a nota de referência é a da voz da nota tocada por último ("ruidoDona" é
    // essa voz, nos dois modos), já com o Glide (altura em semitons)
    if (this.ruidoDona) this.filtroTrack.notaReferencia = this.ruidoDona.altura;
    // Efeitos do C++: o som é copiado para dentro dele antes do primeiro e fica lá enquanto
    // os seguintes também forem do C++ (sem cópias de ida e volta entre eles); volta para a
    // saída antes de um efeito em JavaScript (ou no fim).
    const ponte = this.ponte;
    let somE = saidaE; // onde o som está agora: na saída ou dentro do C++ (ponte.somE/somD)
    let somD = saidaD;
    let pico = picoDoBloco(somE, somD, tamanhoBloco);
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
      if (item.efeito.noMotor) {
        if (somE === saidaE) {
          ponte.somE.set(saidaE);
          ponte.somD.set(saidaD);
          somE = ponte.somE;
          somD = ponte.somD;
        }
        item.efeito.processar(tamanhoBloco);
      } else {
        if (somE !== saidaE) {
          saidaE.set(somE.subarray(0, tamanhoBloco));
          saidaD.set(somD.subarray(0, tamanhoBloco));
          somE = saidaE;
          somD = saidaD;
        }
        item.efeito.processar(saidaE, saidaD, tamanhoBloco);
      }
      if (temInvalido(somE, somD, tamanhoBloco)) {
        // Conta inválida neste efeito: limpa a memória dele (fica como novo, com os mesmos ajustes)
        this.consertar(item.id, somE, somD, tamanhoBloco);
        const ajustes = { ...item.efeito.ajustes };
        if (item.efeito.zerar) item.efeito.zerar(); // (efeitos no C++)
        else Object.assign(item.efeito, new item.efeito.constructor(sampleRate));
        item.efeito.definir(ajustes);
      }
      pico = picoDoBloco(somE, somD, tamanhoBloco);
      item.silencio = entradaSilenciosa && pico < LIMIAR_SILENCIO ? item.silencio + tamanhoBloco : 0;
      if (item.silencio > this.esperaSilencio) item.parado = true;
    }
    if (somE !== saidaE) {
      saidaE.set(somE.subarray(0, tamanhoBloco));
      saidaD.set(somD.subarray(0, tamanhoBloco));
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
    // O clipper guarda um pouco de memória: um valor inválido o deixaria mudo para sempre
    if (temInvalido(saidaE, saidaD, tamanhoBloco)) {
      this.consertar('clipper', saidaE, saidaD, tamanhoBloco);
      Object.assign(this.clipper, new Clipper(sampleRate));
    }

    this.vigiarClipper();
    return true;
  }

  // Apaga do C++ as wavetables soltas (substituídas ou esquecidas) que nenhum oscilador
  // está usando nem esperando para usar.
  liberarTabelas() {
    this.tabelasSoltas = this.tabelasSoltas.filter((t) => {
      const emUso = this.oscs.some((o) => o.ajustes.tabela === t || o.tabelaNova === t);
      if (!emUso) this.ponte.c.apagarTabela(t);
      return emUso;
    });
  }

  // Knobs dos efeitos ligados a LFO/ENV. Os efeitos tratam todas as notas juntas, então usam
  // as fontes da nota tocada por último (enquanto ela soa); um LFO Livre vale sempre, mesmo
  // sem nota. Sem nenhuma ligação nos efeitos, não faz nada.
  modularEfeitos() {
    const ponte = this.ponte;
    const total = MOD_EFEITOS.length;
    let algum = false;
    for (let j = 0; j < total; j++) {
      if (this.modulandoEfeito[j] || ponte.usa(D_PRIMEIRO_EFEITO + j)) {
        algum = true;
        break;
      }
    }
    if (!algum) return;

    // Soma no C++: fontes da nota tocada por último + Macros e LFOs Livres (valem sempre)
    ponte.c.somarEfeitos(this.indiceUltima());
    const f64 = ponte.f64;
    const iAlvo = ponte.iModEfeitos + D_PRIMEIRO_EFEITO;

    const k = this.suavizarModEfeitos;
    for (let j = 0; j < total; j++) {
      const usa = ponte.usa(D_PRIMEIRO_EFEITO + j);
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
      this.modEfeitos[j] += (f64[iAlvo + j] - this.modEfeitos[j]) * k;
      ajustes[m.nome] = valorDaPosicao(m, posicaoDoValor(m, base) + this.modEfeitos[j]);
      this.modulandoEfeito[j] = 1;
    }
  }

  // Índice da voz da nota tocada por último, se ainda soa (-1 = nenhuma). "ruidoDona" é
  // essa voz nos dois modos (Poly e Mono).
  indiceUltima() {
    return this.ruidoDona && this.ruidoDona.envelopeAtivo ? this.ruidoDona.indice : -1;
  }

  // Ajustes dos LFOs, dos envelopes (ENV 1 = knobs da aba ENV; ENV 2 e 3) e dos Macros
  // → mesa de troca do C++ (motor/ponte.js), uma vez por bloco
  enviarAjustesModulacao(parametros) {
    const ponte = this.ponte;
    const f64 = ponte.f64;
    for (let l = 0; l < this.ajustesLfo.length; l++) {
      const a = this.ajustesLfo[l];
      const i = ponte.iAjustesLfo + l * 3;
      f64[i + CAMPOS_LFO.forma] = FORMAS_LFO.indexOf(a.forma); // (desconhecida = -1: valor 0)
      f64[i + CAMPOS_LFO.rate] = a.rate;
      f64[i + CAMPOS_LFO.livre] = a.modo === 'livre' ? 1 : 0;
    }
    const e = ponte.iAjustesEnv;
    f64[e] = parametros.ataque[0];
    f64[e + 1] = parametros.decaimento[0];
    f64[e + 2] = parametros.sustentacao[0];
    f64[e + 3] = parametros.soltura[0];
    for (let k = 0; k < 2; k++) {
      const env = this.ajustesEnv[k];
      const i = e + 4 * (k + 1);
      f64[i] = env.ataque;
      f64[i + 1] = env.decaimento;
      f64[i + 2] = env.sustentacao;
      f64[i + 3] = env.soltura;
    }
    f64.set(this.macrosAlvo, ponte.iMacros);
  }

  processarVozes(saidaE, saidaD, tamanhoBloco, parametros) {
    const comum = this.comum;
    // Ajustes dos 3 osciladores → mesa de troca do C++ (motor/ponte.js), uma vez por bloco
    const ponte = this.ponte;
    const f64 = ponte.f64;
    const C = CAMPOS_OSC;
    for (let k = 0; k < this.oscs.length; k++) {
      const { params, ajustes } = this.oscs[k];
      ajustes.fine = parametros[params.fine][0];
      ajustes.pan = parametros[params.pan][0];
      ajustes.blend = parametros[params.blend][0];
      ajustes.warp = parametros[params.warp][0];
      ajustes.detune = parametros[params.detune][0];
      ajustes.width = parametros[params.width][0];
      ajustes.nivel = parametros[params.nivel][0];
      const a = ponte.iAjustes + k * ponte.nCampos;
      f64[a + C.tabela] = ajustes.tabela;
      f64[a + C.unison] = ajustes.unison;
      f64[a + C.detune] = ajustes.detune;
      f64[a + C.width] = ajustes.width;
      f64[a + C.ligado] = ajustes.ligado ? 1 : 0;
      f64[a + C.nivel] = ajustes.nivel;
      f64[a + C.ganho] = ajustes.ganho;
      f64[a + C.oitava] = ajustes.oitava;
      f64[a + C.semi] = ajustes.semi;
      f64[a + C.fine] = ajustes.fine;
      f64[a + C.pan] = ajustes.pan;
      f64[a + C.blend] = ajustes.blend;
      f64[a + C.fase] = ajustes.fase;
      f64[a + C.rand] = ajustes.rand;
      f64[a + C.warpModo] = ajustes.warpModo;
      f64[a + C.warp] = ajustes.warp;
      // WT Pos: 1 valor (parado) ou 1 por amostra (mexendo)
      const posicoes = parametros[params.wtPos];
      f64.set(posicoes, ponte.iPosicoes + k * 128);
      f64[a + C.qtdPosicoes] = posicoes.length;
    }
    // Ajustes das vozes (rotas, ruído) e Cutoff/Reso dos Filtros 1 e 2 (1 valor ou 1 por
    // amostra) → mesa do C++; lá, os coeficientes dos filtros são calculados uma vez para todas
    const V = CAMPOS_VOZ;
    const iv = ponte.iAjustesVoz;
    for (let k = 0; k < this.oscs.length; k++) f64[iv + V.rotaA + k] = ROTAS[this.oscs[k].ajustes.rota] ?? 0;
    f64[iv + V.rotaRuido] = ROTAS[this.rotaRuido] ?? 0;
    f64[iv + V.ruidoLigado] = this.ruidoLigado ? 1 : 0;
    f64[iv + V.ruidoTipo] = TIPOS_RUIDO.indexOf(this.ruidoTipo);
    f64[iv + V.ruidoNivel] = parametros.ruido[0];
    f64[iv + V.ruidoOneShot] = this.ruidoModo === 'oneshot' ? 1 : 0;
    f64[iv + V.ruidoDuracao] = this.ruidoDuracao;
    f64[iv + V.ruidoTrack] = this.ruidoTrack ? 1 : 0;
    f64[iv + V.ruidoPitch] = this.ruidoPitch;
    f64[iv + V.ruidoUnico] = this.ruidoUnico ? 1 : 0;
    const filtros = [parametros.cutoff, parametros.resonancia, parametros.cutoff2, parametros.resonancia2];
    for (let n = 0; n < 4; n++) {
      f64.set(filtros[n], ponte.iCortesResos + n * BLOCO);
      f64[iv + V.qtdCortes1 + n] = filtros[n].length;
    }
    ponte.c.vozesComecarBloco(tamanhoBloco);

    comum.ruidoModo = this.ruidoModo;
    comum.ruidoDona = this.ruidoDona;
    comum.ajustesLfo = this.ajustesLfo;

    for (const voz of this.vozes) {
      if (voz.ativa) voz.processar(saidaE, saidaD, tamanhoBloco, comum);
    }
  }

  // Recado do soft clipper para a tela (~6 vezes por segundo): o maior pico que chegou nele
  // (antes de arredondar), quando passa do ponto em que ele começa a agir; e um 0 quando volta
  // a ficar abaixo (a tela para de avisar). É o ÚNICO recado frequente: a modulação e o
  // Compressor não mandam valores "ao vivo" (a tela do celular pesava e atrasava as notas).
  vigiarClipper() {
    if (++this.blocosDesdeEnvio < BLOCOS_ENTRE_ENVIOS) return;
    this.blocosDesdeEnvio = 0;
    const picoSaida = this.clipper.lerPico();
    if (picoSaida > LIMIAR_CLIPPER || this.enviouPico) {
      this.port.postMessage({ tipo: 'clipper', pico: picoSaida > LIMIAR_CLIPPER ? picoSaida : 0 });
      this.enviouPico = picoSaida > LIMIAR_CLIPPER;
    }
  }
}

registerProcessor('processador-synth', ProcessadorSynth);
