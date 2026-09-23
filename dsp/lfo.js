// dsp/lfo.js
// LFO = oscilador bem lento que não se ouve: ele "mexe" em outros controles
// (Cutoff, WT Pos...). Devolve valores de -1 a +1.

export const FORMAS_LFO = ['seno', 'triangulo', 'serraSobe', 'serraDesce', 'quadrada', 'aleatorio'];

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
