// principal.js
// Liga o som, desenha o teclado e transforma os toques na tela em notas.

import { listaWavetables, obterWavetable, existeWavetable, esquecerMontada } from './wavetable.js';
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
import { TIPOS_SATURACAO } from './dsp/efeitos/saturacao.js';
import { TIPOS_RUIDO } from './dsp/ruido.js';
import { criarPresets } from './interface/presets.js';
import {
  criarListaWavetables,
  carregarWavetablesGuardadas,
  wavetablesDosPresets,
  receberWavetables,
} from './interface/wavetables.js';
import { mostrarRecado } from './interface/janela.js';
import { MODOS_WARP, W_NENHUM, codigoWarp, forcaWarp, faseWarp, faseFM, moduladorFM } from './dsp/warp.js';

// Nomes dos modos de Warp na tela
const NOMES_WARP = {
  nenhum: 'Off',
  sync: 'Sync',
  bendMais: 'Bend +',
  bendMenos: 'Bend −',
  pwm: 'PWM',
  fmA: 'FM ← A',
  fmB: 'FM ← B',
  fmC: 'FM ← C',
};
import { carregarPresetsDoProjeto } from './interface/presets-projeto.js';

const botaoLigar = document.getElementById('botao-ligar');
const aviso = document.getElementById('aviso');
const teclado = document.getElementById('teclado');
const botaoOitavaMenos = document.getElementById('oitava-menos');
const botaoOitavaMais = document.getElementById('oitava-mais');
const rotuloOitava = document.getElementById('rotulo-oitava');
const controleVolume = document.getElementById('volume');
const telaEnvelope = document.getElementById('tela-envelope');
const botaoLegato = document.getElementById('legato');
const knobsEnvelope = document.getElementById('knobs-envelope');
const modoVoz = document.getElementById('modo-voz');
const painelLfo = document.querySelector('[data-painel="lfo"]');
let telaSemAoVivo = false; // true = a tela já foi desenhada sem modulação (ver onmessage)
const lugarSeletorVozes = document.getElementById('seletor-vozes');

// Os 3 osciladores. Os controles do A não têm letra (wtPos, unison...), para os presets
// antigos continuarem valendo; os do B e C têm (wtPosB, unisonC...).
// "wavetable" = a wavetable em uso: a página guarda uma cópia para desenhar; o motor recebe outra.
const OSCILADORES = ['A', 'B', 'C'].map((letra) => {
  const s = letra === 'A' ? '' : letra;
  return {
    letra,
    cartao: document.querySelector(`[data-osc="${letra}"]`),
    wavetable: obterWavetable('basica'),
    nomes: {
      wavetable: 'wavetable' + s,
      ligado: `osc${s}Ligado`,
      unison: 'unison' + s,
      rota: 'rotaOsc' + s,
      wtPos: 'wtPos' + s,
      detune: 'detune' + s,
      width: 'width' + s,
      nivel: 'nivelOsc' + s,
      oitava: 'oitavaOsc' + s,
      semi: 'semiOsc' + s,
      fine: 'fineOsc' + s,
      pan: 'panOsc' + s,
      blend: 'blendOsc' + s,
      fase: 'faseOsc' + s,
      rand: 'randOsc' + s,
      warp: 'warpOsc' + s,
      warpModo: 'warpModoOsc' + s,
    },
  };
});
const oscDaOpcao = (nome) => OSCILADORES.find((o) => o.nomes.wavetable === nome);

const estado = {
  // Valores dos controles de som (os nomes são os mesmos do motor de som).
  parametros: {
    wtPos: 0, // posição na wavetable (0 a 1)
    detune: 0.25, // unison: quanto as cópias desafinam (0 a 1)
    width: 1, // unison: abertura no estéreo (0 a 1)
    nivelOsc: 1, // nível do oscilador A (0 a 1)
    fineOsc: 0, // afinação fina do oscilador A (centésimos de semitom, -100 a 100)
    panOsc: 0, // posição no estéreo (-1 esquerda, 0 centro, 1 direita)
    blendOsc: 1, // volume das cópias de fora do unison (1 = todas iguais)
    warpOsc: 0, // quantidade do Warp (0 a 1)
    // OSC B e C: os mesmos controles, com a letra no fim
    wtPosB: 0,
    detuneB: 0.25,
    widthB: 1,
    nivelOscB: 1,
    fineOscB: 0,
    panOscB: 0,
    blendOscB: 1,
    warpOscB: 0,
    wtPosC: 0,
    detuneC: 0.25,
    widthC: 1,
    nivelOscC: 1,
    fineOscC: 0,
    panOscC: 0,
    blendOscC: 1,
    warpOscC: 0,
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
    ruidoModo: 'loop', // 'loop' (contínuo) ou 'oneshot' (rajada no começo da nota)
    ruidoDuracao: 0.2, // One Shot: segundos até sumir
    ruidoTrack: false, // a cor do ruído acompanha a nota
    ruidoPitch: 0, // cor do ruído, em semitons (-24 a +24)
    ruidoUnico: true, // acordes: só a nota mais recente toca ruído
    oitavaOsc: 0, // afinação do oscilador A: oitavas (-3 a +3)
    semiOsc: 0, // e semitons (-12 a +12)
    faseOsc: 0, // Phase: ponto de início da onda (0 a 1 = 0° a 360°)
    randOsc: 1, // Rand: quanto o início é sorteado a cada nota (1 = totalmente)
    warpModoOsc: 'nenhum', // Warp: 'nenhum', 'sync', 'bendMais', 'bendMenos' ou 'pwm'
    // OSC B e C (começam desligados: presets antigos soam iguais)
    wavetableB: 'basica',
    oscBLigado: false,
    unisonB: 1,
    rotaOscB: 'f1',
    oitavaOscB: 0,
    semiOscB: 0,
    faseOscB: 0,
    randOscB: 1,
    warpModoOscB: 'nenhum',
    wavetableC: 'basica',
    oscCLigado: false,
    unisonC: 1,
    rotaOscC: 'f1',
    oitavaOscC: 0,
    semiOscC: 0,
    faseOscC: 0,
    randOscC: 1,
    warpModoOscC: 'nenhum',
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
    // Os valores iniciais dos knobs novos reproduzem o som de antes (presets antigos iguais)
    saturacao: { ligado: false, tipo: 'fita', drive: 0.3, tom: 1, mix: 1 },
    distorcao: { ligado: false, tipo: 'suave', drive: 0.4, mix: 1, tom: 1, lowcut: 20 },
    eq: { ligado: false, grave: 0, medio: 0, agudo: 0, freq: 1000, q: 1, saida: 0, mix: 1 },
    compressor: { ligado: false, threshold: -18, ratio: 4, attack: 0.01, release: 0.15, ganho: 0, mix: 1 },
    phaser: { ligado: false, rate: 0.5, depth: 0.7, freq: 800, feedback: 0.5, stereo: 0.5, mix: 0.5 },
    flanger: { ligado: false, rate: 0.3, depth: 0.7, atraso: 0.002, feedback: 0.5, stereo: 0.5, mix: 0.5 },
    chorus: { ligado: false, rate: 0.8, depth: 0.5, mix: 0.5, atraso: 0.012, feedback: 0, width: 1 },
    delay: { ligado: false, tempo: 0.3, feedback: 0.4, mix: 0.3, pingpong: false, lowcut: 20, highcut: 6000, width: 1 },
    reverb: { ligado: false, tamanho: 0.5, brilho: 0.6, mix: 0.3, predelay: 0, lowcut: 120, width: 1 },
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
  for (const osc of OSCILADORES) {
    if (estado.opcoes[osc.nomes.wavetable] !== osc.wavetable.id) trocarWavetable(osc, estado.opcoes[osc.nomes.wavetable]);
  }

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

// ---------- Funcionar sem internet (sw.js) ----------
// O "service worker" guarda os arquivos do app no aparelho: depois da primeira vez,
// o app abre mesmo sem internet (com internet, sempre busca a versão nova).
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch((erro) => console.warn('Não consegui ativar o modo sem internet:', erro));
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
      parameterData: { ...estado.parametros, volume: volumeDoControle() },
    });
    // Se der um erro dentro do motor, o navegador o desliga de vez (fica mudo):
    // avisa na tela em vez de deixar o app "tocando" sem som.
    synth.onprocessorerror = () => {
      mostrarAviso('O motor de som parou por um erro. Recarregue o app para voltar a tocar.');
      botaoLigar.textContent = 'Som parado';
      botaoLigar.classList.remove('ligado');
    };
    // O volume geral e o soft clipper (nunca passa de 0 dB) ficam DENTRO do motor
    // (parâmetro 'volume' e dsp/clipper.js): o motor sai direto para o alto-falante.
    synth.connect(contexto.destination);

    // Envia uma cópia da wavetable de cada oscilador para o motor de som (motor novo: vazio).
    tabelasNoMotor.clear();
    for (const osc of OSCILADORES) enviarWavetable(osc, synth);

    // Valores ao vivo vindos do motor: atualizam os pontinhos e os desenhos.
    synth.port.onmessage = (evento) => {
      if (evento.data.tipo === 'compressor') {
        mostrarReducaoCompressor(evento.data.reducao);
        return;
      }
      if (evento.data.tipo === 'clipper') {
        avisarClipper(evento.data.pico);
        return;
      }
      if (evento.data.tipo !== 'aoVivo') return;
      // Sem nenhuma ligação, nada na tela muda com os valores ao vivo (a modulação é zero):
      // só redesenha se a aba LFO estiver aberta (o pontinho andando no desenho do LFO).
      // Economiza o processador do celular enquanto se toca. (Desenha uma última vez sem
      // modulação, para nada ficar parado numa posição antiga ao tirar a última ligação.)
      if (estado.ligacoes.length === 0 && painelLfo.hidden) {
        estado.aoVivo = { mod: null, lfos: evento.data.lfos };
        if (!telaSemAoVivo) {
          telaSemAoVivo = true;
          telaModulacao.atualizarAoVivo(null);
          pedirDesenho();
        }
        return;
      }
      telaSemAoVivo = false;
      estado.aoVivo = evento.data;
      telaModulacao.atualizarAoVivo(evento.data.mod);
      pedirDesenho();
    };

    estado.synth = synth;

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
    // Fecha o motor de áudio que não deu certo (o navegador só aceita alguns abertos ao mesmo tempo)
    contexto.close().catch(() => {});
    estado.contexto = null;
    botaoLigar.disabled = false;
    botaoLigar.textContent = 'Ligar som';
  }
}

// Religa o áudio se ele não estiver rodando. No iPhone, uma ligação, a Siri ou um alarme deixam
// o áudio "interrompido" (estado 'interrupted', não 'suspended'): sem isto, o app voltava mudo.
function garantirSomRodando() {
  const contexto = estado.contexto;
  if (contexto && contexto.state !== 'running' && contexto.state !== 'closed') {
    contexto.resume().catch(() => {});
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

// Capotraste (a "bolinha" da barra de volume): acompanha o valor e cresce enquanto é segurado.
const trilhoVolume = controleVolume.closest('.volume-trilho');
const posicionarCapotraste = () => trilhoVolume.style.setProperty('--pos', controleVolume.value);
posicionarCapotraste();
controleVolume.addEventListener('input', posicionarCapotraste);
controleVolume.addEventListener('pointerdown', () => trilhoVolume.classList.add('segurando'));
for (const fim of ['pointerup', 'pointercancel']) {
  window.addEventListener(fim, () => trilhoVolume.classList.remove('segurando'));
}

controleVolume.addEventListener('input', () => {
  if (!estado.synth) return;
  // Mudança suave, para não estalar (o volume é um parâmetro do motor, antes do soft clipper).
  estado.synth.parameters.get('volume').setTargetAtTime(volumeDoControle(), estado.contexto.currentTime, 0.02);
});

// ---------- Aviso do soft clipper (recado na tela) ----------
// O soft clipper (sempre ligado, no fim do motor) arredonda os picos acima de -1 dB e nunca
// deixa passar de 0 dB. Um pouco de arredondamento é normal; quando o som chega bem acima do
// máximo, ele começa a "sujar" (saturar): aí o recado avisa. O motor manda o maior pico ~30×/s.
const AVISO_CLIPPER_DB = 2; // avisa quando o pico passa 2 dB do máximo
const INTERVALO_AVISOS = 6000; // ms: no máximo um aviso a cada 6 s (não fica piscando)
let ultimoAvisoClipper = -Infinity;

function avisarClipper(pico) {
  const acima = 20 * Math.log10(pico || 1e-9); // dB acima de 0 dB (antes de arredondar)
  const agora = performance.now();
  if (acima > AVISO_CLIPPER_DB && agora - ultimoAvisoClipper > INTERVALO_AVISOS) {
    ultimoAvisoClipper = agora;
    mostrarRecado(
      `Soft clipper segurando picos ~${Math.round(acima)} dB acima do máximo (o som pode ficar mais sujo). ` +
        'Se não quiser, abaixe o Volume ou o Nível dos osciladores.',
      4
    );
  }
}

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
  const osc = oscDaOpcao(nome); // 'wavetable', 'wavetableB' ou 'wavetableC'
  if (osc) trocarWavetable(osc, valor);
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
    for (const osc of OSCILADORES) osc.desenhar?.();
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
const telasOnda = document.querySelectorAll('[data-tela-onda]');
[...telasOnda, telaEnvelope, ...telasFiltro, ...telasLfo, ...telasEnv].forEach((tela) => observarTamanho.observe(tela));

// ---------- Osciladores A, B, C (cartões da aba OSC) ----------
// Cada cartão tem: ‹ wavetable ›, On/Off, desenho da onda, WT Pos, rota de filtro,
// atalhos e os knobs Unison, Detune, Width e Nível.

// Tabelas que o motor já recebeu (id → a tabela montada). O motor guarda as que recebe: a
// tabela inteira (uma importada grande tem ~9 MB) só vai na primeira vez; depois, só o id.
// Zera quando o motor é criado (ligarSom).
const tabelasNoMotor = new Map();

function enviarWavetable(osc, synth = estado.synth) {
  if (!synth) return;
  const tabela = osc.wavetable;
  const jaTem = tabelasNoMotor.get(tabela.id) === tabela;
  synth.port.postMessage({ tipo: 'wavetable', osc: osc.letra, id: tabela.id, wavetable: jaTem ? null : tabela });
  tabelasNoMotor.set(tabela.id, tabela);
}

// Importadas que nenhum oscilador usa mais: o motor e a tela esquecem (libera memória no
// celular). Se forem escolhidas de novo, são montadas e enviadas outra vez.
function esquecerWavetablesForaDeUso() {
  const emUso = (id) => OSCILADORES.some((o) => o.wavetable.id === id);
  for (const [id, tabela] of tabelasNoMotor) {
    if (tabela.importada && !emUso(id)) {
      tabelasNoMotor.delete(id);
      estado.synth?.port.postMessage({ tipo: 'esquecerWavetable', id });
    }
  }
  for (const { id } of listaWavetables()) if (!emUso(id)) esquecerMontada(id);
}

// Troca a wavetable de um oscilador: monta (se preciso), manda para o motor e ajusta a tela.
// Importada que não está neste aparelho (apagada, ou preset vindo de outro aparelho) → Básica.
// Passando rápido pelas setas ‹ ›: o desenho troca na hora, mas o motor só recebe a última
// (~0,1 s depois de parar), em vez de cada uma das tabelas pelo caminho.
function trocarWavetable(osc, id) {
  if (!existeWavetable(id)) {
    mostrarRecado(`A wavetable "${String(id).replace(/^wav:/, '')}" não está neste aparelho: usando a Básica.`, 6);
  }
  osc.wavetable = obterWavetable(id);
  estado.opcoes[osc.nomes.wavetable] = osc.wavetable.id;
  const agora = performance.now();
  clearTimeout(osc.esperaEnvio);
  const mandar = () => {
    enviarWavetable(osc);
    esquecerWavetablesForaDeUso();
  };
  if (agora - (osc.ultimaTroca ?? -Infinity) < 300) osc.esperaEnvio = setTimeout(mandar, 120);
  else mandar();
  osc.ultimaTroca = agora;
  osc.aoTrocarWavetable?.();
  pedirDesenho();
}

// Janela com a lista de wavetables (uma só, usada pelos 3 osciladores).
const janelaWavetables = criarListaWavetables({
  idAtual: (osc) => osc.wavetable.id,
  escolher: (osc, id) => definirOpcao(osc.nomes.wavetable, id),
  // Apagou uma que está tocando → aquele oscilador volta para a Básica
  aoApagar: (id) => {
    for (const osc of OSCILADORES) if (osc.wavetable.id === id) definirOpcao(osc.nomes.wavetable, 'basica');
  },
});

// As importadas guardadas no aparelho entram no catálogo (leva alguns milissegundos).
const wavetablesGuardadasProntas = carregarWavetablesGuardadas();

// Para o desenho do FM: afinação de um oscilador em semitons (sem a modulação)...
function afinacaoTela(osc) {
  const { nomes } = osc;
  return estado.opcoes[nomes.oitava] * 12 + estado.opcoes[nomes.semi] + estado.parametros[nomes.fine] / 100;
}

// ...e um ciclo da onda dele, na posição atual do WT Pos (versão mais cheia)
function ondaModuladora(osc) {
  const { wavetable, nomes } = osc;
  const ultimo = wavetable.frames.length - 1;
  const wt = modulado(estado.parametros[nomes.wtPos], nomes.wtPos) * ultimo;
  const f0 = Math.min(Math.floor(wt), ultimo);
  const f1 = Math.min(f0 + 1, ultimo);
  const t = wt - f0;
  const a = wavetable.frames[f0][0];
  const b = wavetable.frames[f1][0];
  if (!osc.ondaModuladora) osc.ondaModuladora = new Float32Array(a.length);
  for (let j = 0; j < a.length; j++) osc.ondaModuladora[j] = a[j] + t * (b[j] - a[j]);
  return osc.ondaModuladora;
}

// Monta um cartão de oscilador (liga cada peça do cartão aos controles daquele oscilador).
function montarOscilador(osc) {
  const { cartao, nomes, letra } = osc;
  const peca = (nome) => cartao.querySelector(`[data-${nome}]`);
  const telaOnda = peca('tela-onda');
  const nomeOnda = peca('nome-onda');
  const controleWTPos = peca('wt-pos');
  const atalhos = peca('atalhos');
  const botaoNome = peca('wt-nome');
  const botaoLigado = peca('osc-ligado');
  const ondaDesenhada = new Float32Array(osc.wavetable.tamanho);
  const ondaDeformada = new Float32Array(osc.wavetable.tamanho); // com Warp

  // --- Wavetable: ‹ Nome › (as setas andam por todas: fábrica e depois as importadas) ---
  const andar = (passo) => {
    const lista = listaWavetables();
    const i = lista.findIndex((w) => w.id === osc.wavetable.id);
    definirOpcao(nomes.wavetable, lista[(i + passo + lista.length) % lista.length].id);
  };
  peca('wt-anterior').addEventListener('click', () => andar(-1));
  peca('wt-proxima').addEventListener('click', () => andar(1));
  botaoNome.addEventListener('click', () => janelaWavetables.abrir(osc));

  // Botões de atalho da wavetable atual (ex.: Seno, Tri, Serra, Quad).
  function montarAtalhos() {
    atalhos.innerHTML = '';
    for (const { nome, posicao } of osc.wavetable.atalhos) {
      const botao = document.createElement('button');
      botao.className = 'botao';
      botao.textContent = nome;
      botao.addEventListener('click', () => definirWTPos(posicao));
      atalhos.appendChild(botao);
    }
  }
  osc.aoTrocarWavetable = () => {
    botaoNome.textContent = osc.wavetable.nome;
    montarAtalhos();
  };
  osc.aoTrocarWavetable();

  // --- WT Pos (barra) ---
  function definirWTPos(valor) {
    const wtPos = Math.min(1, Math.max(0, valor));
    controleWTPos.value = wtPos;
    definirParametro(nomes.wtPos, wtPos);
    desenharModulacaoWTPos(); // as faixas acompanham a barra
  }
  controleWTPos.addEventListener('input', () => definirWTPos(Number(controleWTPos.value)));

  // Faixas de modulação e ponto ao vivo embaixo da barra do WT Pos
  // (o equivalente ao arco colorido dos knobs).
  const grupoWTPos = cartao.querySelector('.grupo-wtpos');
  const faixasWTPos = peca('faixas-wtpos');
  let modulacaoWTPos = { faixas: [], deslocamento: null };
  grupoWTPos.mostrarModulacao = (faixas, deslocamento) => {
    modulacaoWTPos = { faixas, deslocamento };
    desenharModulacaoWTPos();
  };
  function desenharModulacaoWTPos() {
    const base = estado.parametros[nomes.wtPos];
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
  // Acompanha quando um preset é carregado
  sincronizadores.push(() => {
    controleWTPos.value = estado.parametros[nomes.wtPos];
    desenharModulacaoWTPos();
  });
  controleWTPos.value = estado.parametros[nomes.wtPos];

  // Arrastar no desenho da onda muda o WT Pos.
  // Para a direita ou para cima aumenta; atravessar a largura toda = de ponta a ponta.
  let arraste = null;
  telaOnda.addEventListener('pointerdown', (evento) => {
    evento.preventDefault();
    try {
      telaOnda.setPointerCapture(evento.pointerId);
    } catch {
      // alguns navegadores recusam; o arraste funciona mesmo assim
    }
    arraste = { id: evento.pointerId, x: evento.clientX, y: evento.clientY, inicio: estado.parametros[nomes.wtPos] };
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

  // --- Desenho da onda ---
  // Posições das cópias de unison para as marcas no desenho (de -1 a +1, vezes o Detune).
  // Mesma distribuição que o motor de som usa.
  function marcasUnison() {
    const qtd = estado.opcoes[nomes.unison];
    if (qtd < 2) return [];
    const marcas = [];
    const detune = modulado(estado.parametros[nomes.detune], nomes.detune);
    for (let c = 0; c < qtd; c++) marcas.push(((c / (qtd - 1)) * 2 - 1) * detune);
    return marcas;
  }

  osc.desenhar = () => {
    // Mesma mistura que o motor de som faz, usando a versão mais cheia da onda.
    // Com modulação no WT Pos, mostra a onda na posição modulada, ao vivo.
    const wavetable = osc.wavetable;
    const ultimoFrame = wavetable.frames.length - 1;
    const posicao = modulado(estado.parametros[nomes.wtPos], nomes.wtPos);
    const wt = posicao * ultimoFrame;
    const f0 = Math.min(Math.floor(wt), ultimoFrame);
    const f1 = Math.min(f0 + 1, ultimoFrame);
    const t = wt - f0;
    const a = wavetable.frames[f0][0];
    const b = wavetable.frames[f1][0];
    for (let j = 0; j < ondaDesenhada.length; j++) {
      ondaDesenhada[j] = a[j] + t * (b[j] - a[j]);
    }
    // Com Warp: a onda desenhada já deformada (mesma conta do motor, dsp/warp.js).
    // FM: um ciclo deste oscilador, empurrado pelo som do outro (na razão entre as alturas).
    const codigo = codigoWarp(estado.opcoes[nomes.warpModo]);
    let desenho = ondaDesenhada;
    if (codigo !== W_NENHUM) {
      const forca = forcaWarp(codigo, modulado(estado.parametros[nomes.warp], nomes.warp));
      const n = ondaDesenhada.length;
      const qual = moduladorFM(codigo);
      const modulador = qual >= 0 ? ondaModuladora(OSCILADORES[qual]) : null;
      const razao = qual >= 0 ? Math.pow(2, (afinacaoTela(OSCILADORES[qual]) - afinacaoTela(osc)) / 12) : 1;
      for (let j = 0; j < n; j++) {
        const fase = j / n;
        let lida;
        if (modulador) {
          const pm = fase * razao - Math.floor(fase * razao);
          lida = faseFM(fase, forca, modulador[Math.floor(pm * n)]) * n;
        } else {
          lida = faseWarp(codigo, forca, fase) * n;
        }
        const i0 = Math.min(Math.floor(lida), n - 1);
        const i1 = (i0 + 1) % n;
        ondaDeformada[j] = ondaDesenhada[i0] + (lida - i0) * (ondaDesenhada[i1] - ondaDesenhada[i0]);
      }
      desenho = ondaDeformada;
    }
    desenharOnda(telaOnda, desenho, marcasUnison());

    // Nome: se os frames têm nome (ex.: Seno, Tri...), a forma exata ou "de → para";
    // senão, o nome da wavetable com a posição em %.
    const nomesFrames = wavetable.nomesFrames;
    const maisProximo = Math.round(wt);
    if (!nomesFrames) {
      nomeOnda.textContent = `${wavetable.nome} ${Math.round(posicao * 100)}%`;
    } else if (Math.abs(wt - maisProximo) < 0.02) {
      nomeOnda.textContent = nomesFrames[maisProximo];
    } else {
      nomeOnda.textContent = `${nomesFrames[f0]} → ${nomesFrames[f1]}  ${Math.round(t * 100)}%`;
    }
  };

  // --- Knobs: Unison, Detune, Width, Nível ---
  peca('knobs-osc').append(
    criarSeletor({
      rotulo: 'Unison',
      min: 1,
      max: 16,
      padrao: estado.opcoes[nomes.unison],
      aoMudar: (v) => definirOpcao(nomes.unison, v),
      ler: () => estado.opcoes[nomes.unison],
    }),
    criarKnob({
      rotulo: 'Detune',
      destino: nomes.detune,
      escala: escalaLinear(0, 1),
      padrao: estado.parametros[nomes.detune],
      formatar: formatarPorcentagem,
      aoMudar: (v) => definirParametro(nomes.detune, v),
      ler: () => estado.parametros[nomes.detune],
    }),
    criarKnob({
      rotulo: 'Width',
      destino: nomes.width,
      escala: escalaLinear(0, 1),
      padrao: estado.parametros[nomes.width],
      formatar: formatarPorcentagem,
      aoMudar: (v) => definirParametro(nomes.width, v),
      ler: () => estado.parametros[nomes.width],
    }),
    criarKnob({
      rotulo: 'Nível',
      destino: nomes.nivel, // aceita modulação (ex.: LFO = tremolo)
      escala: escalaLinear(0, 1),
      padrao: estado.parametros[nomes.nivel],
      formatar: formatarPorcentagem,
      aoMudar: (v) => definirParametro(nomes.nivel, v),
      ler: () => estado.parametros[nomes.nivel],
    })
  );

  // --- Afinação: Oct, Semi (‹ N ›) e Fine (centésimos; arrastar no número anda rápido) ---
  const comSinal = (v) => (v > 0 ? '+' + v : String(v));
  peca('afinacao').append(
    criarSeletor({
      destino: nomes.oitava,
      rotulo: 'Oct',
      min: -3,
      max: 3,
      padrao: estado.opcoes[nomes.oitava],
      rotuloAoLado: true,
      formatar: comSinal,
      aoMudar: (v) => definirOpcao(nomes.oitava, v),
      ler: () => estado.opcoes[nomes.oitava],
    }),
    criarSeletor({
      destino: nomes.semi,
      rotulo: 'Semi',
      min: -12,
      max: 12,
      padrao: estado.opcoes[nomes.semi],
      rotuloAoLado: true,
      formatar: comSinal,
      aoMudar: (v) => definirOpcao(nomes.semi, v),
      ler: () => estado.opcoes[nomes.semi],
    }),
    criarSeletor({
      destino: nomes.fine,
      rotulo: 'Fine',
      min: -100,
      max: 100,
      padrao: estado.parametros[nomes.fine],
      rotuloAoLado: true,
      pixelsPorPasso: 2,
      formatar: comSinal,
      aoMudar: (v) => definirParametro(nomes.fine, v),
      ler: () => estado.parametros[nomes.fine],
    })
  );

  // --- Página "Mais": Warp ‹ modo ›, e os knobs Pan, Blend, Phase, Rand, Warp ---
  // Modo do Warp: ‹ Off › ‹ Sync › ‹ Bend + › ‹ Bend − › ‹ PWM › (tocar nas setas troca)
  const linhaWarp = peca('warp');
  linhaWarp.innerHTML = `
    <span class="rotulo-warp">Warp</span>
    <div class="seletor-wt">
      <button class="seletor-botao" aria-label="Modo de Warp anterior">‹</button>
      <span class="seletor-wt-nome"></span>
      <button class="seletor-botao" aria-label="Próximo modo de Warp">›</button>
    </div>`;
  const [warpAnterior, warpProximo] = linhaWarp.querySelectorAll('.seletor-botao');
  const nomeWarp = linhaWarp.querySelector('.seletor-wt-nome');
  function mostrarWarp() {
    nomeWarp.textContent = NOMES_WARP[estado.opcoes[nomes.warpModo]] || 'Off';
    cartao.classList.toggle('com-warp', estado.opcoes[nomes.warpModo] !== 'nenhum');
  }
  // Os modos deste oscilador: todos, menos o FM dele mesmo (o A não modula o A)
  const modosDeste = MODOS_WARP.filter((m) => m !== 'fm' + letra);
  const andarWarp = (passo) => {
    const i = modosDeste.indexOf(estado.opcoes[nomes.warpModo]);
    definirOpcao(nomes.warpModo, modosDeste[(i + passo + modosDeste.length) % modosDeste.length]);
    mostrarWarp();
  };
  warpAnterior.addEventListener('click', () => andarWarp(-1));
  warpProximo.addEventListener('click', () => andarWarp(1));
  mostrarWarp();
  sincronizadores.push(mostrarWarp);

  const formatarPan = (v) => (Math.abs(v) < 0.005 ? 'C' : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}`);
  peca('knobs-mais').append(
    criarKnob({
      rotulo: 'Pan',
      destino: nomes.pan, // aceita modulação (ex.: LFO = auto-pan)
      escala: escalaLinear(-1, 1),
      padrao: estado.parametros[nomes.pan],
      formatar: formatarPan,
      aoMudar: (v) => definirParametro(nomes.pan, v),
      ler: () => estado.parametros[nomes.pan],
    }),
    criarKnob({
      rotulo: 'Blend',
      destino: nomes.blend,
      escala: escalaLinear(0, 1),
      padrao: estado.parametros[nomes.blend],
      formatar: formatarPorcentagem,
      aoMudar: (v) => definirParametro(nomes.blend, v),
      ler: () => estado.parametros[nomes.blend],
    }),
    criarKnob({
      rotulo: 'Phase',
      escala: escalaLinear(0, 1),
      padrao: estado.opcoes[nomes.fase],
      formatar: (v) => Math.round(v * 360) + '°',
      aoMudar: (v) => definirOpcao(nomes.fase, v),
      ler: () => estado.opcoes[nomes.fase],
    }),
    criarKnob({
      rotulo: 'Rand',
      escala: escalaLinear(0, 1),
      padrao: estado.opcoes[nomes.rand],
      formatar: formatarPorcentagem,
      aoMudar: (v) => definirOpcao(nomes.rand, v),
      ler: () => estado.opcoes[nomes.rand],
    }),
    criarKnob({
      rotulo: 'Warp',
      destino: nomes.warp, // aceita modulação (ex.: ENV = "rasga" no ataque)
      escala: escalaLinear(0, 1),
      padrao: estado.parametros[nomes.warp],
      formatar: formatarPorcentagem,
      aoMudar: (v) => definirParametro(nomes.warp, v),
      ler: () => estado.parametros[nomes.warp],
    })
  );

  // Tocar no título do cartão ("A ⋯") alterna entre a página Onda e a página Mais.
  // (Só muda a tela: não é guardado no preset.)
  const botaoPagina = peca('pagina-osc');
  botaoPagina.addEventListener('click', () => {
    const mais = cartao.classList.toggle('pagina-2');
    botaoPagina.setAttribute('aria-pressed', mais);
    botaoPagina.setAttribute('aria-label', `Oscilador ${letra}: ${mais ? 'voltar para a página Onda' : 'mostrar Pan, Blend, Phase e Rand'}`);
    pedirDesenho();
  });
  botaoPagina.setAttribute('aria-label', `Oscilador ${letra}: mostrar Pan, Blend, Phase e Rand`);

  // --- Liga/desliga ---
  function mostrarLigado() {
    const ligado = estado.opcoes[nomes.ligado];
    botaoLigado.setAttribute('aria-pressed', ligado);
    botaoLigado.textContent = ligado ? 'On' : 'Off';
    botaoLigado.setAttribute('aria-label', `Oscilador ${letra} ${ligado ? 'ligado' : 'desligado'}`);
    cartao.classList.toggle('desligado', !ligado);
  }
  botaoLigado.addEventListener('click', () => {
    definirOpcao(nomes.ligado, !estado.opcoes[nomes.ligado]);
    mostrarLigado();
  });
  mostrarLigado();
  sincronizadores.push(mostrarLigado);
}

OSCILADORES.forEach(montarOscilador);

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
    botao.textContent = ligado ? 'On' : 'Off'; // curto: 5 efeitos lado a lado
    botao.setAttribute('aria-label', `${ligado ? 'Ligado' : 'Desligado'}: toque para ${ligado ? 'desligar' : 'ligar'}`);
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

// Páginas da aba FX: "Cor" (Saturação, Distorção, EQ, Compressor) e
// "Espaço" (Phaser, Flanger, Chorus, Delay, Reverb)
const gradeFx = document.querySelector('.modulos-fx');
document.querySelectorAll('[data-pagina-fx]').forEach((botao) => {
  botao.addEventListener('click', () => {
    gradeFx.dataset.paginaAtual = botao.dataset.paginaFx;
    document.querySelectorAll('[data-pagina-fx]').forEach((b) => b.classList.toggle('escolhido', b === botao));
  });
});

// Botões de tipo de um efeito (ex.: Distorção: Suave / Dura / Válvula)
function botoesDeTipo(id, lugar, tipos, nomes) {
  const marcar = () =>
    lugar.querySelectorAll('.botao').forEach((b) => b.classList.toggle('escolhido', b.dataset.tipo === estado.efeitos[id].tipo));
  tipos.forEach((tipo) => {
    const botao = document.createElement('button');
    botao.className = 'botao';
    botao.textContent = nomes[tipo];
    botao.dataset.tipo = tipo;
    botao.addEventListener('click', () => {
      definirEfeito(id, 'tipo', tipo);
      marcar();
    });
    lugar.appendChild(botao);
  });
  marcar();
  sincronizadores.push(marcar);
}

// Saturação: tipo + Drive, Tom e Mix
botoesDeTipo('saturacao', document.getElementById('tipos-saturacao'), TIPOS_SATURACAO, {
  fita: 'Fita',
  valvula: 'Válvula',
  transistor: 'Transist.',
});
document.querySelector('[data-knobs-efeito="saturacao"]').append(
  knobEfeito('saturacao', 'Drive', 'drive', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('saturacao', 'Tom', 'tom', escalaLinear(0, 1), (v) => (v > 0.999 ? 'Aberto' : formatarPorcentagem(v))),
  knobEfeito('saturacao', 'Mix', 'mix', escalaLinear(0, 1), formatarPorcentagem)
);

// Distorção: tipo (botões) + Drive e Mix
botoesDeTipo('distorcao', document.getElementById('tipos-distorcao'), TIPOS_DISTORCAO, {
  suave: 'Suave',
  dura: 'Dura',
  valvula: 'Válvula',
});

// Escalas usadas pelos knobs novos
const escalaCorte = escalaExponencial(20, 20000); // Low Cut / High Cut (20 Hz a 20 kHz)
const formatarCorte = (hz) => (hz < 20.5 ? 'Off' : formatarFrequencia(hz)); // Low Cut em 20 Hz = desligado
const formatarAberto = (v) => (v > 0.999 ? 'Aberto' : formatarPorcentagem(v)); // Tom em 100% = aberto

document.querySelector('[data-knobs-efeito="distorcao"]').append(
  knobEfeito('distorcao', 'Drive', 'drive', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('distorcao', 'Tom', 'tom', escalaLinear(0, 1), formatarAberto),
  knobEfeito('distorcao', 'Low Cut', 'lowcut', escalaExponencial(20, 1000), formatarCorte),
  knobEfeito('distorcao', 'Mix', 'mix', escalaLinear(0, 1), formatarPorcentagem)
);

// EQ: ganhos das 3 bandas (±15 dB), Freq e Q do Médio, Saída
const formatarDb = (v) => (Math.abs(v) < 0.05 ? '0 dB' : (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + ' dB');
document.querySelector('[data-knobs-efeito="eq"]').append(
  knobEfeito('eq', 'Grave', 'grave', escalaLinear(-15, 15), formatarDb),
  knobEfeito('eq', 'Médio', 'medio', escalaLinear(-15, 15), formatarDb),
  knobEfeito('eq', 'Agudo', 'agudo', escalaLinear(-15, 15), formatarDb),
  knobEfeito('eq', 'Freq', 'freq', escalaExponencial(200, 8000), formatarFrequencia),
  knobEfeito('eq', 'Q', 'q', escalaExponencial(0.3, 5), (v) => v.toFixed(1).replace('.', ',')),
  knobEfeito('eq', 'Saída', 'saida', escalaLinear(-12, 12), formatarDb)
);

// Compressor: 6 knobs + medidor de quanto está abaixando
document.querySelector('[data-knobs-efeito="compressor"]').append(
  knobEfeito('compressor', 'Threshold', 'threshold', escalaLinear(-40, 0), (v) => Math.round(v) + ' dB'),
  knobEfeito('compressor', 'Ratio', 'ratio', escalaExponencial(1, 20), (v) => (v < 9.95 ? v.toFixed(1).replace('.', ',') : Math.round(v)) + ':1'),
  knobEfeito('compressor', 'Attack', 'attack', escalaExponencial(0.0001, 0.1), formatarTempo),
  knobEfeito('compressor', 'Release', 'release', escalaExponencial(0.01, 1), formatarTempo),
  knobEfeito('compressor', 'Ganho', 'ganho', escalaLinear(-12, 24), (v) => (v > 0.05 ? '+' : '') + v.toFixed(1).replace('.', ',') + ' dB'),
  knobEfeito('compressor', 'Mix', 'mix', escalaLinear(0, 1), formatarPorcentagem)
);
const barraReducao = document.getElementById('compressor-reducao');
const numeroReducao = document.getElementById('compressor-reducao-db');
// Medidor: barra de 0 a 20 dB de redução + o número
function mostrarReducaoCompressor(db) {
  barraReducao.style.width = Math.min(100, (db / 20) * 100) + '%';
  numeroReducao.textContent = db < 0.1 ? '0 dB' : '-' + db.toFixed(1).replace('.', ',') + ' dB';
}

// Phaser e Flanger: Stereo = diferença de balanço entre os lados (100% = opostos)
const escalaRateFx = escalaExponencial(0.02, 10);
document.querySelector('[data-knobs-efeito="phaser"]').append(
  knobEfeito('phaser', 'Rate', 'rate', escalaRateFx, formatarRate),
  knobEfeito('phaser', 'Depth', 'depth', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('phaser', 'Freq', 'freq', escalaExponencial(100, 4000), formatarFrequencia),
  knobEfeito('phaser', 'Feedback', 'feedback', escalaLinear(0, 0.9), formatarPorcentagem),
  knobEfeito('phaser', 'Stereo', 'stereo', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('phaser', 'Mix', 'mix', escalaLinear(0, 1), formatarPorcentagem)
);
document.querySelector('[data-knobs-efeito="flanger"]').append(
  knobEfeito('flanger', 'Rate', 'rate', escalaRateFx, formatarRate),
  knobEfeito('flanger', 'Depth', 'depth', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('flanger', 'Delay', 'atraso', escalaExponencial(0.0005, 0.01), formatarTempo),
  // Feedback com sinal: + e − soam diferentes (− = mais oco)
  knobEfeito('flanger', 'Feedback', 'feedback', escalaLinear(-0.95, 0.95), (v) =>
    (v > 0.005 ? '+' : '') + formatarPorcentagem(v)
  ),
  knobEfeito('flanger', 'Stereo', 'stereo', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('flanger', 'Mix', 'mix', escalaLinear(0, 1), formatarPorcentagem)
);

document.querySelector('[data-knobs-efeito="chorus"]').append(
  knobEfeito('chorus', 'Rate', 'rate', escalaExponencial(0.05, 5), formatarRate),
  knobEfeito('chorus', 'Depth', 'depth', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('chorus', 'Delay', 'atraso', escalaLinear(0.005, 0.03), formatarTempo),
  knobEfeito('chorus', 'Feedback', 'feedback', escalaLinear(0, 0.9), formatarPorcentagem),
  knobEfeito('chorus', 'Width', 'width', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('chorus', 'Mix', 'mix', escalaLinear(0, 1), formatarPorcentagem)
);

document.querySelector('[data-knobs-efeito="delay"]').append(
  knobEfeito('delay', 'Tempo', 'tempo', escalaExponencial(0.01, 2), formatarTempo),
  knobEfeito('delay', 'Feedback', 'feedback', escalaLinear(0, 0.95), formatarPorcentagem),
  knobEfeito('delay', 'Low Cut', 'lowcut', escalaExponencial(20, 2000), formatarCorte),
  knobEfeito('delay', 'High Cut', 'highcut', escalaExponencial(1000, 20000), formatarFrequencia),
  knobEfeito('delay', 'Width', 'width', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('delay', 'Mix', 'mix', escalaLinear(0, 1), formatarPorcentagem)
);

document.querySelector('[data-knobs-efeito="reverb"]').append(
  // Tamanho mostra quanto tempo a cauda leva para sumir
  knobEfeito('reverb', 'Tamanho', 'tamanho', escalaLinear(0, 1), (v) => formatarTempo(tempoDoTamanho(v))),
  knobEfeito('reverb', 'Brilho', 'brilho', escalaLinear(0, 1), formatarPorcentagem),
  knobEfeito('reverb', 'Pre-delay', 'predelay', escalaLinear(0, 0.2), formatarTempo),
  knobEfeito('reverb', 'Low Cut', 'lowcut', escalaExponencial(20, 1000), formatarCorte),
  knobEfeito('reverb', 'Width', 'width', escalaLinear(0, 1), formatarPorcentagem),
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

const modoRuido = document.getElementById('modo-ruido');
const botaoTrack = document.getElementById('ruido-track');
const botaoUnico = document.getElementById('ruido-unico');

function mostrarRuido() {
  const ligado = estado.opcoes.ruidoLigado;
  botaoRuido.setAttribute('aria-pressed', ligado);
  botaoRuido.textContent = ligado ? 'Ligado' : 'Desligado';
  nomeRuido.textContent = NOMES_RUIDO[estado.opcoes.ruidoTipo];
  modoRuido.querySelectorAll('.botao').forEach((botao) => {
    botao.classList.toggle('escolhido', botao.dataset.modo === estado.opcoes.ruidoModo);
  });
  knobDuracao.classList.toggle('desabilitado', estado.opcoes.ruidoModo !== 'oneshot');
  botaoTrack.setAttribute('aria-pressed', estado.opcoes.ruidoTrack);
  botaoUnico.setAttribute('aria-pressed', estado.opcoes.ruidoUnico);
}

// Loop | One Shot
modoRuido.querySelectorAll('.botao').forEach((botao) => {
  botao.addEventListener('click', () => {
    definirOpcao('ruidoModo', botao.dataset.modo);
    mostrarRuido();
  });
});
// Track (a cor acompanha a nota) e "1 ruído" (acordes com um ruído só)
botaoTrack.addEventListener('click', () => {
  definirOpcao('ruidoTrack', !estado.opcoes.ruidoTrack);
  mostrarRuido();
});
botaoUnico.addEventListener('click', () => {
  definirOpcao('ruidoUnico', !estado.opcoes.ruidoUnico);
  mostrarRuido();
});

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

// Duração do One Shot: de 5 ms (um "tic") a 2 s, com mais precisão nos tempos curtos
const knobDuracao = criarKnob({
  rotulo: 'Duração',
  escala: escalaExponencial(0.005, 2),
  padrao: estado.opcoes.ruidoDuracao,
  formatar: formatarTempo,
  aoMudar: (v) => definirOpcao('ruidoDuracao', v),
  ler: () => estado.opcoes.ruidoDuracao,
});
document.getElementById('knobs-ruido').append(
  criarKnob({
    rotulo: 'Nível',
    destino: 'ruido', // aceita modulação (ex.: ENV 2 curto = "tsc" no começo da nota)
    escala: escalaLinear(0, 1),
    padrao: estado.parametros.ruido,
    formatar: formatarPorcentagem,
    aoMudar: (v) => definirParametro('ruido', v),
    ler: () => estado.parametros.ruido,
  }),
  knobDuracao,
  // Pitch: a "cor" do ruído (o trecho tocado mais rápido = mais brilhante), em semitons
  criarKnob({
    rotulo: 'Pitch',
    escala: escalaLinear(-24, 24),
    padrao: estado.opcoes.ruidoPitch,
    formatar: (v) => (Math.round(v) > 0 ? '+' : '') + Math.round(v) + ' st',
    aoMudar: (v) => definirOpcao('ruidoPitch', Math.round(v)),
    ler: () => estado.opcoes.ruidoPitch,
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
  else garantirSomRodando();
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
  else garantirSomRodando();
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
  garantirSomRodando();
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
// Com o app no fundo, o motor de áudio é pausado (economiza bateria: no Android ele
// continuaria rodando). Ao voltar, religa.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    soltarTudo();
    if (estado.contexto?.state === 'running') estado.contexto.suspend().catch(() => {});
  } else {
    garantirSomRodando(); // voltou para o app: religa o áudio (pausado aqui ou pelo sistema)
  }
});

montarTeclado();

// ---------- Presets (barra de cima) ----------
// Criado por último: tudo que foi feito até aqui (montar a tela) não conta como "mexeu no som".
// Os presets que vêm com o app são arquivos .synth nas pastas presets/fabrica e presets/usuario.
// Espera as wavetables guardadas no aparelho entrarem antes (um preset do projeto pode usar uma).
await wavetablesGuardadasProntas;
const doProjeto = await carregarPresetsDoProjeto(receberWavetables);
if (doProjeto.erros.length > 0) {
  mostrarRecado(`Não consegui carregar alguns presets do app (${doProjeto.erros.join(', ')}).`, 6);
}
const presets = criarPresets({
  lugar: document.getElementById('lugar-presets'),
  fabrica: doProjeto.presets,
  categorias: doProjeto.categorias,
  obterSom,
  aplicarSom,
  // Wavetables importadas usadas pelos presets vão junto no arquivo .synth
  extrasExportar: (lista) => {
    const wavetables = wavetablesDosPresets(lista);
    return wavetables.length ? { wavetables } : {};
  },
  receberExtras: async (dados) => {
    const { novas, trocas } = await receberWavetables(dados.wavetables);
    return {
      resumo: novas ? ` e ${novas} wavetable(s) nova(s)` : '',
      // Preset que usava uma wavetable renomeada ("Nome (2)") passa a usar o nome novo
      // (em qualquer um dos 3 osciladores)
      ajustarSom: (som) => {
        if (!som?.opcoes) return som;
        const opcoes = { ...som.opcoes };
        for (const { nomes } of OSCILADORES) if (trocas[opcoes[nomes.wavetable]]) opcoes[nomes.wavetable] = trocas[opcoes[nomes.wavetable]];
        return { ...som, opcoes };
      },
    };
  },
});
avisarModificado = () => presets.marcarModificado();
