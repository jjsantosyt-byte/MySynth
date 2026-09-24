// dsp/oscilador-voz.js
// Um oscilador wavetable DENTRO de uma nota (voz), com as suas cópias de unison.
// Cada voz tem um destes por oscilador (A, B, C).
//
// Unison: várias cópias da onda, desafinadas por igual para cima e para baixo
// (Detune) e abertas entre esquerda e direita (Width). Cada cópia começa num
// ponto sorteado da onda: é o que deixa o som vivo.
//
// O som sai em "somaE"/"somaD" (esquerda/direita), já com o Nível aplicado.
// Quem usa (a voz) manda cada pedaço de modulação (32 amostras) com processarPedaco().

import { escolherNiveis, lerAmostra } from './oscilador.js';

export const MAX_UNISON = 16;

// Com Detune em 100%, as cópias das pontas ficam ±1 semitom da nota.
const DETUNE_MAXIMO = 1;

const limitar01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class OsciladorVoz {
  // "destinos" = índices de modulação deste oscilador: { wtPos, detune, width, nivel }
  constructor(taxaAmostragem, tamanhoBloco, destinos) {
    this.taxa = taxaAmostragem;
    this.destinos = destinos;

    // Dados de cada cópia de unison
    this.fases = new Float64Array(MAX_UNISON);
    this.passos = new Float64Array(MAX_UNISON);
    this.volumes = new Float64Array(MAX_UNISON); // mudam suavemente (sem estalo)
    this.ganhosE = new Float64Array(MAX_UNISON);
    this.ganhosD = new Float64Array(MAX_UNISON);
    this.niveis = new Int32Array(MAX_UNISON);
    this.niveisB = new Int32Array(MAX_UNISON);
    this.misturas = new Float64Array(MAX_UNISON);
    this.volumesDireto = false; // na primeira vez, os volumes vão direto ao valor certo

    this.nivel = 1; // nível atual (liga/desliga e knob Nível, suavizado)
    this.nivelDireto = true;
    this.calado = false; // desligado e já em silêncio neste pedaço: não calcula nada

    // Rascunhos de um bloco
    this.somaE = new Float64Array(tamanhoBloco);
    this.somaD = new Float64Array(tamanhoBloco);
    this.framesBloco = new Int32Array(tamanhoBloco); // WT Pos mudando: frame de cada amostra
    this.tsBloco = new Float64Array(tamanhoBloco); // ...e quanto do frame seguinte

    this.suavizar = 1 - Math.exp(-1 / (0.005 * taxaAmostragem));
    this.escolha = { nivel: 0, nivelB: 0, mistura: 0 };
  }

  // Nota começando do silêncio: cada cópia num ponto sorteado da onda.
  reiniciar() {
    for (let c = 0; c < MAX_UNISON; c++) this.fases[c] = Math.random();
    this.volumesDireto = true;
    this.nivelDireto = true;
  }

  // Zera as somas no começo de cada bloco.
  limpar(tamanhoBloco) {
    this.somaE.fill(0, 0, tamanhoBloco);
    this.somaD.fill(0, 0, tamanhoBloco);
  }

  // Ajusta cada cópia de unison (altura, estéreo, nível anti-aliasing).
  ajustarCopias(frequencia, unison, detune, width, tabela) {
    for (let c = 0; c < unison; c++) {
      // Posição da cópia de -1 (ponta de baixo/esquerda) a +1 (ponta de cima/direita).
      const posicao = unison === 1 ? 0 : (c / (unison - 1)) * 2 - 1;
      const freq = frequencia * Math.pow(2, (posicao * detune * DETUNE_MAXIMO) / 12);
      this.passos[c] = freq / this.taxa;
      escolherNiveis(tabela.harmonicos, freq, this.taxa, this.escolha);
      this.niveis[c] = this.escolha.nivel;
      this.niveisB[c] = this.escolha.nivelB;
      this.misturas[c] = this.escolha.mistura;
      // Estéreo "de potência igual": no centro, os dois lados com o mesmo volume.
      const angulo = ((1 + posicao * width) * Math.PI) / 4;
      this.ganhosE[c] = Math.cos(angulo) * Math.SQRT2;
      this.ganhosD[c] = Math.sin(angulo) * Math.SQRT2;
    }
  }

  // Calcula um pedaço (amostras "inicio" até "fim") e soma em somaE/somaD.
  // ajustes: { tabela, posicoesWT, unison, detune, width, ligado, nivel, ganho }
  //   ganho = 1 normalmente; 0 enquanto a wavetable deste oscilador está sendo trocada
  //   (o som abaixa suavemente, troca no silêncio e volta: sem estalo).
  // mod / modAnterior: modulação da voz (fim deste pedaço / fim do pedaço anterior)
  processarPedaco(inicio, fim, frequencia, ajustes, mod, modAnterior) {
    const { tabela, posicoesWT, unison } = ajustes;
    const destinos = this.destinos;
    const qtd = fim - inicio;
    const s = this.suavizar;

    // Nível (liga/desliga e knob Nível + modulação).
    // Desligado (e já silencioso): nem calcula, economiza processamento.
    const ligado = ajustes.ligado && tabela !== null;
    const alvoNivel = ligado ? limitar01(ajustes.nivel + mod[destinos.nivel]) * ajustes.ganho : 0;
    if (this.nivelDireto) {
      this.nivel = alvoNivel; // nota começando do silêncio: já no nível certo
      this.nivelDireto = false;
    }
    this.calado = alvoNivel === 0 && this.nivel < 1e-5;
    if (this.calado) {
      this.nivel = 0;
      return;
    }

    // Volume de cada cópia: 1/√N, para o som não ficar N vezes mais alto.
    const volumeCopia = 1 / Math.sqrt(unison);
    if (this.volumesDireto) {
      for (let c = 0; c < MAX_UNISON; c++) this.volumes[c] = c < unison ? volumeCopia : 0;
      this.volumesDireto = false;
    }
    // Cópias acima do Unison atual continuam só até sumirem (se o Unison diminuiu).
    let qtdCopias = unison;
    for (let c = unison; c < MAX_UNISON; c++) if (this.volumes[c] > 1e-5) qtdCopias = c + 1;

    // Cópias de unison com Detune/Width modulados
    this.ajustarCopias(
      frequencia,
      unison,
      limitar01(ajustes.detune + mod[destinos.detune]),
      limitar01(ajustes.width + mod[destinos.width]),
      tabela
    );

    // Posição na wavetable: parada no pedaço ou mudando a cada amostra
    const frames = tabela.frames;
    const ultimoFrame = frames.length - 1;
    const tamanho = tabela.tamanho;
    const mascara = tamanho - 1;
    const wtModIni = modAnterior[destinos.wtPos];
    const wtModFim = mod[destinos.wtPos];
    const wtParado = posicoesWT.length === 1 && wtModIni === wtModFim;
    let f0Parado = 0;
    let tParado = 0;
    if (wtParado) {
      const wt = limitar01(posicoesWT[0] + wtModFim) * ultimoFrame;
      f0Parado = Math.min(wt | 0, ultimoFrame);
      tParado = wt - f0Parado;
    } else {
      for (let i = inicio; i < fim; i++) {
        const base = posicoesWT.length > 1 ? posicoesWT[i] : posicoesWT[0];
        const m = wtModIni + ((i - inicio + 1) / qtd) * (wtModFim - wtModIni);
        const wt = limitar01(base + m) * ultimoFrame;
        const f0 = Math.min(wt | 0, ultimoFrame);
        this.framesBloco[i] = f0;
        this.tsBloco[i] = wt - f0;
      }
    }

    // Uma cópia inteira de cada vez.
    const somaE = this.somaE;
    const somaD = this.somaD;
    for (let c = 0; c < qtdCopias; c++) {
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
        // Caminho rápido: as tabelas desta cópia são as mesmas no pedaço todo.
        const frameA = frames[f0Parado];
        const frameB = frames[Math.min(f0Parado + 1, ultimoFrame)];
        const oA = frameA[nivel];
        const oAB = frameA[nivelB];
        const oB = frameB[nivel];
        const oBB = frameB[nivelB];
        for (let i = inicio; i < fim; i++) {
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
        for (let i = inicio; i < fim; i++) {
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

    // Nível do oscilador (liga/desliga e knob Nível), em rampa suave
    if (alvoNivel !== 1 || this.nivel !== 1) {
      for (let i = inicio; i < fim; i++) {
        this.nivel += (alvoNivel - this.nivel) * s;
        somaE[i] *= this.nivel;
        somaD[i] *= this.nivel;
      }
      if (Math.abs(this.nivel - alvoNivel) < 1e-5) this.nivel = alvoNivel;
    }
  }
}
