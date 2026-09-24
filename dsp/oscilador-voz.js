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

// Cópia afinada acima deste ponto (fração da taxa de amostragem; 0,45 ≈ 21,6 kHz a 48 kHz)
// não dá para tocar sem chiado (aliasing): ela some suavemente em vez de chiar.
// Acontece com Oct/Semi para cima em notas muito agudas (acima do que o ouvido escuta).
const FREQUENCIA_MAXIMA = 0.45;

const limitar01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class OsciladorVoz {
  // "destinos" = índices de modulação deste oscilador (ver DESTINOS_OSC em modulacao.js)
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
    this.agudaDemais = new Uint8Array(MAX_UNISON); // 1 = cópia acima do limite (fica calada)
    this.volumesDireto = false; // na primeira vez, os volumes vão direto ao valor certo
    this.volumeMeio = 1; // volume das cópias do meio e de fora (ver calcularVolumes)
    this.volumeFora = 1;

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

  // Nota começando do silêncio: ponto de início de cada cópia na onda.
  // Phase (fase, 0 a 1 = 0° a 360°) = onde começa; Rand (0 a 1) = quanto do sorteio da voz
  // entra por cima. Rand 100% + Phase 0° = sorteio puro (o padrão); Rand 0% = toda nota
  // começa exatamente no mesmo ponto (ataque mais "duro" e igual, bom para baixos).
  // Os 3 osciladores recebem os MESMOS sorteios: na mesma altura, com o mesmo Phase/Rand,
  // eles começam juntos e somam sempre igual.
  reiniciar(fasesSorteadas, ajustes) {
    const { fase, rand } = ajustes;
    for (let c = 0; c < MAX_UNISON; c++) {
      const inicio = fase + rand * fasesSorteadas[c];
      this.fases[c] = inicio >= 1 ? inicio - 1 : inicio;
    }
    this.volumesDireto = true;
    this.nivelDireto = true;
  }

  // Zera as somas no começo de cada bloco.
  limpar(tamanhoBloco) {
    this.somaE.fill(0, 0, tamanhoBloco);
    this.somaD.fill(0, 0, tamanhoBloco);
  }

  // Ajusta cada cópia de unison (altura, estéreo, nível anti-aliasing).
  // pan: posição do oscilador no estéreo (-1 esquerda, 0 centro, 1 direita), somada à
  // abertura do unison (Width).
  ajustarCopias(frequencia, unison, detune, width, pan, tabela) {
    for (let c = 0; c < unison; c++) {
      // Posição da cópia de -1 (ponta de baixo/esquerda) a +1 (ponta de cima/direita).
      const posicao = unison === 1 ? 0 : (c / (unison - 1)) * 2 - 1;
      const freq = frequencia * Math.pow(2, (posicao * detune * DETUNE_MAXIMO) / 12);
      const passo = freq / this.taxa;
      this.agudaDemais[c] = passo > FREQUENCIA_MAXIMA ? 1 : 0;
      this.passos[c] = Math.min(passo, FREQUENCIA_MAXIMA); // a leitura da onda nunca "pula" um ciclo
      escolherNiveis(tabela.harmonicos, freq, this.taxa, this.escolha);
      this.niveis[c] = this.escolha.nivel;
      this.niveisB[c] = this.escolha.nivelB;
      this.misturas[c] = this.escolha.mistura;
      // Estéreo "de potência igual": no centro, os dois lados com o mesmo volume.
      const lugar = Math.min(1, Math.max(-1, posicao * width + pan));
      const angulo = ((1 + lugar) * Math.PI) / 4;
      this.ganhosE[c] = Math.cos(angulo) * Math.SQRT2;
      this.ganhosD[c] = Math.sin(angulo) * Math.SQRT2;
    }
  }

  // Volumes das cópias "do meio" e "de fora" do unison, para este Blend (0 a 1).
  calcularVolumes(unison, blend) {
    const qtdMeio = Math.min(unison, unison % 2 === 1 ? 1 : 2);
    const qtdFora = unison - qtdMeio;
    this.volumeMeio = 1 / Math.sqrt(qtdMeio + qtdFora * blend * blend);
    this.volumeFora = blend * this.volumeMeio;
  }

  // Volume de uma cópia (0 se ela está acima do Unison atual ou aguda demais).
  volumeDaCopia(c, unison) {
    if (c >= unison || this.agudaDemais[c]) return 0;
    return Math.abs(c - (unison - 1) / 2) <= 0.5 ? this.volumeMeio : this.volumeFora;
  }

  // Afinação deste pedaço, em semitons: Oct × 12 + Semi + Fine / 100, com a modulação.
  // A modulação anda na faixa de cada controle (como nos knobs): 100% = a faixa toda
  // (Oct: 6 oitavas, Semi: 24 semitons, Fine: 200 centésimos).
  // Oct e Semi andam em DEGRAUS (arredondados: saltos de nota inteira, bom para arpejos
  // e trills); Fine é contínuo (vibrato). A onda continua de onde estava: sem estalo.
  afinacao(ajustes, mod) {
    const { oitava, semi, fine } = ajustes;
    const mOitava = mod[this.destinos.oitava];
    const mSemi = mod[this.destinos.semi];
    const mFine = mod[this.destinos.fine];
    if (mOitava === 0 && mSemi === 0 && mFine === 0) return oitava * 12 + semi + fine / 100;
    const o = Math.min(3, Math.max(-3, Math.round(oitava + mOitava * 6)));
    const s = Math.min(12, Math.max(-12, Math.round(semi + mSemi * 24)));
    const f = Math.min(100, Math.max(-100, fine + mFine * 200));
    return o * 12 + s + f / 100;
  }

  // Calcula um pedaço (amostras "inicio" até "fim") e soma em somaE/somaD.
  // ajustes: { tabela, posicoesWT, unison, detune, width, ligado, nivel, ganho, oitava, semi,
  //            fine, pan, blend, fase, rand }
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

    // Cópias de unison com Detune/Width modulados, na altura da nota + afinação do oscilador
    const transposicao = this.afinacao(ajustes, mod);
    this.ajustarCopias(
      transposicao === 0 ? frequencia : frequencia * Math.pow(2, transposicao / 12),
      unison,
      limitar01(ajustes.detune + mod[destinos.detune]),
      limitar01(ajustes.width + mod[destinos.width]),
      Math.min(1, Math.max(-1, ajustes.pan + mod[destinos.pan] * 2)), // faixa do Pan = 2 (de -1 a 1)
      tabela
    );

    // Volume de cada cópia. Blend: as cópias "de fora" do unison tocam com Blend × o
    // volume das "do meio" (1 do meio se o Unison é ímpar, 2 se é par). Tudo junto soma
    // sempre a mesma potência, para o volume não mudar ao mexer no Unison ou no Blend.
    // Blend 100% = todas iguais (1/√N cada), como antes.
    this.calcularVolumes(unison, limitar01(ajustes.blend + mod[destinos.blend]));
    if (this.volumesDireto) {
      for (let c = 0; c < MAX_UNISON; c++) this.volumes[c] = this.volumeDaCopia(c, unison);
      this.volumesDireto = false;
    }
    // Cópias acima do Unison atual continuam só até sumirem (se o Unison diminuiu).
    let qtdCopias = unison;
    for (let c = unison; c < MAX_UNISON; c++) if (this.volumes[c] > 1e-5) qtdCopias = c + 1;

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
      // Cópia aguda demais (acima do limite) vai a zero.
      const alvo = this.volumeDaCopia(c, unison);
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
