// interface/tema.js
// Tema visual do app: 'basico' (parecido com as primeiras versões), 'comum' (padrão) ou
// 'claro' (fundo claro, bom no sol). Só muda a aparência; o som é o mesmo.
// O tema fica guardado no aparelho e é aplicado por um scriptzinho no <head> do index.html
// (antes de desenhar a tela). Trocar de tema recarrega o app (os desenhos leem as cores uma vez).

const CHAVE_TEMA = 'mysynth.tema.v1';
export const TEMAS = ['basico', 'comum', 'claro'];
export const NOMES_TEMAS = { basico: 'Básico', comum: 'Comum', claro: 'Claro' };

export const TEMA = TEMAS.includes(document.documentElement.dataset.tema) ? document.documentElement.dataset.tema : 'comum';

// Já foi escolhido alguma vez? (a tela inicial pergunta só uma vez)
export function temaEscolhido() {
  try {
    return TEMAS.includes(localStorage.getItem(CHAVE_TEMA));
  } catch {
    return true; // sem acesso ao armazenamento: não fica perguntando
  }
}

// Guarda o tema. Devolve true se ele é diferente do que está na tela (precisa recarregar).
export function guardarTema(tema) {
  if (!TEMAS.includes(tema)) return false;
  try {
    localStorage.setItem(CHAVE_TEMA, tema);
  } catch {
    // janela anônima etc.: vale só até fechar
  }
  return tema !== TEMA;
}

// Troca de tema (Configurações): guarda e recarrega o app já no tema novo
export function mudarTema(tema) {
  if (guardarTema(tema)) location.reload();
}
