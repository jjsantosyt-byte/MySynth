// dsp/efeitos/eq.js
// EQ de 3 bandas (equalizador): sobe ou desce o volume de partes do som.
//
//   Grave  — "prateleira" abaixo de ~150 Hz (tudo abaixo sobe/desce junto)
//   Médio  — "sino" em volta da Freq (200 Hz a 8 kHz); Q = largura do sino
//            (baixo = largo e musical; alto = estreito, "cirúrgico")
//   Agudo  — "prateleira" acima de ~5 kHz
//   Saída  — volume depois do EQ
//
// Cada banda é um filtro "biquad" (receitas clássicas de R. Bristow-Johnson), nos dois lados.
// Os ajustes andam suavemente (recalculados a cada bloco a partir de valores suavizados):
// girar os knobs não estala. Tudo em 0 dB = som exatamente como entrou.

import { ganhosMix } from './delay.js';

const FREQ_GRAVE = 150; // Hz
const FREQ_AGUDO = 5000; // Hz
const RAIZ_METADE = Math.SQRT1_2; // "inclinação" das prateleiras (suave)

// Um filtro biquad nos dois lados (esquerda e direita), forma "transposta II".
class Biquad {
  constructor() {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.z = new Float64Array(4); // memória: [E1, E2, D1, D2]
  }

  limpar() {
    this.z.fill(0);
  }

  // Divide tudo por a0 e guarda
  guardar(b0, b1, b2, a0, a1, a2) {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  // Prateleira de graves (ganho em dB)
  prateleiraGrave(fc, db, taxa) {
    const A = Math.pow(10, db / 40);
    const w = (2 * Math.PI * fc) / taxa;
    const cos = Math.cos(w);
    const alfa = (Math.sin(w) / 2) * Math.sqrt((A + 1 / A) * (1 / RAIZ_METADE - 1) + 2);
    const raiz = 2 * Math.sqrt(A) * alfa;
    this.guardar(
      A * (A + 1 - (A - 1) * cos + raiz),
      2 * A * (A - 1 - (A + 1) * cos),
      A * (A + 1 - (A - 1) * cos - raiz),
      A + 1 + (A - 1) * cos + raiz,
      -2 * (A - 1 + (A + 1) * cos),
      A + 1 + (A - 1) * cos - raiz
    );
  }

  // Prateleira de agudos (ganho em dB)
  prateleiraAguda(fc, db, taxa) {
    const A = Math.pow(10, db / 40);
    const w = (2 * Math.PI * fc) / taxa;
    const cos = Math.cos(w);
    const alfa = (Math.sin(w) / 2) * Math.sqrt((A + 1 / A) * (1 / RAIZ_METADE - 1) + 2);
    const raiz = 2 * Math.sqrt(A) * alfa;
    this.guardar(
      A * (A + 1 + (A - 1) * cos + raiz),
      -2 * A * (A - 1 + (A + 1) * cos),
      A * (A + 1 + (A - 1) * cos - raiz),
      A + 1 - (A - 1) * cos + raiz,
      2 * (A - 1 - (A + 1) * cos),
      A + 1 - (A - 1) * cos - raiz
    );
  }

  // Sino (ganho em dB, largura Q)
  sino(fc, db, q, taxa) {
    const A = Math.pow(10, db / 40);
    const w = (2 * Math.PI * Math.min(fc, 0.45 * taxa)) / taxa;
    const cos = Math.cos(w);
    const alfa = Math.sin(w) / (2 * q);
    this.guardar(1 + alfa * A, -2 * cos, 1 - alfa * A, 1 + alfa / A, -2 * cos, 1 - alfa / A);
  }

  // Filtra uma amostra do lado "lado" (0 = esquerda, 1 = direita)
  processar(x, lado) {
    const z = this.z;
    const k = lado * 2;
    const y = this.b0 * x + z[k];
    z[k] = this.b1 * x - this.a1 * y + z[k + 1];
    z[k + 1] = this.b2 * x - this.a2 * y;
    return y;
  }
}

export class Eq {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.ajustes = { ligado: false, grave: 0, medio: 0, agudo: 0, freq: 1000, q: 1, saida: 0, mix: 1 };
    this.bandaGrave = new Biquad();
    this.bandaMedia = new Biquad();
    this.bandaAguda = new Biquad();
    // Valores suavizados (andam até o ajuste a cada bloco)
    this.atual = { grave: 0, medio: 0, agudo: 0, freq: 1000, q: 1, saida: 0 };
    this.calculado = null; // últimos valores usados nas contas (evita recalcular à toa)
    this.seco = 1;
    this.molhado = 0;
    this.suavizar = 1 - Math.exp(-1 / (0.01 * taxaAmostragem)); // ~10 ms, por amostra
    this.suavizarBloco = 1 - Math.exp(-128 / (0.02 * taxaAmostragem)); // ~20 ms, por bloco
    this.dormindo = true;
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.ligado) this.dormindo = false;
  }

  // Suaviza os ajustes e recalcula os filtros só se algo mudou de verdade
  atualizar() {
    const a = this.ajustes;
    const atual = this.atual;
    const k = this.suavizarBloco;
    atual.grave += (a.grave - atual.grave) * k;
    atual.medio += (a.medio - atual.medio) * k;
    atual.agudo += (a.agudo - atual.agudo) * k;
    atual.saida += (a.saida - atual.saida) * k;
    // Freq e Q andam na escala "multiplicativa" (como o ouvido percebe)
    atual.freq *= Math.pow(a.freq / atual.freq, k);
    atual.q *= Math.pow(a.q / atual.q, k);
    const c = this.calculado;
    if (
      c &&
      Math.abs(c.grave - atual.grave) < 0.01 &&
      Math.abs(c.medio - atual.medio) < 0.01 &&
      Math.abs(c.agudo - atual.agudo) < 0.01 &&
      Math.abs(c.freq / atual.freq - 1) < 0.001 &&
      Math.abs(c.q / atual.q - 1) < 0.001
    ) {
      return;
    }
    this.bandaGrave.prateleiraGrave(FREQ_GRAVE, atual.grave, this.taxa);
    this.bandaMedia.sino(atual.freq, atual.medio, atual.q, this.taxa);
    this.bandaAguda.prateleiraAguda(FREQ_AGUDO, atual.agudo, this.taxa);
    // Guarda os valores usados (reaproveita o mesmo objeto: sem lixo na memória)
    if (c) Object.assign(c, atual);
    else this.calculado = { ...atual };
  }

  processar(saidaE, saidaD, tamanhoBloco) {
    if (this.dormindo) return;
    this.atualizar();

    const a = this.ajustes;
    const mix = ganhosMix(a.mix);
    const alvoSeco = a.ligado ? mix.seco : 1;
    const alvoMolhado = a.ligado ? mix.molhado : 0;
    const s = this.suavizar;
    const ganhoSaida = Math.pow(10, this.atual.saida / 20);
    const g = this.bandaGrave;
    const m = this.bandaMedia;
    const ag = this.bandaAguda;

    for (let i = 0; i < tamanhoBloco; i++) {
      this.seco += (alvoSeco - this.seco) * s;
      this.molhado += (alvoMolhado - this.molhado) * s;
      const e = saidaE[i];
      const d = saidaD[i];
      const eqE = ag.processar(m.processar(g.processar(e, 0), 0), 0) * ganhoSaida;
      const eqD = ag.processar(m.processar(g.processar(d, 1), 1), 1) * ganhoSaida;
      saidaE[i] = e * this.seco + eqE * this.molhado;
      saidaD[i] = d * this.seco + eqD * this.molhado;
    }

    if (!a.ligado && this.molhado < 1e-4 && Math.abs(this.seco - 1) < 1e-4) {
      this.dormindo = true;
      this.bandaGrave.limpar();
      this.bandaMedia.limpar();
      this.bandaAguda.limpar();
      this.seco = 1;
      this.molhado = 0;
    }
  }
}
