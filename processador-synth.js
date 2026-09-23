// processador-synth.js
// O "motor" de som. Roda num processo de áudio separado (AudioWorklet),
// para o som não falhar mesmo se a tela ficar lenta.
//
// Ele é o "gerente de vozes": cada nota tocada ganha uma voz completa
// (unison → filtro → envelope, ver dsp/voz.js). A saída é estéreo.
//
// - Poly: até N notas ao mesmo tempo. Se faltar voz, "rouba" a melhor
//   candidata (uma que já está sumindo, ou a mais antiga) sem estalo.
// - Mono: uma nota por vez (sempre a voz 1), com Legato opcional:
//   deslizar entre teclas não reinicia o envelope.
// - Glide: a nota escorrega até a nova altura (tempo igual para qualquer
//   intervalo). Por padrão só quando as notas estão emendadas; "Sempre" = toda vez.
// - Modulação: LFO 1 e 2, ENV 2 e 3 ligados a controles (ver dsp/modulacao.js).
//   LFO em modo Retrig vive dentro de cada voz; em modo Livre, fica aqui
//   (um só para todas as notas, rodando sem parar).

import { Voz } from './dsp/voz.js';
import { CoeficientesFiltro } from './dsp/filtro.js';
import { MatrizModulacao } from './dsp/modulacao.js';
import { EstadoLFO } from './dsp/lfo.js';
import { Distorcao } from './dsp/efeitos/distorcao.js';
import { Chorus } from './dsp/efeitos/chorus.js';
import { Delay } from './dsp/efeitos/delay.js';
import { Reverb } from './dsp/efeitos/reverb.js';

const MAX_VOZES = 16;
const PEDACO = 32; // amostras por pedaço de modulação (igual ao da voz)
// A cada quantos blocos manda os valores "ao vivo" para a tela (~30 vezes por segundo).
const BLOCOS_ENTRE_ENVIOS = Math.round(sampleRate / 128 / 30);

class ProcessadorSynth extends AudioWorkletProcessor {
  // Controles que a página pode mexer de forma suave.
  static get parameterDescriptors() {
    return [
      // Oscilador: 0 = primeiro frame, 1 = último frame
      { name: 'wtPos', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Unison: Detune e Width de 0 a 1
      { name: 'detune', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'width', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Filtro
      { name: 'cutoff', defaultValue: 2000, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'resonancia', defaultValue: 0.1, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Envelope de volume (tempos em segundos)
      { name: 'ataque', defaultValue: 0.005, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
      { name: 'decaimento', defaultValue: 0.5, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
      { name: 'sustentacao', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'soltura', defaultValue: 0.08, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.tabela = null; // wavetable recebida da página
    this.tabelaNova = null; // wavetable esperando para entrar (troca sem estalo)
    this.volumeTroca = 1; // abaixa até 0 na troca de wavetable e volta a 1
    this.suavizarTroca = 1 - Math.exp(-1 / (0.0015 * sampleRate)); // ~1,5 ms
    this.vozes = Array.from({ length: MAX_VOZES }, () => new Voz(sampleRate));
    this.coef = new CoeficientesFiltro(sampleRate);

    // Opções (a página manda os valores escolhidos logo ao ligar)
    this.modo = 'poly';
    this.maxVozes = 8;
    this.legato = true;
    this.unison = 1;

    this.notasPresas = []; // (modo Mono) notas seguradas, na ordem em que foram tocadas
    this.contador = 0; // numera as notas, para saber qual é a mais antiga

    // Glide: tempo do escorregão (0 = desligado), "sempre" (mesmo sem emendar
    // as notas) e a última nota tocada (de onde a próxima escorrega no Poly).
    this.glideTempo = 0;
    this.glideSempre = false;
    this.ultimaNota = null;
    this.comum = {}; // dados do bloco, compartilhados por todas as vozes

    // Modulação
    this.matriz = new MatrizModulacao(sampleRate);
    this.ajustesLfo = [
      { forma: 'seno', rate: 2, modo: 'retrig' },
      { forma: 'triangulo', rate: 0.5, modo: 'retrig' },
    ];
    this.ajustesEnv = [
      { ataque: 0.005, decaimento: 0.3, sustentacao: 0, soltura: 0.2 },
      { ataque: 0.005, decaimento: 0.3, sustentacao: 0, soltura: 0.2 },
    ];
    // Efeitos (depois das notas somadas): Distorção → Chorus → Delay → Reverb
    this.distorcao = new Distorcao(sampleRate);
    this.chorus = new Chorus(sampleRate);
    this.delay = new Delay(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.efeitos = { distorcao: this.distorcao, chorus: this.chorus, delay: this.delay, reverb: this.reverb };

    this.lfosLivres = [new EstadoLFO(), new EstadoLFO()];
    this.valoresLivres = [new Float64Array(4), new Float64Array(4)]; // 1 valor por pedaço

    // Valores "ao vivo" para a tela (pontinhos que se mexem)
    this.blocosDesdeEnvio = 0;
    this.enviouAtivo = false;

    this.port.onmessage = (evento) => this.receberMensagem(evento.data);
  }

  receberMensagem(msg) {
    switch (msg.tipo) {
      case 'wavetable':
        // Primeira tabela: entra direto. Trocas depois: passam por um "abaixa e sobe"
        // rápido (sem estalo), feito no process().
        if (!this.tabela) this.tabela = msg.wavetable;
        else this.tabelaNova = msg.wavetable;
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
        break;
    }
  }

  // Ajustes de uma fonte de modulação (LFO: forma, rate, modo; ENV: A, D, S, R).
  definirFonte(id, ajustes) {
    const lfo = { lfo1: 0, lfo2: 1 }[id];
    if (lfo !== undefined) Object.assign(this.ajustesLfo[lfo], ajustes);
    const env = { env2: 0, env3: 1 }[id];
    if (env !== undefined) Object.assign(this.ajustesEnv[env], ajustes);
  }

  definirOpcao(nome, valor) {
    switch (nome) {
      case 'modo':
        if (valor !== this.modo) this.soltarTudo();
        this.modo = valor;
        break;
      case 'vozes':
        this.maxVozes = Math.min(MAX_VOZES, Math.max(1, valor));
        break;
      case 'legato':
        this.legato = valor;
        break;
      case 'unison':
        this.unison = Math.min(16, Math.max(1, valor));
        break;
      case 'glide':
        this.glideTempo = Math.max(0, valor);
        break;
      case 'glideSempre':
        this.glideSempre = valor;
        break;
      case 'filtroTipo':
      case 'filtroLigado':
        for (const voz of this.vozes) voz.definirFiltro(nome, valor);
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
    let voz = this.vozes.find((v) => v.ativa && !v.pendente && v.nota === nota);
    if (voz) return voz.iniciar(nota, idade, true, this.ajustesLfo, glide);

    // Uma voz livre (dentro do limite de vozes escolhido)?
    const disponiveis = this.vozes.slice(0, this.maxVozes);
    voz = disponiveis.find((v) => !v.ativa);
    if (voz) return voz.iniciar(nota, idade, true, this.ajustesLfo, glide);

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
      return;
    }
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
    for (let l = 0; l < 2; l++) {
      const ajustes = this.ajustesLfo[l];
      for (let pedaco = 0; pedaco * PEDACO < tamanhoBloco; pedaco++) {
        this.lfosLivres[l].avancar((ajustes.rate * PEDACO) / sampleRate);
        this.valoresLivres[l][pedaco] = this.lfosLivres[l].valor(ajustes.forma);
      }
    }
    this.matriz.avancarBloco();

    // Notas (só se alguma estiver soando)
    let algumaAtiva = false;
    for (const voz of this.vozes) if (voz.ativa) algumaAtiva = true;

    // Troca de wavetable: sem notas, troca direto; com notas, abaixa o volume
    // das notas (~3 ms), troca quando chega no silêncio e sobe de novo.
    if (this.tabelaNova && (!algumaAtiva || this.volumeTroca < 0.001)) {
      this.tabela = this.tabelaNova;
      this.tabelaNova = null;
    }
    if (this.tabela && algumaAtiva) {
      this.processarVozes(saidaE, saidaD, tamanhoBloco, parametros);
      const alvo = this.tabelaNova ? 0 : 1;
      if (alvo !== 1 || this.volumeTroca < 1) {
        for (let i = 0; i < tamanhoBloco; i++) {
          this.volumeTroca += (alvo - this.volumeTroca) * this.suavizarTroca;
          saidaE[i] *= this.volumeTroca;
          saidaD[i] *= this.volumeTroca;
        }
        if (alvo === 1 && this.volumeTroca > 0.9999) this.volumeTroca = 1;
      }
    } else {
      this.volumeTroca = 1;
    }

    // Efeitos, sempre depois das notas somadas. Rodam mesmo sem notas, para a
    // cauda do reverb e os ecos do delay terminarem (quando tudo silencia, dormem).
    this.distorcao.processar(saidaE, saidaD, tamanhoBloco);
    this.chorus.processar(saidaE, saidaD, tamanhoBloco);
    this.delay.processar(saidaE, saidaD, tamanhoBloco);
    this.reverb.processar(saidaE, saidaD, tamanhoBloco);

    this.enviarAoVivo(); // LFOs livres continuam aparecendo andando mesmo em silêncio
    return true;
  }

  processarVozes(saidaE, saidaD, tamanhoBloco, parametros) {
    // Dados iguais para todas as vozes neste bloco.
    this.coef.calcular(parametros.cutoff, parametros.resonancia, tamanhoBloco);
    const comum = this.comum;
    comum.tabela = this.tabela;
    comum.posicoesWT = parametros.wtPos;
    comum.cortes = parametros.cutoff;
    comum.resonancias = parametros.resonancia;
    comum.coef = this.coef;
    comum.unison = this.unison;
    comum.detune = parametros.detune[0];
    comum.width = parametros.width[0];
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

    let voz = null;
    for (const v of this.vozes) {
      if (v.envelope.ativo && (!voz || v.idade > voz.idade)) voz = v;
    }
    const algumLivre = this.ajustesLfo.some((a) => a.modo === 'livre');
    if (!voz && !algumLivre) {
      // Nada acontecendo: avisa uma vez só, para a tela esconder os pontinhos.
      if (this.enviouAtivo) this.port.postMessage({ tipo: 'aoVivo', mod: null, lfos: [null, null] });
      this.enviouAtivo = false;
      return;
    }

    const lfos = this.ajustesLfo.map((ajustes, l) => {
      if (ajustes.modo === 'livre') {
        return { fase: this.lfosLivres[l].fase, valor: this.valoresLivres[l][this.valoresLivres[l].length - 1] };
      }
      return voz ? { fase: voz.lfos[l].fase, valor: voz.valoresFontes[l] } : null;
    });
    this.port.postMessage({ tipo: 'aoVivo', mod: voz ? Array.from(voz.mod) : null, lfos });
    this.enviouAtivo = true;
  }
}

registerProcessor('processador-synth', ProcessadorSynth);
