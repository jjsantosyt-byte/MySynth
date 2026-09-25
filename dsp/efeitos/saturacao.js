// dsp/efeitos/saturacao.js
// Saturação: "esquenta" e encorpa o som sem virar distorção (bem mais suave que ela).
//
// Tipos (cada um com uma curva própria):
//   fita       — arredonda os picos aos poucos (curva cúbica): cola e amacia, como gravar
//                "quente" numa fita. Harmônicos ímpares suaves.
//   valvula    — assimétrica (o lado de cima satura antes): harmônicos pares, som "cheio".
//   transistor — um pouco mais firme (curva x/√(1+x²)): mais presença e brilho.
// Drive: quanto empurra (1× a 6×). Tom: 100% = aberto; menos = mais escuro (até ~1,5 kHz).
// Mix: mistura com o som original.
//
// Contra chiado (aliasing), igual à Distorção: conta em taxa DOBRADA (dsp/meia-banda.js) +
// ADAA (média da curva entre uma amostra e a seguinte). O volume é compensado para o som
// sair com volume parecido em qualquer Drive. O som original é atrasado na mesma medida
// (sempre, mesmo dormindo: ligar/desligar nunca dá "pulinho").

import { ganhosMix } from './delay.js';
import { TAPS, MEIO, filtrarMeiaBanda, Interpolador } from '../meia-banda.js';
import { coefPolo } from './comum.js';

export const TIPOS_SATURACAO = ['fita', 'valvula', 'transistor'];

const DESVIO_VALVULA = 0.25; // assimetria da válvula
const TANH_DESVIO = Math.tanh(DESVIO_VALVULA);
const TOM_ABERTO = 0.999;
const tomParaHz = (tom) => 1500 * Math.pow(20000 / 1500, tom);

// ln(cosh(x)) sem estourar para valores grandes
function logCosh(x) {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
}

// A curva de cada tipo
function curva(tipo, x) {
  switch (tipo) {
    case 'valvula':
      return Math.tanh(x + DESVIO_VALVULA) - TANH_DESVIO;
    case 'transistor':
      return x / Math.sqrt(1 + x * x);
    default: {
      // fita: x − x³/3 até ±1, depois fica em ±2/3 (arredondado, sem quina)
      if (x >= 1) return 2 / 3;
      if (x <= -1) return -2 / 3;
      return x - (x * x * x) / 3;
    }
  }
}

// "Integral" de cada curva (usada pelo ADAA)
function integral(tipo, x) {
  switch (tipo) {
    case 'valvula':
      return logCosh(x + DESVIO_VALVULA) - TANH_DESVIO * x;
    case 'transistor':
      return Math.sqrt(1 + x * x) - 1;
    default: {
      const a = Math.abs(x);
      if (a >= 1) return (2 / 3) * a - 0.25;
      return (x * x) / 2 - (x * x * x * x) / 12;
    }
  }
}

function curvaADAA(tipo, x, xa, Fx, Fxa) {
  const dx = x - xa;
  if (Math.abs(dx) < 1e-5) return curva(tipo, 0.5 * (x + xa));
  return (Fx - Fxa) / dx;
}

const ganhoDoDrive = (drive) => 1 + 5 * drive; // 1× a 6×

// Um lado: sobe a taxa, satura, filtra e desce
class Canal {
  constructor(taxaAmostragem) {
    this.subir = new Interpolador(); // sobe para a taxa dobrada
    this.altas = new Float64Array(2); // as 2 amostras na taxa dobrada
    this.hDescer = new Float64Array(TAPS);
    this.pDescer = 0;
    this.anterior = 0;
    this.integralAnterior = 0;
    this.tipoAnterior = 'fita';
    // Tira o desvio (DC) que a Válvula cria: passa-altas de ~10 Hz
    this.coefDesvio = 1 - Math.exp((-2 * Math.PI * 10) / taxaAmostragem);
    this.desvio = 0;
  }

  limpar() {
    this.subir.limpar();
    this.hDescer.fill(0);
    this.anterior = 0;
    this.integralAnterior = 0;
    this.desvio = 0;
  }

  processar(x, tipo, ganho, compensacao) {
    // Subir: 1 amostra vira 2 na taxa dobrada (ver Interpolador em dsp/meia-banda.js)
    this.subir.processar(x, this.altas);
    let saida = 0;
    for (let fase = 0; fase < 2; fase++) {
      const alto = this.altas[fase] * ganho;
      if (tipo !== this.tipoAnterior) {
        this.integralAnterior = integral(tipo, this.anterior);
        this.tipoAnterior = tipo;
      }
      const integralAtual = integral(tipo, alto);
      const saturado = curvaADAA(tipo, alto, this.anterior, integralAtual, this.integralAnterior) * compensacao;
      this.anterior = alto;
      this.integralAnterior = integralAtual;
      this.pDescer = this.pDescer + 1 === TAPS ? 0 : this.pDescer + 1;
      this.hDescer[this.pDescer] = saturado;
      if (fase === 1) saida = filtrarMeiaBanda(this.hDescer, this.pDescer);
    }
    this.desvio += (saida - this.desvio) * this.coefDesvio;
    return saida - this.desvio;
  }
}

export class Saturacao {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.esquerdo = new Canal(taxaAmostragem);
    this.direito = new Canal(taxaAmostragem);
    // Atraso do som original (para alinhar com o saturado)
    this.secoE = new Float64Array(MEIO + 1);
    this.secoD = new Float64Array(MEIO + 1);
    this.pSeco = 0;

    this.ajustes = { ligado: false, tipo: 'fita', drive: 0.3, tom: 1, mix: 1 };
    this.ganho = ganhoDoDrive(0.3);
    this.ganhoCompensado = -1; // ganho e tipo usados na última conta da compensação
    this.tipoCompensado = null;
    this.compensacao = 1;
    this.seco = 1;
    this.molhado = 0;
    this.tomE = 0;
    this.tomD = 0;
    this.suavizar = 1 - Math.exp(-1 / (0.01 * taxaAmostragem));
    this.dormindo = true;
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.ligado) this.dormindo = false;
  }

  processar(saidaE, saidaD, tamanhoBloco) {
    const n = this.secoE.length;
    if (this.dormindo) {
      // Dormindo: só o atraso do som original (barato), para nunca dar pulinho.
      for (let i = 0; i < tamanhoBloco; i++) {
        this.secoE[this.pSeco] = saidaE[i];
        this.secoD[this.pSeco] = saidaD[i];
        this.pSeco = this.pSeco + 1 === n ? 0 : this.pSeco + 1;
        saidaE[i] = this.secoE[this.pSeco];
        saidaD[i] = this.secoD[this.pSeco];
      }
      return;
    }

    const a = this.ajustes;
    const tipo = TIPOS_SATURACAO.includes(a.tipo) ? a.tipo : 'fita';
    const mix = ganhosMix(a.mix);
    const alvoSeco = a.ligado ? mix.seco : 1;
    const alvoMolhado = a.ligado ? mix.molhado : 0;
    const alvoGanho = ganhoDoDrive(a.drive);
    const s = this.suavizar;
    const comTom = a.tom < TOM_ABERTO;
    const cTom = comTom ? coefPolo(tomParaHz(a.tom), this.taxa) : 0;

    for (let i = 0; i < tamanhoBloco; i++) {
      this.seco += (alvoSeco - this.seco) * s;
      this.molhado += (alvoMolhado - this.molhado) * s;
      this.ganho += (alvoGanho - this.ganho) * s;
      // Compensação: um sinal de 0,5 sai com 0,5 em qualquer Drive
      // (Recalculada só quando o Drive ou o tipo mudam: com o knob parado, é sempre a mesma.)
      if (this.ganho !== this.ganhoCompensado || tipo !== this.tipoCompensado) {
        this.compensacao = 0.5 / Math.abs(curva(tipo, 0.5 * this.ganho) || 1);
        this.ganhoCompensado = this.ganho;
        this.tipoCompensado = tipo;
      }
      const compensacao = this.compensacao;

      let satE = this.esquerdo.processar(saidaE[i], tipo, this.ganho, compensacao);
      let satD = this.direito.processar(saidaD[i], tipo, this.ganho, compensacao);
      if (comTom) {
        this.tomE += (satE - this.tomE) * cTom;
        this.tomD += (satD - this.tomD) * cTom;
        satE = this.tomE;
        satD = this.tomD;
      } else {
        // Tom aberto: a memória acompanha o som, para fechar o Tom de novo sem tique
        this.tomE = satE;
        this.tomD = satD;
      }

      this.secoE[this.pSeco] = saidaE[i];
      this.secoD[this.pSeco] = saidaD[i];
      this.pSeco = this.pSeco + 1 === n ? 0 : this.pSeco + 1;
      saidaE[i] = this.secoE[this.pSeco] * this.seco + satE * this.molhado;
      saidaD[i] = this.secoD[this.pSeco] * this.seco + satD * this.molhado;
    }

    if (!a.ligado && this.molhado < 1e-4 && Math.abs(this.seco - 1) < 1e-4) {
      this.dormindo = true;
      this.esquerdo.limpar();
      this.direito.limpar();
      this.tomE = 0;
      this.tomD = 0;
      this.seco = 1;
      this.molhado = 0;
    }
  }
}
