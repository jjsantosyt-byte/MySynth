// visualizacao.js
// Desenhos dos painéis: a forma de onda, o envelope (ADSR) e a curva do filtro.

import { amortecimento, compensacaoResonancia } from './dsp/filtro.js';
import { arrumarPontos, valorDesenho } from './dsp/lfo.js';

// Cores dos desenhos: vêm do TEMA (variáveis --desenho-* no estilo.css), lidas na primeira vez
// que algo é desenhado (trocar de tema recarrega o app). Cores em números "r, g, b" viram
// listas [r, g, b] (para montar as transparências do brilho).
let coresTema = null;
function cores() {
  if (coresTema) return coresTema;
  const css = getComputedStyle(document.documentElement);
  const ler = (nome, padrao) => css.getPropertyValue(nome).trim() || padrao;
  const rgb = (nome, padrao) => ler(nome, padrao).split(',').map(Number);
  coresTema = {
    onda: rgb('--desenho-onda', '70, 240, 110'), // ondas dos osciladores
    linha: rgb('--desenho-linha', '63, 184, 255'), // filtro, envelopes, LFO
    apagado: ler('--desenho-apagado', '#56607a'),
    guia: ler('--desenho-guia', '#3d4661'),
    marca: rgb('--desenho-marca', '255, 200, 87'), // marcas do unison
    ponto: rgb('--desenho-ponto', '255, 255, 255'), // contorno das bolinhas (envelopes)
    alca: ler('--desenho-alca', '#0b0d12'), // miolo das bolinhas dos envelopes
  };
  return coresTema;
}
const rgbaDe = (cor, alfa) => `rgba(${cor[0]}, ${cor[1]}, ${cor[2]}, ${alfa})`;

// Prepara o canvas na resolução certa da tela (no máximo 2×: mais leve, sem diferença visível).
// Devolve null se estiver escondido.
function prepararCanvas(canvas) {
  const escalaTela = Math.min(window.devicePixelRatio || 1, 2);
  const largura = canvas.clientWidth;
  const altura = canvas.clientHeight;
  if (largura === 0 || altura === 0) return null; // aba escondida: não desenha

  const larguraReal = Math.round(largura * escalaTela);
  const alturaReal = Math.round(altura * escalaTela);
  if (canvas.width !== larguraReal || canvas.height !== alturaReal) {
    canvas.width = larguraReal;
    canvas.height = alturaReal;
  }
  const g = canvas.getContext('2d');
  g.setTransform(escalaTela, 0, 0, escalaTela, 0, 0);
  g.clearRect(0, 0, largura, altura);
  return { g, largura, altura };
}

// Linha-guia reta (ex.: linha do zero).
function linhaGuia(g, x1, y1, x2, y2) {
  g.strokeStyle = cores().guia;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

// Desenha uma lista de pontos [x, y] como linha, com preenchimento em degradê até a
// altura "base". (Sem sombra/brilho em volta: pesava no celular.)
function linhaComBrilho(g, pontos, base, altura, apagada = false, cor = cores().linha) {
  const rgba = (alfa) => `rgba(${cor[0]}, ${cor[1]}, ${cor[2]}, ${alfa})`;
  const tracar = () => {
    g.beginPath();
    pontos.forEach(([x, y], k) => (k === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  };

  if (!apagada) {
    const degrade = g.createLinearGradient(0, 0, 0, altura);
    degrade.addColorStop(0, rgba(0.35));
    degrade.addColorStop(base / altura, rgba(0.04));
    degrade.addColorStop(1, rgba(0.35));
    tracar();
    g.lineTo(pontos[pontos.length - 1][0], base);
    g.lineTo(pontos[0][0], base);
    g.closePath();
    g.fillStyle = degrade;
    g.fill();
  }

  tracar();
  g.strokeStyle = apagada ? cores().apagado : rgba(1);
  g.lineWidth = 2.5;
  g.lineJoin = 'round';
  g.stroke();
}

// ---------- Forma de onda ----------

// Marcas das cópias de unison (risquinhos verticais, como no Serum).
// "posicoes" vão de -1 a +1: 0 = afinada; pontas = detune máximo.

function desenharMarcasUnison(g, largura, altura, posicoes) {
  if (posicoes.length < 2) return;
  const meio = largura / 2;
  const espalhamento = largura * 0.42;
  g.save();
  g.strokeStyle = rgbaDe(cores().marca, 0.85);
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.beginPath();
  for (const p of posicoes) {
    const x = meio + p * espalhamento;
    // Cópias do centro um pouco mais altas, as das pontas mais baixas.
    const alturaMarca = altura * (0.55 - 0.2 * Math.abs(p));
    g.moveTo(x, altura - 6);
    g.lineTo(x, altura - 6 - alturaMarca);
  }
  g.stroke();
  g.restore();
}

// "amostras" é um ciclo da onda, com valores entre -1 e 1.
// "marcasUnison" (opcional): posições das cópias de unison, de -1 a +1.
export function desenharOnda(canvas, amostras, marcasUnison = []) {
  const tela = prepararCanvas(canvas);
  if (!tela) return;
  const { g, largura, altura } = tela;

  const meio = altura / 2;
  const amplitude = meio * 0.8; // deixa uma folga em cima e embaixo
  linhaGuia(g, 0, meio, largura, meio);

  // Um ponto a cada meio pixel.
  const total = amostras.length;
  const qtd = Math.max(2, Math.floor(largura * 2));
  const pontos = [];
  for (let k = 0; k <= qtd; k++) {
    const indice = Math.min(total - 1, Math.floor((k / qtd) * total));
    pontos.push([(k / qtd) * largura, meio - amostras[indice] * amplitude]);
  }
  desenharMarcasUnison(g, largura, altura, marcasUnison);
  linhaComBrilho(g, pontos, meio, altura, false, cores().onda);
}

// ---------- Forma do LFO ----------

// Degraus de exemplo para desenhar o "Aleatório" (o de verdade é sorteado).
const DEGRAUS_EXEMPLO = [0.55, -0.35, 0.9, -0.75, 0.15, -0.5, 0.7, -0.1];

function valorLFODesenho(forma, fase) {
  switch (forma) {
    case 'seno':
      return Math.sin(2 * Math.PI * fase);
    case 'triangulo':
      if (fase < 0.25) return 4 * fase;
      if (fase < 0.75) return 2 - 4 * fase;
      return 4 * fase - 4;
    case 'serraSobe':
      return 2 * fase - 1;
    case 'serraDesce':
      return 1 - 2 * fase;
    case 'quadrada':
      return fase < 0.5 ? 1 : -1;
    case 'aleatorio':
      return DEGRAUS_EXEMPLO[Math.min(DEGRAUS_EXEMPLO.length - 1, Math.floor(fase * DEGRAUS_EXEMPLO.length))];
  }
  return 0;
}

// Desenha um ciclo da forma do LFO (parado: sem animação, para não pesar a tela).
// "pontos" = o desenho do LFO (usado quando a forma é 'desenho').
export function desenharLFO(canvas, forma, pontos) {
  const tela = prepararCanvas(canvas);
  if (!tela) return;
  const { g, largura, altura } = tela;

  const meio = altura / 2;
  const amplitude = meio * 0.75;
  linhaGuia(g, 0, meio, largura, meio);

  const desenho = forma === 'desenho' ? arrumarPontos(pontos) : null;
  const margem = 6;
  const qtd = Math.max(2, Math.floor(largura * 2));
  const lista = [];
  for (let k = 0; k <= qtd; k++) {
    const fase = Math.min(k / qtd, 0.9999);
    const v = desenho ? valorDesenho(desenho, fase) : valorLFODesenho(forma, fase);
    lista.push([margem + (k / qtd) * (largura - 2 * margem), meio - v * amplitude]);
  }
  linhaComBrilho(g, lista, meio, altura);
}

// ---------- Editor do LFO desenhado (interface/lfo-desenho.js) ----------

// Margem dentro do desenho (os pontos das pontas não ficam cortados pela borda)
export const MARGEM_EDITOR_LFO = 18;

// pontos: [[x, y, curva], ...] já arrumados; grade: 0 (sem) ou 4/8/16 divisões;
// ativo: { tipo: 'ponto' | 'curva', i } = o que está sendo arrastado; rotulo: texto em cima dele.
// Devolve a geometria (para o editor saber onde estão os pontos e as alças de curva).
export function desenharEditorLfo(canvas, pontos, { grade = 0, ativo = null, rotulo = '' } = {}) {
  const tela = prepararCanvas(canvas);
  if (!tela) return null;
  const { g, largura, altura } = tela;
  const m = MARGEM_EDITOR_LFO;
  const X = (x) => m + x * (largura - 2 * m);
  const Y = (y) => m + ((1 - y) / 2) * (altura - 2 * m);
  const c = cores();

  // Grade: linhas das divisões (cheias a cada 1/4) e níveis −1, −0,5, 0, +0,5, +1
  const divisoes = grade || 4;
  for (let k = 0; k <= divisoes; k++) {
    g.save();
    if (k % (divisoes / 4) !== 0 || !grade) g.setLineDash([2, 4]);
    linhaGuia(g, X(k / divisoes), m, X(k / divisoes), altura - m);
    g.restore();
  }
  for (const nivel of [1, 0.5, 0, -0.5, -1]) {
    g.save();
    if (nivel !== 0) g.setLineDash([2, 4]);
    linhaGuia(g, m, Y(nivel), largura - m, Y(nivel));
    g.restore();
  }
  g.fillStyle = c.apagado;
  g.font = '10px system-ui, sans-serif';
  g.fillText('+1', m + 3, m + 11);
  g.fillText('−1', m + 3, altura - m - 4);

  // A forma (uma linha; degraus viram linhas de pé)
  const qtd = Math.max(2, Math.floor(largura * 1.5));
  g.beginPath();
  for (let k = 0; k <= qtd; k++) {
    const fase = Math.min(k / qtd, 0.999999);
    const x = X(fase), y = Y(valorDesenho(pontos, fase));
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.strokeStyle = rgbaDe(c.linha, 1);
  g.lineWidth = 2.5;
  g.lineJoin = 'round';
  g.stroke();

  // Alças de curva (losangos no meio dos trechos que sobem ou descem)
  const alcas = [];
  for (let i = 0; i + 1 < pontos.length; i++) {
    const [xa, ya] = pontos[i];
    const [xb, yb] = pontos[i + 1];
    if (X(xb) - X(xa) < 22 || ya === yb) continue;
    const xm = (xa + xb) / 2;
    const px = X(xm), py = Y(valorDesenho(pontos, xm));
    alcas.push({ i, x: px, y: py });
    const aceso = ativo?.tipo === 'curva' && ativo.i === i;
    const r = aceso ? 7 : 5;
    g.beginPath();
    g.moveTo(px, py - r);
    g.lineTo(px + r, py);
    g.lineTo(px, py + r);
    g.lineTo(px - r, py);
    g.closePath();
    g.fillStyle = aceso ? rgbaDe(c.linha, 1) : c.alca;
    g.fill();
    g.lineWidth = 1.6;
    g.strokeStyle = rgbaDe(c.linha, 1);
    g.stroke();
  }

  // Pontos (o que está sendo arrastado fica maior, aceso e com um halo)
  const lugares = pontos.map(([x, y]) => ({ x: X(x), y: Y(y) }));
  lugares.forEach(({ x, y }, i) => {
    const aceso = ativo?.tipo === 'ponto' && ativo.i === i;
    if (aceso) {
      g.beginPath();
      g.arc(x, y, 16, 0, 2 * Math.PI);
      g.fillStyle = rgbaDe(c.linha, 0.2);
      g.fill();
    }
    g.beginPath();
    g.arc(x, y, aceso ? 8 : 6.5, 0, 2 * Math.PI);
    g.fillStyle = aceso ? rgbaDe(c.linha, 1) : c.alca;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = rgbaDe(c.ponto, 1);
    g.stroke();
  });

  // Rótulo em cima do que está sendo arrastado (posição · valor)
  const alvo = ativo?.tipo === 'ponto' ? lugares[ativo.i] : ativo?.tipo === 'curva' ? alcas.find((a) => a.i === ativo.i) : null;
  if (alvo && rotulo) {
    g.font = 'bold 11px system-ui, sans-serif';
    const w = g.measureText(rotulo).width + 12;
    const bx = Math.min(Math.max(alvo.x - w / 2, 2), largura - w - 2);
    const by = alvo.y - 40 < 2 ? alvo.y + 20 : alvo.y - 40;
    g.fillStyle = c.alca;
    g.fillRect(bx, by, w, 20);
    g.strokeStyle = rgbaDe(c.linha, 1);
    g.lineWidth = 1;
    g.strokeRect(bx + 0.5, by + 0.5, w - 1, 19);
    g.fillStyle = rgbaDe(c.linha, 1);
    g.textAlign = 'center';
    g.fillText(rotulo, bx + w / 2, by + 14);
    g.textAlign = 'start';
  }

  return { largura, altura, lugares, alcas };
}

// ---------- Envelope (ADSR) ----------

// Largura de cada trecho no desenho. Raiz quadrada: tempos curtos ainda
// aparecem, tempos longos não ocupam a tela toda.
function larguraDoTempo(segundos) {
  return 0.04 + Math.sqrt(segundos / 10);
}

// env: { ataque, decaimento, sustentacao, soltura } (tempos em segundos)
export function desenharEnvelope(canvas, env) {
  const tela = prepararCanvas(canvas);
  if (!tela) return;
  const { g, largura, altura } = tela;

  const margem = 8;
  const base = altura - margem;
  const alto = margem + 14; // espaço para o rótulo no canto
  const y = (nivel) => base - nivel * (base - alto);

  const larguras = [
    larguraDoTempo(env.ataque),
    larguraDoTempo(env.decaimento),
    0.35, // trecho "segurando a tecla"
    larguraDoTempo(env.soltura),
  ];
  const escala = (largura - 2 * margem) / larguras.reduce((a, b) => a + b, 0);
  const x0 = margem;
  const x1 = x0 + larguras[0] * escala;
  const x2 = x1 + larguras[1] * escala;
  const x3 = x2 + larguras[2] * escala;
  const x4 = x3 + larguras[3] * escala;

  linhaGuia(g, margem, base, largura - margem, base);
  // Linha tracejada onde a tecla é solta.
  g.save();
  g.setLineDash([3, 4]);
  linhaGuia(g, x3, alto, x3, base);
  g.restore();

  const s = env.sustentacao;
  const pontos = [
    [x0, y(0)],
    [x1, y(1)],
  ];
  // Curvas de queda (mesma forma que o som faz: cai até 1/1000 do caminho).
  const passos = 32;
  for (let k = 1; k <= passos; k++) {
    const u = k / passos;
    pontos.push([x1 + u * (x2 - x1), y(s + (1 - s) * Math.pow(0.001, u))]);
  }
  pontos.push([x3, y(s)]);
  for (let k = 1; k <= passos; k++) {
    const u = k / passos;
    pontos.push([x3 + u * (x4 - x3), y(s * Math.pow(0.001, u))]);
  }
  linhaComBrilho(g, pontos, base, altura);

  // Pontos para arrastar (interface/envelope-arrastar.js): posições guardadas no canvas
  const geometria = {
    base,
    alto,
    pontos: { pico: [x1, y(1)], queda: [x2, y(s)], soltar: [x3, y(s)], fim: [x4, y(0)] },
  };
  canvas.geometriaEnvelope = geometria;
  if (canvas.classList.contains('envelope-arrastavel')) desenharAlcas(g, geometria.pontos, canvas.dataset.alcaAtiva);
}

// Bolinhas nos pontos do envelope: vazadas (contorno branco); a que está sendo arrastada
// fica maior e acesa em azul.
function desenharAlcas(g, pontos, ativa) {
  for (const [nome, [x, y]] of Object.entries(pontos)) {
    const acesa = nome === ativa;
    g.beginPath();
    g.arc(x, y, acesa ? 6 : 4.5, 0, 2 * Math.PI);
    g.fillStyle = acesa ? rgbaDe(cores().linha, 1) : cores().alca;
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = rgbaDe(cores().ponto, acesa ? 1 : 0.85);
    g.stroke();
  }
}

// ---------- Curva do filtro ----------

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const DB_TOPO = 24;
const DB_BASE = -48;

// Quanto o filtro deixa passar (0 = nada, 1 = tudo) em cada frequência.
// É a resposta exata do filtro do motor de som.
function respostaDoFiltro(tipo, frequencia, corte, resonancia, taxa) {
  const w = Math.tan((Math.PI * Math.min(frequencia, taxa * 0.499)) / taxa) /
    Math.tan((Math.PI * Math.min(corte, taxa * 0.45)) / taxa);
  const k = amortecimento(resonancia);
  const c = compensacaoResonancia(resonancia);
  const w2 = w * w;
  const d = Math.sqrt((1 - w2) * (1 - w2) + k * k * w2);
  switch (tipo) {
    case 'lp12':
      return c / d;
    case 'lp24':
      return c / d / Math.sqrt(1 + w2 * w2);
    case 'hp':
      return (c * w2) / d;
    case 'bp':
      return (k * w) / d;
  }
  return 1;
}

// filtro: { tipo, corte, resonancia, ligado, taxa }
export function desenharFiltro(canvas, filtro) {
  const tela = prepararCanvas(canvas);
  if (!tela) return;
  const { g, largura, altura } = tela;

  const margem = 6;
  const y = (db) =>
    margem + ((DB_TOPO - Math.max(DB_BASE, Math.min(DB_TOPO, db))) / (DB_TOPO - DB_BASE)) * (altura - 2 * margem);
  const zeroDb = y(0);

  // Linha do 0 dB (o volume original) e marca do Cutoff.
  linhaGuia(g, 0, zeroDb, largura, zeroDb);
  const xCorte = (Math.log(filtro.corte / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN)) * largura;
  g.save();
  g.setLineDash([3, 4]);
  linhaGuia(g, xCorte, margem, xCorte, altura - margem);
  g.restore();

  const pontos = [];
  const qtd = Math.max(2, Math.floor(largura));
  for (let k = 0; k <= qtd; k++) {
    const x = (k / qtd) * largura;
    const f = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, k / qtd);
    const ganho = filtro.ligado
      ? respostaDoFiltro(filtro.tipo, f, filtro.corte, filtro.resonancia, filtro.taxa)
      : 1;
    pontos.push([x, y(20 * Math.log10(Math.max(ganho, 1e-6)))]);
  }
  linhaComBrilho(g, pontos, altura, altura, !filtro.ligado);
}
