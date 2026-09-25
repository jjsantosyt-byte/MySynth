// dsp/efeitos/flanger.js
// Flanger: uma cópia do som com um atraso MUITO curto (menos de 10 ms) que balança.
// Misturada com o original, cava uma "escadinha" de buracos no som que sobe e desce
// → o "jato de avião" clássico.
//
// - Rate: velocidade do balanço (0,02 a 10 Hz).
// - Depth: quanto o atraso balança (100% = de 1/4 até 4× o Delay).
// - Delay: atraso do centro (0,5 a 10 ms; menor = buracos mais espaçados, som mais "agudo").
// - Feedback: parte da cópia volta para dentro (-95% a +95%): mais metálico e "cantado".
//   Positivo e negativo soam diferentes (negativo = mais oco).
// - Stereo: diferença de balanço entre esquerda e direita (0 = iguais; 100% = opostos).
// - Mix: 50% = original e efeito iguais (buracos mais fundos); 100% = só o efeito.

import { ganhosCruzados } from './phaser.js';

const OITAVAS = 2; // Depth 100% = atraso de 1/4 até 4× (±2 oitavas nos buracos)
const ATRASO_MAXIMO = 0.01; // segundos (knob Delay)
const TAMANHO_MEMORIA = ATRASO_MAXIMO * 4 + 0.002; // segundos
const FEEDBACK_MAXIMO = 0.95;

export class Flanger {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.tamanho = Math.ceil(TAMANHO_MEMORIA * taxaAmostragem) + 4;
    this.memE = new Float32Array(this.tamanho);
    this.memD = new Float32Array(this.tamanho);
    this.escrita = 0;
    this.fase = 0; // do LFO (0 a 1)
    this.ajustes = { ligado: false, rate: 0.3, depth: 0.7, atraso: 0.002, feedback: 0.5, stereo: 0.5, mix: 0.5 };
    this.entrada = 0;
    this.seco = 1;
    this.molhado = 0;
    this.feedback = 0.5;
    this.base = 0.002 * taxaAmostragem; // atraso do centro (amostras), anda suavemente
    this.profundidade = 0.7;
    this.deslocamento = 0.25; // Stereo (em ciclos do LFO), anda suavemente
    this.suavizar = 1 - Math.exp(-1 / (0.01 * taxaAmostragem)); // ~10 ms
    this.dormindo = true;
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.ligado) this.dormindo = false;
  }

  // Lê a memória "atraso" amostras atrás, com interpolação cúbica (Hermite):
  // o atraso muda o tempo todo, e a cúbica não "abafa" os agudos como a linha reta.
  ler(memoria, atraso) {
    let posicao = this.escrita - atraso;
    if (posicao < 0) posicao += this.tamanho;
    const n = this.tamanho;
    const i1 = posicao | 0;
    const t = posicao - i1;
    const i0 = i1 === 0 ? n - 1 : i1 - 1;
    const i2 = i1 + 1 === n ? 0 : i1 + 1;
    const i3 = i2 + 1 === n ? 0 : i2 + 1;
    const y0 = memoria[i0];
    const y1 = memoria[i1];
    const y2 = memoria[i2];
    const y3 = memoria[i3];
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + y1;
  }

  processar(saidaE, saidaD, tamanhoBloco) {
    if (this.dormindo) return;

    const a = this.ajustes;
    const mix = ganhosCruzados(a.mix);
    const alvoSeco = a.ligado ? mix.seco : 1;
    const alvoMolhado = a.ligado ? mix.molhado : 0;
    const alvoFeedback = Math.min(FEEDBACK_MAXIMO, Math.max(-FEEDBACK_MAXIMO, a.feedback));
    const alvoBase = Math.min(ATRASO_MAXIMO, Math.max(0.0005, a.atraso)) * this.taxa;
    const alvoProfundidade = Math.min(1, Math.max(0, a.depth));
    const alvoDeslocamento = 0.5 * Math.min(1, Math.max(0, a.stereo));
    const alvoEntrada = a.ligado ? 1 : 0;
    const s = this.suavizar;
    const passoFase = a.rate / this.taxa;
    const doisPi = 2 * Math.PI;

    for (let i = 0; i < tamanhoBloco; i++) {
      this.seco += (alvoSeco - this.seco) * s;
      this.molhado += (alvoMolhado - this.molhado) * s;
      this.feedback += (alvoFeedback - this.feedback) * s;
      this.base += (alvoBase - this.base) * s;
      this.profundidade += (alvoProfundidade - this.profundidade) * s;
      this.deslocamento += (alvoDeslocamento - this.deslocamento) * s;
      const fb = this.feedback;

      // Atraso de cada lado: centro × 2^(±oitavas), balançando num seno
      // (mínimo 3 amostras: a leitura cúbica usa 2 pontos à frente, já escritos)
      const oitavas = OITAVAS * this.profundidade;
      const atrasoE = Math.max(3, this.base * Math.pow(2, oitavas * Math.sin(doisPi * this.fase)));
      const atrasoD = Math.max(3, this.base * Math.pow(2, oitavas * Math.sin(doisPi * (this.fase + this.deslocamento))));
      const copiaE = this.ler(this.memE, atrasoE);
      const copiaD = this.ler(this.memD, atrasoD);
      // O som entra na memória aos poucos ao ligar (sem isso, a cópia começaria de repente
      // depois do silêncio da memória vazia: um "tique")
      this.entrada += (alvoEntrada - this.entrada) * s;
      this.memE[this.escrita] = saidaE[i] * this.entrada + fb * copiaE;
      this.memD[this.escrita] = saidaD[i] * this.entrada + fb * copiaD;
      this.escrita = this.escrita + 1 === this.tamanho ? 0 : this.escrita + 1;

      // Com Feedback, o efeito ganha volume nos picos: compensa pela energia média
      const compensa = Math.sqrt(1 - fb * fb);
      saidaE[i] = saidaE[i] * this.seco + copiaE * compensa * this.molhado;
      saidaD[i] = saidaD[i] * this.seco + copiaD * compensa * this.molhado;

      this.fase += passoFase;
      if (this.fase >= 1) this.fase -= 1;
    }

    // Desligado e já sem efeito na mistura: dorme e limpa a memória
    if (!a.ligado && this.molhado < 1e-4 && Math.abs(this.seco - 1) < 1e-4) {
      this.dormindo = true;
      this.memE.fill(0);
      this.memD.fill(0);
      this.entrada = 0;
      this.seco = 1;
      this.molhado = 0;
    }
  }
}
