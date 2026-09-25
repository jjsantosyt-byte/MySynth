// dsp/lfo.js
// LFO = oscilador bem lento que não se ouve: ele "mexe" em outros controles
// (Cutoff, WT Pos...). Devolve valores de -1 a +1.

export const FORMAS_LFO = ['seno', 'triangulo', 'serraSobe', 'serraDesce', 'quadrada', 'aleatorio'];

// Faixa do Rate (a mesma do knob na tela: exponencial de 0,02 a 40 Hz)
export const RATE_MIN = 0.02;
export const RATE_MAX = 40;
const LOG_FAIXA_RATE = Math.log(RATE_MAX / RATE_MIN);

// Rate com modulação: "mod" soma na posição do knob (0 a 1), como nos outros controles.
export function rateModulado(rate, mod) {
  if (mod === 0) return rate;
  const posicao = Math.log(rate / RATE_MIN) / LOG_FAIXA_RATE + mod;
  return RATE_MIN * Math.exp(Math.min(1, Math.max(0, posicao)) * LOG_FAIXA_RATE);
}

// Valor da forma numa posição do ciclo (fase de 0 a 1).
// Todas começam no "zero" ou no início natural da forma.
function valorDaForma(forma, fase, aleatorio) {
  switch (forma) {
    case 'seno':
      return Math.sin(2 * Math.PI * fase);
    case 'triangulo':
      if (fase < 0.25) return 4 * fase;
      if (fase < 0.75) return 2 - 4 * fase;
      return 4 * fase - 4;
    case 'serraSobe':
      return 2 * fase - 1;
    case 'serraDesce':
      return 1 - 2 * fase;
    case 'quadrada':
      return fase < 0.5 ? 1 : -1;
    case 'aleatorio':
      // "Sample & Hold": um valor sorteado a cada ciclo, parado até o próximo.
      return aleatorio;
  }
  return 0;
}

export class EstadoLFO {
  constructor() {
    this.fase = 0;
    this.aleatorio = 0;
  }

  // Volta ao início do ciclo (modo Retrig: a cada nota).
  reiniciar() {
    this.fase = 0;
    this.aleatorio = Math.random() * 2 - 1;
  }

  // Anda "passo" ciclos (ex.: Rate × tempo).
  avancar(passo) {
    this.fase += passo;
    if (this.fase >= 1) {
      this.fase -= Math.floor(this.fase);
      this.aleatorio = Math.random() * 2 - 1;
    }
  }

  valor(forma) {
    return valorDaForma(forma, this.fase, this.aleatorio);
  }
}
