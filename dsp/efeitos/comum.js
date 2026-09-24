// dsp/efeitos/comum.js
// Pecinhas usadas por vários efeitos.

// Coeficiente de um filtro simples de 1 polo (passa-baixas) na frequência "fc".
// Uso: estado += (entrada - estado) * coef  → "estado" é o som sem os agudos acima de fc;
// "entrada - estado" é o som sem os graves abaixo de fc (passa-altas).
export function coefPolo(fc, taxa) {
  return 1 - Math.exp((-2 * Math.PI * Math.min(fc, 0.45 * taxa)) / taxa);
}

// Width do som do efeito (0 = mono, no meio; 1 = estéreo como veio).
// Divide em "meio" (o que é igual nos dois lados) e "lados" (a diferença) e
// diminui só os lados. Devolve [esquerda, direita] no objeto "saida" (sem criar lixo).
export function aplicarWidth(e, d, width, saida) {
  const meio = (e + d) * 0.5;
  const lados = (e - d) * 0.5 * width;
  saida[0] = meio + lados;
  saida[1] = meio - lados;
}
