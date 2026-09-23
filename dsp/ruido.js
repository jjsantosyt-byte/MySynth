// dsp/ruido.js
// Gerador de ruído (um por voz, para passar pelo filtro e envelope da nota).
//
//   white = todas as frequências com a mesma força (chiado "cheio", brilhante)
//   pink  = cai 3 dB por oitava (mais equilibrado ao ouvido, tipo chuva)
//   brown = cai 6 dB por oitava (grave, tipo vento/trovão)
//
// Os três saem com volume parecido (mesma "média" de energia).

export const TIPOS_RUIDO = ['white', 'pink', 'brown'];

// Ajustes (medidos) para os três tipos terem o mesmo volume médio (≈ 0,35)
const VOLUME = { white: 0.6, pink: 0.197, brown: 1.71 };

export class Ruido {
  constructor(semente) {
    // Sorteio rápido e próprio (xorshift): cada voz com uma semente diferente,
    // para o ruído de notas diferentes não ser igual.
    this.estado = (semente * 2654435761) >>> 0 || 1;
    // Memória dos filtros do pink e do brown
    this.p0 = 0;
    this.p1 = 0;
    this.p2 = 0;
    this.marrom = 0;
  }

  // Número entre -1 e 1
  sortear() {
    let x = this.estado;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.estado = x >>> 0;
    return this.estado / 2147483648 - 1;
  }

  // Próxima amostra do tipo pedido
  proximo(tipo) {
    const branco = this.sortear();
    switch (tipo) {
      case 'pink': {
        // Soma de 3 filtros suaves (receita clássica de Paul Kellet, versão econômica)
        this.p0 = 0.99765 * this.p0 + branco * 0.099046;
        this.p1 = 0.963 * this.p1 + branco * 0.2965164;
        this.p2 = 0.57 * this.p2 + branco * 1.0526913;
        return (this.p0 + this.p1 + this.p2 + branco * 0.1848) * VOLUME.pink;
      }
      case 'brown':
        // Vai "somando" o branco devagar, com um vazamento para não fugir do centro
        this.marrom = (this.marrom + 0.02 * branco) / 1.02;
        return this.marrom * 3.5 * VOLUME.brown;
      default:
        return branco * VOLUME.white;
    }
  }
}
