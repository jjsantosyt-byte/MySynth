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
//
// Organização: os "coeficientes" (contas que dependem só do Cutoff e da Reso)
// ficam em CoeficientesFiltro e são calculados uma vez e compartilhados por
// todas as vozes. Cada voz tem seus próprios Filtros (a "memória" do filtro).

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

const TAMANHO_BLOCO = 128;

// Coeficientes do filtro para um bloco de áudio: 1 valor (Cutoff/Reso parados)
// ou 1 por amostra (Cutoff/Reso mudando).
export class CoeficientesFiltro {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.freqMaxima = Math.min(20000, 0.45 * taxaAmostragem);
    this.variavel = false; // true = um valor por amostra
    for (const nome of ['k', 'compensacao', 'a1', 'a2', 'a3', 'b1', 'b2', 'b3']) {
      this[nome] = new Float64Array(TAMANHO_BLOCO);
    }
  }

  // cortes/resonancias: listas do motor de som (1 valor ou 1 por amostra).
  calcular(cortes, resonancias, tamanhoBloco) {
    this.variavel = cortes.length > 1 || resonancias.length > 1;
    const qtd = this.variavel ? tamanhoBloco : 1;
    for (let j = 0; j < qtd; j++) {
      const corte = cortes.length > 1 ? cortes[j] : cortes[0];
      const resonancia = resonancias.length > 1 ? resonancias[j] : resonancias[0];
      const f = Math.min(Math.max(corte, 20), this.freqMaxima);
      const g = Math.tan((Math.PI * f) / this.taxa);

      // Estágio 1: com a ressonância escolhida.
      const k = amortecimento(resonancia);
      this.k[j] = k;
      this.compensacao[j] = compensacaoResonancia(resonancia);
      this.a1[j] = 1 / (1 + g * (g + k));
      this.a2[j] = g * this.a1[j];
      this.a3[j] = g * this.a2[j];

      // Estágio 2 (só para o LP 24): sem ressonância extra, só aumenta o corte.
      this.b1[j] = 1 / (1 + g * (g + Math.SQRT2));
      this.b2[j] = g * this.b1[j];
      this.b3[j] = g * this.b2[j];
    }
  }
}

export class Filtro {
  constructor(taxaAmostragem) {
    // Pesos de cada tipo: trocar de tipo faz uma transição de ~5 ms (sem estalo).
    this.pesos = [0, 1, 0, 0];
    this.alvos = [0, 1, 0, 0];
    // Liga/desliga também é gradual: 0 = som direto, 1 = som filtrado.
    this.mistura = 0;
    this.alvoMistura = 0;
    this.suavizar = 1 - Math.exp(-1 / (0.005 * taxaAmostragem));
    this.reiniciar();
  }

  // Zera a "memória" do filtro (usado quando a voz começa do silêncio).
  // Tipo e liga/desliga vão direto para o valor escolhido (a voz estava muda).
  reiniciar() {
    this.s1 = 0;
    this.s2 = 0;
    this.s3 = 0;
    this.s4 = 0;
    for (let j = 0; j < this.alvos.length; j++) this.pesos[j] = this.alvos[j];
    this.mistura = this.alvoMistura;
  }

  definirTipo(tipo) {
    const indice = TIPOS_FILTRO.indexOf(tipo);
    if (indice < 0) return;
    for (let j = 0; j < this.alvos.length; j++) this.alvos[j] = j === indice ? 1 : 0;
  }

  definirLigado(ligado) {
    this.alvoMistura = ligado ? 1 : 0;
  }

  // Filtra uma amostra. "c" = coeficientes; "j" = posição deles no bloco.
  processar(x, c, j) {
    const k = c.k[j];

    // Estágio 1
    const v3 = x - this.s2;
    const v1 = c.a1[j] * this.s1 + c.a2[j] * v3;
    const v2 = this.s2 + c.a2[j] * this.s1 + c.a3[j] * v3;
    this.s1 = 2 * v1 - this.s1;
    this.s2 = 2 * v2 - this.s2;

    const passaBaixas = v2;
    const passaBanda = k * v1; // ajustado para não ficar mais alto que o original
    const passaAltas = x - k * v1 - v2;

    // Estágio 2: passa-baixas de novo, em cima do primeiro (LP 24)
    const w3 = passaBaixas - this.s4;
    const w1 = c.b1[j] * this.s3 + c.b2[j] * w3;
    const w2 = this.s4 + c.b2[j] * this.s3 + c.b3[j] * w3;
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
      (p[0] * passaBaixas + p[1] * passaBaixas24 + p[2] * passaAltas) * c.compensacao[j] +
      p[3] * passaBanda;

    this.mistura += (this.alvoMistura - this.mistura) * s;
    return x + this.mistura * (filtrado - x);
  }
}
