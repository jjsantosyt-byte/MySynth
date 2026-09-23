// dsp/efeitos/delay.js
// Delay estéreo (eco), com Feedback (quantas repetições) e Ping-pong
// (ecos alternando entre esquerda e direita).
//
// - As repetições perdem um pouco de agudo a cada volta (como os delays
//   analógicos): soa mais natural e nunca fica "ardido".
// - Mudar o Tempo com som tocando: o eco antigo some e o novo entra em ~50 ms
//   (transição suave, sem estalo e sem mudar a afinação dos ecos).
// - Desligar: para de entrar som novo, mas os ecos que já existem terminam
//   naturalmente. Quando tudo silencia, o delay "dorme" e não gasta processamento.

const TEMPO_MAXIMO = 2; // segundos
const FEEDBACK_MAXIMO = 0.95; // abaixo de 1: os ecos sempre acabam sumindo

// Volume do som original e do efeito conforme o Mix (0 a 1).
// Até 50%, o original fica cheio; de 50% a 100%, ele vai sumindo.
export function ganhosMix(mix) {
  return { seco: Math.min(1, 2 * (1 - mix)), molhado: Math.min(1, 2 * mix) };
}

export class Delay {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.tamanho = Math.ceil(TEMPO_MAXIMO * taxaAmostragem) + 4;
    this.linhaE = new Float32Array(this.tamanho);
    this.linhaD = new Float32Array(this.tamanho);
    this.escrita = 0;

    this.ajustes = { ligado: false, tempo: 0.3, feedback: 0.4, mix: 0.3, pingpong: false };

    // Tempo do eco (em amostras). Ao mudar, lê o tempo antigo e o novo ao mesmo
    // tempo e passa de um para o outro numa rampa de ~50 ms.
    this.tempoAtual = 0.3 * taxaAmostragem;
    this.tempoNovo = null;
    this.rampa = 0;
    this.passoRampa = 1 / (0.05 * taxaAmostragem);

    // Valores que andam suavemente até o ajuste escolhido
    this.entrada = 0;
    this.seco = 1;
    this.molhado = 0;
    this.feedback = 0;
    this.suavizar = 1 - Math.exp(-1 / (0.01 * taxaAmostragem)); // ~10 ms

    // Perda de agudo nas repetições (passa-baixas suave em ~6 kHz)
    this.coefAgudo = 1 - Math.exp((-2 * Math.PI * 6000) / taxaAmostragem);
    this.baixasE = 0;
    this.baixasD = 0;

    this.silencio = 0; // quantas amostras seguidas sem eco audível
    this.dormindo = true;
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.ligado) this.dormindo = false;
  }

  // Aplica o delay nas saídas (esquerda e direita), no lugar.
  processar(saidaE, saidaD, tamanhoBloco) {
    if (this.dormindo) return;

    const a = this.ajustes;
    const alvoEntrada = a.ligado ? 1 : 0;
    const mix = ganhosMix(a.mix);
    const alvoSeco = a.ligado ? mix.seco : 1; // desligado: original cheio, ecos terminando
    const alvoMolhado = mix.molhado;
    const alvoTempo = Math.min(TEMPO_MAXIMO, Math.max(0.001, a.tempo)) * this.taxa;
    const alvoFeedback = Math.min(FEEDBACK_MAXIMO, Math.max(0, a.feedback));
    const s = this.suavizar;
    const c = this.coefAgudo;
    const tamanho = this.tamanho;
    const linhaE = this.linhaE;
    const linhaD = this.linhaD;
    let energia = 0;

    // Lê a memória "atraso" amostras atrás (com interpolação).
    const ler = (linha, atraso) => {
      let posicao = this.escrita - atraso;
      if (posicao < 0) posicao += tamanho;
      const i0 = posicao | 0;
      const i1 = i0 + 1 === tamanho ? 0 : i0 + 1;
      return linha[i0] + (posicao - i0) * (linha[i1] - linha[i0]);
    };

    for (let i = 0; i < tamanhoBloco; i++) {
      this.entrada += (alvoEntrada - this.entrada) * s;
      this.seco += (alvoSeco - this.seco) * s;
      this.molhado += (alvoMolhado - this.molhado) * s;
      this.feedback += (alvoFeedback - this.feedback) * s;

      // Tempo mudou? Começa a transição do eco antigo para o novo.
      if (this.tempoNovo === null && Math.abs(alvoTempo - this.tempoAtual) > 0.5) {
        this.tempoNovo = alvoTempo;
        this.rampa = 0;
      }

      // Lê o eco
      let ecoE = ler(linhaE, this.tempoAtual);
      let ecoD = ler(linhaD, this.tempoAtual);
      if (this.tempoNovo !== null) {
        this.rampa = Math.min(1, this.rampa + this.passoRampa);
        ecoE += (ler(linhaE, this.tempoNovo) - ecoE) * this.rampa;
        ecoD += (ler(linhaD, this.tempoNovo) - ecoD) * this.rampa;
        if (this.rampa >= 1) {
          this.tempoAtual = this.tempoNovo;
          this.tempoNovo = null;
        }
      }

      // As repetições perdem um pouco de agudo
      this.baixasE += (ecoE - this.baixasE) * c;
      this.baixasD += (ecoD - this.baixasD) * c;

      const entradaE = saidaE[i] * this.entrada;
      const entradaD = saidaD[i] * this.entrada;
      let novoE;
      let novoD;
      if (a.pingpong) {
        // Ping-pong: o som entra só na esquerda; cada repetição troca de lado.
        novoE = (entradaE + entradaD) * 0.5 + this.baixasD * this.feedback;
        novoD = this.baixasE * this.feedback;
      } else {
        novoE = entradaE + this.baixasE * this.feedback;
        novoD = entradaD + this.baixasD * this.feedback;
      }
      // Segurança: nunca deixa acumular além de um limite
      linhaE[this.escrita] = novoE > 4 ? 4 : novoE < -4 ? -4 : novoE;
      linhaD[this.escrita] = novoD > 4 ? 4 : novoD < -4 ? -4 : novoD;
      if (++this.escrita === tamanho) this.escrita = 0;

      saidaE[i] = saidaE[i] * this.seco + ecoE * this.molhado;
      saidaD[i] = saidaD[i] * this.seco + ecoD * this.molhado;
      energia += ecoE * ecoE + ecoD * ecoD;
    }

    // Desligado e sem ecos audíveis por mais tempo que o próprio eco
    // (pode haver eco "a caminho"): dorme e limpa a memória.
    this.silencio = energia / tamanhoBloco < 1e-10 ? this.silencio + tamanhoBloco : 0;
    if (!a.ligado && this.entrada < 1e-4 && this.silencio > this.tempoAtual + tamanhoBloco) {
      this.dormindo = true;
      this.linhaE.fill(0);
      this.linhaD.fill(0);
      this.baixasE = 0;
      this.baixasD = 0;
      this.seco = 1;
    }
  }
}
