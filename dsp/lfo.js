// dsp/lfo.js
// LFO = oscilador bem lento que não se ouve: ele "mexe" em outros controles
// (Cutoff, WT Pos...). Devolve valores de -1 a +1.
//
// As contas do LFO estão no motor em C++ (motor/motor.cpp, etapa F2a). Aqui ficam só a
// lista das formas e a faixa do Rate, que a tela usa (e o processador, para mandar a forma
// ao C++ como número: a posição nesta lista).

export const FORMAS_LFO = ['seno', 'triangulo', 'serraSobe', 'serraDesce', 'quadrada', 'aleatorio', 'desenho'];

// LFO desenhado: pontos [x, y, curva] (x = lugar no ciclo, 0 a 1; y = valor, -1 a +1;
// curva do trecho que sai do ponto, -1 a +1, 0 = reta). No máximo 16 (igual no C++).
// Começa com um triângulo (igual à forma "Tri").
export const MAX_PONTOS_LFO = 16;
export const PONTOS_TRIANGULO = [
  [0, 0, 0],
  [0.25, 1, 0],
  [0.75, -1, 0],
  [1, 0, 0],
];
const CURVA_MAXIMA = 8; // curva ±1 → expoente ±8 (igual no C++)

// Confere os pontos como o C++ faz (ordem, limites; 1º em x = 0, último em x = 1).
// Menos de 2 pontos (ou mais de 16): triângulo.
export function arrumarPontos(pontos) {
  if (!Array.isArray(pontos) || pontos.length < 2 || pontos.length > MAX_PONTOS_LFO) {
    return PONTOS_TRIANGULO.map((p) => [...p]);
  }
  const limitar = (v, min, max) => (v >= min ? (v > max ? max : v) : min); // (NaN → min)
  let anterior = 0;
  return pontos.map((p, i) => {
    const [x0, y, c] = Array.isArray(p) ? p.map((v) => Number(v) || 0) : [0, 0, 0];
    let x = i === 0 ? 0 : i === pontos.length - 1 ? 1 : x0;
    x = limitar(x, anterior, 1);
    anterior = x;
    return [x, limitar(y, -1, 1), limitar(c, -1, 1)];
  });
}

// Valor do LFO desenhado no lugar "fase" (0 a 1) do ciclo — mesma conta do C++ (motor.cpp,
// DesenhoLfo::valor). "pontos" já arrumados (arrumarPontos). Usado pela tela para desenhar.
export function valorDesenho(pontos, fase) {
  const qtd = pontos.length;
  if (qtd < 2) return 0;
  let i = 0;
  while (i + 2 < qtd && fase >= pontos[i + 1][0]) i++;
  const [xa, ya, c] = pontos[i];
  const [xb, yb] = pontos[i + 1];
  const largura = xb - xa;
  if (largura <= 0) return yb;
  let t = Math.min(1, (fase - xa) / largura);
  const k = Math.abs(c) < 1e-6 ? 0 : c * CURVA_MAXIMA;
  if (k !== 0) t = (Math.exp(k * t) - 1) / (Math.exp(k) - 1);
  return ya + (yb - ya) * t;
}

// Faixa do Rate (a mesma do knob na tela: exponencial de 0,02 a 40 Hz; igual no C++)
export const RATE_MIN = 0.02;
export const RATE_MAX = 40;
