// dsp/efeitos/reverb.js
// Reverb (ambiente) do tipo "rede de linhas de atraso com realimentação" (FDN):
// 8 ecos muito curtos que se misturam entre si e vão perdendo força e agudo,
// como o som batendo nas paredes de uma sala.
//
// - Tamanho: quanto tempo o som leva para sumir (de ~0,3 s a ~8 s).
// - Brilho: quanto agudo sobra na cauda (baixo = sala abafada, alto = sala clara).
// - Antes das 8 linhas, 4 "difusores" espalham o som, para a cauda ficar lisa
//   (sem aquele som metálico de "mola").
// - Low Cut: os graves abaixo dele não entram no reverb (deixam o som embolado). Padrão 120 Hz.
// - Pre-delay: espera antes de o reverb começar (0 a 200 ms): separa o som da "sala".
// - Width: abertura da cauda no estéreo (0 = no meio, 100% = bem aberto).
// - Desligar: para de entrar som novo e a cauda termina naturalmente.

import { ganhosMix } from './delay.js';
import { coefPolo, aplicarWidth } from './comum.js';

const PRE_DELAY_MAXIMO = 0.2; // segundos

// Tempos das 8 linhas (ms): valores "quebrados", que não se repetem em
// múltiplos, para os ecos não se somarem num tom só.
const TEMPOS_LINHAS_MS = [29.7, 37.1, 41.1, 43.7, 47.3, 53.1, 59.3, 67.1];
// Difusores (ms) e quanto espalham
const TEMPOS_DIFUSORES_MS = [4.77, 3.59, 12.73, 9.31];
const GANHO_DIFUSOR = 0.6;

const RT_MIN = 0.3; // segundos (Tamanho 0%)
const RT_MAX = 8; // segundos (Tamanho 100%)
const BRILHO_MIN = 1500; // Hz (Brilho 0%)
const BRILHO_MAX = 16000; // Hz (Brilho 100%)
const ESCALA_SAIDA = 0.35;

// Tempo que a cauda leva para sumir (-60 dB), para o Tamanho de 0 a 1.
export function tempoDoTamanho(tamanho) {
  return RT_MIN * Math.pow(RT_MAX / RT_MIN, tamanho);
}

// Mistura rápida das 8 linhas (matriz de Hadamard): cada linha recebe um
// pouco de todas, sem aumentar nem diminuir a energia total.
function misturar8(v) {
  for (let h = 1; h < 8; h *= 2) {
    for (let i = 0; i < 8; i += h * 2) {
      for (let j = i; j < i + h; j++) {
        const x = v[j];
        const y = v[j + h];
        v[j] = x + y;
        v[j + h] = x - y;
      }
    }
  }
  const escala = 1 / Math.sqrt(8);
  for (let j = 0; j < 8; j++) v[j] *= escala;
}

export class Reverb {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    const amostras = (ms) => Math.max(1, Math.round((ms / 1000) * taxaAmostragem));

    this.linhas = TEMPOS_LINHAS_MS.map((ms) => new Float32Array(amostras(ms)));
    this.posLinhas = new Int32Array(8);
    this.ganhos = new Float64Array(8); // perda a cada volta (define o Tamanho)
    this.baixas = new Float64Array(8); // abafamento de agudo em cada linha
    this.v = new Float64Array(8); // rascunho

    this.difusores = TEMPOS_DIFUSORES_MS.map((ms) => new Float32Array(amostras(ms)));
    this.posDifusores = new Int32Array(4);

    // Tira os graves da entrada (Low Cut, padrão 120 Hz)
    this.coefGrave = coefPolo(120, taxaAmostragem);
    this.lowcutCalculado = 120;
    this.graveEntrada = 0;

    // Pre-delay: memória da entrada (até 200 ms)
    this.pre = new Float32Array(Math.ceil(PRE_DELAY_MAXIMO * taxaAmostragem) + 2);
    this.posPre = 0;
    this.par = [0, 0]; // rascunho do Width

    this.ajustes = { ligado: false, tamanho: 0.5, brilho: 0.6, mix: 0.3, predelay: 0, lowcut: 120, width: 1 };
    this.entrada = 0;
    this.seco = 1;
    this.molhado = 0;
    this.suavizar = 1 - Math.exp(-1 / (0.01 * taxaAmostragem));
    this.tamanhoCalculado = -1;
    this.brilhoCalculado = -1;
    this.silencio = 0;
    this.dormindo = true;
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.ligado) this.dormindo = false;
  }

  // Recalcula perdas e abafamento só quando Tamanho/Brilho mudam.
  atualizarCoeficientes() {
    const { tamanho, brilho } = this.ajustes;
    if (tamanho !== this.tamanhoCalculado) {
      const rt = tempoDoTamanho(tamanho);
      this.linhas.forEach((linha, k) => {
        // Cada linha perde o necessário para chegar a -60 dB no tempo "rt".
        this.ganhos[k] = Math.pow(10, (-3 * linha.length) / (rt * this.taxa));
      });
      this.tamanhoCalculado = tamanho;
    }
    if (brilho !== this.brilhoCalculado) {
      const fc = BRILHO_MIN * Math.pow(BRILHO_MAX / BRILHO_MIN, brilho);
      this.coefBrilho = 1 - Math.exp((-2 * Math.PI * Math.min(fc, 0.45 * this.taxa)) / this.taxa);
      this.brilhoCalculado = brilho;
    }
    if (this.ajustes.lowcut !== this.lowcutCalculado) {
      this.coefGrave = coefPolo(this.ajustes.lowcut, this.taxa);
      this.lowcutCalculado = this.ajustes.lowcut;
    }
  }

  // Aplica o reverb nas saídas (esquerda e direita), no lugar.
  processar(saidaE, saidaD, tamanhoBloco) {
    if (this.dormindo) return;
    this.atualizarCoeficientes();

    const a = this.ajustes;
    const alvoEntrada = a.ligado ? 1 : 0;
    const mix = ganhosMix(a.mix);
    const alvoSeco = a.ligado ? mix.seco : 1;
    const alvoMolhado = mix.molhado;
    const s = this.suavizar;
    const cb = this.coefBrilho;
    const v = this.v;
    const atrasoPre = Math.round(Math.min(PRE_DELAY_MAXIMO, Math.max(0, a.predelay)) * this.taxa);
    const tamanhoPre = this.pre.length;
    const width = Math.min(1, Math.max(0, a.width));
    const par = this.par;
    let energia = 0;

    for (let i = 0; i < tamanhoBloco; i++) {
      this.entrada += (alvoEntrada - this.entrada) * s;
      this.seco += (alvoSeco - this.seco) * s;
      this.molhado += (alvoMolhado - this.molhado) * s;

      // Entrada: soma dos dois lados, sem os graves muito baixos
      let x = (saidaE[i] + saidaD[i]) * 0.5 * this.entrada;
      this.graveEntrada += (x - this.graveEntrada) * this.coefGrave;
      x -= this.graveEntrada;

      // Pre-delay. A memória é gravada SEMPRE, mesmo com Pre-delay 0: se ela parasse, ao
      // subir o Pre-delay de novo o reverb receberia um som antigo guardado lá ("fantasma").
      this.pre[this.posPre] = x;
      if (atrasoPre > 0) {
        let leitura = this.posPre - atrasoPre;
        if (leitura < 0) leitura += tamanhoPre;
        x = this.pre[leitura];
      }
      this.posPre = this.posPre + 1 === tamanhoPre ? 0 : this.posPre + 1;

      // Difusores em série (espalham o som antes de entrar na sala)
      for (let d = 0; d < 4; d++) {
        const buffer = this.difusores[d];
        const p = this.posDifusores[d];
        const atrasado = buffer[p];
        const y = -GANHO_DIFUSOR * x + atrasado;
        buffer[p] = x + GANHO_DIFUSOR * y;
        this.posDifusores[d] = p + 1 === buffer.length ? 0 : p + 1;
        x = y;
      }

      // Lê as 8 linhas, perde força e agudo, e mistura todas entre si
      for (let k = 0; k < 8; k++) {
        const saidaLinha = this.linhas[k][this.posLinhas[k]] * this.ganhos[k];
        this.baixas[k] += (saidaLinha - this.baixas[k]) * cb;
        v[k] = this.baixas[k];
      }
      // Saída estéreo: linhas pares à esquerda, ímpares à direita
      let molhadoE = (v[0] - v[2] + v[4] - v[6]) * ESCALA_SAIDA;
      let molhadoD = (v[1] - v[3] + v[5] - v[7]) * ESCALA_SAIDA;
      // Width da cauda (100% = como veio: nem calcula)
      if (width < 1) {
        aplicarWidth(molhadoE, molhadoD, width, par);
        molhadoE = par[0];
        molhadoD = par[1];
      }

      misturar8(v);
      for (let k = 0; k < 8; k++) {
        const linha = this.linhas[k];
        const p = this.posLinhas[k];
        // Realimenta a mistura + injeta a entrada (sinais alternados)
        linha[p] = v[k] + (k & 1 ? x : -x);
        this.posLinhas[k] = p + 1 === linha.length ? 0 : p + 1;
      }

      saidaE[i] = saidaE[i] * this.seco + molhadoE * this.molhado;
      saidaD[i] = saidaD[i] * this.seco + molhadoD * this.molhado;
      energia += molhadoE * molhadoE + molhadoD * molhadoD;
    }

    // Desligado e cauda inaudível por um tempo: dorme e limpa a memória.
    this.silencio = energia / tamanhoBloco < 1e-10 ? this.silencio + tamanhoBloco : 0;
    if (!a.ligado && this.entrada < 1e-4 && this.silencio > 0.1 * this.taxa) {
      this.dormindo = true;
      for (const linha of this.linhas) linha.fill(0);
      for (const difusor of this.difusores) difusor.fill(0);
      this.baixas.fill(0);
      this.pre.fill(0);
      this.graveEntrada = 0;
      this.seco = 1;
    }
  }
}
