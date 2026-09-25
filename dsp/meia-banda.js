// dsp/meia-banda.js
// Filtro "meia-banda": usado para trabalhar em taxa DOBRADA (oversampling 2×) e voltar.
// Ex.: a Distorção e o Warp dos osciladores criam agudos além do limite do áudio digital;
// fazendo as contas na taxa dobrada e filtrando antes de voltar, esses agudos são cortados
// em vez de voltarem como chiado (aliasing).
//
// 31 coeficientes, janela de Blackman: corta tudo acima da metade da taxa original.
// Nesse tipo de filtro, metade dos coeficientes é zero: só os outros são calculados.

export const TAPS = 31;
export const MEIO = (TAPS - 1) / 2;

const COEFS = new Float64Array(TAPS);
for (let n = 0; n < TAPS; n++) {
  const k = n - MEIO;
  const sinc = k === 0 ? 0.5 : Math.sin((Math.PI * k) / 2) / (Math.PI * k);
  const janela = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (TAPS - 1));
  COEFS[n] = sinc * janela;
}
// Normaliza para ganho 1 no grave
{
  let soma = 0;
  for (const c of COEFS) soma += c;
  for (let n = 0; n < TAPS; n++) COEFS[n] /= soma;
}
const POSICOES_UTEIS = [];
for (let n = 0; n < TAPS; n++) if (Math.abs(COEFS[n]) > 1e-12) POSICOES_UTEIS.push(n);
const COEFS_UTEIS = Float64Array.from(POSICOES_UTEIS, (n) => COEFS[n]);
const QTD_UTEIS = POSICOES_UTEIS.length;
const DESLOC_UTEIS = Int32Array.from(POSICOES_UTEIS);

// Filtra o histórico circular "h" (posição "p" = amostra mais nova).
export function filtrarMeiaBanda(h, p) {
  let soma = 0;
  for (let u = 0; u < QTD_UTEIS; u++) {
    let j = p - DESLOC_UTEIS[u];
    if (j < 0) j += TAPS;
    soma += COEFS_UTEIS[u] * h[j];
  }
  return soma;
}

// Sobe para a taxa dobrada: recebe 1 amostra, devolve 2 (em "saida[0]" e "saida[1]").
// É o mesmo que intercalar zeros (x, 0, x, 0...) × 2 e passar pelo filtro meia-banda, mas sem
// multiplicar os zeros: na 1ª amostra só entram os coeficientes pares; na 2ª, só o do meio.
// (Metade das contas da versão direta, mesmo resultado.)
const PARES = Float64Array.from({ length: (TAPS + 1) / 2 }, (_, i) => COEFS[2 * i]); // n = 0, 2, 4... 30 (16)
const CENTRO = COEFS[MEIO];
const TAMANHO_HISTORICO = PARES.length; // 16 amostras de entrada
export class Interpolador {
  constructor() {
    this.h = new Float64Array(TAMANHO_HISTORICO);
    this.p = 0;
  }

  limpar() {
    this.h.fill(0);
  }

  processar(x, saida) {
    this.p = this.p + 1 === TAMANHO_HISTORICO ? 0 : this.p + 1;
    this.h[this.p] = 2 * x;
    // Amostra par: coeficiente n = 2i com a entrada de i amostras atrás
    let soma = 0;
    let j = this.p;
    for (let i = 0; i < TAMANHO_HISTORICO; i++) {
      soma += PARES[i] * this.h[j];
      j = j === 0 ? TAMANHO_HISTORICO - 1 : j - 1;
    }
    saida[0] = soma;
    // Amostra ímpar: só o coeficiente do meio (n = 15), com a entrada de 7 amostras atrás
    let k = this.p - (MEIO - 1) / 2;
    if (k < 0) k += TAMANHO_HISTORICO;
    saida[1] = CENTRO * this.h[k];
  }
}

// Desce da taxa dobrada para a original: recebe 2 amostras, devolve 1 (já filtrada).
// Atraso: MEIO / 2 = 7,5 amostras na taxa original.
export class Decimador {
  constructor() {
    this.h = new Float64Array(TAPS);
    this.p = 0;
  }

  limpar() {
    this.h.fill(0);
  }

  processar(a, b) {
    this.p = this.p + 1 === TAPS ? 0 : this.p + 1;
    this.h[this.p] = a;
    this.p = this.p + 1 === TAPS ? 0 : this.p + 1;
    this.h[this.p] = b;
    return filtrarMeiaBanda(this.h, this.p);
  }
}
