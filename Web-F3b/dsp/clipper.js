// dsp/clipper.js
// Soft clipper da saída: o último passo do som (depois do volume geral).
// Garante que o som nunca passa de 0 dB, SEM abaixar o volume (não é um limitador):
// só a pontinha dos picos é arredondada, na hora, e o resto passa sem mudança nenhuma.
//
//   abaixo de -1 dB (0,89): passa igual (nem é mexido)
//   de -1 dB a 0 dB: curva suave (tanh) que chega perto de 1 sem nunca passar
//
// Contra chiado (aliasing), como a Saturação: a curva é aplicada em taxa DOBRADA
// (dsp/meia-banda.js) com ADAA. Detalhe: só a "correção" (o quanto a curva tira do pico) passa
// pelo caminho da taxa dobrada; o som em si segue direto (atrasado 15 amostras, 0,3 ms, para
// alinhar). Assim, quando nada chega perto de 0 dB, a saída é exatamente o som que entrou.
// No fim, uma trava de segurança em ±1 (os filtros podem passar um fio do limite).

import { TAPS, MEIO, filtrarMeiaBanda, Interpolador } from './meia-banda.js';

export const LIMIAR_CLIPPER = 0.891; // -1 dB: daqui para cima começa a arredondar
const K = 1 - LIMIAR_CLIPPER; // quanto "sobra" até o teto (1 = 0 dB)

// ln(cosh(x)) sem estourar para valores grandes
function logCosh(x) {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
}

// A curva: igual até o limiar; depois, limiar + K·tanh(excesso/K) (encosta em 1)
export function curvaClipper(x) {
  const a = Math.abs(x);
  if (a <= LIMIAR_CLIPPER) return x;
  const y = LIMIAR_CLIPPER + K * Math.tanh((a - LIMIAR_CLIPPER) / K);
  return x < 0 ? -y : y;
}

// "Integral" da curva (para o ADAA): x²/2 até o limiar, depois a da parte suave
function integral(x) {
  const a = Math.abs(x);
  if (a <= LIMIAR_CLIPPER) return 0.5 * a * a;
  return LIMIAR_CLIPPER * a + K * K * logCosh((a - LIMIAR_CLIPPER) / K) - 0.5 * LIMIAR_CLIPPER * LIMIAR_CLIPPER;
}

// Um lado (esquerdo ou direito)
class Canal {
  constructor() {
    this.subir = new Interpolador();
    this.altas = new Float64Array(2);
    this.hCorrecao = new Float64Array(TAPS); // a correção, na taxa dobrada
    this.pCorrecao = 0;
    this.naoZeros = 0; // quantas das últimas TAPS correções não são zero (0 = nem filtra)
    this.anterior = 0;
    this.integralAnterior = 0;
    this.seco = new Float64Array(MEIO + 1); // o som original, atrasado para alinhar
    this.pSeco = 0;
    this.maior = 0; // maior valor na taxa dobrada desde a última leitura (medidor)
  }

  // "mistura" = quanto da correção entra (1 = ligado, 0 = desligado; anda em rampa)
  processar(x, mistura) {
    this.subir.processar(x, this.altas);
    let correcao = 0;
    for (let fase = 0; fase < 2; fase++) {
      const u = this.altas[fase];
      const au = u < 0 ? -u : u;
      if (au > this.maior) this.maior = au;
      // Correção = (curva com ADAA) − (a mesma média sem curva). Na parte reta as duas são
      // iguais: a correção é exatamente 0.
      const Fu = integral(u);
      let e = 0;
      const ua = this.anterior;
      if (au > LIMIAR_CLIPPER || Math.abs(ua) > LIMIAR_CLIPPER) {
        const dx = u - ua;
        const media = Math.abs(dx) < 1e-6 ? curvaClipper(0.5 * (u + ua)) : (Fu - this.integralAnterior) / dx;
        e = media - 0.5 * (u + ua);
      }
      this.anterior = u;
      this.integralAnterior = Fu;

      this.pCorrecao = this.pCorrecao + 1 === TAPS ? 0 : this.pCorrecao + 1;
      // Conta quantas correções diferentes de zero estão no histórico
      if (this.hCorrecao[this.pCorrecao] !== 0) this.naoZeros--;
      this.hCorrecao[this.pCorrecao] = e;
      if (e !== 0) this.naoZeros++;
      if (fase === 1 && this.naoZeros > 0 && mistura > 0) correcao = filtrarMeiaBanda(this.hCorrecao, this.pCorrecao);
    }
    // Som original atrasado (15 amostras, o mesmo atraso do caminho em taxa dobrada)
    this.seco[this.pSeco] = x;
    this.pSeco = this.pSeco + 1 === this.seco.length ? 0 : this.pSeco + 1;
    const y = this.seco[this.pSeco] + correcao * mistura;
    // Trava de segurança em ±1 (acima disso a saída do aparelho cortaria do mesmo jeito)
    return y > 1 ? 1 : y < -1 ? -1 : y;
  }
}

export class Clipper {
  constructor(taxaAmostragem) {
    this.esquerdo = new Canal();
    this.direito = new Canal();
    // Hoje fica sempre ligado (decisão do dono: proteção fixa na saída). A chave continua aqui
    // para testes: desligar/ligar anda em rampa de ~10 ms (sem degrau).
    this.ligado = true;
    this.mistura = 1;
    this.suavizar = 1 - Math.exp(-1 / (0.01 * taxaAmostragem));
  }

  // Maior pico que chegou (antes de arredondar) desde a última leitura, e zera. Serve para a
  // tela mostrar quanto o clipper está arredondando.
  lerPico() {
    const pico = Math.max(this.esquerdo.maior, this.direito.maior);
    this.esquerdo.maior = 0;
    this.direito.maior = 0;
    return pico;
  }

  // Desligado: o som passa igual (com o MESMO atraso: ligar/desligar não dá pulinho) e a
  // correção sai em rampa. Acima de 0 dB, estoura como antes.
  processar(saidaE, saidaD, tamanhoBloco) {
    const e = this.esquerdo;
    const d = this.direito;
    const alvo = this.ligado ? 1 : 0;
    const s = this.suavizar;
    for (let i = 0; i < tamanhoBloco; i++) {
      if (this.mistura !== alvo) {
        this.mistura += (alvo - this.mistura) * s;
        if (Math.abs(alvo - this.mistura) < 1e-5) this.mistura = alvo;
      }
      saidaE[i] = e.processar(saidaE[i], this.mistura);
      saidaD[i] = d.processar(saidaD[i], this.mistura);
    }
  }
}
