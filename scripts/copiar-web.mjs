// scripts/copiar-web.mjs
// Copia SÓ os arquivos do app (o que o navegador usa) para a pasta www/, que é o que o
// Capacitor coloca dentro do app Android. O projeto não tem etapa de build: é só copiar.
// Fica de fora: android/, node_modules/, _antigo/, loja/, scripts/, CLAUDE.md etc.
// Arquivo ou pasta NOVA do app: acrescente na lista ITENS.

import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'www');

const ITENS = [
  'index.html',
  'privacidade.html',
  'estilo.css',
  'manifest.json',
  'sw.js',
  'principal.js',
  'processador-synth.js',
  'wavetable.js',
  'importar-wav.js',
  'visualizacao.js',
  'dsp',
  'interface',
  'presets',
  'icones',
];

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
for (const item of ITENS) {
  const origem = join(raiz, item);
  if (!existsSync(origem)) {
    console.error(`Faltando: ${item}`);
    process.exit(1);
  }
  cpSync(origem, join(destino, item), { recursive: true });
}
console.log(`www/ pronto (${ITENS.length} itens copiados).`);
