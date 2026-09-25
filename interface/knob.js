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

// Marcas em volta do knob (11 risquinhos, de ponta a ponta), como num aparelho de verdade.
// Iguais para todos os knobs: montadas uma vez só.
const MARCAS = Array.from({ length: 11 }, (_, k) => {
  const angulo = INICIO + (GIRO_TOTAL * k) / 10;
  const [x1, y1] = ponto(angulo, 21.2);
  const [x2, y2] = ponto(angulo, 23.4);
  return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`;
}).join('');

// ---------- Faixa de modulação ----------

// Até onde uma ligação leva o controle, a partir da posição "base" (0 a 1).
// LFO (bipolar) balança para os dois lados; ENV (unipolar) só para um.
// Devolve [início, fim] já dentro de 0 a 1.
export function faixaModulacao(base, quantidade, bipolar) {
  const limitar = (v) => Math.min(1, Math.max(0, v));
  if (bipolar) return [limitar(base - Math.abs(quantidade)), limitar(base + Math.abs(quantidade))];
  return quantidade >= 0 ? [base, limitar(base + quantidade)] : [limitar(base + quantidade), base];
}

// ---------- O knob ----------

// opcoes: { rotulo, escala, padrao, formatar, aoMudar, destino, ler }
// "destino" (opcional): nome do controle de som, para receber ligações de modulação.
// "ler" (opcional): função que devolve o valor atual do som; com ela o knob ganha
//   elemento.sincronizar(), que o põe na posição certa (ex.: ao carregar um preset).
export function criarKnob({ rotulo, escala, padrao, formatar, aoMudar, destino, ler }) {
  const elemento = document.createElement('div');
  elemento.className = 'knob';
  if (destino) elemento.dataset.destino = destino;
  elemento.tabIndex = 0;
  elemento.setAttribute('role', 'slider');
  elemento.setAttribute('aria-label', rotulo);
  elemento.innerHTML = `
    <svg class="knob-desenho" viewBox="0 0 48 48" aria-hidden="true">
      <g class="knob-marcas">${MARCAS}</g>
      <g class="knob-faixas"></g>
      <path class="knob-trilho" d="${arco(INICIO, INICIO + GIRO_TOTAL, 18)}" />
      <path class="knob-valor" />
      <circle class="knob-corpo" cx="24" cy="24" r="13" />
      <line class="knob-ponteiro" x1="24" y1="24" x2="24" y2="12.5" />
      <circle class="knob-aovivo" r="3" cx="24" cy="5" style="display: none" />
    </svg>
    <span class="knob-numero"></span>
    <span class="knob-rotulo">${rotulo}</span>`;

  const caminhoValor = elemento.querySelector('.knob-valor');
  const ponteiro = elemento.querySelector('.knob-ponteiro');
  const numero = elemento.querySelector('.knob-numero');
  const grupoFaixas = elemento.querySelector('.knob-faixas');
  const pontoAoVivo = elemento.querySelector('.knob-aovivo');

  const posicaoPadrao = escala.paraPosicao(padrao);
  let posicao = posicaoPadrao;

  // Modulação: faixas coloridas (arco externo) e ponto do valor ao vivo.
  let faixas = []; // [{ cor, quantidade, bipolar }]
  let deslocamentoAoVivo = null; // quanto a modulação está somando agora (ou null)

  let faixasDesenhadas = ''; // para só redesenhar os arcos quando algo mudar

  function desenharModulacao() {
    desenharFaixas();
    if (deslocamentoAoVivo === null || faixas.length === 0) {
      pontoAoVivo.style.display = 'none';
    } else {
      const ao = Math.min(1, Math.max(0, posicao + deslocamentoAoVivo));
      pontoAoVivo.style.display = '';
      pontoAoVivo.setAttribute('transform', `rotate(${INICIO + ao * GIRO_TOTAL} 24 24)`);
    }
  }

  function desenharFaixas() {
    const chave = posicao + JSON.stringify(faixas);
    if (chave === faixasDesenhadas) return;
    faixasDesenhadas = chave;
    grupoFaixas.innerHTML = '';
    for (const faixa of faixas) {
      const [ini, fim] = faixaModulacao(posicao, faixa.quantidade, faixa.bipolar);
      if (fim - ini < 0.002) continue;
      const caminho = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      caminho.setAttribute('class', 'knob-faixa');
      caminho.setAttribute('d', arco(INICIO + ini * GIRO_TOTAL, INICIO + fim * GIRO_TOTAL, 22.5));
      caminho.style.stroke = faixa.cor;
      grupoFaixas.appendChild(caminho);
    }
  }

  // Chamado pela tela de modulação: quais ligações este knob tem e o valor ao vivo.
  elemento.mostrarModulacao = (novasFaixas, deslocamento) => {
    faixas = novasFaixas;
    deslocamentoAoVivo = deslocamento;
    desenharModulacao();
  };

  // Só a aparência (sem avisar ninguém)
  function mostrar() {
    const valor = escala.paraValor(posicao);
    const angulo = INICIO + posicao * GIRO_TOTAL;
    caminhoValor.setAttribute('d', posicao > 0.001 ? arco(INICIO, angulo, 18) : '');
    ponteiro.setAttribute('transform', `rotate(${angulo} 24 24)`);
    numero.textContent = formatar(valor);
    elemento.setAttribute('aria-valuetext', numero.textContent);
    desenharModulacao(); // as faixas acompanham o knob
    return valor;
  }

  // Aparência + avisa que o valor mudou
  function atualizar() {
    aoMudar(mostrar());
  }

  // Põe o knob no valor atual do som, sem avisar (ex.: ao carregar um preset).
  elemento.sincronizar = () => {
    if (!ler) return;
    posicao = Math.min(1, Math.max(0, escala.paraPosicao(ler())));
    mostrar();
  };

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
