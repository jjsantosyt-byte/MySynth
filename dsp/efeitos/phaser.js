// dsp/efeitos/phaser.js
// Phaser: o som passa por 6 filtros "passa-tudo" (não mudam o volume, só atrasam um
// pouco cada frequência). Misturado com o original, isso cava "buracos" no som;
// um LFO faz os buracos subirem e descerem → o "vuuu-uuu" clássico.
//
// - Rate: velocidade do balanço (0,02 a 10 Hz).
// - Depth: quanto os buracos andam (100% = ±2 oitavas em volta da Freq).
// - Freq: centro do balanço (100 Hz a 4 kHz).
// - Feedback: parte da saída volta para a entrada (buracos mais fundos, som mais "cantado").
// - Stereo: diferença de balanço entre esquerda e direita (0 = iguais; 100% = opostos).
// - Mix: 50% = original e efeito iguais (buracos mais fundos); 100% = só o efeito.

const ETAPAS = 6;
const OITAVAS = 2; // Depth 100% = ±2 oitavas
const FEEDBACK_MAXIMO = 0.9;
const PASSO_COEF = 16; // recalcula os filtros a cada 16 amostras (e anda em linha reta entre eles)

// Mistura "em cruz": 0 = só original, 0,5 = metade/metade, 1 = só efeito.
// (Diferente do Delay/Reverb: aqui os buracos só aparecem com os dois em volumes iguais.)
// Devolve sempre o MESMO objeto (sem lixo na memória): quem chama lê os valores na hora.
const CRUZADOS = { seco: 1, molhado: 0 };
export function ganhosCruzados(mix) {
  const m = Math.min(1, Math.max(0, mix));
  CRUZADOS.seco = 1 - m;
  CRUZADOS.molhado = m;
  return CRUZADOS;
}

// Coeficiente do passa-tudo de 1ª ordem na frequência fc
function coefPassaTudo(fc, taxa) {
  const t = Math.tan((Math.PI * fc) / taxa);
  return (t - 1) / (t + 1);
}

export class Phaser {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.ajustes = { ligado: false, rate: 0.5, depth: 0.7, freq: 800, feedback: 0.5, stereo: 0.5, mix: 0.5 };
    this.memE = new Float64Array(ETAPAS);
    this.memD = new Float64Array(ETAPAS);
    this.voltaE = 0; // Feedback: a saída anterior de cada lado
    this.voltaD = 0;
    this.fase = 0; // do LFO (0 a 1)
    // coeficiente atual e o passo até o próximo (um por lado)
    this.coefE = 0;
    this.coefD = 0;
    this.passoE = 0;
    this.passoD = 0;
    this.contador = 0;
    this.acordou = true; // primeira vez depois de dormir: começa com os coeficientes certos
    this.seco = 1;
    this.molhado = 0;
    this.feedback = 0.5;
    this.suavizar = 1 - Math.exp(-1 / (0.01 * taxaAmostragem)); // ~10 ms
    this.dormindo = true;
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.ligado) this.dormindo = false;
  }

  // Coeficiente de um lado na fase "fase" do LFO
  coefNaFase(fase) {
    const a = this.ajustes;
    const oitavas = OITAVAS * Math.min(1, Math.max(0, a.depth)) * Math.sin(2 * Math.PI * fase);
    const fc = Math.min(0.45 * this.taxa, Math.max(20, a.freq * Math.pow(2, oitavas)));
    return coefPassaTudo(fc, this.taxa);
  }

  // Prepara os próximos 16 amostras: de onde o coeficiente está até o novo alvo
  proximosCoeficientes() {
    const deslocamento = 0.5 * Math.min(1, Math.max(0, this.ajustes.stereo)); // 100% = meio ciclo
    const faseAlvo = this.fase + (this.ajustes.rate / this.taxa) * PASSO_COEF;
    this.passoE = (this.coefNaFase(faseAlvo) - this.coefE) / PASSO_COEF;
    this.passoD = (this.coefNaFase(faseAlvo + deslocamento) - this.coefD) / PASSO_COEF;
  }

  // Efeito "parado" no silêncio (o motor nem chama processar): o LFO continua andando,
  // para o balanço estar no mesmo ponto de sempre quando o som voltar.
  pular(tamanhoBloco) {
    this.fase = (this.fase + (this.ajustes.rate / this.taxa) * tamanhoBloco) % 1;
    this.acordou = true; // na volta, os filtros começam já na posição certa do LFO
  }

  processar(saidaE, saidaD, tamanhoBloco) {
    if (this.dormindo) return;

    const a = this.ajustes;
    const mix = ganhosCruzados(a.mix);
    const alvoSeco = a.ligado ? mix.seco : 1;
    const alvoMolhado = a.ligado ? mix.molhado : 0;
    const alvoFeedback = Math.min(FEEDBACK_MAXIMO, Math.max(0, a.feedback));
    const s = this.suavizar;
    const passoFase = a.rate / this.taxa;
    const memE = this.memE;
    const memD = this.memD;

    if (this.acordou) {
      // Primeira vez acordado: começa já com os coeficientes certos (sem "varrida" inicial)
      this.acordou = false;
      this.contador = 0;
      this.coefE = this.coefNaFase(this.fase);
      this.coefD = this.coefNaFase(this.fase + 0.5 * Math.min(1, Math.max(0, a.stereo)));
    }

    for (let i = 0; i < tamanhoBloco; i++) {
      if (this.contador === 0) this.proximosCoeficientes();
      this.contador = this.contador + 1 === PASSO_COEF ? 0 : this.contador + 1;

      this.seco += (alvoSeco - this.seco) * s;
      this.molhado += (alvoMolhado - this.molhado) * s;
      this.feedback += (alvoFeedback - this.feedback) * s;
      this.coefE += this.passoE;
      this.coefD += this.passoD;
      const fb = this.feedback;

      // 6 passa-tudo em série, cada lado com o seu coeficiente
      let e = saidaE[i] + fb * this.voltaE;
      let d = saidaD[i] + fb * this.voltaD;
      const cE = this.coefE;
      const cD = this.coefD;
      for (let k = 0; k < ETAPAS; k++) {
        const yE = cE * e + memE[k];
        memE[k] = e - cE * yE;
        e = yE;
        const yD = cD * d + memD[k];
        memD[k] = d - cD * yD;
        d = yD;
      }
      this.voltaE = e;
      this.voltaD = d;

      // Com Feedback, o efeito ganha volume nos picos: compensa pela energia média
      const compensa = Math.sqrt(1 - fb * fb);
      saidaE[i] = saidaE[i] * this.seco + e * compensa * this.molhado;
      saidaD[i] = saidaD[i] * this.seco + d * compensa * this.molhado;

      this.fase += passoFase;
      if (this.fase >= 1) this.fase -= 1;
    }

    // Desligado e já sem efeito na mistura: dorme e limpa a memória
    if (!a.ligado && this.molhado < 1e-4 && Math.abs(this.seco - 1) < 1e-4) {
      this.dormindo = true;
      memE.fill(0);
      memD.fill(0);
      this.voltaE = 0;
      this.voltaD = 0;
      this.seco = 1;
      this.molhado = 0;
      this.acordou = true;
    }
  }
}
