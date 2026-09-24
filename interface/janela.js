// interface/janela.js
// Janela por cima da tela (fundo escuro) e um ajudante para criar elementos.
// Usada pelos presets e pela lista de wavetables.

export function criar(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

// Recado rápido: uma bolha por cima da tela que some sozinha depois de alguns segundos.
// Não empurra nada do layout (bom para o celular deitado, sem rolagem).
let bolha = null;
let temporizador = 0;
export function mostrarRecado(texto, segundos = 4) {
  if (!bolha) {
    bolha = criar('div', 'recado');
    bolha.setAttribute('role', 'status');
    bolha.addEventListener('click', () => (bolha.hidden = true));
    document.body.appendChild(bolha);
  }
  bolha.textContent = texto;
  bolha.hidden = false;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => (bolha.hidden = true), segundos * 1000);
}

// Fecha no ✕, tocando fora ou com Esc.
export function criarJanela(titulo) {
  const fundo = criar('div', 'janela-fundo');
  fundo.hidden = true;
  const janela = criar('div', 'janela');
  janela.setAttribute('role', 'dialog');
  janela.setAttribute('aria-label', titulo);
  const topo = criar('div', 'janela-topo');
  const fechar = criar('button', 'janela-fechar', '✕');
  fechar.setAttribute('aria-label', 'Fechar');
  topo.append(criar('h2', 'janela-titulo', titulo), fechar);
  const corpo = criar('div', 'janela-corpo');
  const aviso = criar('p', 'janela-aviso');
  aviso.hidden = true;
  const rodape = criar('div', 'janela-rodape');
  janela.append(topo, corpo, aviso, rodape);
  fundo.appendChild(janela);
  document.body.appendChild(fundo);

  const esconder = () => (fundo.hidden = true);
  fechar.addEventListener('click', esconder);
  fundo.addEventListener('pointerdown', (evento) => {
    if (evento.target === fundo) esconder();
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !fundo.hidden) esconder();
  });

  return {
    corpo,
    rodape,
    abrir: () => {
      aviso.hidden = true;
      fundo.hidden = false;
    },
    fechar: esconder,
    avisar: (texto) => {
      aviso.textContent = texto;
      aviso.hidden = !texto;
    },
  };
}
