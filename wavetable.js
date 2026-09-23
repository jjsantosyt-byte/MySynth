// wavetable.js
// Monta as wavetables (tabelas de onda) que o motor de som vai tocar.
//
// Ideia principal (para evitar aliasing = chiado agudo):
// Cada forma de onda é guardada em VÁRIAS versões ("níveis"), cada uma com
// um número diferente de harmônicos. Notas graves usam a versão cheia de
// harmônicos; notas agudas usam versões com menos harmônicos, para que
// nenhum harmônico passe do limite que o áudio digital consegue reproduzir.
//
// Uma wavetable tem vários "frames" (formas de onda em sequência).
// O WT Pos escolhe onde estamos nessa sequência, misturando frames vizinhos.

// Quantos pontos cada ciclo da onda tem.
export const TAMANHO_TABELA = 2048;

// Máximo de harmônicos guardados. Usamos 1/4 do tamanho da tabela para a
// leitura com interpolação ficar limpa.
export const MAX_HARMONICOS = TAMANHO_TABELA / 4; // 512

// Tabela de seno pronta, para montar as ondas somando harmônicos.
const SENO = new Float32Array(TAMANHO_TABELA);
for (let i = 0; i < TAMANHO_TABELA; i++) {
  SENO[i] = Math.sin((2 * Math.PI * i) / TAMANHO_TABELA);
}

// Lista de quantos harmônicos cada nível tem: 512, 362, 256, 181, 128...
// Um nível a cada meia oitava, para não perder brilho entre um nível e outro.
function listaDeHarmonicos() {
  const lista = [];
  for (let i = 0; ; i++) {
    const h = Math.floor(MAX_HARMONICOS / Math.pow(2, i / 2));
    if (h < 1) break;
    if (lista.length === 0 || h < lista[lista.length - 1]) lista.push(h);
  }
  return lista;
}

export const HARMONICOS_POR_NIVEL = listaDeHarmonicos();

// Monta um frame (um ciclo de onda) em todos os níveis.
// "amplitudes[n]" é o volume do harmônico n (n = 1 é a nota fundamental).
function montarFrame(amplitudes) {
  const mascara = TAMANHO_TABELA - 1;
  const niveis = HARMONICOS_POR_NIVEL.map((qtdHarmonicos) => {
    const onda = new Float32Array(TAMANHO_TABELA);
    for (let n = 1; n <= qtdHarmonicos; n++) {
      const a = amplitudes[n];
      if (!a) continue;
      // Soma o harmônico n: um seno que dá n voltas por ciclo.
      let indice = 0;
      for (let j = 0; j < TAMANHO_TABELA; j++) {
        onda[j] += a * SENO[indice];
        indice = (indice + n) & mascara;
      }
    }
    return onda;
  });

  // Ajusta o volume: o nível mais cheio fica com pico 1,
  // e todos os outros recebem o mesmo ajuste (para o volume não pular).
  let pico = 0;
  for (const v of niveis[0]) pico = Math.max(pico, Math.abs(v));
  const ajuste = pico > 0 ? 1 / pico : 1;
  for (const onda of niveis) {
    for (let j = 0; j < onda.length; j++) onda[j] *= ajuste;
  }
  return niveis;
}

// ---------- Receitas das formas básicas ----------
// Todas criadas do zero, pelas fórmulas clássicas de harmônicos.
// Todas começam no mesmo ponto do ciclo (subindo a partir do zero), para que
// a mistura entre elas não cancele o som.

// Seno: só a fundamental.
function receitaSeno() {
  const a = new Float32Array(MAX_HARMONICOS + 1);
  a[1] = 1;
  return a;
}

// Triângulo: só harmônicos ímpares, volume 1/n², sinais alternados.
function receitaTriangulo() {
  const a = new Float32Array(MAX_HARMONICOS + 1);
  for (let n = 1; n <= MAX_HARMONICOS; n += 2) {
    a[n] = (((n - 1) / 2) % 2 === 0 ? 1 : -1) / (n * n);
  }
  return a;
}

// Serra (dente de serra): todos os harmônicos, volume 1/n.
function receitaSerra() {
  const a = new Float32Array(MAX_HARMONICOS + 1);
  for (let n = 1; n <= MAX_HARMONICOS; n++) {
    a[n] = (n % 2 === 1 ? 1 : -1) / n;
  }
  return a;
}

// Quadrada: só harmônicos ímpares, volume 1/n.
function receitaQuadrada() {
  const a = new Float32Array(MAX_HARMONICOS + 1);
  for (let n = 1; n <= MAX_HARMONICOS; n += 2) {
    a[n] = 1 / n;
  }
  return a;
}

// Wavetable "Básica": Seno → Triângulo → Serra → Quadrada.
export function criarWavetableBasica() {
  return {
    nome: 'Básica',
    nomesFrames: ['Seno', 'Triângulo', 'Serra', 'Quadrada'],
    tamanho: TAMANHO_TABELA,
    harmonicos: HARMONICOS_POR_NIVEL,
    frames: [receitaSeno(), receitaTriangulo(), receitaSerra(), receitaQuadrada()].map(montarFrame),
  };
}
