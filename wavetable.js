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
//
// Cada frame é descrito pelos seus harmônicos: para cada harmônico n, quanto
// de "cosseno" (a[n]) e quanto de "seno" (b[n]). A FFT transforma essa lista
// em forma de onda (e vice-versa) de um jeito muito rápido.
//
// Todas as wavetables daqui são criadas do zero, por fórmulas.

// Quantos pontos cada ciclo da onda tem.
export const TAMANHO_TABELA = 2048;

// Máximo de harmônicos guardados. Usamos 1/4 do tamanho da tabela para a
// leitura com interpolação ficar limpa.
export const MAX_HARMONICOS = TAMANHO_TABELA / 4; // 512

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

// ---------- FFT ----------
// Transforma n pontos (n = potência de 2) em harmônicos, no próprio lugar.
// inversa = true: harmônicos → onda (sem dividir por n).
export function fft(re, im, inversa = false) {
  const n = re.length;
  // Reordena (troca de bits)
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Borboletas
  for (let tamanho = 2; tamanho <= n; tamanho <<= 1) {
    const angulo = ((inversa ? 2 : -2) * Math.PI) / tamanho;
    const wr = Math.cos(angulo);
    const wi = Math.sin(angulo);
    for (let inicio = 0; inicio < n; inicio += tamanho) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < tamanho / 2; k++) {
        const a = inicio + k;
        const b = a + tamanho / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const novoCr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = novoCr;
      }
    }
  }
}

// ---------- Montar frames ----------

// Harmônicos vazios (a = cosseno, b = seno), do 0 ao MAX_HARMONICOS
export function harmonicosVazios() {
  return { a: new Float64Array(MAX_HARMONICOS + 1), b: new Float64Array(MAX_HARMONICOS + 1) };
}

// Monta um frame em todos os níveis a partir dos harmônicos.
// Volume (normalizar = true): o nível mais cheio fica com pico 1 (e os outros com o
// mesmo ajuste). Wavetables importadas usam false e ajustam a tabela inteira junta.
export function montarFrame({ a, b }, normalizar = true) {
  const N = TAMANHO_TABELA;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const niveis = HARMONICOS_POR_NIVEL.map((qtd) => {
    re.fill(0);
    im.fill(0);
    for (let n = 1; n <= qtd; n++) {
      // a·cos + b·sen  →  metade no harmônico n, metade no "espelho" N−n
      re[n] = 0.5 * a[n];
      im[n] = -0.5 * b[n];
      re[N - n] = 0.5 * a[n];
      im[N - n] = 0.5 * b[n];
    }
    fft(re, im, true);
    return Float32Array.from(re);
  });
  if (!normalizar) return niveis;

  let pico = 0;
  for (const v of niveis[0]) pico = Math.max(pico, Math.abs(v));
  const ajuste = pico > 0 ? 1 / pico : 1;
  for (const onda of niveis) for (let j = 0; j < onda.length; j++) onda[j] *= ajuste;
  return niveis;
}

// Descobre os harmônicos de um ciclo de onda desenhado ponto a ponto
// (qualquer tamanho potência de 2). Usado para ondas feitas "no tempo"
// (ex.: Sync) e para importar wavetables de arquivo.
export function harmonicosDeAmostras(amostras) {
  const L = amostras.length;
  const re = Float64Array.from(amostras);
  const im = new Float64Array(L);
  fft(re, im);
  const h = harmonicosVazios();
  const limite = Math.min(MAX_HARMONICOS, L / 2 - 1);
  for (let n = 1; n <= limite; n++) {
    h.a[n] = (2 / L) * re[n];
    h.b[n] = (-2 / L) * im[n];
  }
  return h;
}

// Igual à anterior, mas aceita ciclos de QUALQUER tamanho (ex.: 600 pontos).
// Potência de 2 usa a FFT; outros tamanhos usam a conta direta (mais lenta,
// mas os ciclos são curtos). Não precisa "esticar" a onda: os harmônicos
// saem direto do ciclo original, sem perder qualidade.
export function harmonicosDeCiclo(amostras) {
  const L = amostras.length;
  if ((L & (L - 1)) === 0) return harmonicosDeAmostras(amostras);
  const h = harmonicosVazios();
  const limite = Math.min(MAX_HARMONICOS, Math.floor((L - 1) / 2));
  for (let n = 1; n <= limite; n++) {
    let somaCos = 0;
    let somaSen = 0;
    const passo = (2 * Math.PI * n) / L;
    for (let i = 0; i < L; i++) {
      somaCos += amostras[i] * Math.cos(passo * i);
      somaSen += amostras[i] * Math.sin(passo * i);
    }
    h.a[n] = (2 / L) * somaCos;
    h.b[n] = (2 / L) * somaSen;
  }
  return h;
}

// Junta tudo num objeto de wavetable (só dados: pode ir para o motor de som).
function tabela(id, nome, listaHarmonicos, extras = {}) {
  return {
    id,
    nome,
    tamanho: TAMANHO_TABELA,
    harmonicos: HARMONICOS_POR_NIVEL,
    frames: listaHarmonicos.map(montarFrame),
    nomesFrames: null, // nomes de cada frame (se tiver)
    atalhos: [], // botões de atalho: [{ nome, posicao }]
    ...extras,
  };
}

// ---------- Receitas ----------

// Básica: Seno → Triângulo → Serra → Quadrada. Todas começam subindo a
// partir do zero, para a mistura entre elas não cancelar o som.
function criarBasica() {
  const seno = harmonicosVazios();
  seno.b[1] = 1;
  const triangulo = harmonicosVazios();
  for (let n = 1; n <= MAX_HARMONICOS; n += 2) triangulo.b[n] = (((n - 1) / 2) % 2 === 0 ? 1 : -1) / (n * n);
  const serra = harmonicosVazios();
  for (let n = 1; n <= MAX_HARMONICOS; n++) serra.b[n] = (n % 2 === 1 ? 1 : -1) / n;
  const quadrada = harmonicosVazios();
  for (let n = 1; n <= MAX_HARMONICOS; n += 2) quadrada.b[n] = 1 / n;

  return tabela('basica', 'Básica', [seno, triangulo, serra, quadrada], {
    nomesFrames: ['Seno', 'Triângulo', 'Serra', 'Quadrada'],
    atalhos: [
      { nome: 'Seno', posicao: 0 },
      { nome: 'Tri', posicao: 1 / 3 },
      { nome: 'Serra', posicao: 2 / 3 },
      { nome: 'Quad', posicao: 1 },
    ],
  });
}

// PWM: onda de pulso que vai afinando (50% = quadrada → 5% = pulso fininho).
// Pulso = serra − a mesma serra atrasada (a largura do pulso é o atraso).
function criarPwm() {
  const QTD = 8;
  const larguras = Array.from({ length: QTD }, (_, k) => 0.5 * Math.pow(0.1, k / (QTD - 1)));
  const frames = larguras.map((largura) => {
    const h = harmonicosVazios();
    const fase = 2 * Math.PI * largura;
    for (let n = 1; n <= MAX_HARMONICOS; n++) {
      h.b[n] = (1 - Math.cos(n * fase)) / n;
      h.a[n] = Math.sin(n * fase) / n;
    }
    return h;
  });
  const larguraEm = (posicao) => Math.round(100 * 0.5 * Math.pow(0.1, posicao)) + '%';
  return tabela('pwm', 'PWM', frames, {
    atalhos: [0, 1 / 3, 2 / 3, 1].map((posicao) => ({ nome: larguraEm(posicao), posicao })),
  });
}

// Harmônicos: começa só com a fundamental e vai somando harmônicos
// (como um filtro abrindo): 1, 2, 3, 5, 8, 16, 48 e 256 harmônicos.
function criarHarmonicos() {
  const quantidades = [1, 2, 3, 5, 8, 16, 48, 256];
  const frames = quantidades.map((qtd) => {
    const h = harmonicosVazios();
    for (let n = 1; n <= qtd; n++) h.b[n] = 1 / n;
    return h;
  });
  return tabela('harmonicos', 'Harmônicos', frames, {
    atalhos: [
      { nome: 'Puro', posicao: 0 },
      { nome: 'Pouco', posicao: 1 / 3 },
      { nome: 'Médio', posicao: 2 / 3 },
      { nome: 'Cheio', posicao: 1 },
    ],
  });
}

// Formante: timbre de vogal (A, E, I, O, U). Uma fonte cheia de harmônicos com
// 3 "picos" (formantes) nas frequências típicas de cada vogal. Os picos foram
// calculados para uma nota em torno de 110 Hz (Lá grave).
const VOGAIS = {
  A: [730, 1090, 2440],
  E: [530, 1840, 2480],
  I: [270, 2290, 3010],
  O: [570, 840, 2410],
  U: [300, 870, 2240],
};
function criarFormante() {
  const NOTA_BASE = 110;
  const ganhos = [1, 0.5, 0.25];
  const frames = Object.values(VOGAIS).map((formantes) => {
    const h = harmonicosVazios();
    for (let n = 1; n <= 64; n++) {
      let soma = 0;
      formantes.forEach((f, k) => {
        const centro = f / NOTA_BASE; // em qual harmônico fica o pico
        const largura = Math.max(1, centro * 0.12);
        soma += ganhos[k] / (1 + ((n - centro) / largura) ** 2);
      });
      h.b[n] = soma / Math.sqrt(n);
    }
    return h;
  });
  const nomes = Object.keys(VOGAIS);
  return tabela('formante', 'Formante', frames, {
    nomesFrames: nomes,
    atalhos: nomes.map((nome, k) => ({ nome, posicao: k / (nomes.length - 1) })),
  });
}

// Sync: o som "rasgado" de hard sync. Uma serra que reinicia a cada ciclo
// da nota, mas corre 1× a 6× mais rápido dentro dele.
function criarSync() {
  const QTD = 8;
  const PONTOS = 8192; // desenhada com bem mais pontos, para a análise ficar precisa
  const razoes = Array.from({ length: QTD }, (_, k) => 1 + (5 * k) / (QTD - 1));
  const frames = razoes.map((razao) => {
    const onda = new Float64Array(PONTOS);
    for (let i = 0; i < PONTOS; i++) {
      const fase = ((razao * i) / PONTOS) % 1;
      onda[i] = 2 * fase - 1;
    }
    return harmonicosDeAmostras(onda);
  });
  const razaoEm = (posicao) => (1 + 5 * posicao).toFixed(1).replace('.', ',') + '×';
  return tabela('sync', 'Sync', frames, {
    atalhos: [0, 1 / 3, 2 / 3, 1].map((posicao) => ({ nome: razaoEm(posicao), posicao })),
  });
}

// ---------- Catálogo ----------

export const WAVETABLES = [
  { id: 'basica', nome: 'Básica', criar: criarBasica },
  { id: 'pwm', nome: 'PWM', criar: criarPwm },
  { id: 'harmonicos', nome: 'Harmônicos', criar: criarHarmonicos },
  { id: 'formante', nome: 'Formante', criar: criarFormante },
  { id: 'sync', nome: 'Sync', criar: criarSync },
];

// Monta a wavetable só na primeira vez que ela é pedida (e guarda).
// Id desconhecido (ex.: importada que não existe mais) → Básica.
const prontas = new Map();
export function obterWavetable(id) {
  if (!prontas.has(id)) {
    const receita = listaWavetables().find((w) => w.id === id);
    if (!receita) return obterWavetable(WAVETABLES[0].id);
    prontas.set(id, receita.criar());
  }
  return prontas.get(id);
}

// ---------- Wavetables importadas (.wav) ----------

// Máximo de frames guardados de um arquivo. Tabelas maiores (o Serum usa até 256)
// ficam com frames escolhidos por igual ao longo da tabela: o morphing continua suave
// e a memória fica leve no celular (64 frames ≈ 9 MB montados).
export const MAX_FRAMES_IMPORTADOS = 64;

// Importadas nesta sessão: [{ id, nome, criar }] (a ordem é a da lista)
export const IMPORTADAS = [];

// Todas as wavetables que dá para escolher: fábrica + importadas.
export function listaWavetables() {
  return [...WAVETABLES, ...IMPORTADAS];
}

// Escolhe no máximo "maximo" ciclos, espalhados por igual (sempre com o 1º e o último).
export function escolherCiclos(ciclos, maximo = MAX_FRAMES_IMPORTADOS) {
  if (ciclos.length <= maximo) return ciclos;
  return Array.from({ length: maximo }, (_, k) => ciclos[Math.round((k * (ciclos.length - 1)) / (maximo - 1))]);
}

// Monta uma wavetable a partir de ciclos de onda (listas de amostras, qualquer tamanho).
// O volume é ajustado para a tabela TODA: o frame mais alto fica com pico 1 e os outros
// mantêm o volume relativo que tinham no arquivo.
export function criarWavetableDeCiclos(id, nome, ciclos) {
  const escolhidos = escolherCiclos(ciclos);
  const frames = escolhidos.map((ciclo) => montarFrame(harmonicosDeCiclo(ciclo), false));
  let pico = 0;
  for (const niveis of frames) for (const v of niveis[0]) pico = Math.max(pico, Math.abs(v));
  const ajuste = pico > 1e-9 ? 1 / pico : 1;
  for (const niveis of frames) for (const onda of niveis) for (let j = 0; j < onda.length; j++) onda[j] *= ajuste;

  // Atalhos: número do frame no início, 1/3, 2/3 e fim (só se tiver mais de 1 frame)
  const ultimo = frames.length - 1;
  const atalhos =
    ultimo > 0
      ? [0, 1 / 3, 2 / 3, 1].map((posicao) => ({ nome: String(Math.round(posicao * ultimo) + 1), posicao }))
      : [];
  return {
    id,
    nome,
    tamanho: TAMANHO_TABELA,
    harmonicos: HARMONICOS_POR_NIVEL,
    frames,
    nomesFrames: null,
    atalhos,
    importada: true,
  };
}

export const idImportada = (nome) => 'wav:' + nome;

// Coloca (ou substitui, se o nome já existe) uma importada no catálogo.
// Ela só é montada na primeira vez que for escolhida. Devolve o id.
export function registrarImportada(nome, ciclos) {
  const id = idImportada(nome);
  // "ciclos" fica guardado na receita: serve para exportar junto com os presets
  const receita = { id, nome, ciclos, criar: () => criarWavetableDeCiclos(id, nome, ciclos) };
  const i = IMPORTADAS.findIndex((w) => w.id === id);
  if (i >= 0) IMPORTADAS[i] = receita;
  else IMPORTADAS.push(receita);
  IMPORTADAS.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  prontas.delete(id); // se já estava montada (substituição), monta de novo
  return id;
}

export function removerImportada(id) {
  const i = IMPORTADAS.findIndex((w) => w.id === id);
  if (i >= 0) IMPORTADAS.splice(i, 1);
  prontas.delete(id);
}

export const existeWavetable = (id) => listaWavetables().some((w) => w.id === id);
