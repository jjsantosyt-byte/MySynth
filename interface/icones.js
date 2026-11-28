// interface/icones.js
// Ícones desenhados (traço, na cor do texto), iguais em qualquer celular. Substituem emojis
// (🗑 ⤓) e sinais de texto (‹ › ✕), que cada aparelho desenha de um jeito.

const DESENHOS = {
  esquerda: 'M10 3L5 8L10 13',
  direita: 'M6 3L11 8L6 13',
  fechar: 'M4 4L12 12M12 4L4 12',
  lixeira: 'M3 4.5H13M6.5 4.5V2.8H9.5V4.5M4.5 4.5L5.2 13.5H10.8L11.5 4.5M7 7V11.5M9 7V11.5',
  baixar: 'M8 2.5V10M4.5 6.8L8 10.3L11.5 6.8M3 13.5H13',
  desfazer: 'M5.5 3.5L2.5 6.5L5.5 9.5M2.5 6.5H10A3.5 3.5 0 0 1 10 13.5H6.5',
  refazer: 'M10.5 3.5L13.5 6.5L10.5 9.5M13.5 6.5H6A3.5 3.5 0 0 0 6 13.5H9.5',
  salvar: 'M2.5 2.5H11L13.5 5V13.5H2.5ZM5 2.5V6H10V2.5M4.5 13.5V9H11.5V13.5',
  lapis:'M2.5 13.5L3.2 10.3L10.5 3L13 5.5L5.7 12.8ZM9 4.5L11.5 7',
  espelhar: 'M8 1.5V14.5M6 4L2 8L6 12ZM10 4L14 8L10 12Z',
  // Piano roll: notas na grade (botão da barra de cima), tocar (triângulo) e parar (quadrado)
  pianoRoll: 'M2 3.5H8.5V6H2ZM6 7.5H14V10H6ZM3.5 11.5H9V14H3.5Z',
  tocar: 'M5 3L13 8L5 13Z',
  parar: 'M4 4H12V12H4Z',
  // Desenhos genéricos (não são as logos das marcas): nota musical e tela com "play"
  nota: 'M6 12.5V3.5L13 2V11M6 12.5A2 1.6 0 1 1 2 12.5A2 1.6 0 1 1 6 12.5ZM13 11A2 1.6 0 1 1 9 11A2 1.6 0 1 1 13 11Z',
  video: 'M2 3.5H14V12.5H2ZM6.5 5.8V10.2L10.3 8Z',
};

// Devolve o <svg> do ícone (texto HTML), para pôr dentro de um botão
export function icone(nome) {
  return `<svg class="icone" viewBox="0 0 16 16" aria-hidden="true"><path d="${DESENHOS[nome]}" /></svg>`;
}

// Troca o conteúdo de um botão por um ícone (o nome para leitores de tela fica no aria-label)
export function botaoComIcone(botao, nome, rotulo) {
  botao.innerHTML = icone(nome);
  if (rotulo) botao.setAttribute('aria-label', rotulo);
  return botao;
}
