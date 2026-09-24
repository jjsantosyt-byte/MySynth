// dsp/efeitos/distorcao.js
// Distorção (saturação) com 3 tipos:
//   suave   = arredonda os picos (quente, tipo fita)
//   dura    = corta os picos (agressiva)
//   valvula = assimétrica, como amplificador valvulado (cria harmônicos pares)
//
// - Drive: quanto o som é "empurrado" para a saturação.
// - Sem aliasing: distorcer cria harmônicos novos, que podem passar do limite
//   do áudio digital e voltar como chiado. Duas técnicas juntas evitam isso:
//   1) a distorção trabalha com o DOBRO da taxa de amostragem (sobe, distorce,
//      filtra e volta);
//   2) "ADAA": em vez de aplicar a curva ponto a ponto, usa a média da curva
//      entre uma amostra e a seguinte (calculada com a "integral" da curva).
//      Isso corta boa parte dos harmônicos que virariam chiado.
// - A Válvula é assimétrica e empurraria a onda para um lado; um filtro tira
//   esse desvio (abaixo de ~10 Hz, inaudível).
// - Volume compensado: aumentar o Drive muda o timbre, mas não explode o volume.
// - O som original (Mix) é atrasado na mesma medida que o distorcido, para os
//   dois ficarem alinhados quando misturados. Esse atraso (~0,3 ms, inaudível)
//   fica SEMPRE ligado: se ele sumisse ao desligar, o som daria um pulinho (estalo).

import { ganhosMix } from './delay.js';
import { TAPS, MEIO, filtrarMeiaBanda } from '../meia-banda.js';

export const TIPOS_DISTORCAO = ['suave', 'dura', 'valvula'];

// ---------- Filtro "meia-banda" (para subir e descer a taxa): ver dsp/meia-banda.js ----------
// Atraso total (subir + descer) na taxa original, em amostras
export const ATRASO_DISTORCAO = MEIO; // (15 + 15 na taxa dobrada) / 2

// ---------- As curvas de saturação ----------
const VALVULA_DESVIO = 0.3;
const TANH_DESVIO = Math.tanh(VALVULA_DESVIO);

// A curva em si
function saturar(tipo, x) {
  switch (tipo) {
    case 'dura':
      // Corta os picos em ±1
      return x > 1 ? 1 : x < -1 ? -1 : x;
    case 'valvula':
      // Assimétrica: o lado positivo satura antes do negativo
      return Math.tanh(x + VALVULA_DESVIO) - TANH_DESVIO;
    default:
      return Math.tanh(x);
  }
}

// ln(cosh(x)) sem estourar para valores grandes
function logCosh(x) {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
}

// "Integral" de cada curva (usada pelo ADAA)
function integral(tipo, x) {
  switch (tipo) {
    case 'dura': {
      const a = Math.abs(x);
      return a <= 1 ? 0.5 * x * x : a - 0.5;
    }
    case 'valvula':
      return logCosh(x + VALVULA_DESVIO) - TANH_DESVIO * x;
    default:
      return logCosh(x);
  }
}

// ADAA: média da curva entre a amostra anterior (xa) e a atual (x).
// "Fx" e "Fxa" são as integrais já calculadas (a anterior vem guardada da volta passada).
function saturarADAA(tipo, x, xa, Fx, Fxa) {
  const dx = x - xa;
  if (Math.abs(dx) < 1e-5) return saturar(tipo, 0.5 * (x + xa)); // quase iguais: usa o meio
  return (Fx - Fxa) / dx;
}

// Drive (0 a 1) → quanto o sinal é multiplicado antes de saturar (1x a ~30x).
function ganhoDoDrive(drive) {
  return 1 + 29 * drive * drive;
}

// Um lado (esquerdo ou direito): sobe a taxa, satura, filtra e desce.
class Canal {
  constructor(taxaAmostragem) {
    this.hSubir = new Float64Array(TAPS); // histórico na taxa dobrada (subida)
    this.hDescer = new Float64Array(TAPS); // histórico na taxa dobrada (descida)
    this.pSubir = 0;
    this.pDescer = 0;
    this.anterior = 0; // amostra anterior (para o ADAA)
    this.integralAnterior = 0; // e a integral dela (guardada para não recalcular)
    this.tipoAnterior = 'suave';
    // Tira o desvio (DC) que a Válvula cria: passa-altas de ~10 Hz
    this.coefDesvio = 1 - Math.exp((-2 * Math.PI * 10) / taxaAmostragem);
    this.desvio = 0;
  }

  limpar() {
    this.hSubir.fill(0);
    this.hDescer.fill(0);
    this.anterior = 0;
    this.integralAnterior = 0;
    this.desvio = 0;
  }

  // Filtra o histórico circular "h" (posição "p" = amostra mais nova).
  filtrar(h, p) {
    return filtrarMeiaBanda(h, p);
  }

  processar(x, tipo, ganho, compensacao) {
    // Subir: amostra, zero, amostra, zero... (×2 para manter o volume) e filtra
    let saida = 0;
    for (let fase = 0; fase < 2; fase++) {
      this.pSubir = this.pSubir + 1 === TAPS ? 0 : this.pSubir + 1;
      this.hSubir[this.pSubir] = fase === 0 ? 2 * x : 0;
      const alto = this.filtrar(this.hSubir, this.pSubir);

      // Satura na taxa dobrada (com ADAA)
      const empurrado = alto * ganho;
      if (tipo !== this.tipoAnterior) {
        // Trocou de tipo: a integral guardada era da outra curva
        this.integralAnterior = integral(tipo, this.anterior);
        this.tipoAnterior = tipo;
      }
      const integralAtual = integral(tipo, empurrado);
      const saturado =
        saturarADAA(tipo, empurrado, this.anterior, integralAtual, this.integralAnterior) * compensacao;
      this.anterior = empurrado;
      this.integralAnterior = integralAtual;

      // Descer: filtra e fica com uma de cada duas amostras
      this.pDescer = this.pDescer + 1 === TAPS ? 0 : this.pDescer + 1;
      this.hDescer[this.pDescer] = saturado;
      if (fase === 1) saida = this.filtrar(this.hDescer, this.pDescer);
    }
    // Tira o desvio (DC)
    this.desvio += (saida - this.desvio) * this.coefDesvio;
    return saida - this.desvio;
  }
}

export class Distorcao {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.esquerdo = new Canal(taxaAmostragem);
    this.direito = new Canal(taxaAmostragem);

    // Atraso do som original, para alinhar com o distorcido
    this.secoE = new Float64Array(ATRASO_DISTORCAO + 1);
    this.secoD = new Float64Array(ATRASO_DISTORCAO + 1);
    this.pSeco = 0;

    this.ajustes = { ligado: false, tipo: 'suave', drive: 0.4, mix: 1 };
    this.ganho = ganhoDoDrive(0.4);
    this.seco = 1;
    this.molhado = 0;
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
    const mix = ganhosMix(a.mix);
    const alvoSeco = a.ligado ? mix.seco : 1;
    const alvoMolhado = a.ligado ? mix.molhado : 0;
    const alvoGanho = ganhoDoDrive(a.drive);
    const s = this.suavizar;

    for (let i = 0; i < tamanhoBloco; i++) {
      this.seco += (alvoSeco - this.seco) * s;
      this.molhado += (alvoMolhado - this.molhado) * s;
      this.ganho += (alvoGanho - this.ganho) * s;
      // Compensação: um sinal de 0,5 sai com 0,5 em qualquer Drive.
      // A Válvula (assimétrica) soa mais alta com a mesma conta: leva um desconto.
      const desconto = a.tipo === 'valvula' ? 0.7 : 1;
      const compensacao = (desconto * 0.5) / Math.abs(saturar(a.tipo, 0.5 * this.ganho) || 1);

      const distE = this.esquerdo.processar(saidaE[i], a.tipo, this.ganho, compensacao);
      const distD = this.direito.processar(saidaD[i], a.tipo, this.ganho, compensacao);

      // Som original atrasado na mesma medida
      this.secoE[this.pSeco] = saidaE[i];
      this.secoD[this.pSeco] = saidaD[i];
      this.pSeco = this.pSeco + 1 === n ? 0 : this.pSeco + 1;
      const originalE = this.secoE[this.pSeco];
      const originalD = this.secoD[this.pSeco];

      saidaE[i] = originalE * this.seco + distE * this.molhado;
      saidaD[i] = originalD * this.seco + distD * this.molhado;
    }

    // Desligado e já sem distorção na mistura: dorme (o atraso do original continua).
    if (!a.ligado && this.molhado < 1e-4 && Math.abs(this.seco - 1) < 1e-4) {
      this.dormindo = true;
      this.esquerdo.limpar();
      this.direito.limpar();
      this.seco = 1;
      this.molhado = 0;
    }
  }
}
