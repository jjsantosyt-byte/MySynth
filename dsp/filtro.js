// dsp/filtro.js
// Filtro do synth, do tipo "SVF" (state variable filter) em versão digital
// estável (TPT). Por que esse tipo:
// - Aguenta o Cutoff mudando rápido (LFOs, envelopes) sem estalos nem "zíper".
// - Com ressonância alta ele assobia, mas não "explode".
// - Um só cálculo já entrega passa-baixas, passa-altas e passa-banda.
//
// Tipos:
//   lp12 = passa-baixas 12 dB/oitava (corta agudos, mais suave)
//   lp24 = passa-baixas 24 dB/oitava (corta agudos, mais forte)
//   hp   = passa-altas (corta graves)
//   bp   = passa-banda (deixa passar só uma faixa)

export const TIPOS_FILTRO = ['lp12', 'lp24', 'hp', 'bp'];

// Converte a ressonância (0 a 1) no "amortecimento" do filtro.
// 2 = sem ressonância; 0,1 = ressonância forte (assobio), mas ainda estável.
export function amortecimento(resonancia) {
  return 2 - 1.9 * Math.min(1, Math.max(0, resonancia));
}

// Com ressonância alta o pico fica muito mais alto que o resto do som.
// Para não estourar, o volume do LP/HP baixa conforme a ressonância sobe
// (como em vários synths analógicos). O BP já é ajustado de outro jeito.
export function compensacaoResonancia(resonancia) {
  return 1 / (1 + 1.5 * Math.min(1, Math.max(0, resonancia)));
}

export class Filtro {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.freqMaxima = Math.min(20000, 0.45 * taxaAmostragem);

    // Pesos de cada tipo: trocar de tipo faz uma transição de ~5 ms (sem estalo).
    this.pesos = [0, 1, 0, 0];
    this.alvos = [0, 1, 0, 0];
    // Liga/desliga também é gradual: 0 = som direto, 1 = som filtrado.
    this.mistura = 0;
    this.alvoMistura = 0;
    this.suavizar = 1 - Math.exp(-1 / (0.005 * taxaAmostragem));

    this.reiniciar();
    this.definirCorte(1000, 0);
  }

  // Zera a "memória" do filtro (usado quando a voz começa do silêncio).
  reiniciar() {
    this.s1 = 0;
    this.s2 = 0;
    this.s3 = 0;
    this.s4 = 0;
  }

  definirTipo(tipo) {
    const indice = TIPOS_FILTRO.indexOf(tipo);
    if (indice < 0) return;
    for (let j = 0; j < this.alvos.length; j++) this.alvos[j] = j === indice ? 1 : 0;
  }

  definirLigado(ligado) {
    this.alvoMistura = ligado ? 1 : 0;
  }

  // Cutoff em Hz; ressonância de 0 a 1.
  definirCorte(frequencia, resonancia) {
    const f = Math.min(Math.max(frequencia, 20), this.freqMaxima);
    const g = Math.tan((Math.PI * f) / this.taxa);

    // Estágio 1: com a ressonância escolhida.
    const k = amortecimento(resonancia);
    this.k = k;
    this.compensacao = compensacaoResonancia(resonancia);
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;

    // Estágio 2 (só para o LP 24): sem ressonância extra, só aumenta o corte.
    const k2 = Math.SQRT2;
    this.b1 = 1 / (1 + g * (g + k2));
    this.b2 = g * this.b1;
    this.b3 = g * this.b2;
  }

  // Filtra uma amostra.
  processar(x) {
    // Estágio 1
    const v3 = x - this.s2;
    const v1 = this.a1 * this.s1 + this.a2 * v3;
    const v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    this.s1 = 2 * v1 - this.s1;
    this.s2 = 2 * v2 - this.s2;

    const passaBaixas = v2;
    const passaBanda = this.k * v1; // ajustado para não ficar mais alto que o original
    const passaAltas = x - this.k * v1 - v2;

    // Estágio 2: passa-baixas de novo, em cima do primeiro (LP 24)
    const w3 = passaBaixas - this.s4;
    const w1 = this.b1 * this.s3 + this.b2 * w3;
    const w2 = this.s4 + this.b2 * this.s3 + this.b3 * w3;
    this.s3 = 2 * w1 - this.s3;
    this.s4 = 2 * w2 - this.s4;
    const passaBaixas24 = w2;

    // Mistura os tipos conforme os pesos (que andam suavemente até o tipo escolhido).
    const p = this.pesos;
    const s = this.suavizar;
    p[0] += (this.alvos[0] - p[0]) * s;
    p[1] += (this.alvos[1] - p[1]) * s;
    p[2] += (this.alvos[2] - p[2]) * s;
    p[3] += (this.alvos[3] - p[3]) * s;
    const filtrado =
      (p[0] * passaBaixas + p[1] * passaBaixas24 + p[2] * passaAltas) * this.compensacao +
      p[3] * passaBanda;

    this.mistura += (this.alvoMistura - this.mistura) * s;
    return x + this.mistura * (filtrado - x);
  }
}
