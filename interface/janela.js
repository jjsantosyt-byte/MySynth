// interface/janela.js
// Janela por cima da tela (fundo escuro) e um ajudante para criar elementos.
// Usada pelos presets e pela lista de wavetables.

import { botaoComIcone } from './icones.js';

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

// Pergunta de sim/não numa janela do próprio app (no lugar do confirm() do navegador, que
// cada celular desenha de um jeito). [Cancelar] [textoBotao]; fechar no X, tocando fora ou
// com Esc = Cancelar. Devolve uma Promise: true = confirmou.
let pergunta = null;
export function confirmar(texto, textoBotao = 'Apagar') {
  if (!pergunta) {
    const janela = criarJanela('Confirmar', { aoFechar: () => pergunta.responder(false) });
    const paragrafo = criar('p', 'config-texto');
    janela.corpo.appendChild(paragrafo);
    const cancelar = criar('button', 'botao', 'Cancelar');
    const sim = criar('button', 'botao botao-perigo');
    janela.rodape.append(cancelar, sim);
    pergunta = { janela, paragrafo, sim, responder: () => {} };
    cancelar.addEventListener('click', () => pergunta.responder(false));
    sim.addEventListener('click', () => pergunta.responder(true));
  }
  return new Promise((resolver) => {
    pergunta.paragrafo.textContent = texto;
    pergunta.sim.textContent = textoBotao;
    pergunta.responder = (resposta) => {
      pergunta.responder = () => {}; // responde uma vez só
      pergunta.janela.fechar();
      resolver(resposta);
    };
    pergunta.janela.abrir();
  });
}

// Fecha no X, tocando fora ou com Esc. "aoFechar" (opcional): chamado sempre que ela fecha.
export function criarJanela(titulo, { aoFechar } = {}) {
  const fundo = criar('div', 'janela-fundo');
  fundo.hidden = true;
  const janela = criar('div', 'janela');
  janela.setAttribute('role', 'dialog');
  janela.setAttribute('aria-label', titulo);
  const topo = criar('div', 'janela-topo');
  const fechar = botaoComIcone(criar('button', 'janela-fechar'), 'fechar', 'Fechar');
  topo.append(criar('h2', 'janela-titulo', titulo), fechar);
  const corpo = criar('div', 'janela-corpo');
  const aviso = criar('p', 'janela-aviso');
  aviso.hidden = true;
  const rodape = criar('div', 'janela-rodape');
  janela.append(topo, corpo, aviso, rodape);
  fundo.appendChild(janela);
  document.body.appendChild(fundo);

  const esconder = () => {
    if (fundo.hidden) return;
    fundo.hidden = true;
    aoFechar?.();
  };
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
