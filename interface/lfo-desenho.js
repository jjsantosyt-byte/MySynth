// interface/lfo-desenho.js
// Editor do LFO desenhado: uma janela grande (quase a tela toda) com o desenho do LFO.
//   - Tocar no vazio cria um ponto (e já dá para arrastar); arrastar um ponto move.
//   - Toque duplo num ponto apaga (o primeiro e o último não: são o começo e o fim do ciclo).
//   - Arrastar o losango ◆ no meio de uma linha curva a linha (toque duplo nele = reta de novo).
//   - Grade (Off / 4 / 8 / 16): os pontos "grudam" nas divisões (e em alturas de 1/4).
//   - Modelos prontos, Espelhar (de trás para frente) e Desfazer (só dentro do editor; o ↶ da
//     barra de cima também desfaz, como qualquer mudança no som).
// O som muda na hora (a cada movimento), como girar um knob.

import { criar, mostrarRecado } from './janela.js';
import { icone, botaoComIcone } from './icones.js';
import { arrumarPontos, valorDesenho, MAX_PONTOS_LFO } from '../dsp/lfo.js';
import { desenharEditorLfo, MARGEM_EDITOR_LFO } from '../visualizacao.js';
import { EM_INGLES } from './idioma.js';

// Modelos para começar (o nome aparece no botão, com o desenhinho)
export const MODELOS_LFO = [
  { nome: 'Rampa ↑', pontos: [[0, -1, 0], [1, 1, 0]] },
  { nome: 'Rampa ↓', pontos: [[0, 1, 0], [1, -1, 0]] },
  { nome: 'Triângulo', pontos: [[0, 0, 0], [0.25, 1, 0], [0.75, -1, 0], [1, 0, 0]] },
  {
    nome: 'Degraus',
    pontos: [[0, -1, 0], [0.25, -1, 0], [0.25, -1 / 3, 0], [0.5, -1 / 3, 0], [0.5, 1 / 3, 0], [0.75, 1 / 3, 0], [0.75, 1, 0], [1, 1, 0]],
  },
  { nome: 'Sidechain', pontos: [[0, -1, -0.8], [0.6, 1, 0], [1, 1, 0]] },
  { nome: 'Onda', pontos: [[0, 0, -0.5], [0.25, 1, 0.5], [0.5, 0, -0.5], [0.75, -1, 0.5], [1, 0, 0]] },
];

// Espelhar = tocar de trás para frente: x → 1 − x, na ordem inversa. A curva de cada trecho
// troca de sinal (a mesma curva vista ao contrário).
export function espelharPontos(pontos) {
  const n = pontos.length;
  return pontos.map((_, j) => {
    const [x, y] = pontos[n - 1 - j];
    const curva = j < n - 1 ? -pontos[n - 2 - j][2] : 0;
    return [1 - x, y, curva || 0];
  });
}

// Caminho SVG (caixa 60 × 18) de um desenho: para os botões dos modelos e para as fichas
export function caminhoDoDesenho(pontos, largura = 60, altura = 18, voltas = 1) {
  const p = arrumarPontos(pontos);
  const qtd = 48 * voltas;
  let d = '';
  for (let k = 0; k <= qtd; k++) {
    const t = (k / qtd) * voltas;
    const fase = k === qtd ? 0.999999 : t - Math.floor(t); // lugar dentro da volta
    const x = 1 + (k / qtd) * (largura - 2);
    const y = altura / 2 - valorDesenho(p, fase) * (altura / 2 - 1);
    d += (k ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d;
}

const RAIO_PONTO = 22; // px: distância para "pegar" um ponto com o dedo
const RAIO_ALCA = 20;
const TOQUE_DUPLO = 350; // ms
const MAX_DESFAZER = 50;
const GRADES = [0, 4, 8, 16];

const decimal = (v, casas = 2) => {
  const texto = (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(casas);
  return EM_INGLES ? texto : texto.replace('.', ',');
};

// opções:
//   lerPontos(id): os pontos atuais do LFO (id = 'lfo1'...)
//   aoMudar(id, pontos): o desenho mudou (guardar no estado, mandar ao motor, redesenhar)
//   nomeDe(id): "LFO 1"
export function criarEditorLfo({ lerPontos, aoMudar, nomeDe }) {
  let id = null; // LFO sendo editado
  let pontos = []; // cópia arrumada dos pontos
  let grade = 8;
  let pilha = []; // Desfazer (fotos dos pontos)
  let arrasto = null; // { tipo: 'ponto' | 'curva', i, ... }
  let ultimoToque = null; // { tipo, i, tempo } (para o toque duplo)
  let geometria = null;

  // ---------- Montagem da janela ----------
  const fundo = criar('div', 'janela-fundo');
  fundo.hidden = true;
  const janela = criar('div', 'janela janela-lfo');
  janela.setAttribute('role', 'dialog');

  const topo = criar('div', 'janela-topo lfo-editor-topo');
  const titulo = criar('h2', 'janela-titulo lfo-editor-titulo');
  const bolinha = criar('span', 'bolinha-fonte');
  const nome = criar('span');
  const subtitulo = criar('span', 'lfo-editor-sub', '· Desenho');
  titulo.append(bolinha, nome, subtitulo);
  const contagem = criar('span', 'lfo-editor-contagem');
  const desfazer = botaoComIcone(criar('button', 'botao botao-icone'), 'desfazer', 'Desfazer');
  // ("Pronto" já é "Ready" no tradutor, da tela de carregamento: aqui o texto vem direto)
  const pronto = criar('button', 'botao lfo-editor-pronto', EM_INGLES ? 'Done' : 'Pronto');
  topo.append(titulo, contagem, desfazer, pronto);

  const corpo = criar('div', 'lfo-editor-corpo');
  const area = criar('div', 'lfo-editor-area');
  const moldura = criar('div', 'tela-grafico lfo-editor-tela');
  const canvas = criar('canvas');
  moldura.appendChild(canvas);
  const dica = criar('p', 'lfo-editor-dica');
  // (a dica tem partes em negrito: vem pronta em cada idioma, em vez de passar pelo tradutor)
  dica.innerHTML = EM_INGLES
    ? '<span class="dica-longa"><b>Tap</b> an empty spot to add a point · <b>drag</b> to move · <b>double-tap</b> to delete · drag the <b>◆</b> to bend</span>' +
      '<span class="dica-curta"><b>Tap</b> adds · <b>drag</b> moves · <b>double-tap</b> deletes · <b>◆</b> bends</span>'
    : '<span class="dica-longa"><b>Toque</b> no vazio cria um ponto · <b>arraste</b> move · <b>toque duplo</b> apaga · arraste o <b>◆</b> para curvar</span>' +
      '<span class="dica-curta"><b>Toque</b> cria · <b>arraste</b> move · <b>2 toques</b> apaga · <b>◆</b> curva</span>';
  area.append(moldura, dica);

  const lado = criar('div', 'lfo-editor-lado');
  const botoesGrade = criar('div', 'lfo-editor-grade');
  GRADES.forEach((n) => {
    const b = criar('button', 'botao', n ? String(n) : 'Off');
    b.dataset.grade = n;
    b.setAttribute('aria-label', n ? `Grade ${n}` : 'Grade Off');
    b.addEventListener('click', () => {
      grade = n;
      marcarGrade();
      desenhar();
    });
    botoesGrade.appendChild(b);
  });
  const botoesModelos = criar('div', 'lfo-editor-modelos');
  for (const modelo of MODELOS_LFO) {
    const b = criar('button', 'botao lfo-editor-modelo');
    b.innerHTML = `<svg viewBox="0 0 60 18" aria-hidden="true"><path d="${caminhoDoDesenho(modelo.pontos)}" /></svg><span></span>`;
    b.querySelector('span').textContent = modelo.nome;
    b.addEventListener('click', () => trocarTudo(modelo.pontos));
    botoesModelos.appendChild(b);
  }
  const espelhar = criar('button', 'botao lfo-editor-espelhar');
  espelhar.innerHTML = `${icone('espelhar')}<span>Espelhar</span>`;
  espelhar.title = 'Tocar o desenho de trás para frente';
  espelhar.addEventListener('click', () => trocarTudo(espelharPontos(pontos)));
  lado.append(criar('div', 'lfo-editor-rotulo', 'Grade'), botoesGrade, criar('div', 'lfo-editor-rotulo', 'Modelos'), botoesModelos, espelhar);

  corpo.append(area, lado);
  janela.append(topo, corpo);
  fundo.appendChild(janela);
  document.body.appendChild(fundo);

  // ---------- Abrir / fechar ----------
  function abrir(qual) {
    id = qual;
    pontos = arrumarPontos(lerPontos(id));
    pilha = [];
    arrasto = null;
    nome.textContent = nomeDe(id);
    bolinha.style.background = `var(--cor-${id})`;
    janela.setAttribute('aria-label', `${nomeDe(id)} · Desenho`);
    marcarGrade();
    fundo.hidden = false;
    atualizar();
  }
  function fechar() {
    if (fundo.hidden) return;
    fundo.hidden = true;
    arrasto = null;
  }
  pronto.addEventListener('click', fechar);
  fundo.addEventListener('pointerdown', (evento) => {
    if (evento.target === fundo) fechar();
  });
  document.addEventListener('keydown', (evento) => {
    if (fundo.hidden) return;
    if (evento.key === 'Escape') fechar();
    // Ctrl/Cmd+Z dentro do editor: desfaz o desenho (e não chega ao Desfazer geral)
    if ((evento.ctrlKey || evento.metaKey) && !evento.shiftKey && evento.key.toLowerCase() === 'z') {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      voltar();
    }
  }, true);
  new ResizeObserver(() => fundo.hidden || desenhar()).observe(moldura);

  // ---------- Mudanças ----------
  function guardarFoto() {
    pilha.push(pontos.map((p) => [...p]));
    if (pilha.length > MAX_DESFAZER) pilha.shift();
  }
  function mudou() {
    aoMudar(id, pontos.map((p) => [...p]));
    atualizar();
  }
  function trocarTudo(novos) {
    guardarFoto();
    pontos = arrumarPontos(novos);
    mudou();
  }
  function voltar() {
    if (!pilha.length) return;
    pontos = pilha.pop();
    arrasto = null;
    mudou();
  }
  desfazer.addEventListener('click', voltar);

  function marcarGrade() {
    botoesGrade.querySelectorAll('.botao').forEach((b) => b.classList.toggle('escolhido', Number(b.dataset.grade) === grade));
  }
  function atualizar() {
    contagem.textContent = `${pontos.length} / ${MAX_PONTOS_LFO} pontos`;
    desfazer.disabled = pilha.length === 0;
    desenhar();
  }

  // Texto em cima do que está sendo arrastado: "3/8 · +0,50" (com grade) ou "38% · +0,50";
  // na curva: "Curva +0,40"
  function rotulo() {
    if (!arrasto) return '';
    if (arrasto.tipo === 'curva') return `${EM_INGLES ? 'Curve' : 'Curva'} ${decimal(pontos[arrasto.i][2])}`; // (desenhado no canvas)
    const [x, y] = pontos[arrasto.i];
    const lugar = grade && Math.abs(x * grade - Math.round(x * grade)) < 1e-9 ? `${Math.round(x * grade)}/${grade}` : `${Math.round(x * 100)}%`;
    return `${lugar} · ${decimal(y)}`;
  }
  function desenhar() {
    geometria = desenharEditorLfo(canvas, pontos, { grade, ativo: arrasto, rotulo: rotulo() });
  }

  // ---------- Toques no desenho ----------
  function paraValores(evento) {
    const r = canvas.getBoundingClientRect();
    const m = MARGEM_EDITOR_LFO;
    const x = (evento.clientX - r.left - m) / (r.width - 2 * m);
    const y = 1 - (2 * (evento.clientY - r.top - m)) / (r.height - 2 * m);
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(-1, y)), px: evento.clientX - r.left, py: evento.clientY - r.top };
  }
  const grudarX = (x) => (grade ? Math.round(x * grade) / grade : x);
  const grudarY = (y) => (grade ? Math.round(y * 4) / 4 : y);

  // O que está debaixo do dedo: { tipo: 'ponto' | 'curva', i } ou null
  function achar(px, py) {
    if (!geometria) return null;
    let melhor = null;
    let perto = RAIO_PONTO;
    geometria.lugares.forEach(({ x, y }, i) => {
      const d = Math.hypot(px - x, py - y);
      if (d < perto) {
        perto = d;
        melhor = { tipo: 'ponto', i };
      }
    });
    if (melhor) return melhor;
    perto = RAIO_ALCA;
    for (const a of geometria.alcas) {
      const d = Math.hypot(px - a.x, py - a.y);
      if (d < perto) {
        perto = d;
        melhor = { tipo: 'curva', i: a.i };
      }
    }
    return melhor;
  }

  canvas.addEventListener('pointerdown', (evento) => {
    evento.preventDefault();
    try {
      canvas.setPointerCapture(evento.pointerId);
    } catch {
      // (alguns navegadores recusam: segue sem prender o dedo)
    }
    const v = paraValores(evento);
    let alvo = achar(v.px, v.py);
    const agora = performance.now();
    const duplo = alvo && ultimoToque && ultimoToque.tipo === alvo.tipo && ultimoToque.i === alvo.i && agora - ultimoToque.tempo < TOQUE_DUPLO;
    ultimoToque = alvo ? { ...alvo, tempo: agora } : null;

    if (duplo) {
      ultimoToque = null;
      if (alvo.tipo === 'ponto') {
        if (alvo.i === 0 || alvo.i === pontos.length - 1) return; // começo e fim do ciclo ficam
        guardarFoto();
        pontos.splice(alvo.i, 1);
      } else {
        if (pontos[alvo.i][2] === 0) return;
        guardarFoto();
        pontos[alvo.i][2] = 0; // curva → reta
      }
      arrasto = null;
      mudou();
      return;
    }

    if (!alvo) {
      // Toque no vazio: ponto novo (no lugar certo da ordem), já pronto para arrastar
      if (pontos.length >= MAX_PONTOS_LFO) {
        mostrarRecado(`Máximo de ${MAX_PONTOS_LFO} pontos.`);
        return;
      }
      guardarFoto();
      const x = grudarX(v.x);
      let i = 1;
      while (i < pontos.length - 1 && pontos[i][0] <= x) i++;
      pontos.splice(i, 0, [x, grudarY(v.y), 0]);
      alvo = { tipo: 'ponto', i };
      arrasto = { ...alvo, gravou: true };
      ultimoToque = { ...alvo, tempo: agora };
      mudou();
      return;
    }
    // Pegou um ponto ou uma alça: a foto para Desfazer só é tirada se ele se mexer
    arrasto = { ...alvo, gravou: false, y0: v.py, curva0: pontos[alvo.i][2] };
    desenhar();
  });

  canvas.addEventListener('pointermove', (evento) => {
    if (!arrasto) return;
    const v = paraValores(evento);
    const i = arrasto.i;
    let novo;
    if (arrasto.tipo === 'ponto') {
      const ultimo = i === pontos.length - 1;
      let x = i === 0 ? 0 : ultimo ? 1 : grudarX(v.x);
      if (i > 0 && !ultimo) x = Math.min(pontos[i + 1][0], Math.max(pontos[i - 1][0], x));
      novo = [x, grudarY(v.y), pontos[i][2]];
    } else {
      // Arrastar para cima "empurra" o meio da linha para cima (o sinal depende de a linha
      // subir ou descer); 120 px = curva inteira
      const sobe = pontos[i + 1][1] > pontos[i][1] ? 1 : -1;
      const c = Math.min(1, Math.max(-1, arrasto.curva0 - (sobe * (arrasto.y0 - v.py)) / 120));
      novo = [pontos[i][0], pontos[i][1], Math.abs(c) < 0.03 ? 0 : c];
    }
    if (novo.every((valor, k) => valor === pontos[i][k])) return;
    if (!arrasto.gravou) {
      guardarFoto();
      arrasto.gravou = true;
    }
    pontos[i] = novo;
    mudou();
  });

  const soltar = () => {
    if (!arrasto) return;
    arrasto = null;
    desenhar();
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);

  return { abrir, fechar, aberto: () => !fundo.hidden };
}
