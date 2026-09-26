// interface/armazem-wavetables.js
// Guarda as wavetables importadas NESTE aparelho (IndexedDB do navegador).
// É um "armário" maior que o dos presets (localStorage, ~5 MB): cada tabela de
// 64 frames ocupa ~0,5 MB. Guardamos os ciclos (a onda original, já com no máximo
// 64 frames); as versões anti-chiado são montadas de novo quando a tabela é usada.
//
// Cada item: { nome, tamanho (pontos por ciclo), amostras (todos os ciclos em fila) }
//
// Se o navegador não deixar gravar (ex.: janela anônima), tudo continua funcionando,
// só que as importadas somem ao fechar o app.

const BANCO = 'mysynth';
const VERSAO = 1;
const GAVETA = 'wavetables';

let abrindo = null;

// Se o armário não responder nesse tempo, desiste (alguns navegadores/modos de app nunca
// respondem): o app abre mesmo assim, só sem as wavetables guardadas.
const ESPERA_MAXIMA_MS = 4000;

function abrir() {
  if (!abrindo) {
    abrindo = new Promise((resolver, rejeitar) => {
      if (!window.indexedDB) {
        rejeitar(new Error('sem IndexedDB'));
        return;
      }
      const desistir = setTimeout(() => rejeitar(new Error('o armário não respondeu')), ESPERA_MAXIMA_MS);
      let pedido;
      try {
        pedido = indexedDB.open(BANCO, VERSAO);
      } catch (erro) {
        clearTimeout(desistir);
        rejeitar(erro);
        return;
      }
      pedido.onupgradeneeded = () => {
        const banco = pedido.result;
        if (!banco.objectStoreNames.contains(GAVETA)) banco.createObjectStore(GAVETA, { keyPath: 'nome' });
      };
      pedido.onsuccess = () => {
        clearTimeout(desistir);
        resolver(pedido.result);
      };
      pedido.onerror = () => {
        clearTimeout(desistir);
        rejeitar(pedido.error);
      };
    });
    abrindo.catch(() => (abrindo = null)); // deixa tentar de novo depois
  }
  return abrindo;
}

// Executa uma operação na gaveta e espera ela terminar.
async function operar(modo, fazer) {
  const banco = await abrir();
  return new Promise((resolver, rejeitar) => {
    const transacao = banco.transaction(GAVETA, modo);
    const pedido = fazer(transacao.objectStore(GAVETA));
    transacao.oncomplete = () => resolver(pedido?.result);
    transacao.onerror = () => rejeitar(transacao.error);
    transacao.onabort = () => rejeitar(transacao.error);
  });
}

// Junta os ciclos (todos do mesmo tamanho) numa fila só, para guardar.
export function empacotar(nome, ciclos) {
  const tamanho = ciclos[0].length;
  const amostras = new Float32Array(tamanho * ciclos.length);
  ciclos.forEach((ciclo, k) => amostras.set(ciclo, k * tamanho));
  return { nome, tamanho, amostras };
}

// O contrário: fila → lista de ciclos.
export function desempacotar({ tamanho, amostras }) {
  const quantidade = Math.floor(amostras.length / tamanho);
  return Array.from({ length: quantidade }, (_, k) => amostras.subarray(k * tamanho, (k + 1) * tamanho));
}

// Todas as guardadas: [{ nome, tamanho, amostras }]
export async function listarGuardadas() {
  const itens = await operar('readonly', (gaveta) => gaveta.getAll());
  return (itens || []).filter((w) => w && typeof w.nome === 'string' && w.amostras instanceof Float32Array && w.tamanho > 0);
}

// Guarda (ou substitui, se o nome já existe).
export async function guardarWavetable(nome, ciclos) {
  await operar('readwrite', (gaveta) => gaveta.put(empacotar(nome, ciclos)));
  // Pede ao navegador para não apagar os dados sozinho quando faltar espaço
  // (nem todo navegador atende; no iPhone ajuda mais com o app instalado).
  navigator.storage?.persist?.().catch(() => {});
}

export async function apagarWavetable(nome) {
  await operar('readwrite', (gaveta) => gaveta.delete(nome));
}
