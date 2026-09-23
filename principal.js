// principal.js
// Liga o som, desenha o teclado e transforma os toques na tela em notas.

import { criarWavetableBasica } from './wavetable.js';
import { desenharOnda, desenharEnvelope, desenharFiltro } from './visualizacao.js';
import { TIPOS_FILTRO } from './dsp/filtro.js';
import {
  criarKnob,
  escalaLinear,
  escalaExponencial,
  escalaPotencia,
  formatarTempo,
  formatarPorcentagem,
  formatarFrequencia,
} from './interface/knob.js';
import { criarSeletor } from './interface/seletor.js';

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
const telaFiltro = document.getElementById('tela-filtro');
const botaoFiltroLigado = document.getElementById('filtro-ligado');
const tiposFiltro = document.getElementById('tipos-filtro');
const knobsFiltro = document.getElementById('knobs-filtro');
const telaEnvelope = document.getElementById('tela-envelope');
const botaoLegato = document.getElementById('legato');
const knobsEnvelope = document.getElementById('knobs-envelope');
const unisonOsc = document.getElementById('unison-osc');
const modoVoz = document.getElementById('modo-voz');
const lugarSeletorVozes = document.getElementById('seletor-vozes');

// A wavetable é montada uma vez, ao abrir a página.
// A página guarda uma cópia para desenhar; o motor de som recebe outra.
const wavetable = criarWavetableBasica();

const estado = {
  // Valores dos controles de som (os nomes são os mesmos do motor de som).
  parametros: {
    wtPos: 0, // posição na wavetable (0 a 1)
    detune: 0.25, // unison: quanto as cópias desafinam (0 a 1)
    width: 1, // unison: abertura no estéreo (0 a 1)
    cutoff: 2000, // Hz
    resonancia: 0.1, // 0 a 1
    ataque: 0.005, // segundos
    decaimento: 0.5, // segundos
    sustentacao: 1, // 0 a 1
    soltura: 0.08, // segundos
  },
  // Opções liga/desliga e escolhas.
  opcoes: {
    filtroLigado: false,
    filtroTipo: 'lp24',
    modo: 'poly', // 'mono' ou 'poly'
    vozes: 8, // quantas notas ao mesmo tempo (Poly)
    legato: true, // só vale no Mono
    unison: 1, // cópias do oscilador por nota
  },
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
      outputChannelCount: [2], // estéreo
      parameterData: { ...estado.parametros },
    });
    const ganho = contexto.createGain();
    ganho.gain.value = volumeDoControle();

    // Limitador no fim do caminho: no uso normal não faz nada; só segura
    // picos que iam estourar (ex.: ressonância alta com varredura rápida).
    const limiar = -3;
    const razao = 20;
    const limitador = new DynamicsCompressorNode(contexto, {
      threshold: limiar,
      knee: 0,
      ratio: razao,
      attack: 0.001,
      release: 0.1,
    });
    // O limitador do navegador aumenta o volume de tudo por conta própria
    // ("makeup gain"). Este ganho desfaz isso, para ele ficar neutro.
    const desfazerAumento = contexto.createGain();
    desfazerAumento.gain.value = Math.pow(10, (limiar * (1 - 1 / razao) * 0.6) / 20);

    synth
      .connect(ganho)
      .connect(limitador)
      .connect(desfazerAumento)
      .connect(contexto.destination);

    // Envia uma cópia da wavetable para o motor de som.
    synth.port.postMessage({ tipo: 'wavetable', wavetable });

    estado.synth = synth;
    estado.ganho = ganho;

    // Envia as opções atuais (tipo de filtro, legato...).
    for (const nome of Object.keys(estado.opcoes)) enviarOpcao(nome);

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
// O "× 0,5" deixa uma folga para picos (ex.: ressonância alta) não estourarem.
function volumeDoControle() {
  const v = Number(controleVolume.value);
  return v * v * 0.5;
}

controleVolume.addEventListener('input', () => {
  if (!estado.ganho) return;
  // Mudança suave, para não estalar.
  estado.ganho.gain.setTargetAtTime(volumeDoControle(), estado.contexto.currentTime, 0.02);
});

// ---------- Controles de som (parâmetros e opções) ----------

// Muda um controle de som: guarda o valor e manda para o motor.
function definirParametro(nome, valor) {
  estado.parametros[nome] = valor;
  if (estado.synth) {
    // Vai até o novo valor em poucos milissegundos, sem "degraus" no som.
    const parametro = estado.synth.parameters.get(nome);
    parametro.setTargetAtTime(valor, estado.contexto.currentTime, 0.01);
  }
  pedirDesenho();
}

// Muda uma opção (liga/desliga, tipo de filtro...).
function definirOpcao(nome, valor) {
  estado.opcoes[nome] = valor;
  enviarOpcao(nome);
  pedirDesenho();
}

function enviarOpcao(nome) {
  estado.synth?.port.postMessage({ tipo: 'opcao', nome, valor: estado.opcoes[nome] });
}

// ---------- Desenhos ----------

let desenhoPendente = false;

// Desenha no máximo uma vez por quadro da tela (economiza bateria).
// Os painéis de abas escondidas são pulados automaticamente.
function pedirDesenho() {
  if (desenhoPendente) return;
  desenhoPendente = true;
  requestAnimationFrame(() => {
    desenhoPendente = false;
    desenharPainelOnda();
    desenharEnvelope(telaEnvelope, estado.parametros);
    desenharFiltro(telaFiltro, {
      tipo: estado.opcoes.filtroTipo,
      ligado: estado.opcoes.filtroLigado,
      corte: estado.parametros.cutoff,
      resonancia: estado.parametros.resonancia,
      taxa: estado.contexto?.sampleRate || 48000,
    });
  });
}

// Redesenha sempre que um painel mudar de tamanho (girar a tela, trocar de aba...).
const observarTamanho = new ResizeObserver(pedirDesenho);
[telaOnda, telaEnvelope, telaFiltro].forEach((tela) => observarTamanho.observe(tela));

// ---------- WT Pos e desenho da onda ----------

const nomesFrames = wavetable.nomesFrames;
const ultimoFrame = wavetable.frames.length - 1;
const ondaDesenhada = new Float32Array(wavetable.tamanho);

// Muda o WT Pos (0 a 1): atualiza o som, a barra e o desenho.
function definirWTPos(valor) {
  const wtPos = Math.min(1, Math.max(0, valor));
  controleWTPos.value = wtPos;
  definirParametro('wtPos', wtPos);
}

function desenharPainelOnda() {
  // Mesma mistura que o motor de som faz, usando a versão mais cheia da onda.
  const wt = estado.parametros.wtPos * ultimoFrame;
  const f0 = Math.min(Math.floor(wt), ultimoFrame);
  const f1 = Math.min(f0 + 1, ultimoFrame);
  const t = wt - f0;
  const a = wavetable.frames[f0][0];
  const b = wavetable.frames[f1][0];
  for (let j = 0; j < ondaDesenhada.length; j++) {
    ondaDesenhada[j] = a[j] + t * (b[j] - a[j]);
  }
  desenharOnda(telaOnda, ondaDesenhada, marcasUnison());

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
  botao.textContent = wavetable.nomesCurtos[indice];
  botao.title = nome;
  botao.addEventListener('click', () => definirWTPos(indice / ultimoFrame));
  atalhosWT.appendChild(botao);
});

// Arrastar no desenho da onda muda o WT Pos.
// Para a direita ou para cima aumenta; atravessar a largura toda = de ponta a ponta.
let arraste = null;
telaOnda.addEventListener('pointerdown', (evento) => {
  evento.preventDefault();
  telaOnda.setPointerCapture(evento.pointerId);
  arraste = { id: evento.pointerId, x: evento.clientX, y: evento.clientY, inicio: estado.parametros.wtPos };
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

// ---------- Unison (no cartão OSC A) ----------

// Posições das cópias para as marcas no desenho (de -1 a +1, vezes o Detune).
// Mesma distribuição que o motor de som usa.
function marcasUnison() {
  const qtd = estado.opcoes.unison;
  if (qtd < 2) return [];
  const marcas = [];
  for (let c = 0; c < qtd; c++) marcas.push(((c / (qtd - 1)) * 2 - 1) * estado.parametros.detune);
  return marcas;
}

unisonOsc.append(
  criarSeletor({
    rotulo: 'Unison',
    min: 1,
    max: 16,
    padrao: estado.opcoes.unison,
    aoMudar: (v) => definirOpcao('unison', v),
  }),
  criarKnob({
    rotulo: 'Detune',
    escala: escalaLinear(0, 1),
    padrao: estado.parametros.detune,
    formatar: formatarPorcentagem,
    aoMudar: (v) => definirParametro('detune', v),
  }),
  criarKnob({
    rotulo: 'Width',
    escala: escalaLinear(0, 1),
    padrao: estado.parametros.width,
    formatar: formatarPorcentagem,
    aoMudar: (v) => definirParametro('width', v),
  })
);

// ---------- Opções de voz (Mono/Poly, vozes, Legato) ----------

const seletorVozes = criarSeletor({
  rotulo: 'Vozes',
  min: 1,
  max: 16,
  padrao: estado.opcoes.vozes,
  aoMudar: (v) => definirOpcao('vozes', v),
  rotuloAoLado: true,
});
lugarSeletorVozes.replaceWith(seletorVozes);

modoVoz.querySelectorAll('.botao').forEach((botao) => {
  botao.addEventListener('click', () => {
    if (botao.dataset.modo === estado.opcoes.modo) return;
    soltarTudo(); // trocar de modo solta todas as notas
    definirOpcao('modo', botao.dataset.modo);
    atualizarOpcoesVoz();
  });
});

botaoLegato.addEventListener('click', () => {
  definirOpcao('legato', !estado.opcoes.legato);
  atualizarOpcoesVoz();
});

// Marca o modo escolhido. "Vozes" só vale no Poly; "Legato" só no Mono.
function atualizarOpcoesVoz() {
  const mono = estado.opcoes.modo === 'mono';
  modoVoz.querySelectorAll('.botao').forEach((botao) => {
    botao.classList.toggle('escolhido', botao.dataset.modo === estado.opcoes.modo);
  });
  seletorVozes.habilitar(!mono);
  botaoLegato.disabled = !mono;
  botaoLegato.setAttribute('aria-pressed', estado.opcoes.legato);
  botaoLegato.title = mono ? '' : 'Legato só funciona no modo Mono';
}

atualizarOpcoesVoz();

// ---------- Aba Filtro ----------

const NOMES_FILTRO = { lp12: 'LP 12', lp24: 'LP 24', hp: 'HP', bp: 'BP' };

function atualizarBotaoFiltro() {
  const ligado = estado.opcoes.filtroLigado;
  botaoFiltroLigado.setAttribute('aria-pressed', ligado);
  botaoFiltroLigado.textContent = ligado ? 'Ligado' : 'Desligado';
}

botaoFiltroLigado.addEventListener('click', () => {
  definirOpcao('filtroLigado', !estado.opcoes.filtroLigado);
  atualizarBotaoFiltro();
});

// Botões de tipo: LP 12, LP 24, HP, BP.
TIPOS_FILTRO.forEach((tipo) => {
  const botao = document.createElement('button');
  botao.className = 'botao';
  botao.textContent = NOMES_FILTRO[tipo];
  botao.dataset.tipo = tipo;
  botao.addEventListener('click', () => {
    definirOpcao('filtroTipo', tipo);
    marcarTipoFiltro();
  });
  tiposFiltro.appendChild(botao);
});

function marcarTipoFiltro() {
  tiposFiltro.querySelectorAll('.botao').forEach((botao) => {
    botao.classList.toggle('escolhido', botao.dataset.tipo === estado.opcoes.filtroTipo);
  });
}

knobsFiltro.append(
  criarKnob({
    rotulo: 'Cutoff',
    escala: escalaExponencial(20, 20000),
    padrao: estado.parametros.cutoff,
    formatar: formatarFrequencia,
    aoMudar: (v) => definirParametro('cutoff', v),
  }),
  criarKnob({
    rotulo: 'Reso',
    escala: escalaLinear(0, 1),
    padrao: estado.parametros.resonancia,
    formatar: formatarPorcentagem,
    aoMudar: (v) => definirParametro('resonancia', v),
  })
);

atualizarBotaoFiltro();
marcarTipoFiltro();

// ---------- Aba ENV (envelope de volume) ----------

// Tempos: de 0 a 10 s, com mais precisão nos tempos curtos.
const escalaTempo = escalaPotencia(10, 3);

knobsEnvelope.append(
  criarKnob({
    rotulo: 'A',
    escala: escalaTempo,
    padrao: estado.parametros.ataque,
    formatar: formatarTempo,
    aoMudar: (v) => definirParametro('ataque', v),
  }),
  criarKnob({
    rotulo: 'D',
    escala: escalaTempo,
    padrao: estado.parametros.decaimento,
    formatar: formatarTempo,
    aoMudar: (v) => definirParametro('decaimento', v),
  }),
  criarKnob({
    rotulo: 'S',
    escala: escalaLinear(0, 1),
    padrao: estado.parametros.sustentacao,
    formatar: formatarPorcentagem,
    aoMudar: (v) => definirParametro('sustentacao', v),
  }),
  criarKnob({
    rotulo: 'R',
    escala: escalaTempo,
    padrao: estado.parametros.soltura,
    formatar: formatarTempo,
    aoMudar: (v) => definirParametro('soltura', v),
  })
);

// ---------- Abas ----------

const abas = document.querySelectorAll('.aba');
const paineis = document.querySelectorAll('.conteudo-aba');

// Mostra só o conteúdo da aba escolhida. O som não muda ao trocar de aba.
function mostrarAba(nome) {
  abas.forEach((aba) => {
    const ativa = aba.dataset.aba === nome;
    aba.classList.toggle('ativa', ativa);
    aba.setAttribute('aria-selected', ativa);
  });
  paineis.forEach((painel) => {
    painel.hidden = painel.dataset.painel !== nome;
  });
}

abas.forEach((aba) => aba.addEventListener('click', () => mostrarAba(aba.dataset.aba)));

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
definirWTPos(Number(controleWTPos.value));
