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

export class Envelope {
  constructor(taxaAmostragem) {
    this.taxa = taxaAmostragem;
    this.estagio = PARADO;
    this.nivel = 0;
    // Se o S mudar com a nota segurada, o volume acompanha em ~5 ms (sem degrau).
    this.suavizarSustentacao = 1 - Math.exp(-1 / (0.005 * taxaAmostragem));
    this.definir(0.005, 0.5, 1, 0.08);
  }

  // Tempos em segundos; sustentação de 0 a 1.
  definir(ataque, decaimento, sustentacao, soltura) {
    this.passoAtaque = 1 / (Math.max(ataque, ATAQUE_MINIMO) * this.taxa);
    this.coefDecaimento = Math.exp(QUEDA_60DB / (Math.max(decaimento, QUEDA_MINIMA) * this.taxa));
    this.coefSoltura = Math.exp(QUEDA_60DB / (Math.max(soltura, QUEDA_MINIMA) * this.taxa));
    this.sustentacao = sustentacao;
  }

  // Começa (ou recomeça) a nota. Parte do nível em que está: nunca pula, nunca estala.
  disparar() {
    this.estagio = ATAQUE;
  }

  // Tecla solta: vai para a soltura.
  soltar() {
    if (this.estagio !== PARADO) this.estagio = SOLTURA;
  }

  get ativo() {
    return this.estagio !== PARADO;
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
        this.nivel *= this.coefSoltura;
        if (this.nivel < 1e-5) {
          this.nivel = 0;
          this.estagio = PARADO;
        }
        break;
    }
    return this.nivel;
  }
}
