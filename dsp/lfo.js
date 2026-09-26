// dsp/lfo.js
// LFO = oscilador bem lento que não se ouve: ele "mexe" em outros controles
// (Cutoff, WT Pos...). Devolve valores de -1 a +1.
//
// As contas do LFO estão no motor em C++ (motor/motor.cpp, etapa F2a). Aqui ficam só a
// lista das formas e a faixa do Rate, que a tela usa (e o processador, para mandar a forma
// ao C++ como número: a posição nesta lista).

export const FORMAS_LFO = ['seno', 'triangulo', 'serraSobe', 'serraDesce', 'quadrada', 'aleatorio'];

// Faixa do Rate (a mesma do knob na tela: exponencial de 0,02 a 40 Hz; igual no C++)
export const RATE_MIN = 0.02;
export const RATE_MAX = 40;
