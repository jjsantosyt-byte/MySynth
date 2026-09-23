// interface/knob.js
// Knob giratório pensado para o dedo, reutilizável em todo o app.
//
// Como usar na tela:
// - Arrastar para cima (ou para a direita) aumenta; para baixo (ou esquerda) diminui.
// - Toque duplo volta ao valor inicial.
// - Mostra o valor com número e unidade logo abaixo.
//
// Internamente o knob anda de 0 a 1 ("posição"). Uma "escala" converte essa
// posição no valor real (ms, Hz, %...), do jeito que soa mais natural.

const GIRO_TOTAL = 270; // graus de ponta a ponta
const INICIO = -135; // posição mínima (graus, 0 = para cima)
const PIXELS_PONTA_A_PONTA = 200; // arrastar 200 px = do mínimo ao máximo
const TEMPO_TOQUE_DUPLO = 300; // ms

// ---------- Escalas ----------

// Linear: de "min" a "max" em partes iguais (ex.: porcentagem).
export function escalaLinear(min, max) {
  return {
    paraValor: (p) => min + p * (max - min),
    paraPosicao: (v) => (v - min) / (max - min),
  };
}

// Exponencial: cada pedaço do giro multiplica o valor (ex.: frequência em Hz).
export function escalaExponencial(min, max) {
  const razao = max / min;
  return {
    paraValor: (p) => min * Math.pow(razao, p),
    paraPosicao: (v) => Math.log(v / min) / Math.log(razao),
  };
}

// Potência: mais precisão perto do zero (ex.: tempos de envelope).
export function escalaPotencia(max, expoente) {
  return {
    paraValor: (p) => max * Math.pow(p, expoente),
    paraPosicao: (v) => Math.pow(v / max, 1 / expoente),
  };
}

// ---------- Formatos do número ----------

const virgula = (texto) => texto.replace('.', ',');

export function formatarTempo(segundos) {
  if (segundos < 0.01) return virgula((segundos * 1000).toFixed(1)) + ' ms';
  if (segundos < 1) return Math.round(segundos * 1000) + ' ms';
  return virgula(segundos.toFixed(segundos < 10 ? 2 : 1)) + ' s';
}

export function formatarPorcentagem(valor) {
  return Math.round(valor * 100) + ' %';
}

// Velocidade de LFO: casas decimais quando é lento (ex.: 0,25 Hz).
export function formatarRate(hz) {
  if (hz < 1) return virgula(hz.toFixed(2)) + ' Hz';
  if (hz < 10) return virgula(hz.toFixed(1)) + ' Hz';
  return Math.round(hz) + ' Hz';
}

export function formatarFrequencia(hz) {
  if (hz < 1000) return Math.round(hz) + ' Hz';
  return virgula((hz / 1000).toFixed(hz < 10000 ? 2 : 1)) + ' kHz';
}

// ---------- Desenho do arco ----------

function ponto(angulo, raio) {
  const rad = (angulo * Math.PI) / 180;
  return [24 + raio * Math.sin(rad), 24 - raio * Math.cos(rad)];
}

function arco(anguloInicio, anguloFim, raio) {
  const [x1, y1] = ponto(anguloInicio, raio);
  const [x2, y2] = ponto(anguloFim, raio);
  const arcoGrande = anguloFim - anguloInicio > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${raio} ${raio} 0 ${arcoGrande} 1 ${x2} ${y2}`;
}

// ---------- O knob ----------

// opcoes: { rotulo, escala, padrao, formatar, aoMudar, destino }
// "destino" (opcional): nome do controle de som, para receber ligações de modulação.
export function criarKnob({ rotulo, escala, padrao, formatar, aoMudar, destino }) {
  const elemento = document.createElement('div');
  elemento.className = 'knob';
  if (destino) elemento.dataset.destino = destino;
  elemento.tabIndex = 0;
  elemento.setAttribute('role', 'slider');
  elemento.setAttribute('aria-label', rotulo);
  elemento.innerHTML = `
    <svg class="knob-desenho" viewBox="0 0 48 48" aria-hidden="true">
      <path class="knob-trilho" d="${arco(INICIO, INICIO + GIRO_TOTAL, 19)}" />
      <path class="knob-valor" />
      <line class="knob-ponteiro" x1="24" y1="24" x2="24" y2="10" />
    </svg>
    <span class="knob-numero"></span>
    <span class="knob-rotulo">${rotulo}</span>`;

  const caminhoValor = elemento.querySelector('.knob-valor');
  const ponteiro = elemento.querySelector('.knob-ponteiro');
  const numero = elemento.querySelector('.knob-numero');

  const posicaoPadrao = escala.paraPosicao(padrao);
  let posicao = posicaoPadrao;

  function atualizar() {
    const valor = escala.paraValor(posicao);
    const angulo = INICIO + posicao * GIRO_TOTAL;
    caminhoValor.setAttribute('d', posicao > 0.001 ? arco(INICIO, angulo, 19) : '');
    ponteiro.setAttribute('transform', `rotate(${angulo} 24 24)`);
    numero.textContent = formatar(valor);
    elemento.setAttribute('aria-valuetext', numero.textContent);
    aoMudar(valor);
  }

  function mudarPosicao(nova) {
    posicao = Math.min(1, Math.max(0, nova));
    atualizar();
  }

  // Arrastar
  let arraste = null;
  let ultimoToque = 0;
  elemento.addEventListener('pointerdown', (evento) => {
    evento.preventDefault();
    elemento.focus();
    // Toque duplo: volta ao valor inicial.
    const agora = performance.now();
    if (agora - ultimoToque < TEMPO_TOQUE_DUPLO) {
      ultimoToque = 0;
      mudarPosicao(posicaoPadrao);
      return;
    }
    ultimoToque = agora;
    // "Prende" o dedo no knob: dá para arrastar mesmo saindo de cima dele.
    try {
      elemento.setPointerCapture(evento.pointerId);
    } catch {
      // Sem captura, o arraste ainda funciona enquanto o dedo estiver no knob.
    }
    arraste = { id: evento.pointerId, x: evento.clientX, y: evento.clientY, inicio: posicao };
    elemento.classList.add('girando');
  });
  elemento.addEventListener('pointermove', (evento) => {
    if (!arraste || evento.pointerId !== arraste.id) return;
    const deslocamento = arraste.y - evento.clientY + (evento.clientX - arraste.x);
    mudarPosicao(arraste.inicio + deslocamento / PIXELS_PONTA_A_PONTA);
  });
  const terminar = (evento) => {
    if (arraste && evento.pointerId === arraste.id) {
      arraste = null;
      elemento.classList.remove('girando');
    }
  };
  elemento.addEventListener('pointerup', terminar);
  elemento.addEventListener('pointercancel', terminar);

  // Teclado do computador: setas mexem de pouco em pouco.
  elemento.addEventListener('keydown', (evento) => {
    const passos = { ArrowUp: 0.01, ArrowRight: 0.01, ArrowDown: -0.01, ArrowLeft: -0.01 };
    if (evento.key in passos) {
      evento.preventDefault();
      mudarPosicao(posicao + passos[evento.key]);
    }
  });

  atualizar();
  return elemento;
}
