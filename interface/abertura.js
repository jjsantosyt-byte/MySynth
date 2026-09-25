// interface/abertura.js
// O que aparece ao abrir o app:
//   1. Tela de carregamento (já está no index.html: aparece antes de qualquer JavaScript).
//      O principal.js avisa as etapas (avancarCarregamento) e o fim (terminarCarregamento).
//   2. Escolha de idioma — só na PRIMEIRA vez (fica guardada no aparelho).
//
// Idioma: por enquanto o app só tem os textos em português; escolher English já fica guardado
// (e o app avisa que a tradução vem depois).

const CHAVE_IDIOMA = 'mysynth.idioma.v1';
const TEMPO_MINIMO_MS = 900; // a tela de carregamento fica pelo menos isso (não "pisca")
const inicio = performance.now();

// ---------- Idioma guardado ----------

export function lerIdioma() {
  try {
    const idioma = localStorage.getItem(CHAVE_IDIOMA);
    return idioma === 'pt' || idioma === 'en' ? idioma : null;
  } catch {
    return null;
  }
}

export function guardarIdioma(idioma) {
  try {
    localStorage.setItem(CHAVE_IDIOMA, idioma);
  } catch {
    // janela anônima / sem permissão: vale só até fechar o app
  }
  document.documentElement.lang = idioma === 'en' ? 'en' : 'pt-BR';
}

// ---------- Carregamento ----------

// Mostra a etapa atual (texto) e quanto já foi (0 a 1) na barra.
export function avancarCarregamento(texto, fracao) {
  const rotulo = document.getElementById('carregando-texto');
  const barra = document.getElementById('carregando-barra');
  if (rotulo) rotulo.textContent = texto;
  if (barra) barra.style.width = Math.round(Math.min(1, Math.max(0, fracao)) * 100) + '%';
}

// Tudo pronto: completa a barra, espera o tempo mínimo, some suavemente e, se for a primeira
// vez, mostra a escolha de idioma. "aoEscolherIdioma(idioma)" é chamado quando o idioma muda.
export async function terminarCarregamento(aoEscolherIdioma) {
  avancarCarregamento('Pronto', 1);
  const falta = TEMPO_MINIMO_MS - (performance.now() - inicio);
  if (falta > 0) await new Promise((resolver) => setTimeout(resolver, falta));
  const tela = document.getElementById('carregando');
  if (tela) {
    tela.classList.add('saindo');
    setTimeout(() => tela.remove(), 350);
  }
  const idioma = lerIdioma();
  if (idioma) {
    document.documentElement.lang = idioma === 'en' ? 'en' : 'pt-BR';
    return;
  }
  mostrarEscolhaIdioma(aoEscolherIdioma);
}

function mostrarEscolhaIdioma(aoEscolherIdioma) {
  const tela = document.getElementById('escolha-idioma');
  if (!tela) return;
  tela.hidden = false;
  tela.querySelectorAll('[data-idioma]').forEach((botao) => {
    botao.addEventListener('click', () => {
      guardarIdioma(botao.dataset.idioma);
      tela.hidden = true;
      aoEscolherIdioma?.(botao.dataset.idioma);
    });
  });
}
