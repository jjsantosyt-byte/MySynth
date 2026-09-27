// interface/medidor.js
// Medidor de desempenho (Configurações → Medidor de desempenho): uma caixinha no canto de cima
// da tela com os números do motor de som, para comparar aparelhos e jeitos de instalar o app
// (Chrome × app da loja). Não pega o toque (dá para tocar com ela aberta) e muda só 1 vez por
// segundo, e só enquanto está ligada. Fica ligada entre aberturas do app (gaveta
// mysynth.medidor.v1) até desligar.
//
//   Motor 23%  pico 41%   → quanto do tempo o motor passa calculando (100% = no limite)
//   Atrasos 0  maior 0 ms → vezes em que o som ficou para trás (engasgos)
//   Tela 0  maior 0 ms    → vezes em que a tela travou mais de 50 ms (atrasa o toque)
//   Vozes 3 · 48000 Hz · buffer 21 ms
//
// Ligar de novo zera tudo.

import { criar } from './janela.js';

const CHAVE_MEDIDOR = 'mysynth.medidor.v1';

function lerGuardado() {
  try {
    return localStorage.getItem(CHAVE_MEDIDOR) === '1';
  } catch {
    return false;
  }
}

function guardar(ligado) {
  try {
    localStorage.setItem(CHAVE_MEDIDOR, ligado ? '1' : '0');
  } catch {
    // janela anônima / sem permissão: vale só até fechar o app
  }
}

let ligado = lerGuardado();
let synth = null;
let contexto = null;

// ---------- A caixinha ----------
const caixa = criar('div', 'medidor');
caixa.hidden = true;
caixa.setAttribute('aria-hidden', 'true');

// Uma linha = rótulos (traduzíveis) + números (spans próprios, que o tradutor não precisa ver)
function linha(...partes) {
  const el = criar('div', 'medidor-linha');
  const numeros = [];
  for (const parte of partes) {
    if (parte === null) {
      const n = criar('span', 'medidor-numero', '—');
      numeros.push(n);
      el.appendChild(n);
    } else {
      el.appendChild(criar('span', 'medidor-rotulo', parte));
    }
  }
  caixa.appendChild(el);
  return numeros;
}

const [motorMedia, motorPico] = linha('Motor', null, 'pico', null);
const [atrasos, maiorAtraso] = linha('Atrasos', null, 'maior', null);
const [travadas, maiorTravada] = linha('Tela', null, 'maior', null);
const [vozes, info] = linha('Vozes', null, null);

// A caixa entra na página quando o app termina de montar a tela (ver iniciarMedidor)
export function iniciarMedidor() {
  document.body.appendChild(caixa);
  if (ligado) ligarPartes();
}

// ---------- Tela travada (tarefas longas na tela, > 50 ms) ----------
let observador = null;
let contagemTravadas = 0;
let maiorTravadaMs = 0;

function mostrarTravadas() {
  travadas.textContent = String(contagemTravadas);
  maiorTravada.textContent = `${Math.round(maiorTravadaMs)} ms`;
}

function vigiarTela() {
  contagemTravadas = 0;
  maiorTravadaMs = 0;
  mostrarTravadas();
  try {
    observador = new PerformanceObserver((lista) => {
      for (const tarefa of lista.getEntries()) {
        contagemTravadas++;
        if (tarefa.duration > maiorTravadaMs) maiorTravadaMs = tarefa.duration;
      }
      mostrarTravadas();
    });
    observador.observe({ type: 'longtask' });
  } catch {
    // navegador sem esse recurso (ex.: Safari): a linha fica com "—"
    observador = null;
    travadas.textContent = '—';
    maiorTravada.textContent = '—';
  }
}

// ---------- Ligar / desligar ----------
function ligarPartes() {
  for (const n of [motorMedia, motorPico, atrasos, maiorAtraso, vozes]) n.textContent = '—';
  mostrarInfo();
  vigiarTela();
  synth?.port.postMessage({ tipo: 'medidor', ligado: true });
  caixa.hidden = false;
}

function desligarPartes() {
  observador?.disconnect();
  observador = null;
  synth?.port.postMessage({ tipo: 'medidor', ligado: false });
  caixa.hidden = true;
}

function mostrarInfo() {
  if (!contexto) {
    info.textContent = 'toque uma nota';
    return;
  }
  // Atraso do áudio: o do navegador (buffer) + o da saída (alto-falante/fone), quando ele conta
  const buffer = ((contexto.baseLatency || 0) + (contexto.outputLatency || 0)) * 1000;
  info.textContent = `· ${contexto.sampleRate} Hz · buffer ${Math.round(buffer)} ms`;
}

export const medidor = {
  get ligado() {
    return ligado;
  },

  ligar(valor) {
    if (valor === ligado) return;
    ligado = valor;
    guardar(ligado);
    ligado ? ligarPartes() : desligarPartes();
  },

  // O som ligou: o medidor passa a conversar com o motor
  conectar(novoSynth, novoContexto) {
    synth = novoSynth;
    contexto = novoContexto;
    if (ligado) {
      synth.port.postMessage({ tipo: 'medidor', ligado: true });
      mostrarInfo();
    }
  },

  // Recado do motor (1 vez por segundo)
  receber(dados) {
    if (!ligado) return;
    const porcento = (valor) => `${Math.round(valor * 100)}%`;
    motorMedia.textContent = porcento(dados.media);
    motorPico.textContent = porcento(dados.pico);
    atrasos.textContent = String(dados.atrasos);
    maiorAtraso.textContent = `${Math.round(dados.maiorAtraso)} ms`;
    vozes.textContent = String(dados.vozes);
    // Cores: laranja perto do limite, vermelho no limite / com atrasos
    caixa.classList.toggle('medidor-alto', dados.pico > 0.7);
    caixa.classList.toggle('medidor-limite', dados.pico > 0.95 || dados.atrasos > 0);
    // (o buffer da saída pode mudar ao ligar/desligar um fone)
    mostrarInfo();
  },
};
