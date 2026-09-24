// principal.js
// Liga o som, desenha o teclado e transforma os toques na tela em notas.

import { listaWavetables, obterWavetable } from './wavetable.js';
import { desenharOnda, desenharEnvelope, desenharFiltro, desenharLFO } from './visualizacao.js';
import { TIPOS_FILTRO } from './dsp/filtro.js';
import { FORMAS_LFO } from './dsp/lfo.js';
import {
  criarKnob,
  escalaLinear,
  escalaExponencial,
  escalaPotencia,
  formatarTempo,
  formatarPorcentagem,
  formatarFrequencia,
  formatarRate,
  faixaModulacao,
} from './interface/knob.js';
import { criarSeletor } from './interface/seletor.js';
import { criarModulacao } from './interface/modulacao.js';
import { DESTINOS_MOD } from './dsp/modulacao.js';
import { tempoDoTamanho } from './dsp/efeitos/reverb.js';
import { TIPOS_DISTORCAO } from './dsp/efeitos/distorcao.js';
import { TIPOS_RUIDO } from './dsp/ruido.js';
import { criarPresets } from './interface/presets.js';
import { criarListaWavetables } from './interface/wavetables.js';
import { PRESETS_FABRICA, CATEGORIAS } from './presets-fabrica.js';

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
const telaEnvelope = document.getElementById('tela-envelope');
const botaoLegato = document.getElementById('legato');
const knobsEnvelope = document.getElementById('knobs-envelope');
const unisonOsc = document.getElementById('unison-osc');
const modoVoz = document.getElementById('modo-voz');
const lugarSeletorVozes = document.getElementById('seletor-vozes');

// A wavetable em uso. A página guarda uma cópia para desenhar; o motor de som recebe outra.
let wavetable = obterWavetable('basica');

const estado = {
  // Valores dos controles de som (os nomes são os mesmos do motor de som).
  parametros: {
    wtPos: 0, // posição na wavetable (0 a 1)
    detune: 0.25, // unison: quanto as cópias desafinam (0 a 1)
    width: 1, // unison: abertura no estéreo (0 a 1)
    nivelOsc: 1, // nível do oscilador A (0 a 1)
    ruido: 0.5, // nível do ruído (0 a 1)
    cutoff: 2000, // Hz
    resonancia: 0.1, // 0 a 1
    cutoff2: 2000, // Filtro 2 (Hz)
    resonancia2: 0.1, // Filtro 2 (0 a 1)
    ataque: 0.005, // segundos
    decaimento: 0.5, // segundos
    sustentacao: 1, // 0 a 1
    soltura: 0.08, // segundos
  },
  // Opções liga/desliga e escolhas.
  opcoes: {
    wavetable: 'basica', // qual wavetable o OSC A usa
    oscLigado: true, // OSC A ligado
    filtroLigado: false, // Filtro 1
    filtroTipo: 'lp24',
    filtro2Ligado: false, // Filtro 2
    filtro2Tipo: 'lp24',
    rotaOsc: 'f1', // rota de filtro do oscilador: 'f1', 'f2', 'f12' (1→2) ou 'f21' (2→1)
    rotaRuido: 'f1', // rota de filtro do ruído
    modo: 'poly', // 'mono' ou 'poly'
    vozes: 8, // quantas notas ao mesmo tempo (Poly)
    legato: true, // só vale no Mono
    unison: 1, // cópias do oscilador por nota
    glide: 0, // segundos do escorregão entre notas (0 = desligado)
    glideSempre: false, // escorregar mesmo sem emendar as notas
    ruidoLigado: false, // ruído somado ao oscilador
    ruidoTipo: 'white', // 'white', 'pink' ou 'brown'
  },
  // Fontes de modulação (mesmos valores iniciais do motor de som).
  fontes: {
    lfo1: { forma: 'seno', rate: 2, modo: 'retrig' },
    lfo2: { forma: 'triangulo', rate: 0.5, modo: 'retrig' },
    env2: { ataque: 0.005, decaimento: 0.3, sustentacao: 0, soltura: 0.2 },
    env3: { ataque: 0.005, decaimento: 0.3, sustentacao: 0, soltura: 0.2 },
  },
  // Ligações de modulação: [{ fonte: 'lfo1', destino: 'cutoff', quantidade: 0.5 }]
  ligacoes: [],
  // Efeitos (mesmos valores iniciais do motor de som)
  efeitos: {
    distorcao: { ligado: false, tipo: 'suave', drive: 0.4, mix: 1 },
    chorus: { ligado: false, rate: 0.8, depth: 0.5, mix: 0.5 },
    delay: { ligado: false, tempo: 0.3, feedback: 0.4, mix: 0.3, pingpong: false },
    reverb: { ligado: false, tamanho: 0.5, brilho: 0.6, mix: 0.3 },
  },
  // O que a nota mais recente está fazendo agora (vem do motor ~30 vezes por segundo):
  // mod = quanto cada controle está sendo modulado; lfos = fase e valor de cada LFO.
  aoVivo: { mod: null, lfos: [null, null] },
  contexto: null, // o "motor" de áudio do navegador
  synth: null, // nosso processador de som
  ganho: null, // volume geral
  oitavaBase: 3, // a primeira tecla é o C3
  qtdOitavas: 0,
  dedos: new Map(), // cada dedo/mouse -> nota que ele está tocando
  teclasPc: new Map(), // cada tecla do computador apertada -> nota que ela está tocando
  contagemNotas: new Map(), // quantos dedos seguram cada nota
};

// ---------- O "som" (o que um preset guarda) ----------
// Tudo que define o timbre. Não entram volume geral e oitava (são de quem toca).

const clonar = (dados) => JSON.parse(JSON.stringify(dados));

function obterSom() {
  const { parametros, opcoes, fontes, ligacoes, efeitos } = estado;
  return clonar({ parametros, opcoes, fontes, ligacoes, efeitos });
}

// O som inicial ("Init"): base para todos os presets.
const SOM_PADRAO = obterSom();

// Junta "extra" em cima de "base" (objetos dentro de objetos; listas são trocadas inteiras).
function mesclar(base, extra) {
  for (const [chave, valor] of Object.entries(extra || {})) {
    if (valor && typeof valor === 'object' && !Array.isArray(valor) && base[chave] && typeof base[chave] === 'object') {
      mesclar(base[chave], valor);
    } else if (chave in base) {
      base[chave] = clonar(valor);
    }
  }
  return base;
}

// Enquanto um preset é carregado, as mudanças não contam como "som modificado".
let carregandoPreset = false;
let avisarModificado = () => {};
function modificou() {
  if (!carregandoPreset) avisarModificado();
}

// Coisas da tela que precisam ser atualizadas quando o som muda de uma vez
// (botões, marcações...). Knobs e seletores se atualizam sozinhos (sincronizar).
const sincronizadores = [];

// Carrega um som (de um preset): valores → motor de som → tela.
function aplicarSom(som) {
  carregandoPreset = true;
  const novo = mesclar(clonar(SOM_PADRAO), som);
  soltarTudo();

  // Estado (as ligações são trocadas no lugar: a tela de modulação usa a mesma lista)
  Object.assign(estado.parametros, novo.parametros);
  Object.assign(estado.opcoes, novo.opcoes);
  for (const id of Object.keys(estado.fontes)) Object.assign(estado.fontes[id], novo.fontes[id]);
  for (const id of Object.keys(estado.efeitos)) Object.assign(estado.efeitos[id], novo.efeitos[id]);
  estado.ligacoes.splice(0, estado.ligacoes.length, ...novo.ligacoes);
  if (estado.opcoes.wavetable !== wavetable.id) trocarWavetable(estado.opcoes.wavetable);

  // Motor de som (os parâmetros chegam suavemente, sem estalo)
  for (const [nome, valor] of Object.entries(estado.parametros)) definirParametro(nome, valor);
  for (const nome of Object.keys(estado.opcoes)) enviarOpcao(nome);
  for (const id of Object.keys(estado.fontes)) enviarFonte(id);
  for (const id of Object.keys(estado.efeitos)) enviarEfeito(id);
  enviarLigacoes();

  // Tela
  document.querySelectorAll('.knob, .seletor').forEach((el) => el.sincronizar?.());
  for (const sincronizar of sincronizadores) sincronizar();
  telaModulacao.atualizar();
  pedirDesenho();
  carregandoPreset = false;
}

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

    // Valores ao vivo vindos do motor: atualizam os pontinhos e os desenhos.
    synth.port.onmessage = (evento) => {
      if (evento.data.tipo !== 'aoVivo') return;
      estado.aoVivo = evento.data;
      telaModulacao.atualizarAoVivo(evento.data.mod);
      pedirDesenho();
    };

    estado.synth = synth;
    estado.ganho = ganho;

    // Envia as opções atuais (tipo de filtro, legato...), as fontes e as ligações.
    for (const nome of Object.keys(estado.opcoes)) enviarOpcao(nome);
    for (const id of Object.keys(estado.fontes)) enviarFonte(id);
    for (const id of Object.keys(estado.efeitos)) enviarEfeito(id);
    enviarLigacoes();

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
  modificou();
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
  modificou();
  if (nome === 'wavetable') trocarWavetable(valor);
  else enviarOpcao(nome);
  pedirDesenho();
}

function enviarOpcao(nome) {
  estado.synth?.port.postMessage({ tipo: 'opcao', nome, valor: estado.opcoes[nome] });
}

// Muda um ajuste de uma fonte de modulação (ex.: rate do LFO 1).
function definirFonte(id, nome, valor) {
  estado.fontes[id][nome] = valor;
  modificou();
  enviarFonte(id);
  pedirDesenho();
}

function enviarFonte(id) {
  estado.synth?.port.postMessage({ tipo: 'fonte', id, ajustes: { ...estado.fontes[id] } });
}

// Muda um ajuste de um efeito (ex.: mix do reverb).
function definirEfeito(id, nome, valor) {
  estado.efeitos[id][nome] = valor;
  modificou();
  enviarEfeito(id);
}

function enviarEfeito(id) {
  estado.synth?.port.postMessage({ tipo: 'efeito', id, ajustes: { ...estado.efeitos[id] } });
}

function enviarLigacoes() {
  estado.synth?.port.postMessage({ tipo: 'modulacoes', lista: estado.ligacoes.map((l) => ({ ...l })) });
}

// ---------- Valores modulados "ao vivo" (para os desenhos) ----------

// Controle de 0 a 1 somado à modulação que a nota mais recente está recebendo agora.
function modulado(base, destino) {
  const mod = estado.aoVivo.mod;
  if (!mod) return base;
  return Math.min(1, Math.max(0, base + mod[DESTINOS_MOD.indexOf(destino)]));
}

// Cutoff ao vivo: a modulação anda na escala do knob (exponencial de 20 Hz a 20 kHz).
// "nome" = 'cutoff' (Filtro 1) ou 'cutoff2' (Filtro 2): é também o nome do destino de modulação.
const escalaCutoff = escalaExponencial(20, 20000);
function corteAoVivo(nome) {
  return escalaCutoff.paraValor(modulado(escalaCutoff.paraPosicao(estado.parametros[nome]), nome));
}

// Os dois filtros: nomes das opções e dos parâmetros de cada um
const FILTROS = [
  { numero: 1, ligado: 'filtroLigado', tipo: 'filtroTipo', corte: 'cutoff', reso: 'resonancia' },
  { numero: 2, ligado: 'filtro2Ligado', tipo: 'filtro2Tipo', corte: 'cutoff2', reso: 'resonancia2' },
];
const cartaoFiltro = (numero) => document.querySelector(`[data-filtro="${numero}"]`);

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
    for (const f of FILTROS) {
      desenharFiltro(cartaoFiltro(f.numero).querySelector('[data-filtro-tela]'), {
        tipo: estado.opcoes[f.tipo],
        ligado: estado.opcoes[f.ligado],
        corte: corteAoVivo(f.corte),
        resonancia: modulado(estado.parametros[f.reso], f.reso),
        taxa: estado.contexto?.sampleRate || 48000,
      });
    }
    telasLfo.forEach((tela) => {
      const id = tela.dataset.telaLfo;
      desenharLFO(tela, estado.fontes[id].forma, estado.aoVivo.lfos[id === 'lfo1' ? 0 : 1]);
    });
    telasEnv.forEach((tela) => desenharEnvelope(tela, estado.fontes[tela.dataset.telaEnv]));
  });
}

// Redesenha sempre que um painel mudar de tamanho (girar a tela, trocar de aba...).
const telasLfo = document.querySelectorAll('[data-tela-lfo]');
const telasEnv = document.querySelectorAll('[data-tela-env]');
const observarTamanho = new ResizeObserver(pedirDesenho);
const telasFiltro = document.querySelectorAll('[data-filtro-tela]');
[telaOnda, telaEnvelope, ...telasFiltro, ...telasLfo, ...telasEnv].forEach((tela) => observarTamanho.observe(tela));

// ---------- Escolha da wavetable (‹ Básica ›) ----------

const nomeWavetable = document.getElementById('wt-nome');

// Troca a wavetable do oscilador: monta (se preciso), manda para o motor e ajusta a tela.
function trocarWavetable(id) {
  wavetable = obterWavetable(id);
  estado.opcoes.wavetable = wavetable.id;
  estado.synth?.port.postMessage({ tipo: 'wavetable', wavetable });
  nomeWavetable.textContent = wavetable.nome;
  montarAtalhos();
  pedirDesenho();
}

// As setas andam por todas: fábrica e depois as importadas.
function andarWavetable(passo) {
  const lista = listaWavetables();
  const i = lista.findIndex((w) => w.id === wavetable.id);
  const proxima = lista[(i + passo + lista.length) % lista.length];
  definirOpcao('wavetable', proxima.id);
}

document.getElementById('wt-anterior').addEventListener('click', () => andarWavetable(-1));
document.getElementById('wt-proxima').addEventListener('click', () => andarWavetable(1));

// Tocar no nome abre a lista (e o botão Importar .wav).
criarListaWavetables({
  botaoNome: nomeWavetable,
  idAtual: () => wavetable.id,
  escolher: (id) => definirOpcao('wavetable', id),
});

// ---------- WT Pos e desenho da onda ----------

const ondaDesenhada = new Float32Array(wavetable.tamanho);

// Muda o WT Pos (0 a 1): atualiza o som, a barra e o desenho.
function definirWTPos(valor) {
  const wtPos = Math.min(1, Math.max(0, valor));
  controleWTPos.value = wtPos;
  definirParametro('wtPos', wtPos);
  desenharModulacaoWTPos(); // as faixas acompanham a barra
}

// Faixas de modulação e ponto ao vivo embaixo da barra do WT Pos
// (o equivalente ao arco colorido dos knobs).
const grupoWTPos = document.querySelector('.grupo-wtpos');
const faixasWTPos = document.getElementById('faixas-wtpos');
let modulacaoWTPos = { faixas: [], deslocamento: null };

grupoWTPos.mostrarModulacao = (faixas, deslocamento) => {
  modulacaoWTPos = { faixas, deslocamento };
  desenharModulacaoWTPos();
};

function desenharModulacaoWTPos() {
  const base = estado.parametros.wtPos;
  const { faixas, deslocamento } = modulacaoWTPos;
  faixasWTPos.innerHTML = '';
  for (const faixa of faixas) {
    const [ini, fim] = faixaModulacao(base, faixa.quantidade, faixa.bipolar);
    const trecho = document.createElement('span');
    trecho.className = 'faixa';
    trecho.style.left = ini * 100 + '%';
    trecho.style.width = (fim - ini) * 100 + '%';
    trecho.style.background = faixa.cor;
    faixasWTPos.appendChild(trecho);
  }
  if (deslocamento !== null && faixas.length > 0) {
    const ponto = document.createElement('span');
    ponto.className = 'ponto-aovivo';
    ponto.style.left = Math.min(1, Math.max(0, base + deslocamento)) * 100 + '%';
    faixasWTPos.appendChild(ponto);
  }
}

function desenharPainelOnda() {
  // Mesma mistura que o motor de som faz, usando a versão mais cheia da onda.
  // Com modulação no WT Pos, mostra a onda na posição modulada, ao vivo.
  const ultimoFrame = wavetable.frames.length - 1;
  const posicao = modulado(estado.parametros.wtPos, 'wtPos');
  const wt = posicao * ultimoFrame;
  const f0 = Math.min(Math.floor(wt), ultimoFrame);
  const f1 = Math.min(f0 + 1, ultimoFrame);
  const t = wt - f0;
  const a = wavetable.frames[f0][0];
  const b = wavetable.frames[f1][0];
  for (let j = 0; j < ondaDesenhada.length; j++) {
    ondaDesenhada[j] = a[j] + t * (b[j] - a[j]);
  }
  desenharOnda(telaOnda, ondaDesenhada, marcasUnison());

  // Nome: se os frames têm nome (ex.: Seno, Tri...), a forma exata ou "de → para";
  // senão, o nome da wavetable com a posição em %.
  const nomes = wavetable.nomesFrames;
  const maisProximo = Math.round(wt);
  if (!nomes) {
    nomeOnda.textContent = `${wavetable.nome} ${Math.round(posicao * 100)}%`;
  } else if (Math.abs(wt - maisProximo) < 0.02) {
    nomeOnda.textContent = nomes[maisProximo];
  } else {
    nomeOnda.textContent = `${nomes[f0]} → ${nomes[f1]}  ${Math.round(t * 100)}%`;
  }
}

controleWTPos.addEventListener('input', () => definirWTPos(Number(controleWTPos.value)));

// Botões de atalho da wavetable atual (ex.: Seno, Tri, Serra, Quad).
function montarAtalhos() {
  atalhosWT.innerHTML = '';
  for (const { nome, posicao } of wavetable.atalhos) {
    const botao = document.createElement('button');
    botao.className = 'botao';
    botao.textContent = nome;
    botao.addEventListener('click', () => definirWTPos(posicao));
    atalhosWT.appendChild(botao);
  }
}
montarAtalhos();

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
  const detune = modulado(estado.parametros.detune, 'detune');
  for (let c = 0; c < qtd; c++) marcas.push(((c / (qtd - 1)) * 2 - 1) * detune);
  return marcas;
}

unisonOsc.append(
  criarSeletor({
    rotulo: 'Unison',
    min: 1,
    max: 16,
    padrao: estado.opcoes.unison,
    aoMudar: (v) => definirOpcao('unison', v),
    ler: () => estado.opcoes.unison,
  }),
  criarKnob({
    rotulo: 'Detune',
    destino: 'detune',
    escala: escalaLinear(0, 1),
    padrao: estado.parametros.detune,
    formatar: formatarPorcentagem,
    aoMudar: (v) => definirParametro('detune', v),
    ler: () => estado.parametros.detune,
  }),
  criarKnob({
    rotulo: 'Width',
    destino: 'width',
    escala: escalaLinear(0, 1),
    padrao: estado.parametros.width,
    formatar: formatarPorcentagem,
    aoMudar: (v) => definirParametro('width', v),
    ler: () => estado.parametros.width,
  }),
  criarKnob({
    rotulo: 'Nível',
    destino: 'nivelOsc', // aceita modulação (ex.: LFO = tremolo)
    escala: escalaLinear(0, 1),
    padrao: estado.parametros.nivelOsc,
    formatar: formatarPorcentagem,
    aoMudar: (v) => definirParametro('nivelOsc', v),
    ler: () => estado.parametros.nivelOsc,
  })
);

// Liga/desliga do OSC A
const botaoOsc = document.getElementById('osc-ligado');
function mostrarOsc() {
  const ligado = estado.opcoes.oscLigado;
  botaoOsc.setAttribute('aria-pressed', ligado);
  botaoOsc.textContent = ligado ? 'On' : 'Off';
  botaoOsc.setAttribute('aria-label', ligado ? 'Oscilador A ligado' : 'Oscilador A desligado');
}
botaoOsc.addEventListener('click', () => {
  definirOpcao('oscLigado', !estado.opcoes.oscLigado);
  mostrarOsc();
});
mostrarOsc();
sincronizadores.push(mostrarOsc);

// ---------- Opções de voz (Mono/Poly, vozes, Legato) ----------

const seletorVozes = criarSeletor({
  rotulo: 'Vozes',
  min: 1,
  max: 16,
  padrao: estado.opcoes.vozes,
  aoMudar: (v) => definirOpcao('vozes', v),
  rotuloAoLado: true,
  ler: () => estado.opcoes.vozes,
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
sincronizadores.push(atualizarOpcoesVoz);

// ---------- Glide (aba Global) ----------

const botaoGlideSempre = document.getElementById('glide-sempre');

document.getElementById('knobs-glide').append(
  criarKnob({
    rotulo: 'Tempo',
    escala: escalaPotencia(2, 3), // 0 a 2 s, com mais precisão nos tempos curtos
    padrao: estado.opcoes.glide,
    formatar: (v) => (v < 0.0005 ? 'Desligado' : formatarTempo(v)),
    aoMudar: (v) => definirOpcao('glide', v < 0.0005 ? 0 : v),
    ler: () => estado.opcoes.glide,
  })
);

const mostrarGlideSempre = () => botaoGlideSempre.setAttribute('aria-pressed', estado.opcoes.glideSempre);
botaoGlideSempre.addEventListener('click', () => {
  definirOpcao('glideSempre', !estado.opcoes.glideSempre);
  mostrarGlideSempre();
});
sincronizadores.push(mostrarGlideSempre);

// ---------- Aba FX (efeitos) ----------

// Botões Ligado/Desligado de cada efeito
document.querySelectorAll('[data-ligar-efeito]').forEach((botao) => {
  const id = botao.dataset.ligarEfeito;
  const mostrar = () => {
    const ligado = estado.efeitos[id].ligado;
    botao.setAttribute('aria-pressed', ligado);
    botao.textContent = ligado ? 'Ligado' : 'Desligado';
  };
  botao.addEventListener('click', () => {
    definirEfeito(id, 'ligado', !estado.efeitos[id].ligado);
    mostrar();
  });
  mostrar();
  sincronizadores.push(mostrar);
});

// Knob de um efeito
const knobEfeito = (id, rotulo, nome, escala, formatar) =>
  criarKnob({
    rotulo,
    escala,
    padrao: estado.efeitos[id][nome],
    formatar,
    aoMudar: (v) => definirEfeito(id, nome, v),
    ler: () => estado.efeitos[id][nome],
  });

// Distorção: tipo (botões) + Drive e Mix
const NOMES_DISTORCAO = { suave: 'Suave', dura: 'Dura', valvula: 'Válvula' };
const tiposDistorcao = document.getElementById('tipos-distorcao');
const marcarTipoDistorcao = () =>
  tiposDistorcao.querySelectorAll('.botao').forEach((b) => b.classList.toggle('escolhido', b.dataset.tipo === estado.efeitos.distorcao.tipo));
TIPOS_DISTORCAO.forEach((tipo) => {
  const botao = document.createElement('button');
  botao.className = 'botao';
  botao.textContent = NOMES_DISTORCAO[tipo];
  botao.dataset.tipo = tipo;
  botao.addEventListener('click', () => {
    definirEfeito('distorcao', 'tipo', tipo);
    marcarTipoDistorcao();
  });
  tiposDistorcao.appendChild(botao);
});
marcarTipoDistorcao();
sincronizadores.push(marcarTipoDistorcao);

document.querySelector('[data-knobs-efeito="distorcao"]').append(
  knobEfeito('distorcao', 'Drive', 'drive', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('distorcao', 'Mix', 'mix', escalaLinear(0, 1), formatarPorcentagem)
);

document.querySelector('[data-knobs-efeito="chorus"]').append(
  knobEfeito('chorus', 'Rate', 'rate', escalaExponencial(0.05, 5), formatarRate),
  knobEfeito('chorus', 'Depth', 'depth', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('chorus', 'Mix', 'mix', escalaLinear(0, 1), formatarPorcentagem)
);

document.querySelector('[data-knobs-efeito="delay"]').append(
  knobEfeito('delay', 'Tempo', 'tempo', escalaExponencial(0.01, 2), formatarTempo),
  knobEfeito('delay', 'Feedback', 'feedback', escalaLinear(0, 0.95), formatarPorcentagem),
  knobEfeito('delay', 'Mix', 'mix', escalaLinear(0, 1), formatarPorcentagem)
);

document.querySelector('[data-knobs-efeito="reverb"]').append(
  // Tamanho mostra quanto tempo a cauda leva para sumir
  knobEfeito('reverb', 'Tamanho', 'tamanho', escalaLinear(0, 1), (v) => formatarTempo(tempoDoTamanho(v))),
  knobEfeito('reverb', 'Brilho', 'brilho', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('reverb', 'Mix', 'mix', escalaLinear(0, 1), formatarPorcentagem)
);

const botaoPingPong = document.getElementById('delay-pingpong');
const mostrarPingPong = () => botaoPingPong.setAttribute('aria-pressed', estado.efeitos.delay.pingpong);
botaoPingPong.addEventListener('click', () => {
  definirEfeito('delay', 'pingpong', !estado.efeitos.delay.pingpong);
  mostrarPingPong();
});
sincronizadores.push(mostrarPingPong);

// ---------- Aba Filtro ----------

const NOMES_FILTRO = { lp12: 'LP 12', lp24: 'LP 24', hp: 'HP', bp: 'BP' };

// Monta um cartão de filtro (1 ou 2): liga/desliga, tipos e knobs Cutoff/Reso.
for (const f of FILTROS) {
  const cartao = cartaoFiltro(f.numero);
  const botaoLigado = cartao.querySelector('[data-filtro-ligado]');
  const tipos = cartao.querySelector('[data-filtro-tipos]');

  const mostrar = () => {
    const ligado = estado.opcoes[f.ligado];
    botaoLigado.setAttribute('aria-pressed', ligado);
    botaoLigado.textContent = ligado ? 'Ligado' : 'Desligado';
    tipos.querySelectorAll('.botao').forEach((b) => b.classList.toggle('escolhido', b.dataset.tipo === estado.opcoes[f.tipo]));
  };

  botaoLigado.addEventListener('click', () => {
    definirOpcao(f.ligado, !estado.opcoes[f.ligado]);
    mostrar();
  });

  // Botões de tipo: LP 12, LP 24, HP, BP.
  TIPOS_FILTRO.forEach((tipo) => {
    const botao = document.createElement('button');
    botao.className = 'botao';
    botao.textContent = NOMES_FILTRO[tipo];
    botao.dataset.tipo = tipo;
    botao.addEventListener('click', () => {
      definirOpcao(f.tipo, tipo);
      mostrar();
    });
    tipos.appendChild(botao);
  });

  cartao.querySelector('[data-filtro-knobs]').append(
    criarKnob({
      rotulo: 'Cutoff',
      destino: f.corte,
      escala: escalaExponencial(20, 20000),
      padrao: estado.parametros[f.corte],
      formatar: formatarFrequencia,
      aoMudar: (v) => definirParametro(f.corte, v),
      ler: () => estado.parametros[f.corte],
    }),
    criarKnob({
      rotulo: 'Reso',
      destino: f.reso,
      escala: escalaLinear(0, 1),
      padrao: estado.parametros[f.reso],
      formatar: formatarPorcentagem,
      aoMudar: (v) => definirParametro(f.reso, v),
      ler: () => estado.parametros[f.reso],
    })
  );

  mostrar();
  sincronizadores.push(mostrar);
}

// ---------- Rotas de filtro (botões no OSC A e no Ruído) ----------
// Tocar troca: F1 → F2 → F1→F2 → F2→F1 → F1...
const ROTAS = ['f1', 'f2', 'f12', 'f21'];
const NOMES_ROTA = { f1: 'F1', f2: 'F2', f12: 'F1→F2', f21: 'F2→F1' };
const EXPLICACAO_ROTA = {
  f1: 'Passa pelo Filtro 1',
  f2: 'Passa pelo Filtro 2',
  f12: 'Passa pelo Filtro 1 e depois pelo Filtro 2',
  f21: 'Passa pelo Filtro 2 e depois pelo Filtro 1',
};

document.querySelectorAll('[data-rota]').forEach((botao) => {
  const opcao = botao.dataset.rota; // 'rotaOsc' ou 'rotaRuido'
  const mostrar = () => {
    const rota = estado.opcoes[opcao];
    botao.textContent = NOMES_ROTA[rota];
    botao.setAttribute('aria-label', `Rota de filtro: ${EXPLICACAO_ROTA[rota]}. Toque para trocar.`);
  };
  botao.addEventListener('click', () => {
    const i = ROTAS.indexOf(estado.opcoes[opcao]);
    definirOpcao(opcao, ROTAS[(i + 1) % ROTAS.length]);
    mostrar();
  });
  mostrar();
  sincronizadores.push(mostrar);
});

// ---------- Aba ENV (envelope de volume) ----------

// Tempos: de 0 a 10 s, com mais precisão nos tempos curtos.
const escalaTempo = escalaPotencia(10, 3);

// Knob ligado a um parâmetro do motor de som
const knobParametro = (rotulo, nome, escala, formatar) =>
  criarKnob({
    rotulo,
    escala,
    padrao: estado.parametros[nome],
    formatar,
    aoMudar: (v) => definirParametro(nome, v),
    ler: () => estado.parametros[nome],
  });

knobsEnvelope.append(
  knobParametro('A', 'ataque', escalaTempo, formatarTempo),
  knobParametro('D', 'decaimento', escalaTempo, formatarTempo),
  knobParametro('S', 'sustentacao', escalaLinear(0, 1), formatarPorcentagem),
  knobParametro('R', 'soltura', escalaTempo, formatarTempo)
);

// ---------- ENV 2 e ENV 3 (envelopes de modulação) ----------

document.querySelectorAll('[data-knobs-env]').forEach((lugar) => {
  const id = lugar.dataset.knobsEnv;
  const knob = (rotulo, nome, escala, formatar) =>
    criarKnob({
      rotulo,
      escala,
      padrao: estado.fontes[id][nome],
      formatar,
      aoMudar: (v) => definirFonte(id, nome, v),
      ler: () => estado.fontes[id][nome],
    });
  lugar.append(
    knob('A', 'ataque', escalaTempo, formatarTempo),
    knob('D', 'decaimento', escalaTempo, formatarTempo),
    knob('S', 'sustentacao', escalaLinear(0, 1), formatarPorcentagem),
    knob('R', 'soltura', escalaTempo, formatarTempo)
  );
});

// ---------- Ruído (aba OSC) ----------

const botaoRuido = document.getElementById('ruido-ligado');
const nomeRuido = document.getElementById('ruido-tipo');
const NOMES_RUIDO = { white: 'White', pink: 'Pink', brown: 'Brown' };

function mostrarRuido() {
  const ligado = estado.opcoes.ruidoLigado;
  botaoRuido.setAttribute('aria-pressed', ligado);
  botaoRuido.textContent = ligado ? 'Ligado' : 'Desligado';
  nomeRuido.textContent = NOMES_RUIDO[estado.opcoes.ruidoTipo];
}

botaoRuido.addEventListener('click', () => {
  definirOpcao('ruidoLigado', !estado.opcoes.ruidoLigado);
  mostrarRuido();
});

function andarRuido(passo) {
  const i = TIPOS_RUIDO.indexOf(estado.opcoes.ruidoTipo);
  definirOpcao('ruidoTipo', TIPOS_RUIDO[(i + passo + TIPOS_RUIDO.length) % TIPOS_RUIDO.length]);
  mostrarRuido();
}
document.getElementById('ruido-anterior').addEventListener('click', () => andarRuido(-1));
document.getElementById('ruido-proximo').addEventListener('click', () => andarRuido(1));

document.getElementById('knobs-ruido').append(
  criarKnob({
    rotulo: 'Nível',
    destino: 'ruido', // aceita modulação (ex.: ENV 2 curto = "tsc" no começo da nota)
    escala: escalaLinear(0, 1),
    padrao: estado.parametros.ruido,
    formatar: formatarPorcentagem,
    aoMudar: (v) => definirParametro('ruido', v),
    ler: () => estado.parametros.ruido,
  })
);

mostrarRuido();
sincronizadores.push(mostrarRuido);

// ---------- Aba LFO ----------

// [nome normal, nome curto (celular deitado)]
const NOMES_FORMAS_LFO = {
  seno: ['Seno', 'Sen'],
  triangulo: ['Tri', 'Tri'],
  serraSobe: ['Serra ↑', 'S↑'],
  serraDesce: ['Serra ↓', 'S↓'],
  quadrada: ['Quad', 'Qd'],
  aleatorio: ['S&H', 'S&H'],
};

// Formas: um botão para cada.
document.querySelectorAll('[data-formas-lfo]').forEach((lugar) => {
  const id = lugar.dataset.formasLfo;
  const marcar = () =>
    lugar.querySelectorAll('.botao').forEach((b) => b.classList.toggle('escolhido', b.dataset.forma === estado.fontes[id].forma));
  FORMAS_LFO.forEach((forma) => {
    const botao = document.createElement('button');
    botao.className = 'botao';
    const [nomeLongo, nomeCurto] = NOMES_FORMAS_LFO[forma];
    botao.innerHTML = `<span class="nome-longo">${nomeLongo}</span><span class="nome-curto">${nomeCurto}</span>`;
    botao.title = nomeLongo;
    botao.dataset.forma = forma;
    botao.addEventListener('click', () => {
      definirFonte(id, 'forma', forma);
      marcar();
    });
    lugar.appendChild(botao);
  });
  marcar();
  sincronizadores.push(marcar);
});

// Rate (velocidade): de 0,02 Hz (bem lento) a 40 Hz (vibrato rápido).
document.querySelectorAll('[data-knobs-lfo]').forEach((lugar) => {
  const id = lugar.dataset.knobsLfo;
  lugar.append(
    criarKnob({
      rotulo: 'Rate',
      escala: escalaExponencial(0.02, 40),
      padrao: estado.fontes[id].rate,
      formatar: formatarRate,
      aoMudar: (v) => definirFonte(id, 'rate', v),
      ler: () => estado.fontes[id].rate,
    })
  );
});

// Modo: Retrig (recomeça a cada nota) ou Livre (roda sem parar).
document.querySelectorAll('[data-modo-lfo]').forEach((botao) => {
  const id = botao.dataset.modoLfo;
  const mostrar = () => {
    const retrig = estado.fontes[id].modo === 'retrig';
    botao.textContent = retrig ? 'Retrig' : 'Livre';
    botao.setAttribute('aria-pressed', retrig);
    botao.title = retrig ? 'Recomeça a cada nota' : 'Roda sem parar (as notas pegam ele andando)';
  };
  botao.addEventListener('click', () => {
    definirFonte(id, 'modo', estado.fontes[id].modo === 'retrig' ? 'livre' : 'retrig');
    mostrar();
  });
  mostrar();
  sincronizadores.push(mostrar);
});

// ---------- Ligações de modulação (fichas, arrastar, listas) ----------

const listasMod = {};
document.querySelectorAll('[data-lista]').forEach((lista) => (listasMod[lista.dataset.lista] = lista));

const barraFontes = document.getElementById('barra-fontes');
const telaModulacao = criarModulacao({
  barra: barraFontes,
  dica: document.getElementById('dica-modulacao'),
  listas: listasMod,
  ligacoes: estado.ligacoes,
  aoMudar: () => {
    modificou();
    enviarLigacoes();
  },
});

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
  estado.teclasPc.clear();
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

// ---------- Teclado do computador ----------
// Mesmo padrão do FL Studio. Usa a POSIÇÃO da tecla (funciona em teclado
// brasileiro ABNT ou americano): [código da tecla, semitons a partir do 1º C da tela, letra].
//   Linha Q W E R T Y U I O P [ ]  = notas brancas (Q = C) · números 2 3 5 6 7 9 0 = = pretas
//   Linha Z X C V B N M           = uma oitava abaixo · S D G H J = pretas
const TECLAS_PC = [
  ['KeyQ', 0, 'Q'], ['Digit2', 1, '2'], ['KeyW', 2, 'W'], ['Digit3', 3, '3'], ['KeyE', 4, 'E'],
  ['KeyR', 5, 'R'], ['Digit5', 6, '5'], ['KeyT', 7, 'T'], ['Digit6', 8, '6'], ['KeyY', 9, 'Y'],
  ['Digit7', 10, '7'], ['KeyU', 11, 'U'], ['KeyI', 12, 'I'], ['Digit9', 13, '9'], ['KeyO', 14, 'O'],
  ['Digit0', 15, '0'], ['KeyP', 16, 'P'], ['BracketLeft', 17, '['], ['Equal', 18, '='], ['BracketRight', 19, ']'],
  ['KeyZ', -12, 'Z'], ['KeyS', -11, 'S'], ['KeyX', -10, 'X'], ['KeyD', -9, 'D'], ['KeyC', -8, 'C'],
  ['KeyV', -7, 'V'], ['KeyG', -6, 'G'], ['KeyB', -5, 'B'], ['KeyH', -4, 'H'], ['KeyN', -3, 'N'],
  ['KeyJ', -2, 'J'], ['KeyM', -1, 'M'],
];
const SEMITOM_DA_TECLA_PC = new Map(TECLAS_PC.map(([codigo, semitom]) => [codigo, semitom]));
const LETRA_DO_SEMITOM = new Map(TECLAS_PC.filter(([, s]) => s >= 0).map(([, semitom, letra]) => [semitom, letra]));

// Mostra a letra do computador em cima da tecla da tela (só em telas com mouse).
function letraPc(tecla, semitomDesdeInicio) {
  const letra = LETRA_DO_SEMITOM.get(semitomDesdeInicio);
  if (!letra) return;
  const span = document.createElement('span');
  span.className = 'letra-pc';
  span.textContent = letra;
  tecla.prepend(span);
}

function teclaPcIgnorada(evento) {
  // Com Ctrl/Cmd/Alt é atalho (copiar, recarregar...); em campo de texto, é digitação.
  if (evento.ctrlKey || evento.metaKey || evento.altKey) return true;
  const alvo = evento.target;
  return (alvo instanceof HTMLInputElement && alvo.type !== 'range') || alvo instanceof HTMLSelectElement;
}

document.addEventListener('keydown', (evento) => {
  const semitom = SEMITOM_DA_TECLA_PC.get(evento.code);
  if (semitom === undefined || teclaPcIgnorada(evento)) return;
  evento.preventDefault();
  if (evento.repeat || estado.teclasPc.has(evento.code)) return; // segurar a tecla não repete a nota
  if (!estado.contexto) ligarSom(); // apertar uma tecla também liga o som
  const nota = notaInicial() + semitom;
  estado.teclasPc.set(evento.code, nota); // guarda a nota (se a oitava mudar, solta a certa)
  notaOn(nota);
});

document.addEventListener('keyup', (evento) => {
  if (!estado.teclasPc.has(evento.code)) return;
  const nota = estado.teclasPc.get(evento.code);
  estado.teclasPc.delete(evento.code);
  notaOff(nota);
});

// Janela perdeu o foco (ex.: trocou de programa com a tecla apertada): solta tudo.
window.addEventListener('blur', () => soltarTudo());

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
    letraPc(tecla, nota - primeira);
    teclado.appendChild(tecla);
  }

  for (let oitava = 0; oitava < estado.qtdOitavas; oitava++) {
    for (const [posicao, semitom] of PRETAS) {
      const tecla = document.createElement('div');
      tecla.className = 'tecla preta';
      tecla.dataset.nota = primeira + oitava * 12 + semitom;
      tecla.style.left = ((oitava * 7 + posicao) / totalBrancas) * 100 + '%';
      tecla.style.width = (0.6 / totalBrancas) * 100 + '%';
      letraPc(tecla, oitava * 12 + semitom);
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
  try {
    teclado.setPointerCapture(evento.pointerId);
  } catch {
    // Sem captura, o dedo ainda toca enquanto estiver em cima do teclado.
  }
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

// WT Pos (é uma barra, não um knob): acompanha quando um preset é carregado
sincronizadores.push(() => {
  controleWTPos.value = estado.parametros.wtPos;
  desenharModulacaoWTPos();
});

// ---------- Presets (barra de cima) ----------
// Criado por último: tudo que foi feito até aqui (montar a tela) não conta como "mexeu no som".
const presets = criarPresets({
  lugar: document.getElementById('lugar-presets'),
  fabrica: PRESETS_FABRICA,
  categorias: CATEGORIAS,
  obterSom,
  aplicarSom,
});
avisarModificado = () => presets.marcarModificado();
