// dsp/efeitos/compressor.js
// Compressor: quando o som passa do Threshold, o volume é abaixado na proporção do Ratio.
// Deixa o som mais "colado" e constante (e com punch, com Attack lento).
//
// - Threshold: a partir de que volume começa a comprimir (-40 a 0 dB).
// - Ratio: quanto comprime (2:1 = o que passa do limite sobe só metade; 20:1 = quase limita).
// - Attack: quanto tempo leva para abaixar (curto = segura tudo; longo = deixa o ataque passar).
// - Release: quanto tempo leva para soltar.
// - Ganho: volume depois de comprimir. O compressor já compensa sozinho uma parte (o volume
//   perdido pela compressão, estimado pelo Threshold e Ratio); o Ganho ajusta a partir daí.
// - Mix: mistura com o som original (compressão "paralela": encorpa sem achatar).
//
// Os dois lados são comprimidos juntos (mesma redução: o estéreo não "anda").
// Joelho suave de 6 dB: a compressão começa aos poucos em volta do Threshold.

import { ganhosMix } from './delay.js';

const JOELHO = 6; // dB

const paraDb = (x) => 20 * Math.log10(x + 1e-12);
const deDb = (db) => Math.pow(10, db / 20);

// Quanto abaixar (dB, positivo) para um nível de entrada "nivelDb"
function reducaoEstatica(nivelDb, threshold, ratio) {
  const acima = nivelDb - threshold;
  const inclinacao = 1 - 1 / ratio;
  if (acima <= -JOELHO / 2) return 0;
  if (acima >= JOELHO / 2) return acima * inclinacao;
  // Dentro do joelho: entra aos poucos (curva suave)
  const x = acima + JOELHO / 2;
  return (inclinacao * x * x) / (2 * JOELHO);
}

export class Compressor {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.ajustes = { ligado: false, threshold: -18, ratio: 4, attack: 0.01, release: 0.15, ganho: 0, mix: 1 };
    this.reducao = 0; // dB que está abaixando agora (suavizado pelo Attack/Release)
    this.maiorReducao = 0; // maior redução desde a última leitura (para o medidor da tela)
    this.seco = 1;
    this.molhado = 0;
    this.compensacao = null; // volume de compensação em uso (null = ainda não começou)
    this.suavizar = 1 - Math.exp(-1 / (0.01 * taxaAmostragem));
    this.dormindo = true;
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.ligado) this.dormindo = false;
  }

  // Maior redução (dB) desde a última vez que a tela perguntou (e zera)
  lerReducao() {
    const r = this.maiorReducao;
    this.maiorReducao = 0;
    return r;
  }

  processar(saidaE, saidaD, tamanhoBloco) {
    if (this.dormindo) return;

    const a = this.ajustes;
    const mix = ganhosMix(a.mix);
    const alvoSeco = a.ligado ? mix.seco : 1;
    const alvoMolhado = a.ligado ? mix.molhado : 0;
    const threshold = Math.min(0, Math.max(-60, a.threshold));
    const ratio = Math.max(1, a.ratio);
    const coefAtaque = 1 - Math.exp(-1 / (Math.max(0.0001, a.attack) * this.taxa));
    const coefSoltura = 1 - Math.exp(-1 / (Math.max(0.005, a.release) * this.taxa));
    // Compensação automática: metade do que um som em 0 dB perderia, + o Ganho escolhido
    // (anda suave, ~10 ms: girar/modular Threshold, Ratio ou Ganho não dá degrau no volume;
    // ao acordar, já começa no valor certo)
    const alvoCompensacao = deDb(reducaoEstatica(0, threshold, ratio) * 0.5 + a.ganho);
    if (this.compensacao === null) this.compensacao = alvoCompensacao;
    const s = this.suavizar;
    let maior = this.maiorReducao;

    for (let i = 0; i < tamanhoBloco; i++) {
      this.seco += (alvoSeco - this.seco) * s;
      this.molhado += (alvoMolhado - this.molhado) * s;

      const e = saidaE[i];
      const d = saidaD[i];
      const nivel = Math.max(Math.abs(e), Math.abs(d));
      const alvo = reducaoEstatica(paraDb(nivel), threshold, ratio);
      // Abaixar = Attack; soltar = Release
      this.reducao += (alvo - this.reducao) * (alvo > this.reducao ? coefAtaque : coefSoltura);
      if (this.reducao > maior) maior = this.reducao;

      if (this.compensacao !== alvoCompensacao) {
        this.compensacao += (alvoCompensacao - this.compensacao) * s;
        if (Math.abs(this.compensacao - alvoCompensacao) < 1e-7) this.compensacao = alvoCompensacao;
      }
      const ganho = deDb(-this.reducao) * this.compensacao * this.molhado;
      saidaE[i] = e * this.seco + e * ganho;
      saidaD[i] = d * this.seco + d * ganho;
    }
    this.maiorReducao = maior;

    // Desligado e já sem compressão na mistura: dorme
    if (!a.ligado && this.molhado < 1e-4 && Math.abs(this.seco - 1) < 1e-4) {
      this.dormindo = true;
      this.seco = 1;
      this.molhado = 0;
      this.reducao = 0;
      this.compensacao = null;
    }
  }
}
