// principal.js
// Liga o som, desenha o teclado e transforma os toques na tela em notas.

import { criarWavetableSerra } from './wavetable.js';

const botaoLigar = document.getElementById('botao-ligar');
const aviso = document.getElementById('aviso');
const teclado = document.getElementById('teclado');
const botaoOitavaMenos = document.getElementById('oitava-menos');
const botaoOitavaMais = document.getElementById('oitava-mais');
const rotuloOitava = document.getElementById('rotulo-oitava');
const controleVolume = document.getElementById('volume');

const estado = {
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
    });
    const ganho = contexto.createGain();
    ganho.gain.value = volumeDoControle();
    synth.connect(ganho).connect(contexto.destination);

    // Monta a onda aqui e envia para o motor de som.
    const wavetable = criarWavetableSerra();
    const buffers = wavetable.frames.flat().map((onda) => onda.buffer);
    synth.port.postMessage({ tipo: 'wavetable', wavetable }, buffers);

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
  }, 150);
});

// Se o app for para o fundo (trocar de aba, bloquear a tela), solta todas as notas.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) soltarTudo();
});

montarTeclado();
