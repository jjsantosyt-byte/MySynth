// dsp/warp.js
// Warp: deforma a onda na hora, mexendo em QUAL ponto do ciclo é lido.
// Em vez de ler a onda na posição "fase" (0 a 1), lê na posição faseWarp(fase).
// A Quantidade (0 a 1) diz o quanto deformar; 0 = onda original (em todos os modos).
//
// Modos:
//   sync      — hard sync: a onda corre 1× a 8× mais rápido dentro de cada ciclo da nota
//               e recomeça no fim do ciclo (som "rasgado").
//   bendMais  — empurra a onda para o COMEÇO do ciclo (mais nasal e brilhante).
//   bendMenos — empurra a onda para o FIM do ciclo (mais cheio e arredondado).
//   pwm       — aperta a onda inteira na primeira parte do ciclo (até 10%) e o resto fica
//               parado no ponto de início (como a largura de pulso, em qualquer onda).
//
// Só contas: usado pelo motor (dsp/oscilador-voz.js) e pelo desenho da onda na tela.

export const MODOS_WARP = ['nenhum', 'sync', 'bendMais', 'bendMenos', 'pwm', 'fmA', 'fmB', 'fmC'];

// Números dos modos (o motor usa o número: é mais rápido que comparar texto)
export const W_NENHUM = 0;
export const W_SYNC = 1;
export const W_BEND_MAIS = 2;
export const W_BEND_MENOS = 3;
export const W_PWM = 4;
// FM: a posição lida ganha "fase + índice × (som do outro oscilador)" (modulação de fase,
// como no DX7 e no FM do Serum). fmA = modulado pelo OSC A, fmB = pelo B, fmC = pelo C.
export const W_FM_A = 5;
export const W_FM_B = 6;
export const W_FM_C = 7;

// Qual oscilador (0 = A, 1 = B, 2 = C) modula, num modo FM (ou -1 se não é FM)
export const moduladorFM = (codigo) => (codigo >= W_FM_A ? codigo - W_FM_A : -1);

// FM: com a Quantidade em 100%, o outro oscilador empurra a leitura até 2 ciclos
// para frente e para trás (bem forte: som metálico/agressivo).
export const INDICE_FM_MAXIMO = 2;

export function codigoWarp(modo) {
  const i = MODOS_WARP.indexOf(modo);
  return i < 0 ? W_NENHUM : i;
}

// Valor de trabalho de cada modo para a Quantidade q (0 a 1):
//   sync: quantas vezes mais rápido (1 a 8);
//   bend: inclinação da curva na ponta mais rápida (1 a 8);
//   pwm: que parte do ciclo a onda ocupa (1 a 0,1).
export function forcaWarp(codigo, q) {
  switch (codigo) {
    case W_SYNC:
      return 1 + 7 * q;
    case W_BEND_MAIS:
    case W_BEND_MENOS:
      return Math.pow(8, q); // uma vez por pedaço (não por amostra)
    case W_PWM:
      // Até 10% do ciclo (medido: com 5%, notas bem agudas chiavam)
      return 1 - 0.9 * q;
    case W_FM_A:
    case W_FM_B:
    case W_FM_C:
      // FM: o índice (quanto a leitura é empurrada, em ciclos)
      return INDICE_FM_MAXIMO * q;
    default:
      return 1;
  }
}

// FM: quanto a onda "corre" mais rápido no pior ponto, para o índice e a razão entre as
// alturas (modulador / portadora). A velocidade instantânea chega a 1 + 2π·índice·razão.
export function aceleracaoFM(indice, razao) {
  return 1 + 2 * Math.PI * indice * razao;
}

// FM: posição lida (0 a 1) para a fase e o som do modulador agora (-1 a 1).
export function faseFM(fase, indice, modulador) {
  const f = fase + indice * modulador;
  return f - Math.floor(f);
}

// Quanto a onda deformada "corre" mais rápido que a nota, no pior ponto do ciclo.
// Serve para escolher a versão da onda com menos agudos (sem chiado), como se a nota
// fosse essa quantidade de vezes mais aguda.
export function aceleracaoWarp(codigo, forca) {
  switch (codigo) {
    case W_SYNC:
    case W_BEND_MAIS:
    case W_BEND_MENOS:
      return forca;
    case W_PWM:
      return 1 / forca;
    default:
      return 1;
  }
}

// Posição deformada (0 a 1) para a fase (0 a 1).
export function faseWarp(codigo, forca, fase) {
  switch (codigo) {
    case W_SYNC: {
      const f = fase * forca;
      return f - Math.floor(f);
    }
    case W_BEND_MAIS:
      // Começa rápido e termina devagar: curva k·f / (1 + (k−1)·f), inclinação k no
      // começo e 1/k no fim. Só uma divisão (é calculada milhões de vezes por segundo).
      return (forca * fase) / (1 + (forca - 1) * fase);
    case W_BEND_MENOS: {
      // O espelho: começa devagar e termina rápido
      const r = 1 - fase;
      return 1 - (forca * r) / (1 + (forca - 1) * r);
    }
    case W_PWM:
      return fase < forca ? fase / forca : 0;
    default:
      return fase;
  }
}
