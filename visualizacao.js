// visualizacao.js
// Desenhos dos painéis: a forma de onda, o envelope (ADSR) e a curva do filtro.

import { amortecimento, compensacaoResonancia } from './dsp/filtro.js';

// Cores do desenho (combinam com as de estilo.css)
const COR_LINHA = '#3fb8ff';
const COR_BRILHO = 'rgba(63, 184, 255, 0.7)';
const COR_LINHA_APAGADA = '#56607a';
const COR_GUIA = '#3d4661';

// Prepara o canvas na resolução certa da tela. Devolve null se estiver escondido.
function prepararCanvas(canvas) {
  const escalaTela = window.devicePixelRatio || 1;
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
  g.strokeStyle = COR_GUIA;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

// Desenha uma lista de pontos [x, y] como linha brilhante, com preenchimento
// em degradê até a altura "base".
function linhaComBrilho(g, pontos, base, altura, apagada = false) {
  const tracar = () => {
    g.beginPath();
    pontos.forEach(([x, y], k) => (k === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  };

  if (!apagada) {
    const degrade = g.createLinearGradient(0, 0, 0, altura);
    degrade.addColorStop(0, 'rgba(63, 184, 255, 0.35)');
    degrade.addColorStop(base / altura, 'rgba(63, 184, 255, 0.04)');
    degrade.addColorStop(1, 'rgba(63, 184, 255, 0.35)');
    tracar();
    g.lineTo(pontos[pontos.length - 1][0], base);
    g.lineTo(pontos[0][0], base);
    g.closePath();
    g.fillStyle = degrade;
    g.fill();
  }

  tracar();
  g.save();
  if (!apagada) {
    g.shadowColor = COR_BRILHO;
    g.shadowBlur = 8;
  }
  g.strokeStyle = apagada ? COR_LINHA_APAGADA : COR_LINHA;
  g.lineWidth = 2.5;
  g.lineJoin = 'round';
  g.stroke();
  g.restore();
}

// ---------- Forma de onda ----------

// "amostras" é um ciclo da onda, com valores entre -1 e 1.
export function desenharOnda(canvas, amostras) {
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
  linhaComBrilho(g, pontos, meio, altura);
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
