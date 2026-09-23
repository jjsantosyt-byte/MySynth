// dsp/voz.js
// Uma "voz" = uma nota tocando, completa:
//   cópias de unison (oscilador) → filtro estéreo → envelope de volume
//
// Unison: várias cópias do oscilador, desafinadas por igual para cima e
// para baixo (Detune) e abertas entre esquerda e direita (Width).
// Cada cópia começa num ponto sorteado da onda: é o que deixa o som vivo.

import { Envelope } from './envelope.js';
import { Filtro } from './filtro.js';
import { escolherNiveis, lerAmostra } from './oscilador.js';

export const MAX_UNISON = 16;

// Com Detune em 100%, as cópias das pontas ficam ±1 semitom da nota.
const DETUNE_MAXIMO = 1;

const TAMANHO_BLOCO = 128;

function notaParaFrequencia(nota) {
  return 440 * Math.pow(2, (nota - 69) / 12);
}

export class Voz {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.envelope = new Envelope(taxaAmostragem);
    this.filtroE = new Filtro(taxaAmostragem); // lado esquerdo
    this.filtroD = new Filtro(taxaAmostragem); // lado direito

    this.nota = null;
    this.frequencia = 440;
    this.segurada = false; // tecla ainda apertada?
    this.idade = 0; // ordem em que a nota começou (para saber qual é a mais antiga)
    this.pendente = null; // nota que vai tocar assim que esta voz terminar de sumir

    // Dados de cada cópia de unison
    this.fases = new Float64Array(MAX_UNISON);
    this.passos = new Float64Array(MAX_UNISON);
    this.volumes = new Float64Array(MAX_UNISON); // mudam suavemente (sem estalo)
    this.ganhosE = new Float64Array(MAX_UNISON);
    this.ganhosD = new Float64Array(MAX_UNISON);
    this.niveis = new Int32Array(MAX_UNISON);
    this.niveisB = new Int32Array(MAX_UNISON);
    this.misturas = new Float64Array(MAX_UNISON);
    this.qtdCopias = 0; // quantas cópias estão soando (inclui as que estão sumindo)
    this.volumesDireto = false; // na primeira vez, os volumes vão direto ao valor certo

    // Rascunhos de um bloco de áudio (128 amostras)
    this.somaE = new Float64Array(TAMANHO_BLOCO); // soma das cópias, lado esquerdo
    this.somaD = new Float64Array(TAMANHO_BLOCO); // soma das cópias, lado direito
    this.framesBloco = new Int32Array(TAMANHO_BLOCO); // WT Pos mudando: frame de cada amostra
    this.tsBloco = new Float64Array(TAMANHO_BLOCO); // ...e quanto do frame seguinte

    this.suavizar = 1 - Math.exp(-1 / (0.005 * taxaAmostragem));
    this.escolha = { nivel: 0, nivelB: 0, mistura: 0 };
  }

  // Está fazendo som (ou prestes a fazer)?
  get ativa() {
    return this.envelope.ativo || this.pendente !== null;
  }

  get nivel() {
    return this.envelope.nivel;
  }

  // Começa uma nota. "recomecar" = dispara o envelope (falso no legato).
  iniciar(nota, idade, recomecar = true) {
    if (!this.envelope.ativo) {
      // Vindo do silêncio: filtro limpo e cada cópia num ponto sorteado da onda.
      this.filtroE.reiniciar();
      this.filtroD.reiniciar();
      for (let c = 0; c < MAX_UNISON; c++) this.fases[c] = Math.random();
      this.volumesDireto = true;
    }
    this.nota = nota;
    this.frequencia = notaParaFrequencia(nota);
    this.segurada = true;
    this.idade = idade;
    this.pendente = null;
    if (recomecar) this.envelope.disparar();
  }

  soltar() {
    this.segurada = false;
    this.envelope.soltar();
  }

  // Voz roubada: some em ~4 ms e depois toca a nota nova.
  roubar(nota, idade) {
    this.segurada = false;
    this.pendente = { nota, idade };
    this.envelope.silenciarRapido();
  }

  // Liga/desliga e tipo do filtro valem para os dois lados.
  definirFiltro(nome, valor) {
    for (const filtro of [this.filtroE, this.filtroD]) {
      if (nome === 'filtroTipo') filtro.definirTipo(valor);
      if (nome === 'filtroLigado') filtro.definirLigado(valor);
    }
  }

  // Calcula o som desta voz e SOMA nas saídas (esquerda e direita).
  // comum = { tabela, posicoesWT, coef, unison, detune, width }
  processar(saidaE, saidaD, tamanhoBloco, comum) {
    // Terminou de sumir e tem nota esperando? Começa ela agora.
    if (this.pendente && !this.envelope.ativo) {
      this.iniciar(this.pendente.nota, this.pendente.idade);
    }
    if (!this.envelope.ativo) return;

    const { tabela, posicoesWT, coef, unison, detune, width } = comum;

    // --- Ajustes de cada cópia, uma vez por bloco ---
    // Volume de cada cópia: 1/√N, para o som não ficar N vezes mais alto.
    const volumeCopia = 1 / Math.sqrt(unison);
    for (let c = 0; c < unison; c++) {
      // Posição da cópia de -1 (ponta de baixo/esquerda) a +1 (ponta de cima/direita).
      const posicao = unison === 1 ? 0 : (c / (unison - 1)) * 2 - 1;
      const freq = this.frequencia * Math.pow(2, (posicao * detune * DETUNE_MAXIMO) / 12);
      this.passos[c] = freq / this.taxa;
      escolherNiveis(tabela.harmonicos, freq, this.taxa, this.escolha);
      this.niveis[c] = this.escolha.nivel;
      this.niveisB[c] = this.escolha.nivelB;
      this.misturas[c] = this.escolha.mistura;
      // Estéreo "de potência igual": no centro, os dois lados com o mesmo volume.
      const angulo = ((1 + posicao * width) * Math.PI) / 4;
      this.ganhosE[c] = Math.cos(angulo) * Math.SQRT2;
      this.ganhosD[c] = Math.sin(angulo) * Math.SQRT2;
      if (this.volumesDireto) this.volumes[c] = volumeCopia;
    }
    if (this.volumesDireto) {
      for (let c = unison; c < MAX_UNISON; c++) this.volumes[c] = 0;
      this.volumesDireto = false;
    }
    // Cópias acima do Unison atual continuam só até sumirem (se o Unison diminuiu).
    let qtd = unison;
    for (let c = unison; c < MAX_UNISON; c++) if (this.volumes[c] > 1e-5) qtd = c + 1;
    this.qtdCopias = qtd;

    // --- Oscilador: calcula uma cópia inteira de cada vez (bloco todo) ---
    // Assim, tudo que não muda dentro do bloco é preparado uma vez só.
    const frames = tabela.frames;
    const ultimoFrame = frames.length - 1;
    const tamanho = tabela.tamanho;
    const mascara = tamanho - 1;
    const s = this.suavizar;
    const somaE = this.somaE;
    const somaD = this.somaD;
    somaE.fill(0, 0, tamanhoBloco);
    somaD.fill(0, 0, tamanhoBloco);

    // Posição na wavetable: parada (1 valor) ou mudando (1 por amostra).
    const wtParado = posicoesWT.length === 1;
    let f0Parado = 0;
    let tParado = 0;
    if (wtParado) {
      const wt = posicoesWT[0] * ultimoFrame;
      f0Parado = Math.min(wt | 0, ultimoFrame);
      tParado = wt - f0Parado;
    } else {
      for (let i = 0; i < tamanhoBloco; i++) {
        const wt = posicoesWT[i] * ultimoFrame;
        const f0 = Math.min(wt | 0, ultimoFrame);
        this.framesBloco[i] = f0;
        this.tsBloco[i] = wt - f0;
      }
    }

    for (let c = 0; c < qtd; c++) {
      let fase = this.fases[c];
      const passo = this.passos[c];
      const ganhoE = this.ganhosE[c];
      const ganhoD = this.ganhosD[c];
      const nivel = this.niveis[c];
      const nivelB = this.niveisB[c];
      const mistura = this.misturas[c];

      // Volume da cópia: só suaviza se ainda não chegou no valor certo.
      const alvo = c < unison ? volumeCopia : 0;
      let volume = this.volumes[c];
      const suavizando = Math.abs(volume - alvo) > 1e-4;
      if (!suavizando) volume = alvo;

      if (wtParado) {
        // Caminho rápido: as tabelas desta cópia são as mesmas no bloco todo.
        const frameA = frames[f0Parado];
        const frameB = frames[Math.min(f0Parado + 1, ultimoFrame)];
        const oA = frameA[nivel];
        const oAB = frameA[nivelB];
        const oB = frameB[nivel];
        const oBB = frameB[nivelB];
        for (let i = 0; i < tamanhoBloco; i++) {
          if (suavizando) volume += (alvo - volume) * s;
          const posicao = fase * tamanho;
          const i0 = posicao | 0;
          const i1 = (i0 + 1) & mascara;
          const frac = posicao - i0;

          let amostra = oA[i0] + frac * (oA[i1] - oA[i0]);
          if (mistura > 0) amostra += mistura * (oAB[i0] + frac * (oAB[i1] - oAB[i0]) - amostra);
          if (tParado > 0) {
            let amostraB = oB[i0] + frac * (oB[i1] - oB[i0]);
            if (mistura > 0) amostraB += mistura * (oBB[i0] + frac * (oBB[i1] - oBB[i0]) - amostraB);
            amostra += tParado * (amostraB - amostra);
          }
          amostra *= volume;
          somaE[i] += amostra * ganhoE;
          somaD[i] += amostra * ganhoD;

          fase += passo;
          if (fase >= 1) fase -= 1;
        }
      } else {
        // WT Pos mudando: posição na wavetable a cada amostra (morphing suave).
        for (let i = 0; i < tamanhoBloco; i++) {
          if (suavizando) volume += (alvo - volume) * s;
          const f0 = this.framesBloco[i];
          const frameA = frames[f0];
          const frameB = frames[Math.min(f0 + 1, ultimoFrame)];
          const amostra =
            lerAmostra(frameA, frameB, this.tsBloco[i], nivel, nivelB, mistura, fase, tamanho, mascara) * volume;
          somaE[i] += amostra * ganhoE;
          somaD[i] += amostra * ganhoD;

          fase += passo;
          if (fase >= 1) fase -= 1;
        }
      }

      this.fases[c] = fase;
      this.volumes[c] = volume;
    }

    // --- Filtro (estéreo) e envelope de volume ---
    const filtroE = this.filtroE;
    const filtroD = this.filtroD;
    const envelope = this.envelope;
    for (let i = 0; i < tamanhoBloco; i++) {
      const j = coef.variavel ? i : 0;
      const env = envelope.proximo();
      saidaE[i] += filtroE.processar(somaE[i], coef, j) * env;
      saidaD[i] += filtroD.processar(somaD[i], coef, j) * env;
    }
  }
}
