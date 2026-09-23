// dsp/oscilador.js
// Leitura da wavetable sem aliasing. Usado por cada cópia de unison.
//
// A wavetable tem vários frames (formas de onda) e cada frame tem vários
// níveis (versões com menos harmônicos, para notas mais agudas).

// Em que ponto da faixa de cada nível começa a mistura com o próximo (0 a 1).
const INICIO_MISTURA = 0.75;

// Decide quais 2 níveis da tabela usar para esta frequência e quanto de cada.
// Guarda o resultado em "destino" (nivel, nivelB, mistura) para não criar lixo na memória.
export function escolherNiveis(harmonicos, frequencia, taxa, destino) {
  const ultimo = harmonicos.length - 1;
  // Quantos harmônicos cabem sem passar do limite (metade da taxa de amostragem).
  const limite = (0.5 * taxa) / frequencia;

  // Primeiro nível (o mais cheio) que ainda não gera aliasing.
  let nivel = 0;
  while (nivel < ultimo && harmonicos[nivel] > limite) nivel++;
  destino.nivel = nivel;
  destino.nivelB = Math.min(nivel + 1, ultimo);
  if (nivel === ultimo) {
    destino.mistura = 0;
    return;
  }

  // Mistura com o próximo nível conforme a nota sobe, para a troca ser
  // gradual. Chega em 100% do próximo exatamente no limite deste nível.
  // A mistura só acontece no último quarto da faixa de cada nível: antes
  // disso o nível sozinho já é perfeito, e ler um só economiza processamento.
  const freqMaxima = (0.5 * taxa) / harmonicos[nivel];
  const razao = nivel > 0 ? harmonicos[nivel] / harmonicos[nivel - 1] : harmonicos[1] / harmonicos[0];
  const freqMinima = freqMaxima * razao;
  const posicaoNaFaixa = Math.log(frequencia / freqMinima) / Math.log(freqMaxima / freqMinima);
  const mistura = (posicaoNaFaixa - INICIO_MISTURA) / (1 - INICIO_MISTURA);
  destino.mistura = Math.min(1, Math.max(0, mistura));
}

// Lê um ponto da onda com interpolação (liga os pontos da tabela por retas).
function lerOnda(onda, i0, i1, frac) {
  return onda[i0] + frac * (onda[i1] - onda[i0]);
}

// Lê uma amostra da wavetable:
// - frameA/frameB e t: os 2 frames vizinhos do WT Pos e quanto de cada (morphing)
// - nivel/nivelB e mistura: os 2 níveis anti-aliasing e quanto de cada
// - fase: posição dentro do ciclo da onda (0 a 1)
export function lerAmostra(frameA, frameB, t, nivel, nivelB, mistura, fase, tamanho, mascara) {
  const posicao = fase * tamanho;
  const i0 = posicao | 0;
  const i1 = (i0 + 1) & mascara;
  const frac = posicao - i0;

  let som = lerOnda(frameA[nivel], i0, i1, frac);
  if (mistura > 0) som += mistura * (lerOnda(frameA[nivelB], i0, i1, frac) - som);
  if (t > 0) {
    let somB = lerOnda(frameB[nivel], i0, i1, frac);
    if (mistura > 0) somB += mistura * (lerOnda(frameB[nivelB], i0, i1, frac) - somB);
    som += t * (somB - som);
  }
  return som;
}
