// interface/modulacao.js
// Ligações de modulação na tela: as fichas (LFO 1, LFO 2, ENV 2, ENV 3),
// arrastar e soltar em cima de um knob, o modo "tocar para ligar" e as
// listas de ligações (com a quantidade e o botão ✕) dentro de cada cartão.
//
// Qualquer elemento com o atributo data-destino="cutoff" (por exemplo) pode
// receber uma ligação. Se ele tiver o método mostrarModulacao(faixas, deslocamento),
// também mostra as faixas coloridas e o valor ao vivo (ver interface/knob.js).

import { DESTINOS_MOD } from '../dsp/modulacao.js';

export const FONTES = [
  { id: 'lfo1', nome: 'LFO 1' },
  { id: 'lfo2', nome: 'LFO 2' },
  { id: 'env2', nome: 'ENV 2' },
  { id: 'env3', nome: 'ENV 3' },
];

export const NOMES_DESTINOS = {
  wtPos: 'WT Pos',
  detune: 'Detune',
  width: 'Width',
  cutoff: 'Cutoff',
  resonancia: 'Reso',
  ruido: 'Ruído',
};

const QUANTIDADE_INICIAL = 0.5; // +50% ao criar uma ligação
const DISTANCIA_ARRASTE = 8; // px: menos que isso é um toque, não um arraste

const nomeDaFonte = (id) => FONTES.find((f) => f.id === id).nome;
const corDaFonte = (id) => `var(--cor-${id})`;
// LFOs vão de -1 a +1 (balançam para os dois lados); envelopes de 0 a 1.
const ehBipolar = (id) => id.startsWith('lfo');

// opcoes:
//   barra: onde colocar as fichas
//   dica: elemento de texto para as instruções do modo "tocar para ligar"
//   listas: { lfo1: elemento, ... } onde mostrar as ligações de cada fonte
//   ligacoes: a lista de ligações (é alterada aqui dentro)
//   aoMudar: chamado sempre que as ligações mudam
export function criarModulacao({ barra, dica, listas, ligacoes, aoMudar }) {
  let armada = null; // fonte escolhida no modo "tocar para ligar"
  let modAoVivo = null; // quanto cada destino está sendo modulado agora (ou null)

  // ---------- Fichas ----------
  const fichas = FONTES.map(({ id, nome }) => {
    const ficha = document.createElement('button');
    ficha.className = 'ficha';
    ficha.textContent = nome;
    ficha.dataset.fonte = id;
    ficha.style.setProperty('--cor', corDaFonte(id));
    ficha.setAttribute('aria-pressed', 'false');
    prepararFicha(ficha, id);
    barra.appendChild(ficha);
    return ficha;
  });

  // ---------- Criar / remover ligações ----------
  function ligar(fonte, destino) {
    const existente = ligacoes.find((l) => l.fonte === fonte && l.destino === destino);
    if (existente) {
      piscar(destino);
      return;
    }
    ligacoes.push({ fonte, destino, quantidade: QUANTIDADE_INICIAL });
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
      dica.textContent = `Toque nos controles para ligar o ${nomeDaFonte(armada)}. Toque na ficha de novo para terminar.`;
      dica.hidden = false;
    } else {
      dica.hidden = true;
    }
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
        // Começou a arrastar: uma cópia da ficha segue o dedo.
        arraste.fantasma = ficha.cloneNode(true);
        arraste.fantasma.classList.add('ficha-fantasma');
        document.body.appendChild(arraste.fantasma);
        document.body.classList.add('arrastando-mod');
        document.body.style.setProperty('--cor-ligando', corDaFonte(fonte));
      }
      arraste.fantasma.style.left = evento.clientX + 'px';
      arraste.fantasma.style.top = evento.clientY + 'px';

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
      const { fantasma, alvo } = arraste;
      arraste = null;
      if (!fantasma) {
        if (!cancelado) armar(fonte); // foi só um toque: arma/desarma a ficha
        return;
      }
      fantasma.remove();
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
    barraQuantidade.min = -1;
    barraQuantidade.max = 1;
    barraQuantidade.step = 0.01;
    barraQuantidade.value = ligacao.quantidade;
    barraQuantidade.setAttribute('aria-label', `Quantidade: ${nomeDaFonte(ligacao.fonte)} → ${nome.textContent}`);

    const valor = document.createElement('span');
    valor.className = 'linha-mod-valor';
    const mostrar = () => {
      const pct = Math.round(ligacao.quantidade * 100);
      valor.textContent = (pct > 0 ? '+' : '') + pct + ' %';
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
    botaoRemover.textContent = '✕';
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
  return { atualizar, atualizarAoVivo, desarmar };
}
