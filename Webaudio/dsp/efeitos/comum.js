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
  // (quem chama suaviza o Width amostra por amostra: ver andarWidth)
  const meio = (e + d) * 0.5;
  const lados = (e - d) * 0.5 * width;
  saida[0] = meio + lados;
  saida[1] = meio - lados;
}

// Um passo do Width suavizado (~10 ms com "s"): girar o knob ou modular com LFO não faz
// "degraus" (antes o Width mudava de uma vez a cada bloco). Chegou perto: encosta no alvo.
export function andarWidth(atual, alvo, s) {
  if (atual === alvo) return atual;
  const novo = atual + (alvo - atual) * s;
  return Math.abs(novo - alvo) < 1e-5 ? alvo : novo;
}
