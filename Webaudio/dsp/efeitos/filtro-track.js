// dsp/efeitos/filtro-track.js
// Filtro Track: um filtro de EFEITO (no som já somado de todas as notas) cujo Cutoff pode
// acompanhar a nota tocada ("keytracking"). Os filtros das vozes (Filtro 1 e 2) não mudam.
//
// - Cutoff em NOTAS (número MIDI: 60 = C4, 69 = A4 = 440 Hz), de C1 a C10.
// - Track (0 a 1): quanto o cutoff acompanha a nota de referência.
//     cutoff final = Cutoff + Track × (nota de referência − C4)
//   Track 100%: tocando uma oitava acima, o filtro sobe uma oitava (o timbre fica igual em
//   todas as notas). Track 0%: filtro parado no Cutoff.
// - Nota de referência: a ÚLTIMA nota tocada (com Glide, escorrega junto). Num acorde, é a
//   nota mais recente (os efeitos recebem o som já somado: não dá para seguir cada nota).
// - Tipos LP 12, LP 24, HP, BP e Reso: o mesmo filtro das vozes (dsp/filtro.js), com a mesma
//   troca suave de tipo.
// - Mix: 0 = só o original, 100% = só o filtrado.
// - Ao trocar de nota, o cutoff anda até a nova em ~5 ms (sem "degrau").

import { Filtro, CoeficientesFiltro } from '../filtro.js';
import { ganhosCruzados } from './phaser.js';

export const NOTA_MINIMA_TRACK = 24; // C1 (~33 Hz)
export const NOTA_MAXIMA_TRACK = 132; // C10 (~16,7 kHz)
const NOTA_CENTRO = 60; // C4: nesta nota, o Track não muda nada

const notaParaHz = (nota) => 440 * Math.pow(2, (nota - 69) / 12);

export class FiltroTrack {
  constructor(taxaAmostragem, tamanhoBloco = 128) {
    this.taxa = taxaAmostragem;
    this.ajustes = { ligado: false, tipo: 'lp24', nota: 72, track: 1, reso: 0.2, mix: 1 };
    this.notaReferencia = NOTA_CENTRO; // o motor atualiza a cada bloco (última nota tocada)

    this.coef = new CoeficientesFiltro(taxaAmostragem);
    this.esquerdo = new Filtro(taxaAmostragem);
    this.direito = new Filtro(taxaAmostragem);
    for (const f of [this.esquerdo, this.direito]) {
      f.definirLigado(true); // a mistura com o original é feita aqui (Mix)
      f.definirTipo('lp24');
      f.reiniciar();
    }
    this.tipoAtual = 'lp24';

    this.cortes = new Float32Array(tamanhoBloco); // cutoff de cada amostra (quando anda)
    this.corteUnico = new Float32Array(1);
    this.resos = new Float32Array(1);
    this.notaAtual = null; // cutoff atual, em notas (anda suave até o alvo)
    this.resoAtual = 0.2;
    this.seco = 1;
    this.molhado = 0;
    this.suavizar = 1 - Math.exp(-1 / (0.005 * taxaAmostragem)); // ~5 ms
    this.suavizarMix = 1 - Math.exp(-1 / (0.01 * taxaAmostragem)); // ~10 ms
    this.dormindo = true;
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.tipo !== this.tipoAtual) {
      this.esquerdo.definirTipo(this.ajustes.tipo);
      this.direito.definirTipo(this.ajustes.tipo);
      this.tipoAtual = this.ajustes.tipo;
    }
    if (this.ajustes.ligado) this.dormindo = false;
  }

  // Cutoff (em notas) para o ajuste atual e a nota de referência
  notaAlvo() {
    const a = this.ajustes;
    const nota = a.nota + Math.min(1, Math.max(0, a.track)) * (this.notaReferencia - NOTA_CENTRO);
    return Math.min(NOTA_MAXIMA_TRACK + 12, Math.max(NOTA_MINIMA_TRACK - 12, nota));
  }

  processar(saidaE, saidaD, tamanhoBloco) {
    if (this.dormindo) return;

    const a = this.ajustes;
    const mix = ganhosCruzados(a.mix);
    const alvoSeco = a.ligado ? mix.seco : 1;
    const alvoMolhado = a.ligado ? mix.molhado : 0;

    // Cutoff deste bloco: parado (um valor só) ou andando (um por amostra)
    const alvo = this.notaAlvo();
    if (this.notaAtual === null) this.notaAtual = alvo; // acordando: já no lugar certo
    let cortes;
    if (Math.abs(alvo - this.notaAtual) < 1e-3) {
      this.notaAtual = alvo;
      this.corteUnico[0] = notaParaHz(alvo);
      cortes = this.corteUnico;
    } else {
      const s = this.suavizar;
      for (let i = 0; i < tamanhoBloco; i++) {
        this.notaAtual += (alvo - this.notaAtual) * s;
        this.cortes[i] = notaParaHz(this.notaAtual);
      }
      cortes = this.cortes;
    }
    // Reso anda suave de um bloco para o outro (girar o knob não dá "degraus")
    this.resoAtual += (Math.min(1, Math.max(0, a.reso)) - this.resoAtual) * 0.3;
    this.resos[0] = this.resoAtual;
    this.coef.calcular(cortes, this.resos, tamanhoBloco);

    const c = this.coef;
    const variavel = c.variavel;
    const sm = this.suavizarMix;
    for (let i = 0; i < tamanhoBloco; i++) {
      this.seco += (alvoSeco - this.seco) * sm;
      this.molhado += (alvoMolhado - this.molhado) * sm;
      const j = variavel ? i : 0;
      const e = saidaE[i];
      const d = saidaD[i];
      saidaE[i] = e * this.seco + this.esquerdo.processar(e, c, j) * this.molhado;
      saidaD[i] = d * this.seco + this.direito.processar(d, c, j) * this.molhado;
    }

    // Desligado e já sem filtro na mistura: dorme (e começa limpo na próxima vez)
    if (!a.ligado && this.molhado < 1e-4 && Math.abs(this.seco - 1) < 1e-4) {
      this.dormindo = true;
      this.esquerdo.reiniciar();
      this.direito.reiniciar();
      this.seco = 1;
      this.molhado = 0;
      this.notaAtual = null;
    }
  }
}
