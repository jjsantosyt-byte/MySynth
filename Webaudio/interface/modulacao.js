// interface/modulacao.js
// Ligações de modulação na tela: as fichas (LFO 1, 2, 3, ENV 2, ENV 3),
// arrastar e soltar em cima de um knob, o modo "tocar para ligar" e as
// listas de ligações (com a quantidade e o botão ✕) dentro de cada cartão.
//
// Qualquer elemento com o atributo data-destino="cutoff" (por exemplo) pode
// receber uma ligação. Se ele tiver o método mostrarModulacao(faixas, deslocamento),
// também mostra as faixas coloridas e o valor ao vivo (ver interface/knob.js).

import { DESTINOS_MOD } from '../dsp/modulacao.js';
import { icone } from './icones.js';

export const FONTES = [
  { id: 'lfo1', nome: 'LFO 1' },
  { id: 'lfo2', nome: 'LFO 2' },
  { id: 'lfo3', nome: 'LFO 3' },
  { id: 'env2', nome: 'ENV 2' },
  { id: 'env3', nome: 'ENV 3' },
  // Macros: as fichas ficam no painel dos Macros (botão "M"), não na barra
  { id: 'macro1', nome: 'M1', macro: true },
  { id: 'macro2', nome: 'M2', macro: true },
  { id: 'macro3', nome: 'M3', macro: true },
  { id: 'macro4', nome: 'M4', macro: true },
];

export const NOMES_DESTINOS = {
  wtPos: 'WT Pos A',
  detune: 'Detune A',
  width: 'Width A',
  nivelOsc: 'Nível A',
  wtPosB: 'WT Pos B',
  detuneB: 'Detune B',
  widthB: 'Width B',
  nivelOscB: 'Nível B',
  wtPosC: 'WT Pos C',
  detuneC: 'Detune C',
  widthC: 'Width C',
  nivelOscC: 'Nível C',
  oitavaOsc: 'Oct A',
  semiOsc: 'Semi A',
  fineOsc: 'Fine A',
  oitavaOscB: 'Oct B',
  semiOscB: 'Semi B',
  fineOscB: 'Fine B',
  oitavaOscC: 'Oct C',
  semiOscC: 'Semi C',
  fineOscC: 'Fine C',
  panOsc: 'Pan A',
  blendOsc: 'Blend A',
  panOscB: 'Pan B',
  blendOscB: 'Blend B',
  panOscC: 'Pan C',
  blendOscC: 'Blend C',
  warpOsc: 'Warp A',
  warpOscB: 'Warp B',
  warpOscC: 'Warp C',
  cutoff: 'Cutoff 1',
  resonancia: 'Reso 1',
  ruido: 'Ruído',
  cutoff2: 'Cutoff 2',
  resonancia2: 'Reso 2',
  rateLfo1: 'Rate LFO 1',
  rateLfo2: 'Rate LFO 2',
  rateLfo3: 'Rate LFO 3',
  ruidoPitch: 'Pitch Ruído',
  ruidoDuracao: 'Duração Ruído',
};

const QUANTIDADE_INICIAL = 0.5; // +50% ao criar uma ligação

// Destinos com medida própria: a quantidade aparece na unidade do controle (ex.: "+7 st")
// e a barra anda de 1 em 1 nessa unidade. "faixa" = quanto vale 100% (a faixa toda do
// controle); "inicial" = quantidade ao criar a ligação, na unidade.
// Os outros destinos mostram % (da faixa do knob).
const MEDIDAS = {};
for (const letra of ['', 'B', 'C']) {
  MEDIDAS['oitavaOsc' + letra] = { faixa: 6, unidade: 'oct', inicial: 1 };
  MEDIDAS['semiOsc' + letra] = { faixa: 24, unidade: 'st', inicial: 12 };
  MEDIDAS['fineOsc' + letra] = { faixa: 200, unidade: 'ct', inicial: 50 };
}

const comSinal = (n) => (n > 0 ? '+' : '') + n;

// Texto da quantidade de uma ligação: "+7 st", "-1 oct", "+25 ct" ou "+50 %".
function textoQuantidade(destino, quantidade) {
  const medida = MEDIDAS[destino];
  if (medida) return `${comSinal(Math.round(quantidade * medida.faixa))} ${medida.unidade}`;
  return `${comSinal(Math.round(quantidade * 100))} %`;
}
const DISTANCIA_ARRASTE = 8; // px: menos que isso é um toque, não um arraste

// Desenhinho dentro da ficha (caixa 22 × 12): a forma atual do LFO, ou um ADSR nos ENVs
const DESENHOS_FORMA = {
  seno: 'M1 6C3 0 5 0 6 6S9 12 11 6 14 0 16 6 19 12 21 6',
  triangulo: 'M1 6L3.5 1 8.5 11 13.5 1 18.5 11 21 6',
  serraSobe: 'M1 11L10 1V11L19 1V11',
  serraDesce: 'M1 1L10 11V1L19 11V1',
  quadrada: 'M1 11V1H6V11H11V1H16V11H21',
  aleatorio: 'M1 8H5V3H9V10H13V5H17V9H21',
  env: 'M1 11L5 1L9 6H15L21 11',
  macro: 'M6 11A5.5 5.5 0 1 1 16 11M11 6.5L11 2.5', // um knob
};
const desenhoDaFicha = (forma) => DESENHOS_FORMA[forma] || DESENHOS_FORMA.env;

const nomeDaFonte = (id) => FONTES.find((f) => f.id === id).nome;

// Cabo desenhado por cima da tela enquanto se arrasta uma ficha: sai do meio da ficha,
// "pendura" um pouco (curva para baixo, mais quanto mais longe) e termina num plugue no dedo.
function criarCabo(ficha, cor) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'cabo-mod');
  svg.innerHTML = '<path /><circle r="6" />';
  svg.style.setProperty('--cor', cor);
  const [caminho, plugue] = svg.children;
  const r = ficha.getBoundingClientRect();
  const x0 = r.left + r.width / 2;
  const y0 = r.top + r.height / 2;
  return {
    svg,
    puxar(x, y) {
      const queda = 30 + Math.hypot(x - x0, y - y0) * 0.2;
      const cx = (x0 + x) / 2;
      const cy = Math.max(y0, y) + queda;
      caminho.setAttribute('d', `M ${x0} ${y0} Q ${cx} ${cy} ${x} ${y}`);
      plugue.setAttribute('cx', x);
      plugue.setAttribute('cy', y);
    },
  };
}
const corDaFonte = (id) => `var(--cor-${id})`;
// LFOs vão de -1 a +1 (balançam para os dois lados); envelopes de 0 a 1.
const ehBipolar = (id) => id.startsWith('lfo');

// opcoes:
//   barra: onde colocar as fichas
//   dica: elemento de texto para as instruções do modo "tocar para ligar"
//   listas: { lfo1: elemento, ... } onde mostrar as ligações de cada fonte
//   ligacoes: a lista de ligações (é alterada aqui dentro)
//   aoMudar: chamado sempre que as ligações mudam
//   formaDe: (id) → forma atual de um LFO ('seno'...), para o desenhinho da ficha
//   lugaresMacros: { macro1: elemento, ... } onde pôr a ficha de cada Macro (painel dos Macros)
//   aoArmar(fonte): avisa quando uma ficha é armada (ou null ao desarmar)
export function criarModulacao({ barra, dica, listas, ligacoes, aoMudar, formaDe, lugaresMacros = {}, aoArmar = () => {} }) {
  let armada = null; // fonte escolhida no modo "tocar para ligar"
  let modAoVivo = null; // quanto cada destino está sendo modulado agora (ou null)

  // ---------- Fichas ----------
  // Cheias na cor da fonte, com o desenhinho da forma e o nome.
  const fichas = FONTES.map(({ id, nome, macro }) => {
    const ficha = document.createElement('button');
    ficha.className = 'ficha';
    ficha.innerHTML = `<svg class="ficha-forma" viewBox="0 0 22 12" aria-hidden="true"><path /></svg><span></span>`;
    ficha.querySelector('span').textContent = nome;
    ficha.setAttribute('aria-label', nome);
    ficha.dataset.fonte = id;
    ficha.style.setProperty('--cor', corDaFonte(id));
    ficha.setAttribute('aria-pressed', 'false');
    prepararFicha(ficha, id);
    (macro ? lugaresMacros[id] : barra)?.appendChild(ficha);
    return ficha;
  });

  // Atualiza o desenhinho de cada ficha (chamar quando a forma de um LFO mudar)
  function atualizarFichas() {
    for (const ficha of fichas) {
      const id = ficha.dataset.fonte;
      const forma = ehBipolar(id) ? formaDe?.(id) : id.startsWith('macro') ? 'macro' : 'env';
      ficha.querySelector('.ficha-forma path').setAttribute('d', desenhoDaFicha(forma));
    }
  }
  atualizarFichas();

  // ---------- Criar / remover ligações ----------
  function ligar(fonte, destino) {
    const existente = ligacoes.find((l) => l.fonte === fonte && l.destino === destino);
    if (existente) {
      piscar(destino);
      return;
    }
    const medida = MEDIDAS[destino];
    const quantidade = medida ? medida.inicial / medida.faixa : QUANTIDADE_INICIAL;
    ligacoes.push({ fonte, destino, quantidade });
    mudou();
    piscar(destino);
  }

  function remover(ligacao) {
    ligacoes.splice(ligacoes.indexOf(ligacao), 1);
    mudou();
  }

  function mudou() {
    atualizar();
    aoMudar();
  }

  // Um brilho rápido no destino, confirmando a ligação.
  function piscar(destino) {
    document.querySelectorAll(`[data-destino="${destino}"]`).forEach((el) => {
      el.classList.remove('mod-ligou');
      void el.offsetWidth; // reinicia a animação
      el.classList.add('mod-ligou');
      // Tira a marcação no fim, senão o brilho repete toda vez que a aba reabre.
      el.addEventListener('animationend', () => el.classList.remove('mod-ligou'), { once: true });
    });
  }

  // ---------- Modo "tocar para ligar" ----------
  function armar(fonte) {
    armada = armada === fonte ? null : fonte;
    fichas.forEach((f) => f.setAttribute('aria-pressed', f.dataset.fonte === armada));
    document.body.classList.toggle('ligando-mod', armada !== null);
    if (armada) {
      document.body.style.setProperty('--cor-ligando', corDaFonte(armada));
      // Macro: o painel fecha para mostrar os controles; termina tocando no "M"
      dica.textContent = armada.startsWith('macro')
        ? `Toque nos controles para ligar o ${nomeDaFonte(armada)}. Toque no M para terminar.`
        : `Toque nos controles para ligar o ${nomeDaFonte(armada)}. Toque na ficha de novo para terminar.`;
      dica.hidden = false;
    } else {
      dica.hidden = true;
    }
    aoArmar(armada);
  }

  // Com uma ficha armada, tocar num destino liga (em vez de mexer no controle).
  const interceptar = (evento) => {
    if (!armada) return;
    const destino = evento.target.closest?.('[data-destino]');
    if (!destino) return;
    evento.preventDefault();
    evento.stopPropagation();
    if (evento.type === 'pointerdown') ligar(armada, destino.dataset.destino);
  };
  document.addEventListener('pointerdown', interceptar, true);
  document.addEventListener('touchstart', interceptar, { capture: true, passive: false });
  document.addEventListener('mousedown', interceptar, true);
  document.addEventListener('click', interceptar, true);
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && armada) armar(armada);
  });

  // ---------- Arrastar a ficha ----------
  function prepararFicha(ficha, fonte) {
    let arraste = null;

    ficha.addEventListener('pointerdown', (evento) => {
      evento.preventDefault();
      try {
        ficha.setPointerCapture(evento.pointerId);
      } catch {
        // Sem captura, o arraste ainda funciona enquanto o dedo estiver na ficha.
      }
      arraste = { id: evento.pointerId, x: evento.clientX, y: evento.clientY, fantasma: null, alvo: null };
    });

    ficha.addEventListener('pointermove', (evento) => {
      if (!arraste || evento.pointerId !== arraste.id) return;
      const distancia = Math.hypot(evento.clientX - arraste.x, evento.clientY - arraste.y);
      if (!arraste.fantasma && distancia < DISTANCIA_ARRASTE) return;

      if (!arraste.fantasma) {
        // Começou a arrastar: uma cópia da ficha segue o dedo, puxando um "cabo" colorido
        // que sai da ficha (como ligar um cabo num sintetizador modular).
        arraste.fantasma = ficha.cloneNode(true);
        arraste.fantasma.classList.add('ficha-fantasma');
        arraste.cabo = criarCabo(ficha, corDaFonte(fonte));
        document.body.append(arraste.cabo.svg, arraste.fantasma);
        document.body.classList.add('arrastando-mod');
        document.body.style.setProperty('--cor-ligando', corDaFonte(fonte));
      }
      arraste.fantasma.style.left = evento.clientX + 'px';
      arraste.fantasma.style.top = evento.clientY + 'px';
      arraste.cabo.puxar(evento.clientX, evento.clientY);

      // Destaca o controle que está embaixo do dedo.
      const embaixo = document.elementFromPoint(evento.clientX, evento.clientY)?.closest('[data-destino]');
      if (embaixo !== arraste.alvo) {
        arraste.alvo?.classList.remove('mod-alvo');
        embaixo?.classList.add('mod-alvo');
        arraste.alvo = embaixo;
      }
    });

    const terminar = (evento, cancelado) => {
      if (!arraste || evento.pointerId !== arraste.id) return;
      const { fantasma, alvo, cabo } = arraste;
      arraste = null;
      if (!fantasma) {
        if (!cancelado) armar(fonte); // foi só um toque: arma/desarma a ficha
        return;
      }
      fantasma.remove();
      cabo.svg.remove();
      alvo?.classList.remove('mod-alvo');
      document.body.classList.remove('arrastando-mod');
      if (alvo && !cancelado) ligar(fonte, alvo.dataset.destino);
    };
    ficha.addEventListener('pointerup', (evento) => terminar(evento, false));
    ficha.addEventListener('pointercancel', (evento) => terminar(evento, true));
  }

  // ---------- Listas de ligações e bolinhas nos controles ----------
  function atualizar() {
    for (const { id, nome } of FONTES) {
      const lista = listas[id];
      if (!lista) continue;
      lista.innerHTML = '';
      const minhas = ligacoes.filter((l) => l.fonte === id);
      if (minhas.length === 0) {
        const vazio = document.createElement('p');
        vazio.className = 'lista-mod-vazia';
        vazio.textContent = `Arraste a ficha ${nome} até um controle (ou toque nela e depois no controle).`;
        lista.appendChild(vazio);
      }
      for (const ligacao of minhas) lista.appendChild(criarLinha(ligacao));
    }

    // Bolinhas coloridas nos controles ligados (uma por fonte).
    document.querySelectorAll('[data-destino]').forEach((el) => {
      let bolinhas = el.querySelector(':scope > .bolinhas-mod');
      if (!bolinhas) {
        bolinhas = document.createElement('span');
        bolinhas.className = 'bolinhas-mod';
        el.appendChild(bolinhas);
      }
      bolinhas.innerHTML = '';
      for (const ligacao of ligacoes.filter((l) => l.destino === el.dataset.destino)) {
        const bolinha = document.createElement('i');
        bolinha.style.background = corDaFonte(ligacao.fonte);
        bolinhas.appendChild(bolinha);
      }
    });
    atualizarAoVivo(modAoVivo);
  }

  // Faixas coloridas e ponto ao vivo em cada controle ligado.
  // "mod": lista do motor de som (na ordem de DESTINOS_MOD), ou null se nada toca.
  function atualizarAoVivo(mod) {
    modAoVivo = mod;
    document.querySelectorAll('[data-destino]').forEach((el) => {
      if (!el.mostrarModulacao) return;
      const destino = el.dataset.destino;
      const faixas = ligacoes
        .filter((l) => l.destino === destino)
        .map((l) => ({ cor: corDaFonte(l.fonte), quantidade: l.quantidade, bipolar: ehBipolar(l.fonte) }));
      const deslocamento = mod ? mod[DESTINOS_MOD.indexOf(destino)] : null;
      el.mostrarModulacao(faixas, deslocamento);
    });
  }

  // Uma linha da lista: nome do destino, barra de quantidade, valor e ✕.
  function criarLinha(ligacao) {
    const linha = document.createElement('div');
    linha.className = 'linha-mod';
    linha.style.setProperty('--cor', corDaFonte(ligacao.fonte));

    const nome = document.createElement('span');
    nome.className = 'linha-mod-nome';
    nome.textContent = NOMES_DESTINOS[ligacao.destino];

    const barraQuantidade = document.createElement('input');
    barraQuantidade.type = 'range';
    barraQuantidade.className = 'barra-quantidade';
    barraQuantidade.min = -1;
    barraQuantidade.max = 1;
    // Com medida própria, a barra anda de 1 em 1 unidade (ex.: 1 semitom = 1/24)
    const medida = MEDIDAS[ligacao.destino];
    barraQuantidade.step = medida ? 1 / medida.faixa : 0.01;
    barraQuantidade.value = ligacao.quantidade;
    barraQuantidade.setAttribute('aria-label', `Quantidade: ${nomeDaFonte(ligacao.fonte)} → ${nome.textContent}`);

    const valor = document.createElement('span');
    valor.className = 'linha-mod-valor';
    const mostrar = () => {
      valor.textContent = textoQuantidade(ligacao.destino, ligacao.quantidade);
      // Barra pintada do meio (zero) até a quantidade: para a direita (+) ou esquerda (−)
      const q = ligacao.quantidade;
      barraQuantidade.style.setProperty('--ini', 50 + Math.min(0, q) * 50 + '%');
      barraQuantidade.style.setProperty('--fim', 50 + Math.max(0, q) * 50 + '%');
    };
    mostrar();

    barraQuantidade.addEventListener('input', () => {
      ligacao.quantidade = Number(barraQuantidade.value);
      mostrar();
      atualizarAoVivo(modAoVivo); // as faixas nos controles acompanham
      aoMudar();
    });

    const botaoRemover = document.createElement('button');
    botaoRemover.className = 'linha-mod-remover';
    botaoRemover.innerHTML = icone('fechar');
    botaoRemover.setAttribute('aria-label', `Remover ligação com ${nome.textContent}`);
    botaoRemover.addEventListener('click', () => remover(ligacao));

    linha.append(nome, barraQuantidade, valor, botaoRemover);
    return linha;
  }

  // Sai do modo "tocar para ligar" (ex.: ao esconder as fichas).
  function desarmar() {
    if (armada) armar(armada);
  }

  atualizar();
  return { atualizar, atualizarAoVivo, desarmar, atualizarFichas, armada: () => armada };
}
