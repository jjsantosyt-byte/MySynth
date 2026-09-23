// principal.js
// Liga o som, desenha o teclado e transforma os toques na tela em notas.

import { criarWavetableBasica } from './wavetable.js';
import { desenharOnda } from './visualizacao.js';

const botaoLigar = document.getElementById('botao-ligar');
const aviso = document.getElementById('aviso');
const teclado = document.getElementById('teclado');
const botaoOitavaMenos = document.getElementById('oitava-menos');
const botaoOitavaMais = document.getElementById('oitava-mais');
const rotuloOitava = document.getElementById('rotulo-oitava');
const controleVolume = document.getElementById('volume');
const telaOnda = document.getElementById('tela-onda');
const nomeOnda = document.getElementById('nome-onda');
const controleWTPos = document.getElementById('wt-pos');
const atalhosWT = document.getElementById('atalhos-wt');

// A wavetable é montada uma vez, ao abrir a página.
// A página guarda uma cópia para desenhar; o motor de som recebe outra.
const wavetable = criarWavetableBasica();

const estado = {
  wtPos: 0, // posição na wavetable (0 a 1)
  contexto: null, // o "motor" de áudio do navegador
  synth: null, // nosso processador de som
  ganho: null, // volume geral
  oitavaBase: 3, // a primeira tecla é o C3
  qtdOitavas: 0,
  dedos: new Map(), // cada dedo/mouse -> nota que ele está tocando
  contagemNotas: new Map(), // quantos dedos seguram cada nota
};

// ---------- Ligar o som ----------

async function ligarSom() {
  if (estado.contexto) return;

  if (!window.isSecureContext || !window.AudioWorkletNode) {
    mostrarAviso(
      'Este navegador não liberou o motor de som. Abra pelo endereço http://localhost:8080 ' +
        '(no computador) ou por um endereço https (no celular).'
    );
    return;
  }

  // O contexto precisa ser criado logo no toque (exigência do celular).
  const contexto = new AudioContext({ latencyHint: 'interactive' });
  contexto.resume();
  estado.contexto = contexto;
  botaoLigar.disabled = true;
  botaoLigar.textContent = 'Ligando...';

  try {
    await contexto.audioWorklet.addModule('processador-synth.js');

    const synth = new AudioWorkletNode(contexto, 'processador-synth', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      parameterData: { wtPos: estado.wtPos },
    });
    const ganho = contexto.createGain();
    ganho.gain.value = volumeDoControle();
    synth.connect(ganho).connect(contexto.destination);

    // Envia uma cópia da wavetable para o motor de som.
    synth.port.postMessage({ tipo: 'wavetable', wavetable });

    estado.synth = synth;
    estado.ganho = ganho;

    // Notas que já estavam sendo seguradas enquanto o som ligava começam a tocar agora.
    for (const nota of estado.contagemNotas.keys()) {
      synth.port.postMessage({ tipo: 'notaOn', nota });
    }

    await contexto.resume();
    botaoLigar.textContent = 'Som ligado';
    botaoLigar.classList.add('ligado');
  } catch (erro) {
    console.error(erro);
    mostrarAviso('Não consegui ligar o som: ' + erro.message);
    estado.contexto = null;
    botaoLigar.disabled = false;
    botaoLigar.textContent = 'Ligar som';
  }
}

function mostrarAviso(texto) {
  aviso.textContent = texto;
  aviso.hidden = false;
}

// ---------- Volume ----------

// O controle vai de 0 a 1; elevar ao quadrado deixa a curva mais natural ao ouvido.
function volumeDoControle() {
  const v = Number(controleVolume.value);
  return v * v;
}

controleVolume.addEventListener('input', () => {
  if (!estado.ganho) return;
  // Mudança suave, para não estalar.
  estado.ganho.gain.setTargetAtTime(volumeDoControle(), estado.contexto.currentTime, 0.02);
});

// ---------- WT Pos e desenho da onda ----------

const nomesFrames = wavetable.nomesFrames;
const ultimoFrame = wavetable.frames.length - 1;
const ondaDesenhada = new Float32Array(wavetable.tamanho);
let desenhoPendente = false;

// Muda o WT Pos (0 a 1): atualiza o som, a barra e o desenho.
function definirWTPos(valor) {
  estado.wtPos = Math.min(1, Math.max(0, valor));
  controleWTPos.value = estado.wtPos;
  if (estado.synth) {
    // Vai até o novo valor em poucos milissegundos, sem "degraus" no som.
    const parametro = estado.synth.parameters.get('wtPos');
    parametro.setTargetAtTime(estado.wtPos, estado.contexto.currentTime, 0.01);
  }
  pedirDesenho();
}

// Desenha no máximo uma vez por quadro da tela (economiza bateria).
function pedirDesenho() {
  if (desenhoPendente) return;
  desenhoPendente = true;
  requestAnimationFrame(() => {
    desenhoPendente = false;
    desenharAgora();
  });
}

function desenharAgora() {
  // Mesma mistura que o motor de som faz, usando a versão mais cheia da onda.
  const wt = estado.wtPos * ultimoFrame;
  const f0 = Math.min(Math.floor(wt), ultimoFrame);
  const f1 = Math.min(f0 + 1, ultimoFrame);
  const t = wt - f0;
  const a = wavetable.frames[f0][0];
  const b = wavetable.frames[f1][0];
  for (let j = 0; j < ondaDesenhada.length; j++) {
    ondaDesenhada[j] = a[j] + t * (b[j] - a[j]);
  }
  desenharOnda(telaOnda, ondaDesenhada);

  // Nome: a forma exata, ou "de → para" com a porcentagem do caminho.
  const maisProximo = Math.round(wt);
  if (Math.abs(wt - maisProximo) < 0.02) {
    nomeOnda.textContent = nomesFrames[maisProximo];
  } else {
    nomeOnda.textContent = `${nomesFrames[f0]} → ${nomesFrames[f1]}  ${Math.round(t * 100)}%`;
  }
}

controleWTPos.addEventListener('input', () => definirWTPos(Number(controleWTPos.value)));

// Botões de atalho, um para cada forma de onda.
nomesFrames.forEach((nome, indice) => {
  const botao = document.createElement('button');
  botao.className = 'botao';
  botao.textContent = nome;
  botao.addEventListener('click', () => definirWTPos(indice / ultimoFrame));
  atalhosWT.appendChild(botao);
});

// Arrastar no desenho da onda muda o WT Pos.
// Para a direita ou para cima aumenta; atravessar a largura toda = de ponta a ponta.
let arraste = null;
telaOnda.addEventListener('pointerdown', (evento) => {
  evento.preventDefault();
  telaOnda.setPointerCapture(evento.pointerId);
  arraste = { id: evento.pointerId, x: evento.clientX, y: evento.clientY, inicio: estado.wtPos };
});
telaOnda.addEventListener('pointermove', (evento) => {
  if (!arraste || evento.pointerId !== arraste.id) return;
  const deslocamento = evento.clientX - arraste.x - (evento.clientY - arraste.y);
  definirWTPos(arraste.inicio + deslocamento / telaOnda.clientWidth);
});
const terminarArraste = (evento) => {
  if (arraste && evento.pointerId === arraste.id) arraste = null;
};
telaOnda.addEventListener('pointerup', terminarArraste);
telaOnda.addEventListener('pointercancel', terminarArraste);

// ---------- Notas ----------

function notaOn(nota) {
  const qtd = (estado.contagemNotas.get(nota) || 0) + 1;
  estado.contagemNotas.set(nota, qtd);
  if (qtd === 1) {
    estado.synth?.port.postMessage({ tipo: 'notaOn', nota });
    marcarTecla(nota, true);
  }
}

function notaOff(nota) {
  const qtd = (estado.contagemNotas.get(nota) || 0) - 1;
  if (qtd > 0) {
    estado.contagemNotas.set(nota, qtd);
    return;
  }
  estado.contagemNotas.delete(nota);
  estado.synth?.port.postMessage({ tipo: 'notaOff', nota });
  marcarTecla(nota, false);
}

function soltarTudo() {
  estado.dedos.clear();
  estado.contagemNotas.clear();
  estado.synth?.port.postMessage({ tipo: 'tudoOff' });
  teclado.querySelectorAll('.ativa').forEach((t) => t.classList.remove('ativa'));
}

function marcarTecla(nota, ativa) {
  const tecla = teclado.querySelector(`[data-nota="${nota}"]`);
  if (tecla) tecla.classList.toggle('ativa', ativa);
}

// ---------- Teclado na tela ----------

// Posição das teclas dentro de uma oitava.
const BRANCAS = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const PRETAS = [
  // [depois de qual tecla branca, semitom]
  [1, 1], // C#
  [2, 3], // D#
  [4, 6], // F#
  [5, 8], // G#
  [6, 10], // A#
];

// Quantas oitavas cabem com teclas de pelo menos ~48 px de largura.
function oitavasQueCabem() {
  const brancasQueCabem = Math.floor(teclado.clientWidth / 48);
  return Math.min(4, Math.max(1, Math.floor((brancasQueCabem - 1) / 7)));
}

// Nota MIDI da primeira tecla (C3 = 48).
function notaInicial() {
  return 12 * (estado.oitavaBase + 1);
}

function montarTeclado() {
  soltarTudo();
  estado.qtdOitavas = oitavasQueCabem();
  const totalBrancas = estado.qtdOitavas * 7 + 1; // +1 = o C do final
  const primeira = notaInicial();
  teclado.innerHTML = '';

  for (let i = 0; i < totalBrancas; i++) {
    const oitava = Math.floor(i / 7);
    const nota = primeira + oitava * 12 + BRANCAS[i % 7];
    const tecla = document.createElement('div');
    tecla.className = 'tecla branca';
    tecla.dataset.nota = nota;
    if (i % 7 === 0) tecla.textContent = 'C' + (estado.oitavaBase + oitava);
    teclado.appendChild(tecla);
  }

  for (let oitava = 0; oitava < estado.qtdOitavas; oitava++) {
    for (const [posicao, semitom] of PRETAS) {
      const tecla = document.createElement('div');
      tecla.className = 'tecla preta';
      tecla.dataset.nota = primeira + oitava * 12 + semitom;
      tecla.style.left = ((oitava * 7 + posicao) / totalBrancas) * 100 + '%';
      tecla.style.width = (0.6 / totalBrancas) * 100 + '%';
      teclado.appendChild(tecla);
    }
  }

  rotuloOitava.textContent = 'C' + estado.oitavaBase;
}

// Descobre qual tecla está embaixo do dedo e toca/troca a nota.
function atualizarDedo(evento) {
  const elemento = document.elementFromPoint(evento.clientX, evento.clientY);
  const tecla = elemento?.closest('.tecla');
  const nota = tecla && teclado.contains(tecla) ? Number(tecla.dataset.nota) : null;
  const anterior = estado.dedos.get(evento.pointerId);
  if (nota === anterior) return;

  if (anterior != null) notaOff(anterior);
  if (nota != null) notaOn(nota);
  estado.dedos.set(evento.pointerId, nota);
}

function soltarDedo(evento) {
  if (!estado.dedos.has(evento.pointerId)) return;
  const nota = estado.dedos.get(evento.pointerId);
  estado.dedos.delete(evento.pointerId);
  if (nota != null) notaOff(nota);
}

teclado.addEventListener('pointerdown', (evento) => {
  // Primeiro toque no teclado já liga o som (não precisa do botão).
  if (!estado.contexto) ligarSom();
  evento.preventDefault();
  teclado.setPointerCapture(evento.pointerId);
  estado.dedos.set(evento.pointerId, null);
  atualizarDedo(evento);
});

teclado.addEventListener('pointermove', (evento) => {
  // Só segue quem está com o dedo/botão apertado (deslizar entre teclas).
  if (estado.dedos.has(evento.pointerId)) atualizarDedo(evento);
});

teclado.addEventListener('pointerup', (evento) => {
  // Alguns celulares só liberam o som quando o dedo sai da tela.
  if (estado.contexto?.state === 'suspended') estado.contexto.resume();
  soltarDedo(evento);
});
teclado.addEventListener('pointercancel', soltarDedo);
teclado.addEventListener('lostpointercapture', soltarDedo);
teclado.addEventListener('contextmenu', (evento) => evento.preventDefault());

// ---------- Botões ----------

botaoLigar.addEventListener('click', ligarSom);

botaoOitavaMenos.addEventListener('click', () => {
  if (estado.oitavaBase > 0) {
    estado.oitavaBase--;
    montarTeclado();
  }
});

botaoOitavaMais.addEventListener('click', () => {
  if (estado.oitavaBase + estado.qtdOitavas < 8) {
    estado.oitavaBase++;
    montarTeclado();
  }
});

// Se a tela mudar de tamanho (ex.: girar o celular), refaz o teclado.
let esperaRedimensionar;
window.addEventListener('resize', () => {
  clearTimeout(esperaRedimensionar);
  esperaRedimensionar = setTimeout(() => {
    if (oitavasQueCabem() !== estado.qtdOitavas) montarTeclado();
    pedirDesenho();
  }, 150);
});

// Se o app for para o fundo (trocar de aba, bloquear a tela), solta todas as notas.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) soltarTudo();
});

montarTeclado();
definirWTPos(Number(controleWTPos.value));
