// sw.js — "service worker": faz o app abrir mesmo SEM internet.
//
// Como funciona:
// - Na instalação, guarda uma cópia de todos os arquivos do app no aparelho.
// - Depois, a cada arquivo pedido: se tem internet, busca a versão NOVA (e atualiza a
//   cópia); se não tem (ou a rede demora demais), usa a cópia guardada.
//   Assim, com internet você sempre recebe a última versão publicada, e sem internet
//   o app continua abrindo com a última versão que foi aberta.
//
// Não faz parte do motor de som: é só para o navegador guardar os arquivos.

const GAVETA = 'mysynth-arquivos-v1';

// Arquivos do app (o que não estiver aqui também é guardado na primeira vez que for usado)
const ARQUIVOS = [
  './',
  'index.html',
  'estilo.css',
  'manifest.json',
  'principal.js',
  'processador-synth.js',
  'wavetable.js',
  'importar-wav.js',
  'visualizacao.js',
  'icones/icone-180.png',
  'icones/icone-192.png',
  'icones/icone-512.png',
  'dsp/clipper.js',
  'dsp/envelope.js',
  'dsp/filtro.js',
  'dsp/lfo.js',
  'dsp/meia-banda.js',
  'dsp/modulacao.js',
  'dsp/oscilador-voz.js',
  'dsp/oscilador.js',
  'dsp/ruido.js',
  'dsp/voz.js',
  'dsp/warp.js',
  'dsp/efeitos/comum.js',
  'dsp/efeitos/compressor.js',
  'dsp/efeitos/saturacao.js',
  'dsp/efeitos/eq.js',
  'dsp/efeitos/phaser.js',
  'dsp/efeitos/flanger.js',
  'dsp/efeitos/chorus.js',
  'dsp/efeitos/delay.js',
  'dsp/efeitos/distorcao.js',
  'dsp/efeitos/reverb.js',
  'interface/abertura.js',
  'interface/armazem-wavetables.js',
  'interface/idioma.js',
  'interface/menu-app.js',
  'interface/janela.js',
  'interface/knob.js',
  'interface/modulacao.js',
  'interface/presets-projeto.js',
  'interface/presets.js',
  'interface/seletor.js',
  'interface/wavetables.js',
  'presets/lista.json',
];

// Quanto esperar pela rede antes de usar a cópia guardada
const ESPERA_REDE_MS = 3000;

// Os presets que vêm com o app: os nomes dos arquivos estão em presets/lista.json
async function arquivosDePresets() {
  try {
    const lista = await (await fetch('presets/lista.json')).json();
    return ['fabrica', 'usuario'].flatMap((pasta) =>
      (lista[pasta] || []).map((arquivo) => `presets/${pasta}/${encodeURIComponent(arquivo)}`)
    );
  } catch {
    return [];
  }
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const gaveta = await caches.open(GAVETA);
      const todos = [...ARQUIVOS, ...(await arquivosDePresets())];
      // Um por um: se algum arquivo faltar, os outros são guardados mesmo assim
      await Promise.all(todos.map((arquivo) => gaveta.add(arquivo).catch(() => {})));
    })()
  );
  self.skipWaiting(); // a versão nova do service worker entra na hora
});

self.addEventListener('activate', (evento) => {
  // Apaga gavetas de versões antigas deste arquivo
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== GAVETA).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Internet ruim: depois que um pedido passa do tempo, os próximos (por 15 s) usam direto a
// cópia guardada e atualizam por trás. Antes, CADA arquivo esperava 3 s: o app podia levar
// muitos segundos para abrir com uma rede lenta.
const TEMPO_REDE_RUIM_MS = 15000;
let redeRuimAte = 0;

// A cópia guardada deste pedido (abrir o app por outro endereço, ex.: com "?algo",
// recebe a página principal)
async function copiaGuardada(gaveta, pedido) {
  let guardada = await gaveta.match(pedido, { ignoreSearch: true });
  if (!guardada && pedido.mode === 'navigate') guardada = await gaveta.match('./');
  return guardada;
}

// Busca na rede e atualiza a cópia (usado "por trás", sem esperar)
function atualizarCopia(gaveta, pedido) {
  return fetch(pedido)
    .then((resposta) => {
      if (resposta.ok) gaveta.put(pedido, resposta.clone());
      return resposta;
    })
    .catch(() => null);
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  // Só arquivos do próprio app, lidos com GET (o resto passa direto)
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;

  evento.respondWith(
    (async () => {
      const gaveta = await caches.open(GAVETA);

      // Sem internet (o aparelho sabe) ou rede ruim há pouco: cópia primeiro, sem esperar.
      if (self.navigator.onLine === false || Date.now() < redeRuimAte) {
        const guardada = await copiaGuardada(gaveta, pedido);
        if (guardada) {
          if (self.navigator.onLine !== false) evento.waitUntil(atualizarCopia(gaveta, pedido));
          return guardada;
        }
      }

      try {
        // Rede primeiro (com limite de tempo)
        const resposta = await Promise.race([
          fetch(pedido),
          new Promise((_, falhar) => setTimeout(() => falhar(new Error('rede lenta')), ESPERA_REDE_MS)),
        ]);
        if (resposta.ok) gaveta.put(pedido, resposta.clone());
        return resposta;
      } catch {
        // Sem rede ou lenta demais: a cópia guardada (e os próximos pedidos nem esperam)
        redeRuimAte = Date.now() + TEMPO_REDE_RUIM_MS;
        return (await copiaGuardada(gaveta, pedido)) || Response.error();
      }
    })()
  );
});
