// interface/abertura.js
// O que aparece ao abrir o app:
//   1. Tela de carregamento (já está no index.html: aparece antes de qualquer JavaScript).
//      O principal.js avisa as etapas (avancarCarregamento) e o fim (terminarCarregamento).
//   2. Tela inicial: idioma + tema — só na PRIMEIRA vez (ficam guardados no aparelho; ver
//      idioma.js e tema.js). Tocar numa opção só marca; "Seguir" guarda as duas escolhas e,
//      se algo mudou em relação à tela atual, recarrega o app já no idioma/tema escolhidos.

import { lerIdioma, guardarIdioma, IDIOMA } from './idioma.js';
import { guardarTema, TEMA } from './tema.js';

const TEMPO_MINIMO_MS = 900; // a tela de carregamento fica pelo menos isso (não "pisca")
const inicio = performance.now();

// Mostra a etapa atual (texto) e quanto já foi (0 a 1) na barra.
export function avancarCarregamento(texto, fracao) {
  const rotulo = document.getElementById('carregando-texto');
  const barra = document.getElementById('carregando-barra');
  if (rotulo) rotulo.textContent = texto;
  if (barra) barra.style.width = Math.round(Math.min(1, Math.max(0, fracao)) * 100) + '%';
}

// Tudo pronto: completa a barra, espera o tempo mínimo, some suavemente e, se for a primeira
// vez, mostra a escolha de idioma.
export async function terminarCarregamento() {
  avancarCarregamento('Pronto', 1);
  const falta = TEMPO_MINIMO_MS - (performance.now() - inicio);
  if (falta > 0) await new Promise((resolver) => setTimeout(resolver, falta));
  const tela = document.getElementById('carregando');
  if (tela) {
    tela.classList.add('saindo');
    setTimeout(() => tela.remove(), 350);
  }
  if (!lerIdioma()) mostrarEscolhaIdioma();
}

function mostrarEscolhaIdioma() {
  const tela = document.getElementById('escolha-idioma');
  if (!tela) return;
  tela.hidden = false;

  // Escolhas marcadas (começam no português e no tema Comum)
  let idioma = 'pt';
  let tema = 'comum';
  const marcar = (atributo, valor) =>
    tela.querySelectorAll(`[${atributo}]`).forEach((b) => b.setAttribute('aria-pressed', b.getAttribute(atributo) === valor));
  marcar('data-idioma', idioma);
  marcar('data-tema-opcao', tema);

  tela.querySelectorAll('[data-idioma]').forEach((botao) =>
    botao.addEventListener('click', () => {
      idioma = botao.dataset.idioma;
      marcar('data-idioma', idioma);
    })
  );
  tela.querySelectorAll('[data-tema-opcao]').forEach((botao) =>
    botao.addEventListener('click', () => {
      tema = botao.dataset.temaOpcao;
      marcar('data-tema-opcao', tema);
    })
  );

  // Seguir: guarda as duas escolhas; recarrega só se o idioma ou o tema da tela mudou
  document.getElementById('botao-seguir').addEventListener('click', () => {
    guardarIdioma(idioma);
    guardarTema(tema);
    if (idioma !== IDIOMA || tema !== TEMA) location.reload();
    else tela.hidden = true;
  });
}
