// interface/piano-roll.js
// Piano roll (o começo do "DAW"): uma tela cheia, aberta pelo botão da barra de cima.
//   - Barra de cima: ‹ Synth (volta aos knobs e PARA a música), Play, Stop e BPM.
//   - Embaixo: as teclas do piano em pé (esquerda), a régua com os tempos (em cima) e a grade
//     com as notas. A linha verde mostra onde a música está (é a única coisa que se mexe).
// A música toca DENTRO do motor de som (motor.cpp, "Sequenciador"): ele dispara cada nota na
// amostra exata, sem depender da tela. A tela só manda as notas, o BPM e Play/Stop, e calcula
// sozinha onde desenhar a linha (o motor avisa onde a música estava num instante do relógio).
// Decisão do dono: o loop só toca com esta tela aberta (sair dela para a música).
// (P2: as notas são um loop fixo de 1 compasso; editar notas é a próxima etapa.)

import { criarSeletor } from './seletor.js';
import { icone, botaoComIcone } from './icones.js';

const COMPRIMENTO = 4; // tempos (1 compasso de 4/4)
const DIVISOES = 4; // linhas da grade por tempo (semicolcheias)

// Loop fixo da P2 (para ouvir se o ritmo está firme): baixo em semicolcheias + 3 acordes.
// Cada nota: [início, duração, nota MIDI], em tempos (1 = uma semínima).
const BAIXO = [48, 48, 60, 48, 48, 48, 60, 48, 53, 53, 65, 53, 55, 55, 67, 55];
export const LOOP_FIXO = [
  ...BAIXO.map((nota, i) => [i / DIVISOES, 0.2, nota]),
  ...[60, 64, 67].map((nota) => [0, 1.75, nota]),
  ...[60, 65, 69].map((nota) => [2, 0.9, nota]),
  ...[59, 62, 67].map((nota) => [3, 0.9, nota]),
];

const NOMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ehPreta = (nota) => [1, 3, 6, 8, 10].includes(nota % 12);
const nomeNota = (nota) => NOMES[nota % 12] + (Math.floor(nota / 12) - 1);

function criar(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

// opções:
//   obterSynth(): o AudioWorkletNode do motor (ou null se o som ainda não ligou)
//   obterContexto(): o AudioContext (relógio do som)
//   ligarSom(): liga o som (Promise) — o Play liga o som se precisar
//   garantirSom(): religa o áudio se o sistema pausou
export function criarPianoRoll({ obterSynth, obterContexto, ligarSom, garantirSom }) {
  let notas = LOOP_FIXO;
  let bpm = 120;
  let tocando = false;
  let relogio = null; // { posicao, tempo, bpm }: onde a música estava num instante do relógio
  let synthComNotas = null; // o motor que já recebeu as notas
  let quadro = 0; // requestAnimationFrame da linha que anda
  let geometria = null;
  let acesas = ''; // teclas acesas (as notas tocando agora), para só redesenhar quando mudam
  let cores = null;

  // ---------- Montagem ----------
  const tela = criar('section', 'piano-roll');
  tela.hidden = true;
  tela.setAttribute('role', 'dialog');
  tela.setAttribute('aria-label', 'Piano roll');

  const barra = criar('div', 'pr-barra');
  const voltar = criar('button', 'botao pr-voltar');
  voltar.innerHTML = `${icone('esquerda')}<span>Synth</span>`;
  voltar.title = 'Voltar ao synth (a música para)';
  const botaoTocar = botaoComIcone(criar('button', 'botao botao-icone pr-tocar'), 'tocar', 'Tocar');
  const botaoParar = botaoComIcone(criar('button', 'botao botao-icone pr-parar'), 'parar', 'Parar');
  const seletorBpm = criarSeletor({
    rotulo: 'BPM',
    min: 20,
    max: 300,
    padrao: bpm,
    rotuloAoLado: true,
    pixelsPorPasso: 4,
    ler: () => bpm,
    aoMudar: (valor) => {
      bpm = valor;
      obterSynth()?.port.postMessage({ tipo: 'seqBpm', bpm });
    },
  });
  seletorBpm.classList.add('pr-bpm');
  barra.append(voltar, botaoTocar, botaoParar, seletorBpm);

  const area = criar('div', 'pr-area');
  const canvas = criar('canvas', 'pr-canvas');
  const cabeca = criar('div', 'pr-cabeca'); // a linha verde (só ela se mexe: sem redesenhar a grade)
  area.append(canvas, cabeca);
  tela.append(barra, area);
  document.body.appendChild(tela);

  // ---------- Abrir / fechar ----------
  function abrir() {
    tela.hidden = false;
    lerCores();
    desenhar();
  }
  function fechar() {
    if (tela.hidden) return;
    parar(); // decisão do dono: sair do piano roll para a música
    tela.hidden = true;
  }
  voltar.addEventListener('click', fechar);
  document.addEventListener('keydown', (evento) => {
    if (!tela.hidden && evento.key === 'Escape') fechar();
  });
  // (App no fundo: o principal.js pausa o áudio inteiro, então a música pausa junto e continua
  // de onde estava ao voltar; a linha também, porque o relógio do som fica parado.)
  new ResizeObserver(() => tela.hidden || desenhar()).observe(area);

  // ---------- Play / Stop ----------
  async function tocar() {
    if (!obterSynth()) await ligarSom();
    const synth = obterSynth();
    if (!synth || tela.hidden) return;
    garantirSom();
    if (synthComNotas !== synth) {
      synth.port.postMessage({ tipo: 'sequencia', notas, comprimento: COMPRIMENTO });
      synthComNotas = synth;
    }
    synth.port.postMessage({ tipo: 'seqBpm', bpm });
    synth.port.postMessage({ tipo: 'seqTocar', tocar: true }); // (de novo = recomeça do início)
    relogio = null; // até o motor responder, a linha fica no começo
    tocando = true;
    mostrarBotoes();
    if (!quadro) quadro = requestAnimationFrame(andar);
  }
  function parar() {
    if (tocando) obterSynth()?.port.postMessage({ tipo: 'seqTocar', tocar: false });
    tocando = false;
    relogio = null;
    cancelAnimationFrame(quadro);
    quadro = 0;
    mostrarBotoes();
    moverCabeca(0);
    acenderTeclas(-1);
  }
  botaoTocar.addEventListener('click', tocar);
  botaoParar.addEventListener('click', parar);
  function mostrarBotoes() {
    botaoTocar.classList.toggle('tocando', tocando);
    botaoTocar.setAttribute('aria-pressed', tocando);
  }

  // Recado do motor (Play, Stop, BPM): { tocando, posicao, tempo }
  function receber(dados) {
    if (!tocando || !dados.tocando) return;
    relogio = { posicao: dados.posicao, tempo: dados.tempo, bpm };
  }

  // Onde a música está AGORA, no que se ouve: o relógio do som anda na frente do alto-falante
  // (o tempo do "buffer" de áudio), então a linha desconta esse atraso.
  function posicaoAgora() {
    const contexto = obterContexto();
    if (!relogio || !contexto) return 0;
    const atraso = (contexto.baseLatency || 0) + (contexto.outputLatency || 0);
    const passou = Math.max(0, contexto.currentTime - atraso - relogio.tempo);
    const posicao = relogio.posicao + (passou * relogio.bpm) / 60;
    return posicao % COMPRIMENTO;
  }
  function andar() {
    quadro = 0;
    if (!tocando || tela.hidden) return;
    const posicao = posicaoAgora();
    moverCabeca(posicao);
    acenderTeclas(posicao);
    quadro = requestAnimationFrame(andar);
  }
  function moverCabeca(posicao) {
    if (!geometria) return;
    const x = geometria.x0 + (posicao / COMPRIMENTO) * geometria.largura;
    cabeca.style.transform = `translateX(${x.toFixed(1)}px)`;
  }
  // As teclas das notas que estão tocando ficam acesas (redesenha só quando mudam)
  function acenderTeclas(posicao) {
    const agora = notas
      .filter(([inicio, duracao]) => posicao >= inicio && posicao < inicio + duracao)
      .map((n) => n[2])
      .sort((a, b) => a - b)
      .join(',');
    if (agora === acesas) return;
    acesas = agora;
    desenhar();
  }

  // ---------- Desenho ----------
  function lerCores() {
    const css = getComputedStyle(document.documentElement);
    const ler = (nome) => css.getPropertyValue(nome).trim();
    cores = {
      nota: ler('--destaque'),
      textoNota: ler('--texto-sobre-destaque'),
      branca: ler('--tecla-branca'),
      preta: ler('--tecla-preta'),
      barra: ler('--barra'),
      texto: ler('--texto'),
      suave: ler('--texto-suave'),
      linhaClara: ler('--pr-linha-clara'),
      linhaEscura: ler('--pr-linha-escura'),
      guia: ler('--pr-guia'),
      guiaForte: ler('--pr-guia-forte'),
      fina: ler('--pr-guia-fina'),
      cantos: document.documentElement.dataset.tema === 'basico' ? 'redondo' : 'chanfro',
    };
  }

  // Retângulo com os cantos cortados em 45° (o visual do app) ou redondos (tema Básico)
  function caixa(ctx, x, y, w, h, c) {
    c = Math.min(c, w / 2, h / 2);
    ctx.beginPath();
    if (cores.cantos === 'redondo') {
      ctx.roundRect(x, y, w, h, c);
      return;
    }
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w - c, y);
    ctx.lineTo(x + w, y + c);
    ctx.lineTo(x + w, y + h - c);
    ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x + c, y + h);
    ctx.lineTo(x, y + h - c);
    ctx.lineTo(x, y + c);
    ctx.closePath();
  }

  function desenhar() {
    if (tela.hidden || !cores) return;
    const largura = area.clientWidth;
    const altura = area.clientHeight;
    if (!largura || !altura) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Faixa de notas mostrada: da mais grave à mais aguda do loop, com 1 de folga
    const alturas = notas.map((n) => n[2]);
    const topo = Math.max(...alturas) + 1;
    const baixo = Math.min(...alturas) - 1;
    const linhas = topo - baixo + 1;
    const teclas = largura <= 700 ? 40 : 46; // largura das teclas do piano
    const regua = 20;
    const x0 = teclas;
    const larguraGrade = largura - teclas;
    const alturaLinha = (altura - regua) / linhas;
    const passos = COMPRIMENTO * DIVISOES;
    const celula = larguraGrade / passos;
    geometria = { x0, largura: larguraGrade };
    const yDa = (nota) => regua + (topo - nota) * alturaLinha;

    // Fundo das linhas (linha de tecla preta mais escura) e separação entre oitavas
    for (let nota = topo; nota >= baixo; nota--) {
      const y = yDa(nota);
      ctx.fillStyle = ehPreta(nota) ? cores.linhaEscura : cores.linhaClara;
      ctx.fillRect(x0, y, larguraGrade, alturaLinha);
      ctx.fillStyle = nota % 12 === 0 ? cores.guiaForte : cores.fina;
      ctx.fillRect(x0, y + alturaLinha - 1, larguraGrade, 1);
    }
    // Linhas em pé: semicolcheia fraca, tempo média, compasso forte
    for (let p = 0; p <= passos; p++) {
      const x = Math.min(x0 + p * celula, largura - 1);
      ctx.fillStyle = p % passos === 0 ? cores.guiaForte : p % DIVISOES === 0 ? cores.guia : cores.fina;
      ctx.fillRect(Math.round(x), regua, p % passos === 0 ? 2 : 1, altura - regua);
    }
    // Notas
    const tocandoAgora = new Set(acesas ? acesas.split(',').map(Number) : []);
    ctx.font = `700 ${Math.min(10, alturaLinha - 3)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const [inicio, duracao, nota] of notas) {
      const x = x0 + (inicio / COMPRIMENTO) * larguraGrade + 1;
      const w = (duracao / COMPRIMENTO) * larguraGrade - 2;
      const y = yDa(nota) + 1;
      const h = alturaLinha - 2;
      caixa(ctx, x, y, w, h, 3);
      ctx.fillStyle = cores.nota;
      ctx.fill();
      if (w > 30 && h >= 11) {
        ctx.fillStyle = cores.textoNota;
        ctx.fillText(nomeNota(nota), x + 4, y + h / 2 + 0.5);
      }
    }
    // Régua: número do compasso e dos tempos + faixa do loop
    ctx.fillStyle = cores.barra;
    ctx.fillRect(0, 0, largura, regua);
    ctx.fillStyle = cores.nota;
    ctx.globalAlpha = 0.45;
    ctx.fillRect(x0, regua - 4, larguraGrade, 4);
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
    for (let t = 0; t < COMPRIMENTO; t++) {
      const x = x0 + t * DIVISOES * celula;
      ctx.fillStyle = t === 0 ? cores.texto : cores.suave;
      ctx.font = t === 0 ? '700 11px system-ui, sans-serif' : '9px system-ui, sans-serif';
      ctx.fillText(t === 0 ? '1' : `1.${t + 1}`, x + 4, regua - 7);
    }
    // Teclas do piano (as que estão tocando acendem) e o nome dos Dós
    ctx.fillStyle = cores.preta;
    ctx.fillRect(0, regua, teclas, altura - regua);
    ctx.font = `700 ${Math.min(10, alturaLinha - 2)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let nota = topo; nota >= baixo; nota--) {
      const y = yDa(nota);
      const preta = ehPreta(nota);
      ctx.fillStyle = tocandoAgora.has(nota) ? cores.nota : preta ? cores.preta : cores.branca;
      ctx.fillRect(0, y + 0.5, preta ? teclas * 0.62 : teclas - 1, alturaLinha - 1);
      if (nota % 12 === 0 && alturaLinha >= 9) {
        ctx.fillStyle = cores.preta;
        ctx.fillText(nomeNota(nota), teclas - 4, y + alturaLinha / 2);
      }
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = cores.barra;
    ctx.fillRect(0, 0, teclas, regua);

    cabeca.style.top = `${regua - 8}px`;
    if (!tocando) moverCabeca(0);
  }

  return { abrir, fechar, receber, aberto: () => !tela.hidden };
}
