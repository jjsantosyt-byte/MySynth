// interface/abertura.js
// O que aparece ao abrir o app:
//   1. Tela de carregamento (já está no index.html: aparece antes de qualquer JavaScript).
//      O principal.js avisa as etapas (avancarCarregamento) e o fim (terminarCarregamento).
//   2. Escolha de idioma — só na PRIMEIRA vez (fica guardada no aparelho; ver idioma.js).
//      Escolher English recarrega o app já em inglês.

import { lerIdioma, mudarIdioma } from './idioma.js';

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
  tela.querySelectorAll('[data-idioma]').forEach((botao) => {
    botao.addEventListener('click', () => {
      tela.hidden = true;
      mudarIdioma(botao.dataset.idioma); // English: recarrega já traduzido
    });
  });
}
