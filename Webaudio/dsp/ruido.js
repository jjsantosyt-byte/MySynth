// dsp/ruido.js
// Ruído, tocado como um "sample" (estilo Serum): para cada tipo, o motor gera UMA vez
// um trecho de ~4 s de ruído e as notas tocam esse trecho, em loop ou uma vez só
// (One Shot), mais rápido ou mais devagar (Pitch e Track mudam a "cor").
//
//   white = todas as frequências com a mesma força (chiado "cheio", brilhante)
//   pink  = cai 3 dB por oitava (mais equilibrado ao ouvido, tipo chuva)
//   brown = cai 6 dB por oitava (grave, tipo vento/trovão)
//
// Os três saem com volume parecido (mesma "média" de energia).

export const TIPOS_RUIDO = ['white', 'pink', 'brown'];

// Ajustes (medidos) para os três tipos terem o mesmo volume médio (≈ 0,35)
const VOLUME = { white: 0.6, pink: 0.197, brown: 1.71 };

// Gerador (usado para montar os trechos)
export class Ruido {
  constructor(semente) {
    // Sorteio rápido e próprio (xorshift)
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

// ---------- Trechos (os "samples" de ruído) ----------

const SEGUNDOS_TRECHO = 4; // longo o bastante para a repetição não ser percebida
const EMENDA = 4096; // amostras de mistura suave entre o fim e o começo (loop sem estalo)

// Monta um trecho de ruído que dá a volta sem emenda: as últimas amostras geradas
// entram misturadas no começo, então o fim do trecho continua direto no começo.
function montarTrecho(tipo, tamanho) {
  const gerador = new Ruido(12345);
  for (let i = 0; i < 8192; i++) gerador.proximo(tipo); // aquece os filtros do pink/brown
  const cru = new Float32Array(tamanho + EMENDA);
  for (let i = 0; i < cru.length; i++) cru[i] = gerador.proximo(tipo);
  const trecho = new Float32Array(tamanho);
  for (let i = 0; i < tamanho; i++) trecho[i] = cru[i];
  // Começo: sai do "fim estendido" (continuação natural da última amostra) e entra
  // no começo original, com mistura de potência igual (ruídos diferentes somam em potência).
  for (let i = 0; i < EMENDA; i++) {
    const t = i / EMENDA;
    trecho[i] = cru[i] * Math.sin((t * Math.PI) / 2) + cru[tamanho + i] * Math.cos((t * Math.PI) / 2);
  }
  return trecho;
}

// Os 3 trechos, montados uma vez só (por taxa de amostragem)
let trechosProntos = null;
export function trechosDeRuido(taxaAmostragem) {
  if (!trechosProntos || trechosProntos.taxa !== taxaAmostragem) {
    const tamanho = Math.round(SEGUNDOS_TRECHO * taxaAmostragem);
    trechosProntos = { taxa: taxaAmostragem };
    for (const tipo of TIPOS_RUIDO) trechosProntos[tipo] = montarTrecho(tipo, tamanho);
  }
  return trechosProntos;
}

// Nota de referência do Track: nesta nota o ruído toca na velocidade normal
export const NOTA_BASE_RUIDO = 60; // C4
