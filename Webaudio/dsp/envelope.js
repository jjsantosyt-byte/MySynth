// dsp/envelope.js
// Envelope ADSR: controla como o volume da nota nasce, se mantém e morre.
//
// - Ataque (A): sobe em linha reta até o máximo.
// - Decaimento (D): cai em curva até o nível de sustentação.
// - Sustentação (S): nível que fica enquanto a tecla está segurada.
// - Soltura (R): cai em curva até o silêncio depois de soltar a tecla.
//
// Os tempos de D e R são o tempo para cair até ~1/1000 do caminho (-60 dB),
// que é quando o ouvido já não percebe mais.

const PARADO = 0;
const ATAQUE = 1;
const DECAIMENTO = 2;
const SUSTENTACAO = 3;
const SOLTURA = 4;

// Tempos mínimos, mesmo com os knobs no zero: é o que evita estalos.
// O ataque sobe em linha reta, então 1,5 ms já é suave. As quedas (D e R)
// são curvas que começam rápidas, por isso precisam de um pouco mais.
const ATAQUE_MINIMO = 0.0015;
const QUEDA_MINIMA = 0.006;
const QUEDA_60DB = Math.log(0.001);
// Quando uma voz é "roubada" para outra nota, ela some neste tempo.
const QUEDA_ROUBO = 0.004;
// Na soltura, abaixo deste nível (-80 dB) a nota termina e a voz para de ser calculada.
// (Antes era -100 dB: a voz ficava ~1,7× o tempo do Release sendo calculada; agora ~1,3×.
// Um degrau de -80 dB no fim é inaudível.)
const FIM_SOLTURA = 1e-4;

export class Envelope {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.estagio = PARADO;
    this.nivel = 0;
    // Se o S mudar com a nota segurada, o volume acompanha em ~5 ms (sem degrau).
    this.suavizarSustentacao = 1 - Math.exp(-1 / (0.005 * taxaAmostragem));
    this.coefRoubo = Math.exp(QUEDA_60DB / (QUEDA_ROUBO * taxaAmostragem));
    this.rapido = false; // true = sumindo rápido (voz roubada)
    this.definir(0.005, 0.5, 1, 0.08);
  }

  // Tempos em segundos; sustentação de 0 a 1.
  // (Chamado a cada bloco: se nada mudou, não refaz as contas.)
  definir(ataque, decaimento, sustentacao, soltura) {
    if (
      ataque === this.ataqueDefinido &&
      decaimento === this.decaimentoDefinido &&
      soltura === this.solturaDefinida &&
      sustentacao === this.sustentacao
    ) {
      return;
    }
    this.ataqueDefinido = ataque;
    this.decaimentoDefinido = decaimento;
    this.solturaDefinida = soltura;
    this.passoAtaque = 1 / (Math.max(ataque, ATAQUE_MINIMO) * this.taxa);
    this.coefDecaimento = Math.exp(QUEDA_60DB / (Math.max(decaimento, QUEDA_MINIMA) * this.taxa));
    this.coefSoltura = Math.exp(QUEDA_60DB / (Math.max(soltura, QUEDA_MINIMA) * this.taxa));
    this.sustentacao = sustentacao;
  }

  // Começa (ou recomeça) a nota. Parte do nível em que está: nunca pula, nunca estala.
  disparar() {
    this.estagio = ATAQUE;
    this.rapido = false;
  }

  // Tecla solta: vai para a soltura.
  soltar() {
    if (this.estagio !== PARADO) this.estagio = SOLTURA;
  }

  // Some rápido (em ~4 ms, sem estalo), ignorando o R. Usado ao roubar a voz.
  silenciarRapido() {
    if (this.estagio === PARADO) return;
    this.estagio = SOLTURA;
    this.rapido = true;
  }

  get ativo() {
    return this.estagio !== PARADO;
  }

  // Anda "qtd" amostras de uma vez (mesmo resultado que chamar proximo() qtd vezes, com
  // diferenças só de arredondamento). Usado nos envelopes de modulação que não estão ligados
  // a nada: eles continuam andando (para estarem certos se uma ligação for feita com a nota
  // tocando), mas sem o custo de calcular amostra por amostra.
  avancar(qtd) {
    switch (this.estagio) {
      case PARADO:
        return this.nivel;
      case ATAQUE: {
        const n = this.nivel + this.passoAtaque * qtd;
        if (n < 1) {
          this.nivel = n;
          return n;
        }
        break; // vai mudar de estágio no meio: passo a passo
      }
      case DECAIMENTO: {
        const n = this.sustentacao + (this.nivel - this.sustentacao) * Math.pow(this.coefDecaimento, qtd);
        if (Math.abs(n - this.sustentacao) >= 1e-4) {
          this.nivel = n;
          return n;
        }
        break;
      }
      case SUSTENTACAO:
        this.nivel += (this.sustentacao - this.nivel) * (1 - Math.pow(1 - this.suavizarSustentacao, qtd));
        return this.nivel;
      case SOLTURA: {
        const n = this.nivel * Math.pow(this.rapido ? this.coefRoubo : this.coefSoltura, qtd);
        if (n >= FIM_SOLTURA) {
          this.nivel = n;
          return n;
        }
        break;
      }
    }
    for (let k = 0; k < qtd; k++) this.proximo();
    return this.nivel;
  }

  // Calcula o próximo valor (um por amostra de áudio).
  proximo() {
    switch (this.estagio) {
      case ATAQUE:
        this.nivel += this.passoAtaque;
        if (this.nivel >= 1) {
          this.nivel = 1;
          this.estagio = DECAIMENTO;
        }
        break;

      case DECAIMENTO:
        this.nivel = this.sustentacao + (this.nivel - this.sustentacao) * this.coefDecaimento;
        if (Math.abs(this.nivel - this.sustentacao) < 1e-4) this.estagio = SUSTENTACAO;
        break;

      case SUSTENTACAO:
        this.nivel += (this.sustentacao - this.nivel) * this.suavizarSustentacao;
        break;

      case SOLTURA:
        this.nivel *= this.rapido ? this.coefRoubo : this.coefSoltura;
        if (this.nivel < FIM_SOLTURA) {
          this.nivel = 0;
          this.estagio = PARADO;
          this.rapido = false;
        }
        break;
    }
    return this.nivel;
  }
}
