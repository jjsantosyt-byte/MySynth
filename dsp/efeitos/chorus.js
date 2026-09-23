// dsp/efeitos/chorus.js
// Chorus: cópias do som levemente atrasadas, com o atraso "balançando"
// devagar. Isso desafina as cópias um pouquinho, para cima e para baixo,
// e o som fica mais largo e cheio (como vários instrumentos tocando juntos).
//
// - Rate: velocidade do balanço (0,05 a 5 Hz).
// - Depth: quanto o atraso balança (quanto desafina).
// - 2 cópias por lado, com o balanço defasado entre elas e entre os lados:
//   é o que abre o estéreo.

import { ganhosMix } from './delay.js';

const ATRASO_BASE = 0.012; // segundos (12 ms)
const PROFUNDIDADE_MAXIMA = 0.006; // segundos (±6 ms com Depth 100%)
const TAMANHO_MEMORIA = 0.03; // segundos

export class Chorus {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.tamanho = Math.ceil(TAMANHO_MEMORIA * taxaAmostragem);
    this.memE = new Float32Array(this.tamanho);
    this.memD = new Float32Array(this.tamanho);
    this.escrita = 0;
    this.fase = 0; // do balanço (0 a 1)

    this.ajustes = { ligado: false, rate: 0.8, depth: 0.5, mix: 0.5 };
    this.entrada = 0;
    this.seco = 1;
    this.molhado = 0;
    this.profundidade = 0.5;
    this.suavizar = 1 - Math.exp(-1 / (0.01 * taxaAmostragem));
    this.silencio = 0;
    this.dormindo = true;
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.ligado) this.dormindo = false;
  }

  // Lê a memória "atraso" amostras atrás (com interpolação).
  ler(memoria, atraso) {
    let posicao = this.escrita - atraso;
    if (posicao < 0) posicao += this.tamanho;
    const i0 = posicao | 0;
    const i1 = i0 + 1 === this.tamanho ? 0 : i0 + 1;
    return memoria[i0] + (posicao - i0) * (memoria[i1] - memoria[i0]);
  }

  processar(saidaE, saidaD, tamanhoBloco) {
    if (this.dormindo) return;

    const a = this.ajustes;
    const alvoEntrada = a.ligado ? 1 : 0;
    const mix = ganhosMix(a.mix);
    const alvoSeco = a.ligado ? mix.seco : 1;
    const alvoMolhado = mix.molhado;
    const s = this.suavizar;
    const passo = a.rate / this.taxa;
    const base = ATRASO_BASE * this.taxa;
    const amplitude = PROFUNDIDADE_MAXIMA * this.taxa;
    let energia = 0;

    for (let i = 0; i < tamanhoBloco; i++) {
      this.entrada += (alvoEntrada - this.entrada) * s;
      this.seco += (alvoSeco - this.seco) * s;
      this.molhado += (alvoMolhado - this.molhado) * s;
      this.profundidade += (a.depth - this.profundidade) * s;

      this.memE[this.escrita] = saidaE[i] * this.entrada;
      this.memD[this.escrita] = saidaD[i] * this.entrada;

      // Atraso de cada cópia: base ± balanço. As 4 cópias estão a 1/4 de ciclo
      // umas das outras, então bastam um seno e um cosseno:
      // esquerda = base ± seno, direita = base ± cosseno.
      const desvio = amplitude * this.profundidade;
      const angulo = 2 * Math.PI * this.fase;
      const balancoSeno = desvio * Math.sin(angulo);
      const balancoCosseno = desvio * Math.cos(angulo);
      const copiasE = (this.ler(this.memE, base + balancoSeno) + this.ler(this.memE, base - balancoSeno)) * 0.5;
      const copiasD = (this.ler(this.memD, base + balancoCosseno) + this.ler(this.memD, base - balancoCosseno)) * 0.5;

      this.fase += passo;
      if (this.fase >= 1) this.fase -= 1;
      this.escrita = this.escrita + 1 === this.tamanho ? 0 : this.escrita + 1;

      saidaE[i] = saidaE[i] * this.seco + copiasE * this.molhado;
      saidaD[i] = saidaD[i] * this.seco + copiasD * this.molhado;
      energia += copiasE * copiasE + copiasD * copiasD;
    }

    // Desligado e sem cópias audíveis por um tempo: dorme e limpa a memória.
    this.silencio = energia / tamanhoBloco < 1e-10 ? this.silencio + tamanhoBloco : 0;
    if (!a.ligado && this.entrada < 1e-4 && this.silencio > TAMANHO_MEMORIA * this.taxa) {
      this.dormindo = true;
      this.memE.fill(0);
      this.memD.fill(0);
      this.seco = 1;
    }
  }
}
