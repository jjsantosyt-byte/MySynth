// app-android/limpar.mjs
// Versão da loja SEM as explicações (pedido do dono, 27/09/2026): tira os comentários dos
// arquivos da CÓPIA do app em www/ (o código original, com os comentários, não é tocado).
// Chamado pelo preparar.sh depois de copiar o app para www/.
//
// Só tira comentários (e espaços que sobram): nomes e contas ficam iguais, para o app da loja
// se comportar exatamente como o do site.
//   - .js: terser sem "compress" e sem "mangle" (só reescreve o código sem os comentários)
//   - .html: html-minifier-terser (comentários do HTML e dos <script> de dentro)
//   - .css: um leitor simples que pula os textos entre aspas e apaga /* ... */
// Uso: node limpar.mjs www
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { minify as minificarJs } from 'terser';
import { minify as minificarHtml } from 'html-minifier-terser';

const OPCOES_JS = { module: true, compress: false, mangle: false, format: { comments: false } };

// Apaga os comentários /* ... */ do CSS (sem mexer em textos entre aspas)
function limparCss(texto) {
  let saida = '';
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"' || c === "'") {
      const fim = texto.indexOf(c, i + 1);
      const ate = fim === -1 ? texto.length : fim + 1;
      saida += texto.slice(i, ate);
      i = ate - 1;
    } else if (c === '/' && texto[i + 1] === '*') {
      const fim = texto.indexOf('*/', i + 2);
      i = fim === -1 ? texto.length : fim + 1;
    } else {
      saida += c;
    }
  }
  return saida.replace(/\n\s*\n+/g, '\n'); // linhas vazias que sobraram
}

async function limparArquivo(caminho) {
  const tipo = extname(caminho);
  if (!['.js', '.mjs', '.css', '.html'].includes(tipo)) return null;
  const antes = await readFile(caminho, 'utf8');
  let depois;
  if (tipo === '.css') {
    depois = limparCss(antes);
  } else if (tipo === '.html') {
    depois = await minificarHtml(antes, {
      removeComments: true,
      minifyJS: OPCOES_JS, // <script> de dentro do HTML
      minifyCSS: false,
      collapseWhitespace: false,
    });
  } else {
    const r = await minificarJs(antes, OPCOES_JS);
    if (r.code === undefined) throw new Error(`não consegui limpar ${caminho}`);
    depois = r.code;
  }
  await writeFile(caminho, depois);
  return [antes.length, depois.length];
}

async function percorrer(pasta, total) {
  for (const nome of await readdir(pasta)) {
    const caminho = join(pasta, nome);
    if ((await stat(caminho)).isDirectory()) {
      await percorrer(caminho, total);
      continue;
    }
    const r = await limparArquivo(caminho);
    if (r) {
      total.arquivos++;
      total.antes += r[0];
      total.depois += r[1];
    }
  }
}

const pasta = process.argv[2] || 'www';
const total = { arquivos: 0, antes: 0, depois: 0 };
await percorrer(pasta, total);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`Sem comentários: ${total.arquivos} arquivos, ${kb(total.antes)} → ${kb(total.depois)}`);
