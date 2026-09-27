// motor.cpp
// Motor de som em C++, compilado para WebAssembly (motor.wasm) e usado pelo
// processador-synth.js dentro do AudioWorklet.
//
// Regras (as mesmas do dsp/): só contas de áudio, nada de navegador. Assim este mesmo
// código pode, no futuro, virar um motor nativo (Android/Oboe, JUCE).
//
// Etapa F1: os OSCILADORES das notas (leitura da wavetable sem chiado, WT Pos, unison,
// Warp e FM).
// F1b: sem Warp, as cópias de unison são calculadas de 4 em 4 com SIMD (quatroCopias).
// F2a: a MODULAÇÃO e os ENVELOPES: ENV 1 (volume), ENV 2/3, LFO 1/2/3 (Retrig e Livre),
// Macros e a soma das ligações (matriz).
// F2b: o resto da VOZ (ruído, Filtros 1 e 2, rotas, glide) e o efeito Filtro Track. A voz
// inteira é calculada aqui (vozProcessar); o JavaScript só decide quem toca qual nota.
// F3a: os efeitos de "cor": Saturação, Distorção, EQ e Compressor (+ o Filtro Track da F2b).
// F3b: os efeitos de "espaço": Phaser, Flanger, Chorus, Delay e Reverb.
//
// Como o JavaScript conversa com o C++ ("mesa de troca"):
//   - wavetables: o JS pede espaço (criarTabela) e copia as ondas para dentro, uma vez só;
//     depois só usa o endereço da tabela (um número).
//   - ajustes dos 3 osciladores (Unison, Detune, Warp...), dos LFOs, dos envelopes e dos
//     Macros: o JS escreve na mesa uma vez por bloco;
//   - ligações de modulação: o JS escreve a lista (fonte, destino, quantidade) quando muda;
//   - o som de cada voz sai em "saidaE/saidaD" dela (o JS soma na saída) e a modulação de
//     cada voz fica em "mod" (a tela mostra ao vivo);
//   - efeitos: o JS escreve os ajustes de cada um na linha dele (ajustesEfeitos) e o som
//     passa por "somEfeito" (copiado para cá antes do 1º efeito do C++ e de volta no fim).
//
// Para compilar: motor\compilar.bat (gera motor\motor.wasm).

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <wasm_simd128.h>  // SIMD: contas em 4 números de uma vez

// "EXPORTAR" = a função fica visível para o JavaScript (processador-synth.js).
#define EXPORTAR extern "C" __attribute__((visibility("default")))

namespace {

constexpr int BLOCO = 128;        // amostras por bloco de áudio
constexpr int MAX_VOZES = 16;
constexpr int N_OSC = 3;          // A, B, C
constexpr int MAX_UNISON = 16;
constexpr int FATOR_WARP = 2;     // com Warp, as contas são feitas em taxa dobrada
constexpr int N_MOD_OSC = 35;     // destinos de modulação dos osciladores: índices 0 a 34
constexpr int MAX_NIVEIS = 64;    // níveis anti-chiado de uma tabela (hoje são 19)

constexpr double PI = 3.14159265358979323846;
constexpr double DETUNE_MAXIMO = 1;        // Detune 100% = pontas a ±1 semitom
constexpr double FREQUENCIA_MAXIMA = 0.45; // cópia acima disso (fração da taxa) fica calada
constexpr double INICIO_MISTURA = 0.75;    // mistura entre níveis só no último 1/4 da faixa
constexpr double INDICE_FM_MAXIMO = 2;

// Campos dos ajustes de cada oscilador (mesma ordem em processador-synth.js: CAMPOS_OSC)
enum Campo {
  C_TABELA, C_UNISON, C_DETUNE, C_WIDTH, C_LIGADO, C_NIVEL, C_GANHO, C_OITAVA, C_SEMI, C_FINE,
  C_PAN, C_BLEND, C_FASE, C_RAND, C_WARP_MODO, C_WARP, C_QTD_POSICOES, N_CAMPOS
};

// Modos do Warp (mesmos números de dsp/warp.js)
enum { W_NENHUM, W_SYNC, W_BEND_MAIS, W_BEND_MENOS, W_PWM, W_FM_A, W_FM_B, W_FM_C };

// Índices de modulação de cada oscilador (mesmos de DESTINOS_OSC em dsp/modulacao.js)
struct Destinos { int wtPos, detune, width, nivel, oitava, semi, fine, pan, blend, warp; };
constexpr Destinos DESTINOS[N_OSC] = {
  { 0, 1, 2, 6, 17, 18, 19, 26, 27, 32 },
  { 9, 10, 11, 12, 20, 21, 22, 28, 29, 33 },
  { 13, 14, 15, 16, 23, 24, 25, 30, 31, 34 },
};

inline double limitar01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
inline double limitar(double v, double a, double b) { return v < a ? a : v > b ? b : v; }
// Arredondamento igual ao Math.round do JavaScript (0,5 sobe; -2,5 vira -2)
inline double arredondar(double v) { return std::floor(v + 0.5); }

// ---------- Wavetables ----------
// Uma tabela = vários frames (formas de onda), cada frame com vários níveis (versões com
// menos harmônicos, para notas agudas). As ondas ficam em "dados": [frame][nível][ponto].
struct Tabela {
  int tamanho;               // pontos por ciclo (2048; sempre potência de 2)
  int mascara;               // tamanho - 1
  int bits;                  // tamanho = 2^bits (usado pela leitura com SIMD)
  int qtdFrames;
  int qtdNiveis;
  int harmonicos[MAX_NIVEIS]; // quantos harmônicos cada nível tem
  float* dados;
  const float* onda(int frame, int nivel) const {
    return dados + (static_cast<size_t>(frame) * qtdNiveis + nivel) * tamanho;
  }
};

// Decide quais 2 níveis usar para esta frequência e quanto de cada (igual a dsp/oscilador.js).
void escolherNiveis(const Tabela* t, double frequencia, double taxa, int& nivel, int& nivelB, double& mistura) {
  const int ultimo = t->qtdNiveis - 1;
  const double limite = (0.5 * taxa) / frequencia;
  int n = 0;
  while (n < ultimo && t->harmonicos[n] > limite) n++;
  nivel = n;
  nivelB = n + 1 < ultimo ? n + 1 : ultimo;
  if (n == ultimo) {
    mistura = 0;
    return;
  }
  const double freqMaxima = (0.5 * taxa) / t->harmonicos[n];
  const double razao = n > 0 ? static_cast<double>(t->harmonicos[n]) / t->harmonicos[n - 1]
                             : static_cast<double>(t->harmonicos[1]) / t->harmonicos[0];
  const double freqMinima = freqMaxima * razao;
  const double posicaoNaFaixa = std::log(frequencia / freqMinima) / std::log(freqMaxima / freqMinima);
  const double m = (posicaoNaFaixa - INICIO_MISTURA) / (1 - INICIO_MISTURA);
  mistura = m < 0 ? 0 : m > 1 ? 1 : m;
}

// Lê um ponto da onda, ligando os pontos da tabela por retas
inline double lerOnda(const float* onda, int i0, int i1, double frac) {
  return onda[i0] + frac * (onda[i1] - onda[i0]);
}

// Uma amostra da wavetable: 2 frames vizinhos (morphing "t") × 2 níveis ("mistura")
inline double lerAmostra(const Tabela* tab, int fA, int fB, double t, int nivel, int nivelB, double mistura, double fase) {
  const double posicao = fase * tab->tamanho;
  const int i0 = static_cast<int>(posicao);
  const int i1 = (i0 + 1) & tab->mascara;
  const double frac = posicao - i0;
  double som = lerOnda(tab->onda(fA, nivel), i0, i1, frac);
  if (mistura > 0) som += mistura * (lerOnda(tab->onda(fA, nivelB), i0, i1, frac) - som);
  if (t > 0) {
    double somB = lerOnda(tab->onda(fB, nivel), i0, i1, frac);
    if (mistura > 0) somB += mistura * (lerOnda(tab->onda(fB, nivelB), i0, i1, frac) - somB);
    som += t * (somB - som);
  }
  return som;
}

// ---------- Warp (cópia das contas de dsp/warp.js, que a tela usa para desenhar) ----------

inline int moduladorFM(int codigo) { return codigo >= W_FM_A ? codigo - W_FM_A : -1; }

double forcaWarp(int codigo, double q) {
  switch (codigo) {
    case W_SYNC: return 1 + 7 * q;
    case W_BEND_MAIS:
    case W_BEND_MENOS: return std::pow(8.0, q);
    case W_PWM: return 1 - 0.9 * q;
    case W_FM_A:
    case W_FM_B:
    case W_FM_C: return INDICE_FM_MAXIMO * q;
    default: return 1;
  }
}

inline double aceleracaoFM(double indice, double razao) { return 1 + 2 * PI * indice * razao; }

inline double faseFM(double fase, double indice, double modulador) {
  const double f = fase + indice * modulador;
  return f - std::floor(f);
}

double aceleracaoWarp(int codigo, double forca) {
  switch (codigo) {
    case W_SYNC:
    case W_BEND_MAIS:
    case W_BEND_MENOS: return forca;
    case W_PWM: return 1 / forca;
    default: return 1;
  }
}

inline double faseWarp(int codigo, double forca, double fase) {
  switch (codigo) {
    case W_SYNC: {
      const double f = fase * forca;
      return f - std::floor(f);
    }
    case W_BEND_MAIS: return (forca * fase) / (1 + (forca - 1) * fase);
    case W_BEND_MENOS: {
      const double r = 1 - fase;
      return 1 - (forca * r) / (1 + (forca - 1) * r);
    }
    case W_PWM: return fase < forca ? fase / forca : 0;
    default: return fase;
  }
}

// ---------- Filtro meia-banda (volta da taxa dobrada; igual a dsp/meia-banda.js) ----------

constexpr int TAPS = 31;
constexpr int MEIO = (TAPS - 1) / 2;
int qtdUteis = 0;             // coeficientes que não são zero
int deslocUteis[TAPS];
double coefsUteis[TAPS];
double coefs[TAPS];           // todos os coeficientes (a subida da taxa usa os pares e o do meio)

void prepararMeiaBanda() {
  double soma = 0;
  for (int n = 0; n < TAPS; n++) {
    const int k = n - MEIO;
    const double sinc = k == 0 ? 0.5 : std::sin((PI * k) / 2) / (PI * k);
    const double janela = 0.42 - 0.5 * std::cos((2 * PI * n) / (TAPS - 1)) + 0.08 * std::cos((4 * PI * n) / (TAPS - 1));
    coefs[n] = sinc * janela;
    soma += coefs[n];
  }
  qtdUteis = 0;
  for (int n = 0; n < TAPS; n++) {
    coefs[n] /= soma;
    if (std::fabs(coefs[n]) > 1e-12) {
      deslocUteis[qtdUteis] = n;
      coefsUteis[qtdUteis] = coefs[n];
      qtdUteis++;
    }
  }
}

// Desce da taxa dobrada para a normal: recebe 2 amostras, devolve 1 (já filtrada)
struct Decimador {
  double h[TAPS] = {};
  int p = 0;
  void limpar() {
    for (double& v : h) v = 0;
  }
  double processar(double a, double b) {
    p = p + 1 == TAPS ? 0 : p + 1;
    h[p] = a;
    p = p + 1 == TAPS ? 0 : p + 1;
    h[p] = b;
    double soma = 0;
    for (int u = 0; u < qtdUteis; u++) {
      int j = p - deslocUteis[u];
      if (j < 0) j += TAPS;
      soma += coefsUteis[u] * h[j];
    }
    return soma;
  }
};

// ---------- Mesa de troca com o JavaScript ----------

double taxa = 48000;
double suavizar = 0;                        // ~5 ms (volumes e nível)
double ajustes[N_OSC][N_CAMPOS];            // ajustes de cada oscilador (o JS escreve por bloco)
double posicoes[N_OSC][BLOCO];              // WT Pos de cada oscilador (1 valor ou 1 por amostra)
double fasesSorteadas[MAX_UNISON];          // pontos de início sorteados para a nota nova

inline const Tabela* tabelaDe(int k) {
  return reinterpret_cast<const Tabela*>(static_cast<uintptr_t>(ajustes[k][C_TABELA]));
}

// Afinação de um oscilador em semitons (Oct × 12 + Semi + Fine / 100, com a modulação).
// Oct e Semi em degraus (arredondados); Fine contínuo.
double afinacaoDe(int k, const double* mod) {
  const double* a = ajustes[k];
  const Destinos& d = DESTINOS[k];
  const double mOitava = mod[d.oitava], mSemi = mod[d.semi], mFine = mod[d.fine];
  if (mOitava == 0 && mSemi == 0 && mFine == 0) return a[C_OITAVA] * 12 + a[C_SEMI] + a[C_FINE] / 100;
  const double o = limitar(arredondar(a[C_OITAVA] + mOitava * 6), -3, 3);
  const double s = limitar(arredondar(a[C_SEMI] + mSemi * 24), -12, 12);
  const double f = limitar(a[C_FINE] + mFine * 200, -100, 100);
  return o * 12 + s + f / 100;
}

// ---------- Um oscilador dentro de uma nota (igual a dsp/oscilador-voz.js, que saiu) ----------

struct OscVoz {
  // Dados de cada cópia de unison
  double fases[MAX_UNISON];
  double passos[MAX_UNISON];
  double volumes[MAX_UNISON]; // mudam suavemente (sem estalo)
  double ganhosE[MAX_UNISON];
  double ganhosD[MAX_UNISON];
  int niveis[MAX_UNISON];
  int niveisB[MAX_UNISON];
  double misturas[MAX_UNISON];
  bool agudaDemais[MAX_UNISON]; // cópia acima do limite (fica calada)
  bool volumesDireto;
  double volumeMeio, volumeFora;

  double nivel;      // nível atual (liga/desliga e knob Nível, suavizado)
  bool nivelDireto;
  bool calado;       // desligado e já em silêncio: não calcula nada

  // Som deste oscilador no bloco (o JS lê) e rascunhos
  double somaE[BLOCO], somaD[BLOCO];
  int framesBloco[BLOCO];
  double tsBloco[BLOCO];

  // Warp: taxa dobrada e o caminho de volta
  double warpE[FATOR_WARP * BLOCO], warpD[FATOR_WARP * BLOCO];
  Decimador decimadorE, decimadorD;
  bool usouWarp;

  // FM: som do oscilador que modula (taxa dobrada) e a fase dele
  double fmBloco[FATOR_WARP * BLOCO];
  double fmFase;

  // Últimos valores de ajustarCopias (se nada mudar, as contas não são refeitas)
  double uFrequencia, uDetune, uWidth, uPan, uAceleracao;
  int uUnison;
  const Tabela* uTabela;

  // Estado de uma voz nova (como o construtor do JavaScript)
  void zerar() {
    for (int c = 0; c < MAX_UNISON; c++) {
      fases[c] = passos[c] = volumes[c] = ganhosE[c] = ganhosD[c] = misturas[c] = 0;
      niveis[c] = niveisB[c] = 0;
      agudaDemais[c] = false;
    }
    volumesDireto = false;
    volumeMeio = volumeFora = 1;
    nivel = 1;
    nivelDireto = true;
    calado = false;
    for (int i = 0; i < BLOCO; i++) somaE[i] = somaD[i] = 0;
    decimadorE.limpar();
    decimadorD.limpar();
    decimadorE.p = decimadorD.p = 0;
    usouWarp = false;
    fmFase = 0;
    uFrequencia = -1;
    uUnison = 0;
    uDetune = uWidth = uPan = uAceleracao = 0;
    uTabela = nullptr;
  }

  // Nota começando do silêncio: ponto de início de cada cópia (Phase + Rand × sorteio)
  void reiniciar(int k, const double* sorteios) {
    const double fase = ajustes[k][C_FASE];
    const double rand = ajustes[k][C_RAND];
    for (int c = 0; c < MAX_UNISON; c++) {
      const double inicio = fase + rand * sorteios[c];
      fases[c] = inicio >= 1 ? inicio - 1 : inicio;
    }
    volumesDireto = true;
    nivelDireto = true;
    usouWarp = false;
    fmFase = 0;
  }

  void limpar(int tamanho) {
    for (int i = 0; i < tamanho; i++) somaE[i] = somaD[i] = 0;
  }

  // Ajusta cada cópia de unison (altura, estéreo, nível anti-chiado)
  void ajustarCopias(double frequencia, int unison, double detune, double width, double pan, const Tabela* tabela, double aceleracao) {
    if (uFrequencia == frequencia && uUnison == unison && uDetune == detune && uWidth == width && uPan == pan &&
        uTabela == tabela && uAceleracao == aceleracao) {
      return;
    }
    uFrequencia = frequencia;
    uUnison = unison;
    uDetune = detune;
    uWidth = width;
    uPan = pan;
    uTabela = tabela;
    uAceleracao = aceleracao;

    for (int c = 0; c < unison; c++) {
      const double posicao = unison == 1 ? 0 : (static_cast<double>(c) / (unison - 1)) * 2 - 1;
      const double freq = frequencia * std::pow(2.0, (posicao * detune * DETUNE_MAXIMO) / 12);
      const double passo = freq / taxa;
      agudaDemais[c] = passo > FREQUENCIA_MAXIMA;
      passos[c] = passo < FREQUENCIA_MAXIMA ? passo : FREQUENCIA_MAXIMA;
      escolherNiveis(tabela, freq * aceleracao, taxa, niveis[c], niveisB[c], misturas[c]);
      // Estéreo "de potência igual"
      const double lugar = limitar(posicao * width + pan, -1, 1);
      const double angulo = ((1 + lugar) * PI) / 4;
      ganhosE[c] = std::cos(angulo) * M_SQRT2;
      ganhosD[c] = std::sin(angulo) * M_SQRT2;
    }
  }

  // Volumes das cópias "do meio" e "de fora" do unison, para este Blend
  void calcularVolumes(int unison, double blend) {
    const int meio = unison % 2 == 1 ? 1 : 2; // 1 cópia no meio se o Unison é ímpar, 2 se é par
    const int qtdMeio = unison < meio ? unison : meio;
    const int qtdFora = unison - qtdMeio;
    volumeMeio = 1 / std::sqrt(qtdMeio + qtdFora * blend * blend);
    volumeFora = blend * volumeMeio;
  }

  double volumeDaCopia(int c, int unison) const {
    if (c >= unison || agudaDemais[c]) return 0;
    return std::fabs(c - (unison - 1) / 2.0) <= 0.5 ? volumeMeio : volumeFora;
  }

  // FM: som do oscilador que modula (km), na taxa dobrada. Devolve a razão das alturas.
  double prepararModulador(int inicio, int fim, double frequenciaNota, double freqOsc, int km, const double* mod) {
    const int F = FATOR_WARP;
    const Tabela* tab = tabelaDe(km);
    if (!tab) {
      for (int j = F * inicio; j < F * fim; j++) fmBloco[j] = 0;
      return 0;
    }
    const Destinos& dM = DESTINOS[km];
    const double transpM = afinacaoDe(km, mod);
    const double freqM = frequenciaNota * std::pow(2.0, transpM / 12);
    const int ultimoFrame = tab->qtdFrames - 1;
    const double wt = limitar01(posicoes[km][0] + mod[dM.wtPos]) * ultimoFrame;
    const int f0 = static_cast<int>(wt) < ultimoFrame ? static_cast<int>(wt) : ultimoFrame;
    const double t = wt - f0;
    const int fB = f0 + 1 < ultimoFrame ? f0 + 1 : ultimoFrame;
    int nivelM, nivelBM;
    double misturaM;
    escolherNiveis(tab, freqM, taxa, nivelM, nivelBM, misturaM);
    const double lim = freqM / taxa;
    const double passo = (lim < FREQUENCIA_MAXIMA ? lim : FREQUENCIA_MAXIMA) / F;
    double fase = fmFase;
    for (int j = F * inicio; j < F * fim; j++) {
      fmBloco[j] = lerAmostra(tab, f0, fB, t, nivelM, nivelBM, misturaM, fase);
      fase += passo;
      if (fase >= 1) fase -= 1;
    }
    fmFase = fase;
    return freqM / freqOsc;
  }

  // Cópias com Warp, em taxa dobrada, e a volta à taxa normal
  void copiasComWarp(int inicio, int fim, int unison, int qtdCopias, const Tabela* tab, bool wtParado, int f0Parado,
                     double tParado, int modoWarp, double forca) {
    const int F = FATOR_WARP;
    const int ultimoFrame = tab->qtdFrames - 1;
    const bool fm = moduladorFM(modoWarp) >= 0;
    if (!usouWarp) {
      decimadorE.limpar();
      decimadorD.limpar();
      usouWarp = true;
    }
    for (int j = F * inicio; j < F * fim; j++) warpE[j] = warpD[j] = 0;

    for (int c = 0; c < qtdCopias; c++) {
      double fase = fases[c];
      const double meioPasso = passos[c] / F;
      const double gE = ganhosE[c], gD = ganhosD[c];
      const int nv = niveis[c], nvB = niveisB[c];
      const double mistura = misturas[c];
      const double alvo = volumeDaCopia(c, unison);
      double volume = volumes[c];
      const bool suavizando = std::fabs(volume - alvo) > 1e-4;
      if (!suavizando) volume = alvo;

      for (int i = inicio; i < fim; i++) {
        if (suavizando) volume += (alvo - volume) * suavizar;
        const int f0 = wtParado ? f0Parado : framesBloco[i];
        const double t = wtParado ? tParado : tsBloco[i];
        const int fB = f0 + 1 < ultimoFrame ? f0 + 1 : ultimoFrame;
        for (int sub = 0; sub < F; sub++) {
          double lida = fm ? faseFM(fase, forca, fmBloco[F * i + sub]) : faseWarp(modoWarp, forca, fase);
          if (lida >= 1) lida = 0;
          const double amostra = lerAmostra(tab, f0, fB, t, nv, nvB, mistura, lida) * volume;
          const int j = F * i + sub;
          warpE[j] += amostra * gE;
          warpD[j] += amostra * gD;
          fase += meioPasso;
          if (fase >= 1) fase -= 1;
        }
      }
      fases[c] = fase;
      volumes[c] = volume;
    }
    for (int i = inicio; i < fim; i++) {
      somaE[i] = decimadorE.processar(warpE[2 * i], warpE[2 * i + 1]);
      somaD[i] = decimadorD.processar(warpD[2 * i], warpD[2 * i + 1]);
    }
  }

  // Lê 4 pontos da onda (um por cópia) e liga cada um ao vizinho por uma reta.
  // j0/j1 = posição de cada ponto dentro do frame (já com o nível de cada cópia somado).
  // O WebAssembly não tem "buscar 4 lugares diferentes de uma vez": as 4 leituras são uma
  // a uma, mas as contas depois delas são feitas juntas.
  static inline v128_t lerQuatro(const float* frame, v128_t j0, v128_t j1, v128_t frac) {
    const v128_t a = wasm_f32x4_make(frame[wasm_i32x4_extract_lane(j0, 0)], frame[wasm_i32x4_extract_lane(j0, 1)],
                                     frame[wasm_i32x4_extract_lane(j0, 2)], frame[wasm_i32x4_extract_lane(j0, 3)]);
    const v128_t b = wasm_f32x4_make(frame[wasm_i32x4_extract_lane(j1, 0)], frame[wasm_i32x4_extract_lane(j1, 1)],
                                     frame[wasm_i32x4_extract_lane(j1, 2)], frame[wasm_i32x4_extract_lane(j1, 3)]);
    return wasm_f32x4_add(a, wasm_f32x4_mul(frac, wasm_f32x4_sub(b, a)));
  }

  // Sem Warp: 4 cópias de unison de uma vez (c0 a c0+3) com SIMD — cada conta é feita
  // nas 4 cópias juntas. MISTURA = alguma cópia mistura 2 níveis anti-chiado;
  // MORPH = mistura 2 frames vizinhos (WT Pos entre frames ou mudando).
  // Dentro do pedaço, a fase de cada cópia é um número inteiro de 32 bits (a volta do ciclo
  // acontece sozinha quando o número "estoura"; os bits de cima dizem o ponto da tabela e os
  // de baixo a fração entre os pontos). No fim, a fase exata (double) anda o pedaço de uma vez.
  // Cópias que não existem (4 além de qtdCopias) ficam com volume 0 e não andam.
  template <bool MISTURA, bool MORPH>
  void quatroCopias(int c0, int inicio, int fim, int unison, int qtdCopias, const Tabela* tab, bool wtParado,
                    int f0Parado, double tParado) {
    constexpr double DOIS_32 = 4294967296.0; // 2^32 = uma volta inteira do ciclo
    const int ultimoFrame = tab->qtdFrames - 1;
    const int bitsFrac = 32 - tab->bits;
    const size_t tamanhoFrame = static_cast<size_t>(tab->qtdNiveis) * tab->tamanho;

    alignas(16) uint32_t fase0[4], passo0[4];
    alignas(16) int32_t nivelA[4], nivelB[4];
    alignas(16) float mist[4], gE[4], gD[4], vol[4], alvo[4];
    bool suavizando = false;
    for (int l = 0; l < 4; l++) {
      const int c = c0 + l;
      const bool existe = c < qtdCopias;
      fase0[l] = existe ? static_cast<uint32_t>(fases[c] * DOIS_32) : 0;
      passo0[l] = existe ? static_cast<uint32_t>(passos[c] * DOIS_32 + 0.5) : 0;
      nivelA[l] = existe ? niveis[c] * tab->tamanho : 0;
      nivelB[l] = existe ? niveisB[c] * tab->tamanho : 0;
      mist[l] = existe ? static_cast<float>(misturas[c]) : 0;
      gE[l] = existe ? static_cast<float>(ganhosE[c]) : 0;
      gD[l] = existe ? static_cast<float>(ganhosD[c]) : 0;
      const double a = existe ? volumeDaCopia(c, unison) : 0;
      const double v = existe ? volumes[c] : 0;
      if (std::fabs(v - a) > 1e-4) suavizando = true;
      vol[l] = static_cast<float>(std::fabs(v - a) > 1e-4 ? v : a);
      alvo[l] = static_cast<float>(a);
    }

    v128_t vFase = wasm_v128_load(fase0);
    const v128_t vPasso = wasm_v128_load(passo0);
    const v128_t vNivelA = wasm_v128_load(nivelA), vNivelB = wasm_v128_load(nivelB);
    const v128_t vMist = wasm_v128_load(mist), vGE = wasm_v128_load(gE), vGD = wasm_v128_load(gD);
    v128_t vVol = wasm_v128_load(vol);
    const v128_t vAlvo = wasm_v128_load(alvo);
    const v128_t vSuavizar = wasm_f32x4_splat(static_cast<float>(suavizar));
    const v128_t vUm = wasm_i32x4_splat(1);
    const v128_t vMascara = wasm_i32x4_splat(tab->mascara);
    const v128_t vBaixos = wasm_i32x4_splat(static_cast<int32_t>((1u << bitsFrac) - 1));
    const v128_t vEscala = wasm_f32x4_splat(1.0f / static_cast<float>(1u << bitsFrac));

    for (int i = inicio; i < fim; i++) {
      const int f0 = wtParado ? f0Parado : framesBloco[i];
      const int fB = f0 + 1 < ultimoFrame ? f0 + 1 : ultimoFrame;
      const float* frameA = tab->dados + f0 * tamanhoFrame;

      // Ponto da tabela (i0), o vizinho (i1) e a fração entre eles, nas 4 cópias
      const v128_t i0 = wasm_u32x4_shr(vFase, bitsFrac);
      const v128_t i1 = wasm_v128_and(wasm_i32x4_add(i0, vUm), vMascara);
      const v128_t frac = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(wasm_v128_and(vFase, vBaixos)), vEscala);
      const v128_t a0 = wasm_i32x4_add(i0, vNivelA), a1 = wasm_i32x4_add(i1, vNivelA);
      v128_t b0, b1;
      if (MISTURA) {
        b0 = wasm_i32x4_add(i0, vNivelB);
        b1 = wasm_i32x4_add(i1, vNivelB);
      }

      v128_t y = lerQuatro(frameA, a0, a1, frac);
      if (MISTURA) y = wasm_f32x4_add(y, wasm_f32x4_mul(vMist, wasm_f32x4_sub(lerQuatro(frameA, b0, b1, frac), y)));
      if (MORPH) {
        const float* frameB = tab->dados + fB * tamanhoFrame;
        v128_t z = lerQuatro(frameB, a0, a1, frac);
        if (MISTURA) z = wasm_f32x4_add(z, wasm_f32x4_mul(vMist, wasm_f32x4_sub(lerQuatro(frameB, b0, b1, frac), z)));
        const v128_t t = wasm_f32x4_splat(static_cast<float>(wtParado ? tParado : tsBloco[i]));
        y = wasm_f32x4_add(y, wasm_f32x4_mul(t, wasm_f32x4_sub(z, y)));
      }

      if (suavizando) vVol = wasm_f32x4_add(vVol, wasm_f32x4_mul(wasm_f32x4_sub(vAlvo, vVol), vSuavizar));
      y = wasm_f32x4_mul(y, vVol);
      const v128_t e = wasm_f32x4_mul(y, vGE);
      const v128_t d = wasm_f32x4_mul(y, vGD);
      // Soma das 4 cópias: [e0+e2, e1+e3, d0+d2, d1+d3] → lugar 0 = esquerda, lugar 2 = direita
      const v128_t p = wasm_f32x4_add(wasm_i32x4_shuffle(e, d, 0, 1, 4, 5), wasm_i32x4_shuffle(e, d, 2, 3, 6, 7));
      const v128_t q = wasm_f32x4_add(p, wasm_i32x4_shuffle(p, p, 1, 0, 3, 2));
      somaE[i] += wasm_f32x4_extract_lane(q, 0);
      somaD[i] += wasm_f32x4_extract_lane(q, 2);

      vFase = wasm_i32x4_add(vFase, vPasso);
    }

    // Guarda a fase exata e o volume de cada cópia
    wasm_v128_store(vol, vVol);
    const int qtd = fim - inicio;
    for (int l = 0; l < 4; l++) {
      const int c = c0 + l;
      if (c >= qtdCopias) break;
      const double f = fases[c] + qtd * passos[c];
      fases[c] = f - std::floor(f);
      volumes[c] = suavizando ? vol[l] : volumeDaCopia(c, unison);
    }
  }

  // Calcula um pedaço (amostras "inicio" até "fim") do oscilador k e soma em somaE/somaD
  void processarPedaco(int k, int inicio, int fim, double frequencia, const double* mod, const double* modAnt) {
    const double* a = ajustes[k];
    const Destinos& d = DESTINOS[k];
    const Tabela* tab = tabelaDe(k);
    const int unison = static_cast<int>(a[C_UNISON]);
    const int qtd = fim - inicio;
    const double s = suavizar;

    // Nível (liga/desliga e knob Nível + modulação). Desligado e silencioso: nem calcula.
    const bool ligado = a[C_LIGADO] != 0 && tab != nullptr;
    const double alvoNivel = ligado ? limitar01(a[C_NIVEL] + mod[d.nivel]) * a[C_GANHO] : 0;
    if (nivelDireto) {
      nivel = alvoNivel;
      nivelDireto = false;
    }
    calado = alvoNivel == 0 && nivel < 1e-5;
    if (calado) {
      nivel = 0;
      usouWarp = false;
      return;
    }

    // Warp: modo e força deste pedaço
    const int modoWarp = static_cast<int>(a[C_WARP_MODO]);
    const double forca = modoWarp == W_NENHUM ? 1 : forcaWarp(modoWarp, limitar01(a[C_WARP] + mod[d.warp]));

    const double transposicao = afinacaoDe(k, mod);
    const double freqOsc = transposicao == 0 ? frequencia : frequencia * std::pow(2.0, transposicao / 12);

    const int qualModula = moduladorFM(modoWarp);
    double aceleracao = modoWarp == W_NENHUM ? 1 : aceleracaoWarp(modoWarp, forca);
    if (qualModula >= 0) {
      const double razao = prepararModulador(inicio, fim, frequencia, freqOsc, qualModula, mod);
      aceleracao = aceleracaoFM(forca, razao);
    }

    ajustarCopias(freqOsc, unison, limitar01(a[C_DETUNE] + mod[d.detune]), limitar01(a[C_WIDTH] + mod[d.width]),
                  limitar(a[C_PAN] + mod[d.pan] * 2, -1, 1), tab, aceleracao);

    calcularVolumes(unison, limitar01(a[C_BLEND] + mod[d.blend]));
    if (volumesDireto) {
      for (int c = 0; c < MAX_UNISON; c++) volumes[c] = volumeDaCopia(c, unison);
      volumesDireto = false;
    }
    // Cópias acima do Unison atual continuam só até sumirem (se o Unison diminuiu)
    int qtdCopias = unison;
    for (int c = unison; c < MAX_UNISON; c++)
      if (volumes[c] > 1e-5) qtdCopias = c + 1;

    // Posição na wavetable: parada no pedaço ou mudando a cada amostra
    const int ultimoFrame = tab->qtdFrames - 1;
    const double* pos = posicoes[k];
    const bool variasPosicoes = a[C_QTD_POSICOES] > 1;
    const double wtModIni = modAnt[d.wtPos];
    const double wtModFim = mod[d.wtPos];
    const bool wtParado = !variasPosicoes && wtModIni == wtModFim;
    int f0Parado = 0;
    double tParado = 0;
    if (wtParado) {
      const double wt = limitar01(pos[0] + wtModFim) * ultimoFrame;
      f0Parado = static_cast<int>(wt) < ultimoFrame ? static_cast<int>(wt) : ultimoFrame;
      tParado = wt - f0Parado;
    } else {
      for (int i = inicio; i < fim; i++) {
        const double base = variasPosicoes ? pos[i] : pos[0];
        const double m = wtModIni + (static_cast<double>(i - inicio + 1) / qtd) * (wtModFim - wtModIni);
        const double wt = limitar01(base + m) * ultimoFrame;
        const int f0 = static_cast<int>(wt) < ultimoFrame ? static_cast<int>(wt) : ultimoFrame;
        framesBloco[i] = f0;
        tsBloco[i] = wt - f0;
      }
    }

    if (modoWarp != W_NENHUM) {
      copiasComWarp(inicio, fim, unison, qtdCopias, tab, wtParado, f0Parado, tParado, modoWarp, forca);
    } else {
      usouWarp = false;
      // Sem Warp: as cópias de unison de 4 em 4 (SIMD). Escolhe a versão do laço que faz
      // só as contas necessárias: mistura entre níveis (alguma cópia no fim da faixa) e
      // morphing entre 2 frames (WT Pos entre frames ou mudando).
      bool comMistura = false;
      for (int c = 0; c < qtdCopias; c++)
        if (misturas[c] > 0) comMistura = true;
      const bool comMorph = !wtParado || tParado > 0;
      for (int c0 = 0; c0 < qtdCopias; c0 += 4) {
        if (comMistura) {
          if (comMorph) quatroCopias<true, true>(c0, inicio, fim, unison, qtdCopias, tab, wtParado, f0Parado, tParado);
          else quatroCopias<true, false>(c0, inicio, fim, unison, qtdCopias, tab, wtParado, f0Parado, tParado);
        } else {
          if (comMorph) quatroCopias<false, true>(c0, inicio, fim, unison, qtdCopias, tab, wtParado, f0Parado, tParado);
          else quatroCopias<false, false>(c0, inicio, fim, unison, qtdCopias, tab, wtParado, f0Parado, tParado);
        }
      }
    }

    // Nível do oscilador (liga/desliga e knob Nível), em rampa suave
    if (alvoNivel != 1 || nivel != 1) {
      for (int i = inicio; i < fim; i++) {
        nivel += (alvoNivel - nivel) * s;
        somaE[i] *= nivel;
        somaD[i] *= nivel;
      }
      if (std::fabs(nivel - alvoNivel) < 1e-5) nivel = alvoNivel;
    }
  }
};

OscVoz osciladores[MAX_VOZES][N_OSC];

// =================== F2a: modulação e envelopes ===================

constexpr int PEDACO = 64;          // amostras por pedaço de modulação (igual a dsp/voz.js)
constexpr int N_FONTES = 9;         // LFO 1, LFO 2, ENV 2, ENV 3, LFO 3, Macro 1–4
constexpr int N_LFO = 3;
constexpr int MAX_DESTINOS = 160;   // destinos de modulação (hoje 93; o JS diz quantos são)
constexpr int MAX_LIGACOES = 256;

// Onde cada fonte fica na lista de fontes (mesmos de FONTES_MOD em dsp/modulacao.js) e os
// destinos "Rate" dos LFOs. Mudou lá? Mudar aqui também.
constexpr int INDICES_LFO[N_LFO] = { 0, 1, 4 };
constexpr int INDICES_ENV[2] = { 2, 3 };
constexpr int INDICES_MACRO[4] = { 5, 6, 7, 8 };
constexpr int D_RATE_LFO[N_LFO] = { 35, 36, 37 };

// Sorteio próprio (xorshift) para o S&H dos LFOs: um valor novo a cada ciclo.
// (Os sorteios do início da nota vêm do JavaScript.)
uint32_t estadoSorteio = 2463534242u;
double sortear() {  // número entre -1 e 1
  uint32_t x = estadoSorteio;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  estadoSorteio = x;
  return x / 2147483648.0 - 1;
}

// ---------- Envelope ADSR (igual ao antigo dsp/envelope.js) ----------
// Ataque sobe em linha reta; Decay e Release caem em curva (tempo = queda até -60 dB).
enum { PARADO, ATAQUE, DECAIMENTO, SUSTENTACAO, SOLTURA };
constexpr double ATAQUE_MINIMO = 0.0015; // mínimos anti-estalo
constexpr double QUEDA_MINIMA = 0.006;
constexpr double QUEDA_ROUBO = 0.004;    // voz roubada some neste tempo
constexpr double FIM_SOLTURA = 1e-4;     // abaixo disso (-80 dB) a nota termina
constexpr double QUEDA_60DB = -6.907755278982137; // log(0,001) (número fixo: o .wasm não roda contas "ao nascer")

struct Envelope {
  int estagio;
  double nivel;
  bool rapido; // sumindo rápido (voz roubada)
  double suavizarSustentacao, coefRoubo;
  bool definido;
  double ataqueDefinido, decaimentoDefinido, solturaDefinida, sustentacao;
  double passoAtaque, coefDecaimento, coefSoltura;

  void zerar() {
    estagio = PARADO;
    nivel = 0;
    rapido = false;
    // Se o S mudar com a nota segurada, o volume acompanha em ~5 ms (sem degrau)
    suavizarSustentacao = 1 - std::exp(-1 / (0.005 * taxa));
    coefRoubo = std::exp(QUEDA_60DB / (QUEDA_ROUBO * taxa));
    definido = false;
    definir(0.005, 0.5, 1, 0.08);
  }

  // Tempos em segundos; sustentação de 0 a 1 (se nada mudou, não refaz as contas)
  void definir(double ataque, double decaimento, double sust, double soltura) {
    if (definido && ataque == ataqueDefinido && decaimento == decaimentoDefinido && soltura == solturaDefinida &&
        sust == sustentacao) {
      return;
    }
    definido = true;
    ataqueDefinido = ataque;
    decaimentoDefinido = decaimento;
    solturaDefinida = soltura;
    passoAtaque = 1 / ((ataque > ATAQUE_MINIMO ? ataque : ATAQUE_MINIMO) * taxa);
    coefDecaimento = std::exp(QUEDA_60DB / ((decaimento > QUEDA_MINIMA ? decaimento : QUEDA_MINIMA) * taxa));
    coefSoltura = std::exp(QUEDA_60DB / ((soltura > QUEDA_MINIMA ? soltura : QUEDA_MINIMA) * taxa));
    sustentacao = sust;
  }

  // Começa (ou recomeça) a nota a partir do nível atual: nunca pula, nunca estala
  void disparar() {
    estagio = ATAQUE;
    rapido = false;
  }
  void soltar() {
    if (estagio != PARADO) estagio = SOLTURA;
  }
  void silenciarRapido() {
    if (estagio == PARADO) return;
    estagio = SOLTURA;
    rapido = true;
  }
  bool ativo() const { return estagio != PARADO; }

  // Próximo valor (um por amostra)
  double proximo() {
    switch (estagio) {
      case ATAQUE:
        nivel += passoAtaque;
        if (nivel >= 1) {
          nivel = 1;
          estagio = DECAIMENTO;
        }
        break;
      case DECAIMENTO:
        nivel = sustentacao + (nivel - sustentacao) * coefDecaimento;
        if (std::fabs(nivel - sustentacao) < 1e-4) estagio = SUSTENTACAO;
        break;
      case SUSTENTACAO:
        nivel += (sustentacao - nivel) * suavizarSustentacao;
        break;
      case SOLTURA:
        nivel *= rapido ? coefRoubo : coefSoltura;
        if (nivel < FIM_SOLTURA) {
          nivel = 0;
          estagio = PARADO;
          rapido = false;
        }
        break;
    }
    return nivel;
  }

  // Anda "qtd" amostras de uma vez (envelope de modulação sem ligação: ninguém ouve,
  // mas ele continua andando certo). Mudança de estágio no meio: passo a passo.
  double avancar(int qtd) {
    switch (estagio) {
      case PARADO:
        return nivel;
      case ATAQUE: {
        const double n = nivel + passoAtaque * qtd;
        if (n < 1) return nivel = n;
        break;
      }
      case DECAIMENTO: {
        const double n = sustentacao + (nivel - sustentacao) * std::pow(coefDecaimento, qtd);
        if (std::fabs(n - sustentacao) >= 1e-4) return nivel = n;
        break;
      }
      case SUSTENTACAO:
        nivel += (sustentacao - nivel) * (1 - std::pow(1 - suavizarSustentacao, qtd));
        return nivel;
      case SOLTURA: {
        const double n = nivel * std::pow(rapido ? coefRoubo : coefSoltura, qtd);
        if (n >= FIM_SOLTURA) return nivel = n;
        break;
      }
    }
    for (int k = 0; k < qtd; k++) proximo();
    return nivel;
  }
};

// ---------- LFO (igual ao antigo dsp/lfo.js) ----------
// Formas (mesma ordem de FORMAS_LFO): seno, triângulo, serra sobe, serra desce, quadrada, S&H
enum { F_SENO, F_TRIANGULO, F_SERRA_SOBE, F_SERRA_DESCE, F_QUADRADA, F_ALEATORIO };
constexpr double RATE_MIN = 0.02;
constexpr double RATE_MAX = 40;
constexpr double LOG_FAIXA_RATE = 7.600902459542082; // log(40 / 0,02)

// Rate com modulação: soma na posição do knob (0 a 1, escala exponencial)
double rateModulado(double rate, double mod) {
  if (mod == 0) return rate;
  const double posicao = std::log(rate / RATE_MIN) / LOG_FAIXA_RATE + mod;
  return RATE_MIN * std::exp(limitar01(posicao) * LOG_FAIXA_RATE);
}

struct EstadoLfo {
  double fase = 0;
  double aleatorio = 0;
  void avancar(double passo) {
    fase += passo;
    if (fase >= 1) {
      fase -= std::floor(fase);
      aleatorio = sortear();
    }
  }
  double valor(int forma) const {
    switch (forma) {
      case F_SENO: return std::sin(2 * PI * fase);
      case F_TRIANGULO:
        if (fase < 0.25) return 4 * fase;
        if (fase < 0.75) return 2 - 4 * fase;
        return 4 * fase - 4;
      case F_SERRA_SOBE: return 2 * fase - 1;
      case F_SERRA_DESCE: return 1 - 2 * fase;
      case F_QUADRADA: return fase < 0.5 ? 1 : -1;
      case F_ALEATORIO: return aleatorio;
      default: return 0;
    }
  }
};

// Mesa: ajustes dos LFOs, dos envelopes e dos Macros (o JS escreve por bloco)
enum { L_FORMA, L_RATE, L_LIVRE, N_CAMPOS_LFO };
double ajustesLfo[N_LFO][N_CAMPOS_LFO];
double ajustesEnv[3][4];   // ENV 1 (volume), ENV 2, ENV 3: Attack, Decay, Sustain, Release
double macrosAlvo[4];      // valor escolhido na tela
double macros[4];          // valor em uso (suavizado ~10 ms)
double suavizarMacros = 0;
double suavizarMod = 0;    // ~2 ms por pedaço: saltos (LFO quadrado, S&H) viram rampas curtíssimas

// LFOs Livres: um só para todas as notas, rodando sempre (1 valor por pedaço)
EstadoLfo livres[N_LFO];
double valoresLivres[N_LFO][BLOCO / PEDACO];
int ultimoPedacoLivre = 0;

// ---------- Ligações de modulação (igual à antiga MatrizModulacao) ----------
struct Ligacao {
  int fonte, destino;
  double alvo, atual; // a quantidade anda até o alvo em ~10 ms (sem estalo)
  bool removida;      // saiu da lista: vai sumindo até zero e depois sai
};
Ligacao ligacoes[MAX_LIGACOES];
int qtdLigacoes = 0;
int qtdDestinos = 0;                  // quantos destinos existem (o JS diz)
double suavizarLigacoes = 0;
uint8_t usos[MAX_DESTINOS];           // 1 = destino sendo modulado
uint8_t usosFonte[N_FONTES];          // 1 = fonte ligada a algo
double entradaLigacoes[MAX_LIGACOES * 3]; // mesa: lista nova (fonte, destino, quantidade)
double modEfeitos[MAX_DESTINOS];      // soma para os knobs dos efeitos (somarEfeitos)

// Soma a modulação de cada destino, dados os valores das fontes
void somarLigacoes(const double* fontes, double* destino) {
  for (int d = 0; d < qtdDestinos; d++) destino[d] = 0;
  for (int k = 0; k < qtdLigacoes; k++) {
    const Ligacao& l = ligacoes[k];
    destino[l.destino] += l.atual * fontes[l.fonte];
  }
}

// =================== F2b: filtros, ruído, rotas e a voz inteira ===================

// Destinos de modulação usados aqui (mesmos de dsp/modulacao.js)
constexpr int D_CUTOFF = 3, D_RESO = 4, D_RUIDO = 5, D_CUTOFF2 = 7, D_RESO2 = 8;
constexpr int D_RUIDO_PITCH = 38, D_RUIDO_DURACAO = 39;

// ---------- Filtro (igual ao antigo dsp/filtro.js) ----------
// SVF (state variable filter) na versão digital estável (TPT): aguenta o Cutoff mudando
// rápido sem estalos, e com ressonância alta assobia sem "explodir".
// Tipos (mesma ordem de TIPOS_FILTRO): LP 12, LP 24, HP, BP.
enum { T_LP12, T_LP24, T_HP, T_BP };

// Coeficientes (dependem só do Cutoff e da Reso)
struct Coefs {
  double k, compensacao, a1, a2, a3, b1, b2, b3;
};
double freqMaximaFiltro = 20000;

inline double amortecimento(double reso) { return 2 - 1.9 * limitar01(reso); }
// Com ressonância alta, o volume do LP/HP baixa (não estoura)
inline double compensacaoResonancia(double reso) { return 1 / (1 + 1.5 * limitar01(reso)); }

void calcularCoefs(Coefs& c, double corte, double reso) {
  const double f = std::fmin(std::fmax(corte, 20.0), freqMaximaFiltro);
  const double g = std::tan((PI * f) / taxa);
  // Estágio 1: com a ressonância escolhida
  c.k = amortecimento(reso);
  c.compensacao = compensacaoResonancia(reso);
  c.a1 = 1 / (1 + g * (g + c.k));
  c.a2 = g * c.a1;
  c.a3 = g * c.a2;
  // Estágio 2 (só para o LP 24): sem ressonância extra, só aumenta o corte
  c.b1 = 1 / (1 + g * (g + M_SQRT2));
  c.b2 = g * c.b1;
  c.b3 = g * c.b2;
}

// Coeficientes de um bloco: 1 valor (Cutoff/Reso parados) ou 1 por amostra (mudando)
struct CoefsBloco {
  Coefs c[BLOCO];
  bool variavel;

  void calcular(const double* cortes, int qtdCortes, const double* resos, int qtdResos, int tamanho) {
    variavel = qtdCortes > 1 || qtdResos > 1;
    const int n = variavel ? tamanho : 1;
    for (int j = 0; j < n; j++) calcularCoefs(c[j], qtdCortes > 1 ? cortes[j] : cortes[0], qtdResos > 1 ? resos[j] : resos[0]);
  }

  // De "inicio" até "fim": em linha reta dos coeficientes "de" até "ate" (transição suave)
  void interpolar(const Coefs& de, const Coefs& ate, int inicio, int fim) {
    const int qtd = fim - inicio;
    for (int i = inicio; i < fim; i++) {
      const double t = static_cast<double>(i - inicio + 1) / qtd;
      Coefs& d = c[i];
      d.k = de.k + t * (ate.k - de.k);
      d.compensacao = de.compensacao + t * (ate.compensacao - de.compensacao);
      d.a1 = de.a1 + t * (ate.a1 - de.a1);
      d.a2 = de.a2 + t * (ate.a2 - de.a2);
      d.a3 = de.a3 + t * (ate.a3 - de.a3);
      d.b1 = de.b1 + t * (ate.b1 - de.b1);
      d.b2 = de.b2 + t * (ate.b2 - de.b2);
      d.b3 = de.b3 + t * (ate.b3 - de.b3);
    }
  }
};

// A "memória" de um filtro (uma por lado, por etapa, por voz)
struct Filtro {
  double pesos[4], alvos[4]; // pesos de cada tipo: trocar de tipo = transição de ~5 ms
  double mistura, alvoMistura; // liga/desliga gradual: 0 = som direto, 1 = filtrado
  bool estagio2;               // o 2º estágio (LP 24) está sendo calculado
  double ultimoPassaBaixas;
  double s1, s2, s3, s4;

  void nascer() {
    for (int j = 0; j < 4; j++) pesos[j] = alvos[j] = j == T_LP24 ? 1 : 0;
    mistura = alvoMistura = 0;
    estagio2 = true;
    ultimoPassaBaixas = 0;
    reiniciar();
  }

  // Zera a memória (voz começando do silêncio); tipo e liga/desliga vão direto ao escolhido
  void reiniciar() {
    s1 = s2 = s3 = s4 = 0;
    for (int j = 0; j < 4; j++) pesos[j] = alvos[j];
    mistura = alvoMistura;
    estagio2 = alvos[T_LP24] == 1;
    ultimoPassaBaixas = 0;
  }

  void definirTipo(int indice) {
    if (indice < 0 || indice > 3) return;
    for (int j = 0; j < 4; j++) alvos[j] = j == indice ? 1 : 0;
    if (indice == T_LP24 && !estagio2) {
      // Voltando para o LP 24 com a nota tocando: o 2º estágio começa "carregado" com o som
      // atual do 1º, para a troca continuar suave
      s3 = 0;
      s4 = ultimoPassaBaixas;
      estagio2 = true;
    }
  }

  void definirLigado(bool ligado) {
    // Religando depois de totalmente desligado: começa com a memória limpa
    if (ligado && alvoMistura == 0 && mistura < 1e-5) s1 = s2 = s3 = s4 = 0;
    alvoMistura = ligado ? 1 : 0;
  }

  bool ativo() const { return !(alvoMistura == 0 && mistura < 1e-5); }

  // Filtra uma amostra
  double processar(double x, const Coefs& c) {
    if (alvoMistura == 0 && mistura < 1e-5) return x; // desligado: passa direto
    const double k = c.k;
    // Estágio 1
    const double v3 = x - s2;
    const double v1 = c.a1 * s1 + c.a2 * v3;
    const double v2 = s2 + c.a2 * s1 + c.a3 * v3;
    s1 = 2 * v1 - s1;
    s2 = 2 * v2 - s2;
    const double passaBaixas = v2;
    const double passaBanda = k * v1;
    const double passaAltas = x - k * v1 - v2;
    // Estágio 2: passa-baixas de novo, em cima do primeiro (LP 24)
    double passaBaixas24 = 0;
    if (estagio2) {
      const double w3 = passaBaixas - s4;
      const double w1 = c.b1 * s3 + c.b2 * w3;
      const double w2 = s4 + c.b2 * s3 + c.b3 * w3;
      s3 = 2 * w1 - s3;
      s4 = 2 * w2 - s4;
      passaBaixas24 = w2;
    } else {
      ultimoPassaBaixas = passaBaixas;
    }
    // Mistura os tipos conforme os pesos (que andam suavemente até o tipo escolhido)
    const double s = suavizar;
    pesos[0] += (alvos[0] - pesos[0]) * s;
    pesos[1] += (alvos[1] - pesos[1]) * s;
    if (estagio2 && alvos[1] == 0 && pesos[1] < 1e-6) {
      pesos[1] = 0;
      estagio2 = false;
    }
    pesos[2] += (alvos[2] - pesos[2]) * s;
    pesos[3] += (alvos[3] - pesos[3]) * s;
    const double filtrado =
        (pesos[0] * passaBaixas + pesos[1] * passaBaixas24 + pesos[2] * passaAltas) * c.compensacao + pesos[3] * passaBanda;
    mistura += (alvoMistura - mistura) * s;
    return x + mistura * (filtrado - x);
  }
};

// Tipo e liga/desliga escolhidos para os Filtros 1 e 2 (valem para todas as vozes; uma voz
// recriada volta com eles)
int tipoFiltroEscolhido[2] = { T_LP24, T_LP24 };
bool filtroLigadoEscolhido[2] = { false, false };

// ---------- Ruído (igual ao antigo dsp/ruido.js) ----------
// Para cada tipo (White, Pink, Brown), UM trecho de 4 s montado ao ligar; as notas tocam o
// trecho como um "sample" (em loop ou One Shot), mais rápido ou mais devagar.
constexpr double SEGUNDOS_TRECHO = 4;
constexpr int EMENDA = 4096; // mistura suave entre o fim e o começo (loop sem estalo)
constexpr double NOTA_BASE_RUIDO = 60; // C4: nesta nota o ruído toca na velocidade normal
float* trechosRuido[3] = { nullptr, nullptr, nullptr };
int tamanhoTrecho = 0;

struct GeradorRuido {
  uint32_t estado;
  double p0 = 0, p1 = 0, p2 = 0, marrom = 0;
  explicit GeradorRuido(uint32_t semente) {
    estado = static_cast<uint32_t>(static_cast<uint64_t>(semente) * 2654435761u);
    if (!estado) estado = 1;
  }
  double sortear() { // -1 a 1
    uint32_t x = estado;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    estado = x;
    return estado / 2147483648.0 - 1;
  }
  double proximo(int tipo) {
    const double branco = sortear();
    switch (tipo) {
      case 1: // pink: soma de 3 filtros suaves (receita de Paul Kellet, versão econômica)
        p0 = 0.99765 * p0 + branco * 0.099046;
        p1 = 0.963 * p1 + branco * 0.2965164;
        p2 = 0.57 * p2 + branco * 1.0526913;
        return (p0 + p1 + p2 + branco * 0.1848) * 0.197;
      case 2: // brown: vai somando o branco devagar, com vazamento
        marrom = (marrom + 0.02 * branco) / 1.02;
        return marrom * 3.5 * 1.71;
      default: // white
        return branco * 0.6;
    }
  }
};

// Monta um trecho que dá a volta sem emenda (as últimas amostras entram misturadas no começo)
void montarTrecho(int tipo, float* trecho, int tamanho) {
  GeradorRuido gerador(12345);
  for (int i = 0; i < 8192; i++) gerador.proximo(tipo); // aquece os filtros do pink/brown
  float* cru = static_cast<float*>(std::malloc(sizeof(float) * (tamanho + EMENDA)));
  for (int i = 0; i < tamanho + EMENDA; i++) cru[i] = static_cast<float>(gerador.proximo(tipo));
  for (int i = 0; i < tamanho; i++) trecho[i] = cru[i];
  for (int i = 0; i < EMENDA; i++) {
    const double t = static_cast<double>(i) / EMENDA;
    trecho[i] = static_cast<float>(cru[i] * std::sin((t * PI) / 2) + cru[tamanho + i] * std::cos((t * PI) / 2));
  }
  std::free(cru);
}

// ---------- Mesa: ajustes da voz (o JS escreve por bloco) ----------
enum CampoVoz {
  V_ROTA_A, V_ROTA_B, V_ROTA_C, V_ROTA_RUIDO, // rotas: 0 = F1, 1 = F2, 2 = F1→F2, 3 = F2→F1
  V_RUIDO_LIGADO, V_RUIDO_TIPO, V_RUIDO_NIVEL, V_RUIDO_ONESHOT, V_RUIDO_DURACAO, V_RUIDO_TRACK,
  V_RUIDO_PITCH, V_RUIDO_UNICO,
  V_QTD_CORTES1, V_QTD_RESOS1, V_QTD_CORTES2, V_QTD_RESOS2, // 1 valor ou 1 por amostra
  N_CAMPOS_VOZ
};
double ajustesVoz[N_CAMPOS_VOZ];
double cortesResos[4][BLOCO]; // Cutoff 1, Reso 1, Cutoff 2, Reso 2 (dos knobs)
CoefsBloco coefsGlobais[2];   // Filtros 1 e 2 sem modulação (iguais para todas as vozes)

constexpr double CORTE_MIN = 20; // Cutoff modulado anda na escala do knob (20 Hz a 20 kHz)
constexpr double LOG_FAIXA_CORTE = 6.907755278982137; // log(1000)
constexpr double PITCH_RUIDO_MAX = 24;
constexpr double DURACAO_RUIDO_MIN = 0.005;
constexpr double LOG_FAIXA_DURACAO = 5.991464547107982; // log(2 / 0,005)

inline double notaParaFrequencia(double nota) { return 440 * std::pow(2.0, (nota - 69) / 12); }

// ---------- Uma voz (uma nota tocando) ----------
//   OSC A, B, C ─┐
//                ├─ cada um pela sua rota de filtro ─→ ENV 1 (volume)
//   ruído ───────┘
// + as fontes de modulação da própria nota (LFOs Retrig, ENV 2 e 3).
struct Etapa {
  int numero; // 0 = Filtro 1, 1 = Filtro 2
  Filtro par[2]; // esquerdo, direito (memória própria desta etapa)
};
struct Rota {
  int qtdEtapas;
  Etapa etapas[2];
  double somaE[BLOCO], somaD[BLOCO]; // "caixa": as fontes desta rota somam aqui
  bool usada;
};
struct FiltroModulado { // Cutoff/Reso modulados: coeficientes próprios da voz
  CoefsBloco coef;
  Coefs pontas[2]; // início e fim do pedaço
  bool novo;
};

struct Voz {
  Envelope envs[3];       // [0] = ENV 1 (volume), [1] = ENV 2, [2] = ENV 3
  EstadoLfo lfos[N_LFO];  // LFOs em modo Retrig (um por nota)
  double fontes[N_FONTES];
  double modAlvo[MAX_DESTINOS];     // soma "crua" das ligações
  double mod[MAX_DESTINOS];         // modulação deste pedaço (suavizada ~2 ms)
  double modAnterior[MAX_DESTINOS]; // do pedaço anterior (os osciladores fazem rampa entre os dois)
  bool modNova;   // ainda não tem "pedaço anterior"
  bool modZerada; // mod e modAnterior todos em zero

  Rota rotas[4];  // f1, f2, f12 (1 → 2), f21 (2 → 1)
  int usadas[4];  // rotas com som neste bloco, na ordem em que foram usadas
  int qtdUsadas;
  FiltroModulado filtrosMod[2];

  double ruidoPos, nivelRuido, ruidoOneShot; // posição no trecho, nível suavizado, queda do One Shot
  double ruidoBloco[BLOCO];

  double altura, alturaAlvo, passoGlide, frequencia; // Glide: em semitons
  double fases[MAX_UNISON]; // pontos de início sorteados para a nota nova
  bool fasesPendentes;      // os osciladores ainda não receberam os pontos de início
  bool tocou[N_OSC];
  double saidaE[BLOCO], saidaD[BLOCO]; // som desta voz no bloco (o JS soma na saída)

  void zerar() {
    for (auto& e : envs) e.zerar();
    for (auto& l : lfos) l = EstadoLfo();
    for (double& f : fontes) f = 0;
    for (int d = 0; d < MAX_DESTINOS; d++) modAlvo[d] = mod[d] = modAnterior[d] = 0;
    modNova = true;
    modZerada = true;
    const int numeros[4][2] = { { 0, -1 }, { 1, -1 }, { 0, 1 }, { 1, 0 } };
    for (int r = 0; r < 4; r++) {
      Rota& rota = rotas[r];
      rota.qtdEtapas = numeros[r][1] < 0 ? 1 : 2;
      for (int e = 0; e < rota.qtdEtapas; e++) {
        Etapa& etapa = rota.etapas[e];
        etapa.numero = numeros[r][e];
        for (Filtro& f : etapa.par) {
          f.nascer();
          f.definirTipo(tipoFiltroEscolhido[etapa.numero]);
          f.definirLigado(filtroLigadoEscolhido[etapa.numero]);
        }
      }
      rota.usada = false;
    }
    qtdUsadas = 0;
    for (auto& f : filtrosMod) {
      f.coef.variavel = true;
      f.novo = true;
    }
    ruidoPos = nivelRuido = 0;
    ruidoOneShot = 1;
    altura = alturaAlvo = 69;
    passoGlide = 0;
    frequencia = 440;
    fasesPendentes = false;
  }

  // Tipo (campo 0) ou liga/desliga (campo 1) do Filtro "numero": todas as etapas dele
  void definirFiltro(int numero, int campo, int valor) {
    for (Rota& rota : rotas) {
      for (int e = 0; e < rota.qtdEtapas; e++) {
        if (rota.etapas[e].numero != numero) continue;
        for (Filtro& f : rota.etapas[e].par) {
          if (campo == 0) f.definirTipo(valor);
          else f.definirLigado(valor != 0);
        }
      }
    }
  }

  // Lê as fontes no fim de um pedaço de "qtd" amostras
  void lerFontes(int qtd, int pedaco) {
    for (int l = 0; l < N_LFO; l++) {
      const int i = INDICES_LFO[l];
      const int forma = static_cast<int>(ajustesLfo[l][L_FORMA]);
      if (ajustesLfo[l][L_LIVRE] != 0) {
        fontes[i] = valoresLivres[l][pedaco];
      } else {
        // Rate modulado: usa a modulação do pedaço anterior (a deste ainda não existe)
        const double rate = rateModulado(ajustesLfo[l][L_RATE], mod[D_RATE_LFO[l]]);
        lfos[l].avancar((rate * qtd) / taxa);
        fontes[i] = lfos[l].valor(forma);
      }
    }
    for (int e = 0; e < 2; e++) {
      Envelope& env = envs[1 + e];
      const int i = INDICES_ENV[e];
      if (usosFonte[i]) {
        for (int k = 0; k < qtd; k++) env.proximo(); // ligado a algo: amostra por amostra
      } else {
        env.avancar(qtd); // sem ligação: anda o pedaço de uma vez
      }
      fontes[i] = env.nivel;
    }
    for (int m = 0; m < 4; m++) fontes[INDICES_MACRO[m]] = macros[m];
  }

  // Caixa de uma rota neste bloco (na primeira vez que é usada: zera e entra na lista)
  Rota& caixa(int r, int tamanho) {
    if (r < 0 || r > 3) r = 0;
    Rota& rota = rotas[r];
    if (!rota.usada) {
      for (int i = 0; i < tamanho; i++) rota.somaE[i] = rota.somaD[i] = 0;
      rota.usada = true;
      usadas[qtdUsadas++] = r;
    }
    return rota;
  }

  // Coeficientes de um filtro com Cutoff/Reso modulados, em rampa suave no pedaço
  void atualizarFiltroModulado(FiltroModulado& f, int n, double modCorte, double modReso, int inicio, int fim) {
    const int j = fim - 1;
    const double* cortes = cortesResos[2 * n];
    const double* resos = cortesResos[2 * n + 1];
    const double corteBase = ajustesVoz[V_QTD_CORTES1 + 2 * n] > 1 ? cortes[j] : cortes[0];
    const double resoBase = ajustesVoz[V_QTD_RESOS1 + 2 * n] > 1 ? resos[j] : resos[0];
    const double posicaoCorte = std::log(std::fmax(corteBase, CORTE_MIN) / CORTE_MIN) / LOG_FAIXA_CORTE;
    const double corte = CORTE_MIN * std::exp(limitar01(posicaoCorte + modCorte) * LOG_FAIXA_CORTE);
    const double reso = limitar01(resoBase + modReso);
    calcularCoefs(f.pontas[1], corte, reso);
    if (f.novo) {
      f.pontas[0] = f.pontas[1];
      f.novo = false;
    }
    f.coef.interpolar(f.pontas[0], f.pontas[1], inicio, fim);
    f.pontas[0] = f.pontas[1];
  }

  // Calcula o som desta voz no bloco (em saidaE/saidaD). "v" = número dela.
  // "sorteioRuido" (0 a 1, ou < 0 = nenhum): nota nova, o ruído recomeça (Loop: de um ponto
  // sorteado; One Shot: do início). "dona" = é a voz da nota mais recente (o "1 ruído").
  void processar(int v, int tamanho, double sorteioRuido, bool dona) {
    const bool oneShot = ajustesVoz[V_RUIDO_ONESHOT] != 0;
    const int tipoRuido = static_cast<int>(ajustesVoz[V_RUIDO_TIPO]);
    const float* trecho = trechosRuido[tipoRuido >= 0 && tipoRuido < 3 ? tipoRuido : 0];
    if (sorteioRuido >= 0) {
      ruidoPos = oneShot ? 0 : std::floor(sorteioRuido * tamanhoTrecho);
      ruidoOneShot = 1;
    }
    // Nota nova: os osciladores recebem os pontos de início sorteados
    if (fasesPendentes) {
      for (int k = 0; k < N_OSC; k++) osciladores[v][k].reiniciar(k, fases);
      fasesPendentes = false;
    }
    for (int e = 0; e < 3; e++) envs[e].definir(ajustesEnv[e][0], ajustesEnv[e][1], ajustesEnv[e][2], ajustesEnv[e][3]);
    for (auto& osc : osciladores[v]) osc.limpar(tamanho);
    for (int k = 0; k < N_OSC; k++) tocou[k] = false;
    for (int i = 0; i < tamanho; i++) ruidoBloco[i] = 0;
    bool temRuido = false;

    const bool modulaF1 = usos[D_CUTOFF] || usos[D_RESO];
    const bool modulaF2 = usos[D_CUTOFF2] || usos[D_RESO2];
    if (!modulaF1) filtrosMod[0].novo = true;
    if (!modulaF2) filtrosMod[1].novo = true;
    const bool semLigacoes = qtdLigacoes == 0;
    const double s = suavizar;

    for (int inicio = 0, pedaco = 0; inicio < tamanho; inicio += PEDACO, pedaco++) {
      const int fim = inicio + PEDACO < tamanho ? inicio + PEDACO : tamanho;
      const int qtd = fim - inicio;

      // 0) Glide: a altura anda um pedaço em direção à nota de chegada
      if (altura != alturaAlvo) {
        const double passo = passoGlide * qtd;
        const double falta = alturaAlvo - altura;
        altura = std::fabs(falta) <= passo ? alturaAlvo : altura + (falta > 0 ? passo : -passo);
        frequencia = notaParaFrequencia(altura);
      }

      // 1) Fontes e soma das ligações (sem ligações e tudo já em zero: pula, som idêntico)
      lerFontes(qtd, pedaco);
      const bool pularMod = semLigacoes && modZerada;
      if (pularMod) {
        modNova = false;
      } else {
        somarLigacoes(fontes, modAlvo);
        if (modNova) {
          for (int d = 0; d < qtdDestinos; d++) mod[d] = modAnterior[d] = modAlvo[d];
          modNova = false;
        } else {
          for (int d = 0; d < qtdDestinos; d++) mod[d] += (modAlvo[d] - mod[d]) * suavizarMod;
        }
      }

      // 2) Osciladores A, B, C (desligado e já em silêncio: não calcula nada)
      for (int k = 0; k < N_OSC; k++) {
        OscVoz& osc = osciladores[v][k];
        osc.processarPedaco(k, inicio, fim, frequencia, mod, modAnterior);
        if (!osc.calado) tocou[k] = true;
      }

      // 3) Ruído (mono), separado dos osciladores (pode ir para outro filtro). Com "1 ruído",
      // só a nota mais recente toca: as outras somem em ~5 ms. One Shot: cai até sumir no
      // tempo da Duração.
      const bool donaDoRuido = ajustesVoz[V_RUIDO_UNICO] == 0 || dona;
      const bool calouOneShot = oneShot && ruidoOneShot < 1e-5;
      const double alvoRuido = ajustesVoz[V_RUIDO_LIGADO] != 0 && donaDoRuido && !calouOneShot
                                   ? limitar01(ajustesVoz[V_RUIDO_NIVEL] + mod[D_RUIDO])
                                   : 0;
      if (alvoRuido > 0 || nivelRuido > 1e-5) {
        temRuido = true;
        // Pitch modulado: 100% = a faixa toda do knob (48 semitons), sem degraus
        double pitch = ajustesVoz[V_RUIDO_PITCH];
        if (mod[D_RUIDO_PITCH] != 0) pitch = limitar(pitch + mod[D_RUIDO_PITCH] * 2 * PITCH_RUIDO_MAX, -PITCH_RUIDO_MAX, PITCH_RUIDO_MAX);
        const double semitons = pitch + (ajustesVoz[V_RUIDO_TRACK] != 0 ? altura - NOTA_BASE_RUIDO : 0);
        const double velocidade = semitons == 0 ? 1 : std::pow(2.0, semitons / 12);
        const double duracaoBase = ajustesVoz[V_RUIDO_DURACAO];
        double queda = std::exp(QUEDA_60DB / (duracaoBase * taxa));
        if (oneShot && mod[D_RUIDO_DURACAO] != 0) {
          // Duração modulada (na escala do knob: exponencial de 5 ms a 2 s)
          const double posicao = std::log(duracaoBase / DURACAO_RUIDO_MIN) / LOG_FAIXA_DURACAO + mod[D_RUIDO_DURACAO];
          const double duracao = DURACAO_RUIDO_MIN * std::exp(limitar01(posicao) * LOG_FAIXA_DURACAO);
          queda = std::exp(QUEDA_60DB / (duracao * taxa));
        }
        double pos = ruidoPos;
        for (int i = inicio; i < fim; i++) {
          nivelRuido += (alvoRuido - nivelRuido) * s;
          const int i0 = static_cast<int>(pos);
          const int i1 = i0 + 1 == tamanhoTrecho ? 0 : i0 + 1;
          const double amostra = trecho[i0] + (pos - i0) * (static_cast<double>(trecho[i1]) - trecho[i0]);
          double nivel = nivelRuido;
          if (oneShot) {
            nivel *= ruidoOneShot;
            ruidoOneShot *= queda;
          }
          ruidoBloco[i] = amostra * nivel;
          pos += velocidade;
          if (pos >= tamanhoTrecho) pos -= tamanhoTrecho;
        }
        ruidoPos = pos;
      } else {
        nivelRuido = 0;
      }

      // 4) Filtros com Cutoff/Reso modulados: coeficientes próprios, em rampa suave
      if (modulaF1) atualizarFiltroModulado(filtrosMod[0], 0, mod[D_CUTOFF], mod[D_RESO], inicio, fim);
      if (modulaF2) atualizarFiltroModulado(filtrosMod[1], 1, mod[D_CUTOFF2], mod[D_RESO2], inicio, fim);

      if (!pularMod) {
        for (int d = 0; d < qtdDestinos; d++) modAnterior[d] = mod[d];
        // Sem ligações: quando a modulação chega exatamente a zero, os próximos pedaços pulam
        modZerada = false;
        if (semLigacoes) {
          bool zerada = true;
          for (int d = 0; d < qtdDestinos; d++) {
            if (mod[d] != 0) {
              zerada = false;
              break;
            }
          }
          modZerada = zerada;
        }
      }
    }

    // --- Caixas das rotas: cada fonte soma o seu som na caixa da sua rota ---
    for (Rota& rota : rotas) rota.usada = false;
    qtdUsadas = 0;
    for (int k = 0; k < N_OSC; k++) {
      if (!tocou[k]) continue;
      Rota& rota = caixa(static_cast<int>(ajustesVoz[V_ROTA_A + k]), tamanho);
      const OscVoz& osc = osciladores[v][k];
      for (int i = 0; i < tamanho; i++) {
        rota.somaE[i] += osc.somaE[i];
        rota.somaD[i] += osc.somaD[i];
      }
    }
    if (temRuido) {
      Rota& rota = caixa(static_cast<int>(ajustesVoz[V_ROTA_RUIDO]), tamanho);
      for (int i = 0; i < tamanho; i++) {
        rota.somaE[i] += ruidoBloco[i];
        rota.somaD[i] += ruidoBloco[i];
      }
    }

    // --- Filtros (estéreo) e envelope de volume ---
    const CoefsBloco& c1 = modulaF1 ? filtrosMod[0].coef : coefsGlobais[0];
    const CoefsBloco& c2 = modulaF2 ? filtrosMod[1].coef : coefsGlobais[1];
    Envelope& envelope = envs[0];

    // Nenhum filtro ativo nas rotas usadas (muitos sons): só soma as caixas e aplica o envelope
    bool algumFiltro = false;
    for (int g = 0; g < qtdUsadas; g++) {
      const Rota& rota = rotas[usadas[g]];
      for (int e = 0; e < rota.qtdEtapas; e++)
        if (rota.etapas[e].par[0].ativo() || rota.etapas[e].par[1].ativo()) algumFiltro = true;
    }
    if (!algumFiltro) {
      for (int i = 0; i < tamanho; i++) {
        double e = 0, d = 0;
        for (int g = 0; g < qtdUsadas; g++) {
          e += rotas[usadas[g]].somaE[i];
          d += rotas[usadas[g]].somaD[i];
        }
        const double env = envelope.proximo();
        saidaE[i] = e * env;
        saidaD[i] = d * env;
      }
      return;
    }

    for (int i = 0; i < tamanho; i++) {
      const Coefs& k1 = c1.c[c1.variavel ? i : 0];
      const Coefs& k2 = c2.c[c2.variavel ? i : 0];
      double e = 0, d = 0;
      for (int g = 0; g < qtdUsadas; g++) {
        Rota& rota = rotas[usadas[g]];
        double xe = rota.somaE[i];
        double xd = rota.somaD[i];
        for (int k = 0; k < rota.qtdEtapas; k++) {
          Etapa& etapa = rota.etapas[k];
          const Coefs& cf = etapa.numero == 0 ? k1 : k2;
          xe = etapa.par[0].processar(xe, cf);
          xd = etapa.par[1].processar(xd, cf);
        }
        e += xe;
        d += xd;
      }
      const double env = envelope.proximo();
      saidaE[i] = e * env;
      saidaD[i] = d * env;
    }
  }
};

Voz vozes[MAX_VOZES];

// ---------- Filtro Track (efeito; igual ao antigo dsp/efeitos/filtro-track.js) ----------
// Filtro no som já somado de todas as notas, com o Cutoff em NOTAS que pode acompanhar a
// última nota tocada: cutoff = Cutoff + Track × (nota de referência − C4).
enum CampoFt { FT_LIGADO, FT_NOTA, FT_TRACK, FT_RESO, FT_MIX, FT_REFERENCIA, N_CAMPOS_FT };
constexpr double NOTA_CENTRO = 60;
constexpr double NOTA_MINIMA_TRACK = 24, NOTA_MAXIMA_TRACK = 132;

// Efeitos no C++, na ordem do caminho do som (mesmos números em motor/ponte.js: EFEITOS_NO_MOTOR).
// Cada um tem uma linha de ajustes na mesa (o JS escreve antes de processar).
enum {
  EF_SATURACAO, EF_DISTORCAO, EF_FILTRO_TRACK, EF_EQ, EF_COMPRESSOR,
  EF_PHASER, EF_FLANGER, EF_CHORUS, EF_DELAY, EF_REVERB, N_EFEITOS
};
constexpr int MAX_CAMPOS_EFEITO = 16;
// "basesEfeitos" = valor dos knobs (o JS escreve quando mudam); "ajustesEfeitos" = valores em
// uso neste bloco (os knobs + a modulação: ver efeitosProcessar). Os efeitos leem os em uso.
double basesEfeitos[N_EFEITOS][MAX_CAMPOS_EFEITO];
double ajustesEfeitos[N_EFEITOS][MAX_CAMPOS_EFEITO];
double* const ajustesFt = ajustesEfeitos[EF_FILTRO_TRACK];
// Som passando pelos efeitos (o JS copia para cá antes do 1º efeito do C++ e de volta
// depois do último): esquerda, direita
double somEfeito[2][BLOCO];
double* const efeitoE = somEfeito[0];
double* const efeitoD = somEfeito[1];

struct FiltroTrack {
  Filtro esquerdo, direito;
  CoefsBloco coef;
  double cortes[BLOCO];
  bool temNota; // false = acordando: o cutoff já começa no lugar certo
  double notaAtual, resoAtual, seco, molhado;
  bool dormindo;

  void zerar() {
    Filtro* lados[2] = { &esquerdo, &direito };
    for (Filtro* f : lados) {
      f->nascer();
      f->definirLigado(true); // a mistura com o original é feita aqui (Mix)
      f->definirTipo(T_LP24);
      f->reiniciar();
    }
    temNota = false;
    notaAtual = 0;
    resoAtual = 0.2;
    seco = 1;
    molhado = 0;
    dormindo = true;
  }

  // Devolve 1 se mexeu no som (0 = dormindo)
  int processar(int tamanho) {
    if (dormindo) return 0;
    const bool ligado = ajustesFt[FT_LIGADO] != 0;
    const double m = limitar01(ajustesFt[FT_MIX]); // Mix em cruz
    const double alvoSeco = ligado ? 1 - m : 1;
    const double alvoMolhado = ligado ? m : 0;

    // Cutoff deste bloco: parado (um valor) ou andando até a nota nova em ~5 ms
    // (os valores passam por "float", como nas listas do antigo JavaScript)
    double nota = ajustesFt[FT_NOTA] + limitar01(ajustesFt[FT_TRACK]) * (ajustesFt[FT_REFERENCIA] - NOTA_CENTRO);
    const double alvo = limitar(nota, NOTA_MINIMA_TRACK - 12, NOTA_MAXIMA_TRACK + 12);
    if (!temNota) {
      notaAtual = alvo;
      temNota = true;
    }
    int qtdCortes = 1;
    if (std::fabs(alvo - notaAtual) < 1e-3) {
      notaAtual = alvo;
      cortes[0] = static_cast<float>(notaParaFrequencia(alvo));
    } else {
      for (int i = 0; i < tamanho; i++) {
        notaAtual += (alvo - notaAtual) * suavizar;
        cortes[i] = static_cast<float>(notaParaFrequencia(notaAtual));
      }
      qtdCortes = tamanho;
    }
    // Reso anda suave de um bloco para o outro
    resoAtual += (limitar01(ajustesFt[FT_RESO]) - resoAtual) * 0.3;
    const double reso = static_cast<float>(resoAtual);
    coef.calcular(cortes, qtdCortes, &reso, 1, tamanho);

    const double sm = 1 - std::exp(-1 / (0.01 * taxa)); // Mix anda em ~10 ms
    for (int i = 0; i < tamanho; i++) {
      seco += (alvoSeco - seco) * sm;
      molhado += (alvoMolhado - molhado) * sm;
      const Coefs& c = coef.c[coef.variavel ? i : 0];
      const double e = efeitoE[i];
      const double d = efeitoD[i];
      efeitoE[i] = e * seco + esquerdo.processar(e, c) * molhado;
      efeitoD[i] = d * seco + direito.processar(d, c) * molhado;
    }
    // Desligado e já sem filtro na mistura: dorme (e começa limpo na próxima vez)
    if (!ligado && molhado < 1e-4 && std::fabs(seco - 1) < 1e-4) {
      dormindo = true;
      esquerdo.reiniciar();
      direito.reiniciar();
      seco = 1;
      molhado = 0;
      temNota = false;
    }
    return 1;
  }
};
FiltroTrack filtroTrack;

// ================= Efeitos de "cor" (F3a) =================
// Saturação, Distorção, EQ e Compressor: cópia exata das contas dos antigos
// dsp/efeitos/saturacao.js, distorcao.js, eq.js e compressor.js.

double suavizar10ms = 0; // ~10 ms por amostra (Mix, Drive)
double tanhDesvioSat = 0, tanhDesvioDist = 0; // tanh do desvio da Válvula (calculados em iniciar)
constexpr double LN2 = 0.6931471805599453;

// Coeficiente de um filtro simples de 1 polo (passa-baixas) na frequência fc.
// Uso: estado += (entrada - estado) * coef → "estado" = som sem os agudos acima de fc.
inline double coefPolo(double fc) {
  return 1 - std::exp((-2 * PI * std::fmin(fc, 0.45 * taxa)) / taxa);
}

// Mix: até 50% o original fica cheio; de 50% a 100% ele some (o efeito entra cheio em 50%)
struct Mix { double seco, molhado; };
inline Mix ganhosMix(double mix) { return { std::fmin(1.0, 2 * (1 - mix)), std::fmin(1.0, 2 * mix) }; }

// ln(cosh(x)) sem estourar para valores grandes
inline double logCosh(double x) {
  const double a = std::fabs(x);
  return a + std::log1p(std::exp(-2 * a)) - LN2;
}

// Sobe para a taxa dobrada: recebe 1 amostra, devolve 2. É o mesmo que intercalar zeros
// (x, 0, x, 0...) × 2 e passar pelo filtro meia-banda, mas sem multiplicar os zeros: na 1ª
// amostra só entram os coeficientes pares; na 2ª, só o do meio.
struct Interpolador {
  static constexpr int N = (TAPS + 1) / 2; // 16 amostras de entrada
  double h[N] = {};
  int p = 0;
  void limpar() {
    for (double& v : h) v = 0;
  }
  void processar(double x, double* saida) {
    p = p + 1 == N ? 0 : p + 1;
    h[p] = 2 * x;
    double soma = 0;
    int j = p;
    for (int i = 0; i < N; i++) {
      soma += coefs[2 * i] * h[j];
      j = j == 0 ? N - 1 : j - 1;
    }
    saida[0] = soma;
    int k = p - (MEIO - 1) / 2;
    if (k < 0) k += N;
    saida[1] = coefs[MEIO] * h[k];
  }
};

// Curvas da Saturação: 0 = Fita, 1 = Válvula, 2 = Transistor
struct CurvaSaturacao {
  static double curva(int tipo, double x) {
    switch (tipo) {
      case 1: return std::tanh(x + 0.25) - tanhDesvioSat;
      case 2: return x / std::sqrt(1 + x * x);
      default:
        // Fita: x − x³/3 até ±1, depois fica em ±2/3 (arredondado, sem quina)
        if (x >= 1) return 2.0 / 3;
        if (x <= -1) return -2.0 / 3;
        return x - (x * x * x) / 3;
    }
  }
  // "Integral" de cada curva (usada pelo ADAA)
  static double integral(int tipo, double x) {
    switch (tipo) {
      case 1: return logCosh(x + 0.25) - tanhDesvioSat * x;
      case 2: return std::sqrt(1 + x * x) - 1;
      default: {
        const double a = std::fabs(x);
        if (a >= 1) return (2.0 / 3) * a - 0.25;
        return (x * x) / 2 - (x * x * x * x) / 12;
      }
    }
  }
};

// Curvas da Distorção: 0 = Suave (tanh), 1 = Dura (corte), 2 = Válvula (assimétrica)
struct CurvaDistorcao {
  static double curva(int tipo, double x) {
    switch (tipo) {
      case 1: return x > 1 ? 1 : x < -1 ? -1 : x;
      case 2: return std::tanh(x + 0.3) - tanhDesvioDist;
      default: return std::tanh(x);
    }
  }
  static double integral(int tipo, double x) {
    switch (tipo) {
      case 1: {
        const double a = std::fabs(x);
        return a <= 1 ? 0.5 * x * x : a - 0.5;
      }
      case 2: return logCosh(x + 0.3) - tanhDesvioDist * x;
      default: return logCosh(x);
    }
  }
};

// Um lado (esquerdo ou direito) da Saturação ou da Distorção: sobe a taxa, satura (com ADAA
// = média da curva entre uma amostra e a seguinte), filtra, desce e tira o desvio (DC).
template <class Curva>
struct CanalSaturador {
  Interpolador subir;
  Decimador descer;
  double anterior, integralAnterior, desvio, coefDesvio;
  int tipoAnterior;

  void nascer() {
    subir = Interpolador();
    descer = Decimador();
    anterior = 0;
    integralAnterior = 0;
    desvio = 0;
    tipoAnterior = 0;
    coefDesvio = 1 - std::exp((-2 * PI * 10) / taxa); // passa-altas de ~10 Hz
  }

  void limpar() {
    subir.limpar();
    descer.limpar();
    anterior = 0;
    integralAnterior = 0;
    desvio = 0;
  }

  double processar(double x, int tipo, double ganho, double compensacao) {
    double altas[2], saturados[2];
    subir.processar(x, altas);
    for (int fase = 0; fase < 2; fase++) {
      const double alto = altas[fase] * ganho;
      if (tipo != tipoAnterior) {
        // Trocou de tipo: a integral guardada era da outra curva
        integralAnterior = Curva::integral(tipo, anterior);
        tipoAnterior = tipo;
      }
      const double integralAtual = Curva::integral(tipo, alto);
      const double dx = alto - anterior;
      const double s = std::fabs(dx) < 1e-5 ? Curva::curva(tipo, 0.5 * (alto + anterior))
                                            : (integralAtual - integralAnterior) / dx;
      saturados[fase] = s * compensacao;
      anterior = alto;
      integralAnterior = integralAtual;
    }
    const double saida = descer.processar(saturados[0], saturados[1]);
    desvio += (saida - desvio) * coefDesvio;
    return saida - desvio;
  }
};

// Atraso do som original (15 amostras), para alinhar com o saturado. Fica SEMPRE ligado
// (mesmo dormindo): se sumisse ao desligar, o som daria um pulinho.
struct AtrasoSeco {
  double e[MEIO + 1], d[MEIO + 1];
  int p;
  void nascer() {
    for (int i = 0; i <= MEIO; i++) e[i] = d[i] = 0;
    p = 0;
  }
  // Guarda a amostra nova e devolve a de 15 amostras atrás
  void passar(double& le, double& ld) {
    e[p] = le;
    d[p] = ld;
    p = p + 1 == MEIO + 1 ? 0 : p + 1;
    le = e[p];
    ld = d[p];
  }
};

// ---------- Saturação ----------
enum { SAT_LIGADO, SAT_TIPO, SAT_DRIVE, SAT_TOM, SAT_MIX, N_CAMPOS_SAT };

struct Saturacao {
  CanalSaturador<CurvaSaturacao> esquerdo, direito;
  AtrasoSeco atraso;
  double ganho, ganhoCompensado, compensacao, seco, molhado, tomE, tomD;
  int tipoCompensado;
  bool dormindo;

  static double ganhoDoDrive(double drive) { return 1 + 5 * drive; } // 1× a 6×

  void zerar() {
    esquerdo.nascer();
    direito.nascer();
    atraso.nascer();
    ganho = ganhoDoDrive(0.3);
    ganhoCompensado = -1;
    tipoCompensado = -1;
    compensacao = 1;
    seco = 1;
    molhado = 0;
    tomE = tomD = 0;
    dormindo = true;
  }

  void processar(int tamanho) {
    if (dormindo) {
      // Dormindo: só o atraso do som original (barato)
      for (int i = 0; i < tamanho; i++) atraso.passar(efeitoE[i], efeitoD[i]);
      return;
    }
    const double* a = ajustesEfeitos[EF_SATURACAO];
    const bool ligado = a[SAT_LIGADO] != 0;
    int tipo = static_cast<int>(a[SAT_TIPO]);
    if (tipo < 0 || tipo > 2) tipo = 0;
    const Mix mix = ganhosMix(a[SAT_MIX]);
    const double alvoSeco = ligado ? mix.seco : 1;
    const double alvoMolhado = ligado ? mix.molhado : 0;
    const double alvoGanho = ganhoDoDrive(a[SAT_DRIVE]);
    const double s = suavizar10ms;
    const bool comTom = a[SAT_TOM] < 0.999;
    const double cTom = comTom ? coefPolo(1500 * std::pow(20000.0 / 1500, a[SAT_TOM])) : 0;

    for (int i = 0; i < tamanho; i++) {
      seco += (alvoSeco - seco) * s;
      molhado += (alvoMolhado - molhado) * s;
      ganho += (alvoGanho - ganho) * s;
      // Compensação: um sinal de 0,5 sai com 0,5 em qualquer Drive (recalculada só quando
      // o Drive ou o tipo mudam)
      if (ganho != ganhoCompensado || tipo != tipoCompensado) {
        double v = CurvaSaturacao::curva(tipo, 0.5 * ganho);
        if (v == 0) v = 1;
        compensacao = 0.5 / std::fabs(v);
        ganhoCompensado = ganho;
        tipoCompensado = tipo;
      }
      double satE = esquerdo.processar(efeitoE[i], tipo, ganho, compensacao);
      double satD = direito.processar(efeitoD[i], tipo, ganho, compensacao);
      if (comTom) {
        tomE += (satE - tomE) * cTom;
        tomD += (satD - tomD) * cTom;
        satE = tomE;
        satD = tomD;
      } else {
        // Tom aberto: a memória acompanha o som, para fechar o Tom de novo sem tique
        tomE = satE;
        tomD = satD;
      }
      double originalE = efeitoE[i], originalD = efeitoD[i];
      atraso.passar(originalE, originalD);
      efeitoE[i] = originalE * seco + satE * molhado;
      efeitoD[i] = originalD * seco + satD * molhado;
    }

    if (!ligado && molhado < 1e-4 && std::fabs(seco - 1) < 1e-4) {
      dormindo = true;
      esquerdo.limpar();
      direito.limpar();
      tomE = tomD = 0;
      seco = 1;
      molhado = 0;
    }
  }
};
Saturacao saturacao;

// ---------- Distorção ----------
enum { DIS_LIGADO, DIS_TIPO, DIS_DRIVE, DIS_MIX, DIS_TOM, DIS_LOWCUT, N_CAMPOS_DIS };

struct Distorcao {
  CanalSaturador<CurvaDistorcao> esquerdo, direito;
  AtrasoSeco atraso;
  double graveE, graveD, tomE, tomD;
  double ganho, ganhoCompensado, compensacao, seco, molhado;
  int tipoCompensado;
  bool dormindo;

  static double ganhoDoDrive(double drive) { return 1 + 29 * drive * drive; } // 1× a 30×

  void zerar() {
    esquerdo.nascer();
    direito.nascer();
    atraso.nascer();
    graveE = graveD = tomE = tomD = 0;
    ganho = ganhoDoDrive(0.4);
    ganhoCompensado = -1;
    tipoCompensado = -1;
    compensacao = 1;
    seco = 1;
    molhado = 0;
    dormindo = true;
  }

  void processar(int tamanho) {
    if (dormindo) {
      for (int i = 0; i < tamanho; i++) atraso.passar(efeitoE[i], efeitoD[i]);
      return;
    }
    const double* a = ajustesEfeitos[EF_DISTORCAO];
    const bool ligado = a[DIS_LIGADO] != 0;
    int tipo = static_cast<int>(a[DIS_TIPO]);
    if (tipo < 0 || tipo > 2) tipo = 0;
    const Mix mix = ganhosMix(a[DIS_MIX]);
    const double alvoSeco = ligado ? mix.seco : 1;
    const double alvoMolhado = ligado ? mix.molhado : 0;
    const double alvoGanho = ganhoDoDrive(a[DIS_DRIVE]);
    const double s = suavizar10ms;
    // Low Cut (antes de distorcer; 20 Hz = desligado) e Tom (depois; 100% = aberto)
    const bool comLowCut = a[DIS_LOWCUT] > 20.5;
    const double cGrave = comLowCut ? coefPolo(a[DIS_LOWCUT]) : 0;
    const bool comTom = a[DIS_TOM] < 0.999;
    const double cTom = comTom ? coefPolo(800 * std::pow(20000.0 / 800, a[DIS_TOM])) : 0;
    // Low Cut desligado: a memória dele fica zerada, para ligar de novo sem tique
    if (!comLowCut) graveE = graveD = 0;

    for (int i = 0; i < tamanho; i++) {
      seco += (alvoSeco - seco) * s;
      molhado += (alvoMolhado - molhado) * s;
      ganho += (alvoGanho - ganho) * s;
      // Compensação: um sinal de 0,5 sai com 0,5 em qualquer Drive; a Válvula (assimétrica)
      // soa mais alta com a mesma conta e leva um desconto
      if (ganho != ganhoCompensado || tipo != tipoCompensado) {
        const double desconto = tipo == 2 ? 0.7 : 1;
        double v = CurvaDistorcao::curva(tipo, 0.5 * ganho);
        if (v == 0) v = 1;
        compensacao = (desconto * 0.5) / std::fabs(v);
        ganhoCompensado = ganho;
        tipoCompensado = tipo;
      }
      double entradaE = efeitoE[i], entradaD = efeitoD[i];
      if (comLowCut) {
        graveE += (entradaE - graveE) * cGrave;
        graveD += (entradaD - graveD) * cGrave;
        entradaE -= graveE;
        entradaD -= graveD;
      }
      double distE = esquerdo.processar(entradaE, tipo, ganho, compensacao);
      double distD = direito.processar(entradaD, tipo, ganho, compensacao);
      if (comTom) {
        tomE += (distE - tomE) * cTom;
        tomD += (distD - tomD) * cTom;
        distE = tomE;
        distD = tomD;
      } else {
        tomE = distE;
        tomD = distD;
      }
      double originalE = efeitoE[i], originalD = efeitoD[i];
      atraso.passar(originalE, originalD);
      efeitoE[i] = originalE * seco + distE * molhado;
      efeitoD[i] = originalD * seco + distD * molhado;
    }

    // Desligado e já sem distorção na mistura: dorme (o atraso do original continua)
    if (!ligado && molhado < 1e-4 && std::fabs(seco - 1) < 1e-4) {
      dormindo = true;
      esquerdo.limpar();
      direito.limpar();
      graveE = graveD = tomE = tomD = 0;
      seco = 1;
      molhado = 0;
    }
  }
};
Distorcao distorcao;

// ---------- EQ de 3 bandas ----------
// Grave: prateleira em 150 Hz; Médio: sino na Freq (largura Q); Agudo: prateleira em 5 kHz.
// Filtros "biquad" (receitas de R. Bristow-Johnson), forma "transposta II".
enum { EQ_LIGADO, EQ_GRAVE, EQ_MEDIO, EQ_AGUDO, EQ_FREQ, EQ_Q, EQ_SAIDA, EQ_MIX, N_CAMPOS_EQ };
constexpr double FREQ_GRAVE_EQ = 150, FREQ_AGUDO_EQ = 5000;
constexpr double RAIZ_METADE = 0.7071067811865476; // inclinação das prateleiras (suave)

struct Biquad {
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  double z[4] = {}; // memória: esquerda 1 e 2, direita 1 e 2

  void limpar() {
    for (double& v : z) v = 0;
  }
  void guardar(double nb0, double nb1, double nb2, double a0, double na1, double na2) {
    b0 = nb0 / a0;
    b1 = nb1 / a0;
    b2 = nb2 / a0;
    a1 = na1 / a0;
    a2 = na2 / a0;
  }
  void prateleiraGrave(double fc, double db) {
    const double A = std::pow(10.0, db / 40);
    const double w = (2 * PI * fc) / taxa;
    const double cs = std::cos(w);
    const double alfa = (std::sin(w) / 2) * std::sqrt((A + 1 / A) * (1 / RAIZ_METADE - 1) + 2);
    const double raiz = 2 * std::sqrt(A) * alfa;
    guardar(A * (A + 1 - (A - 1) * cs + raiz), 2 * A * (A - 1 - (A + 1) * cs), A * (A + 1 - (A - 1) * cs - raiz),
            A + 1 + (A - 1) * cs + raiz, -2 * (A - 1 + (A + 1) * cs), A + 1 + (A - 1) * cs - raiz);
  }
  void prateleiraAguda(double fc, double db) {
    const double A = std::pow(10.0, db / 40);
    const double w = (2 * PI * fc) / taxa;
    const double cs = std::cos(w);
    const double alfa = (std::sin(w) / 2) * std::sqrt((A + 1 / A) * (1 / RAIZ_METADE - 1) + 2);
    const double raiz = 2 * std::sqrt(A) * alfa;
    guardar(A * (A + 1 + (A - 1) * cs + raiz), -2 * A * (A - 1 + (A + 1) * cs), A * (A + 1 + (A - 1) * cs - raiz),
            A + 1 - (A - 1) * cs + raiz, 2 * (A - 1 - (A + 1) * cs), A + 1 - (A - 1) * cs - raiz);
  }
  void sino(double fc, double db, double q) {
    const double A = std::pow(10.0, db / 40);
    const double w = (2 * PI * std::fmin(fc, 0.45 * taxa)) / taxa;
    const double cs = std::cos(w);
    const double alfa = std::sin(w) / (2 * q);
    guardar(1 + alfa * A, -2 * cs, 1 - alfa * A, 1 + alfa / A, -2 * cs, 1 - alfa / A);
  }
  // Filtra uma amostra do lado "lado" (0 = esquerda, 1 = direita)
  double processar(double x, int lado) {
    const int k = lado * 2;
    const double y = b0 * x + z[k];
    z[k] = b1 * x - a1 * y + z[k + 1];
    z[k + 1] = b2 * x - a2 * y;
    return y;
  }
};

struct Eq {
  Biquad grave, media, aguda;
  // Valores suavizados (andam até o ajuste a cada bloco) e os usados na última conta
  double atGrave, atMedio, atAgudo, atFreq, atQ, atSaida;
  double calcGrave, calcMedio, calcAgudo, calcFreq, calcQ;
  bool temCalculado;
  double seco, molhado, suavizarBloco;
  bool dormindo;

  void zerar() {
    grave = Biquad();
    media = Biquad();
    aguda = Biquad();
    atGrave = atMedio = atAgudo = atSaida = 0;
    atFreq = 1000;
    atQ = 1;
    temCalculado = false;
    seco = 1;
    molhado = 0;
    suavizarBloco = 1 - std::exp(-128 / (0.02 * taxa)); // ~20 ms, por bloco
    dormindo = true;
  }

  // Suaviza os ajustes e recalcula os filtros só se algo mudou de verdade
  void atualizar(const double* a) {
    const double k = suavizarBloco;
    atGrave += (a[EQ_GRAVE] - atGrave) * k;
    atMedio += (a[EQ_MEDIO] - atMedio) * k;
    atAgudo += (a[EQ_AGUDO] - atAgudo) * k;
    atSaida += (a[EQ_SAIDA] - atSaida) * k;
    // Freq e Q andam na escala "multiplicativa" (como o ouvido percebe)
    atFreq *= std::pow(a[EQ_FREQ] / atFreq, k);
    atQ *= std::pow(a[EQ_Q] / atQ, k);
    if (temCalculado && std::fabs(calcGrave - atGrave) < 0.01 && std::fabs(calcMedio - atMedio) < 0.01 &&
        std::fabs(calcAgudo - atAgudo) < 0.01 && std::fabs(calcFreq / atFreq - 1) < 0.001 &&
        std::fabs(calcQ / atQ - 1) < 0.001) {
      return;
    }
    grave.prateleiraGrave(FREQ_GRAVE_EQ, atGrave);
    media.sino(atFreq, atMedio, atQ);
    aguda.prateleiraAguda(FREQ_AGUDO_EQ, atAgudo);
    calcGrave = atGrave;
    calcMedio = atMedio;
    calcAgudo = atAgudo;
    calcFreq = atFreq;
    calcQ = atQ;
    temCalculado = true;
  }

  void processar(int tamanho) {
    if (dormindo) return;
    const double* a = ajustesEfeitos[EF_EQ];
    atualizar(a);
    const bool ligado = a[EQ_LIGADO] != 0;
    const Mix mix = ganhosMix(a[EQ_MIX]);
    const double alvoSeco = ligado ? mix.seco : 1;
    const double alvoMolhado = ligado ? mix.molhado : 0;
    const double s = suavizar10ms;
    const double ganhoSaida = std::pow(10.0, atSaida / 20);
    for (int i = 0; i < tamanho; i++) {
      seco += (alvoSeco - seco) * s;
      molhado += (alvoMolhado - molhado) * s;
      const double e = efeitoE[i];
      const double d = efeitoD[i];
      const double eqE = aguda.processar(media.processar(grave.processar(e, 0), 0), 0) * ganhoSaida;
      const double eqD = aguda.processar(media.processar(grave.processar(d, 1), 1), 1) * ganhoSaida;
      efeitoE[i] = e * seco + eqE * molhado;
      efeitoD[i] = d * seco + eqD * molhado;
    }
    if (!ligado && molhado < 1e-4 && std::fabs(seco - 1) < 1e-4) {
      dormindo = true;
      grave.limpar();
      media.limpar();
      aguda.limpar();
      seco = 1;
      molhado = 0;
    }
  }
};
Eq eq;

// ---------- Compressor ----------
// Estéreo ligado (mesma redução nos 2 lados), detector de pico, joelho suave de 6 dB.
enum { CO_LIGADO, CO_THRESHOLD, CO_RATIO, CO_ATTACK, CO_RELEASE, CO_GANHO, CO_MIX, N_CAMPOS_CO };
constexpr double JOELHO = 6; // dB

inline double paraDb(double x) { return 20 * std::log10(x + 1e-12); }
inline double deDb(double db) { return std::pow(10.0, db / 20); }

// Quanto abaixar (dB, positivo) para um nível de entrada "nivelDb"
inline double reducaoEstatica(double nivelDb, double threshold, double ratio) {
  const double acima = nivelDb - threshold;
  const double inclinacao = 1 - 1 / ratio;
  if (acima <= -JOELHO / 2) return 0;
  if (acima >= JOELHO / 2) return acima * inclinacao;
  // Dentro do joelho: entra aos poucos (curva suave)
  const double x = acima + JOELHO / 2;
  return (inclinacao * x * x) / (2 * JOELHO);
}

struct Compressor {
  double reducao;      // dB que está abaixando agora (suavizado pelo Attack/Release)
  double seco, molhado, compensacao;
  bool temCompensacao; // falso = ainda não começou (ao acordar, começa no valor certo)
  bool dormindo;

  void zerar() {
    reducao = 0;
    seco = 1;
    molhado = 0;
    compensacao = 1;
    temCompensacao = false;
    dormindo = true;
  }

  void processar(int tamanho) {
    if (dormindo) return;
    const double* a = ajustesEfeitos[EF_COMPRESSOR];
    const bool ligado = a[CO_LIGADO] != 0;
    const Mix mix = ganhosMix(a[CO_MIX]);
    const double alvoSeco = ligado ? mix.seco : 1;
    const double alvoMolhado = ligado ? mix.molhado : 0;
    const double threshold = std::fmin(0.0, std::fmax(-60.0, a[CO_THRESHOLD]));
    const double ratio = std::fmax(1.0, a[CO_RATIO]);
    const double coefAtaque = 1 - std::exp(-1 / (std::fmax(0.0001, a[CO_ATTACK]) * taxa));
    const double coefSoltura = 1 - std::exp(-1 / (std::fmax(0.005, a[CO_RELEASE]) * taxa));
    // Compensação automática: metade do que um som em 0 dB perderia, + o Ganho escolhido
    // (anda suave, ~10 ms; ao acordar, já começa no valor certo)
    const double alvoCompensacao = deDb(reducaoEstatica(0, threshold, ratio) * 0.5 + a[CO_GANHO]);
    if (!temCompensacao) {
      compensacao = alvoCompensacao;
      temCompensacao = true;
    }
    const double s = suavizar10ms;
    // Abaixo do começo do joelho não há o que comprimir: nem converte para dB (economia)
    const double semCompressao = deDb(threshold - JOELHO / 2 - 0.01);

    for (int i = 0; i < tamanho; i++) {
      seco += (alvoSeco - seco) * s;
      molhado += (alvoMolhado - molhado) * s;
      const double e = efeitoE[i];
      const double d = efeitoD[i];
      const double nivel = std::fmax(std::fabs(e), std::fabs(d));
      const double alvo = nivel < semCompressao ? 0 : reducaoEstatica(paraDb(nivel), threshold, ratio);
      // Abaixar = Attack; soltar = Release
      reducao += (alvo - reducao) * (alvo > reducao ? coefAtaque : coefSoltura);
      if (compensacao != alvoCompensacao) {
        compensacao += (alvoCompensacao - compensacao) * s;
        if (std::fabs(compensacao - alvoCompensacao) < 1e-7) compensacao = alvoCompensacao;
      }
      const double ganho = (reducao == 0 ? 1 : deDb(-reducao)) * compensacao * molhado;
      efeitoE[i] = e * seco + e * ganho;
      efeitoD[i] = d * seco + d * ganho;
    }

    if (!ligado && molhado < 1e-4 && std::fabs(seco - 1) < 1e-4) {
      dormindo = true;
      seco = 1;
      molhado = 0;
      reducao = 0;
      temCompensacao = false;
    }
  }
};
Compressor compressor;

// ================= Efeitos de "espaço" (F3b) =================
// Phaser, Flanger, Chorus, Delay e Reverb: cópia exata das contas dos antigos
// dsp/efeitos/phaser.js, flanger.js, chorus.js, delay.js e reverb.js. As memórias (linhas de
// atraso) guardam "float", como as Float32Array de lá: o som fica igual amostra a amostra.

// Memória de atraso em float (tamanho depende da taxa: criada em iniciar)
struct Memoria {
  float* d = nullptr;
  int n = 0;
  bool alocar(int tamanho) {
    std::free(d);
    d = static_cast<float*>(std::calloc(tamanho, sizeof(float)));
    n = d ? tamanho : 0;
    return d != nullptr;
  }
  void limpar() {
    for (int i = 0; i < n; i++) d[i] = 0;
  }
};

// Mistura "em cruz" (Phaser/Flanger): 0 = só original, 0,5 = metade/metade, 1 = só efeito
inline Mix ganhosCruzados(double mix) {
  const double m = limitar01(mix);
  return { 1 - m, m };
}

// Width (0 = mono, no meio; 1 = estéreo como veio): diminui só os "lados"
inline void aplicarWidth(double& e, double& d, double width) {
  const double meio = (e + d) * 0.5;
  const double lados = (e - d) * 0.5 * width;
  e = meio + lados;
  d = meio - lados;
}

// Um passo do Width suavizado (~10 ms): chegou perto, encosta no alvo
inline double andarWidth(double atual, double alvo, double s) {
  if (atual == alvo) return atual;
  const double novo = atual + (alvo - atual) * s;
  return std::fabs(novo - alvo) < 1e-5 ? alvo : novo;
}

// Leitura com interpolação em linha reta, "atraso" amostras antes de "escrita"
inline double lerLinear(const Memoria& m, int escrita, double atraso) {
  double posicao = escrita - atraso;
  if (posicao < 0) posicao += m.n;
  const int i0 = static_cast<int>(posicao);
  const int i1 = i0 + 1 == m.n ? 0 : i0 + 1;
  const double y0 = m.d[i0], y1 = m.d[i1];
  return y0 + (posicao - i0) * (y1 - y0);
}

// ---------- Phaser: 6 passa-tudo em série, LFO seno ----------
enum { PH_LIGADO, PH_RATE, PH_DEPTH, PH_FREQ, PH_FEEDBACK, PH_STEREO, PH_MIX, N_CAMPOS_PH };
constexpr int ETAPAS_PHASER = 6;
constexpr int PASSO_COEF_PHASER = 16; // recalcula a cada 16 amostras (linha reta entre eles)

struct Phaser {
  double memE[ETAPAS_PHASER], memD[ETAPAS_PHASER];
  double voltaE, voltaD, fase, coefE, coefD, passoE, passoD, seco, molhado, feedback;
  int contador;
  bool acordou, dormindo;

  void zerar() {
    for (int k = 0; k < ETAPAS_PHASER; k++) memE[k] = memD[k] = 0;
    voltaE = voltaD = fase = coefE = coefD = passoE = passoD = 0;
    contador = 0;
    acordou = true;
    seco = 1;
    molhado = 0;
    feedback = 0.5;
    dormindo = true;
  }

  // Coeficiente de um lado na fase "f" do LFO
  static double coefNaFase(const double* a, double f) {
    const double oitavas = 2 * limitar01(a[PH_DEPTH]) * std::sin(2 * PI * f);
    const double fc = std::fmin(0.45 * taxa, std::fmax(20.0, a[PH_FREQ] * std::pow(2.0, oitavas)));
    const double t = std::tan((PI * fc) / taxa);
    return (t - 1) / (t + 1);
  }

  void proximosCoeficientes(const double* a) {
    const double deslocamento = 0.5 * limitar01(a[PH_STEREO]); // 100% = meio ciclo
    const double faseAlvo = fase + (a[PH_RATE] / taxa) * PASSO_COEF_PHASER;
    passoE = (coefNaFase(a, faseAlvo) - coefE) / PASSO_COEF_PHASER;
    passoD = (coefNaFase(a, faseAlvo + deslocamento) - coefD) / PASSO_COEF_PHASER;
  }

  // Parado no silêncio: o LFO continua andando
  void pular(int tamanho) {
    fase = std::fmod(fase + (ajustesEfeitos[EF_PHASER][PH_RATE] / taxa) * tamanho, 1.0);
    acordou = true;
  }

  void processar(int tamanho) {
    if (dormindo) return;
    const double* a = ajustesEfeitos[EF_PHASER];
    const bool ligado = a[PH_LIGADO] != 0;
    const Mix mix = ganhosCruzados(a[PH_MIX]);
    const double alvoSeco = ligado ? mix.seco : 1;
    const double alvoMolhado = ligado ? mix.molhado : 0;
    const double alvoFeedback = std::fmin(0.9, std::fmax(0.0, a[PH_FEEDBACK]));
    const double s = suavizar10ms;
    const double passoFase = a[PH_RATE] / taxa;

    if (acordou) {
      // Primeira vez acordado: começa já com os coeficientes certos
      acordou = false;
      contador = 0;
      coefE = coefNaFase(a, fase);
      coefD = coefNaFase(a, fase + 0.5 * limitar01(a[PH_STEREO]));
    }
    for (int i = 0; i < tamanho; i++) {
      if (contador == 0) proximosCoeficientes(a);
      contador = contador + 1 == PASSO_COEF_PHASER ? 0 : contador + 1;
      seco += (alvoSeco - seco) * s;
      molhado += (alvoMolhado - molhado) * s;
      feedback += (alvoFeedback - feedback) * s;
      coefE += passoE;
      coefD += passoD;
      const double fb = feedback;
      double e = efeitoE[i] + fb * voltaE;
      double d = efeitoD[i] + fb * voltaD;
      const double cE = coefE, cD = coefD;
      for (int k = 0; k < ETAPAS_PHASER; k++) {
        const double yE = cE * e + memE[k];
        memE[k] = e - cE * yE;
        e = yE;
        const double yD = cD * d + memD[k];
        memD[k] = d - cD * yD;
        d = yD;
      }
      voltaE = e;
      voltaD = d;
      // Com Feedback o efeito ganha volume nos picos: compensa pela energia média
      const double compensa = std::sqrt(1 - fb * fb);
      efeitoE[i] = efeitoE[i] * seco + e * compensa * molhado;
      efeitoD[i] = efeitoD[i] * seco + d * compensa * molhado;
      fase += passoFase;
      if (fase >= 1) fase -= 1;
    }
    if (!ligado && molhado < 1e-4 && std::fabs(seco - 1) < 1e-4) {
      dormindo = true;
      for (int k = 0; k < ETAPAS_PHASER; k++) memE[k] = memD[k] = 0;
      voltaE = voltaD = 0;
      seco = 1;
      molhado = 0;
      acordou = true;
    }
  }
};
Phaser phaser;

// ---------- Flanger: atraso curto balançando (leitura cúbica) ----------
enum { FL_LIGADO, FL_RATE, FL_DEPTH, FL_ATRASO, FL_FEEDBACK, FL_STEREO, FL_MIX, N_CAMPOS_FL };
constexpr double ATRASO_MAXIMO_FLANGER = 0.01; // segundos

struct Flanger {
  Memoria memE, memD;
  int escrita;
  double fase, entrada, seco, molhado, feedback, base, profundidade, deslocamento;
  bool dormindo;

  bool alocar() {
    const int n = static_cast<int>(std::ceil((ATRASO_MAXIMO_FLANGER * 4 + 0.002) * taxa)) + 4;
    return memE.alocar(n) && memD.alocar(n);
  }

  void zerar() {
    memE.limpar();
    memD.limpar();
    escrita = 0;
    fase = entrada = 0;
    seco = 1;
    molhado = 0;
    feedback = 0.5;
    base = 0.002 * taxa;
    profundidade = 0.7;
    deslocamento = 0.25;
    dormindo = true;
  }

  // Lê "atraso" amostras atrás com interpolação cúbica (Hermite: não abafa os agudos)
  double ler(const Memoria& m, double atraso) const {
    double posicao = escrita - atraso;
    if (posicao < 0) posicao += m.n;
    const int n = m.n;
    const int i1 = static_cast<int>(posicao);
    const double t = posicao - i1;
    const int i0 = i1 == 0 ? n - 1 : i1 - 1;
    const int i2 = i1 + 1 == n ? 0 : i1 + 1;
    const int i3 = i2 + 1 == n ? 0 : i2 + 1;
    const double y0 = m.d[i0], y1 = m.d[i1], y2 = m.d[i2], y3 = m.d[i3];
    const double c1 = 0.5 * (y2 - y0);
    const double c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const double c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + y1;
  }

  void pular(int tamanho) {
    fase = std::fmod(fase + (ajustesEfeitos[EF_FLANGER][FL_RATE] / taxa) * tamanho, 1.0);
  }

  void processar(int tamanho) {
    if (dormindo) return;
    const double* a = ajustesEfeitos[EF_FLANGER];
    const bool ligado = a[FL_LIGADO] != 0;
    const Mix mix = ganhosCruzados(a[FL_MIX]);
    const double alvoSeco = ligado ? mix.seco : 1;
    const double alvoMolhado = ligado ? mix.molhado : 0;
    const double alvoFeedback = std::fmin(0.95, std::fmax(-0.95, a[FL_FEEDBACK]));
    const double alvoBase = std::fmin(ATRASO_MAXIMO_FLANGER, std::fmax(0.0005, a[FL_ATRASO])) * taxa;
    const double alvoProfundidade = limitar01(a[FL_DEPTH]);
    const double alvoDeslocamento = 0.5 * limitar01(a[FL_STEREO]);
    const double alvoEntrada = ligado ? 1 : 0;
    const double s = suavizar10ms;
    const double passoFase = a[FL_RATE] / taxa;
    const double doisPi = 2 * PI;

    for (int i = 0; i < tamanho; i++) {
      seco += (alvoSeco - seco) * s;
      molhado += (alvoMolhado - molhado) * s;
      feedback += (alvoFeedback - feedback) * s;
      base += (alvoBase - base) * s;
      profundidade += (alvoProfundidade - profundidade) * s;
      deslocamento += (alvoDeslocamento - deslocamento) * s;
      const double fb = feedback;
      // Atraso de cada lado: centro × 2^(±oitavas) balançando num seno (mínimo 3 amostras)
      const double oitavas = 2 * profundidade;
      const double atrasoE = std::fmax(3.0, base * std::pow(2.0, oitavas * std::sin(doisPi * fase)));
      const double atrasoD = std::fmax(3.0, base * std::pow(2.0, oitavas * std::sin(doisPi * (fase + deslocamento))));
      const double copiaE = ler(memE, atrasoE);
      const double copiaD = ler(memD, atrasoD);
      // O som entra na memória aos poucos ao ligar (sem "tique")
      entrada += (alvoEntrada - entrada) * s;
      memE.d[escrita] = static_cast<float>(efeitoE[i] * entrada + fb * copiaE);
      memD.d[escrita] = static_cast<float>(efeitoD[i] * entrada + fb * copiaD);
      escrita = escrita + 1 == memE.n ? 0 : escrita + 1;
      const double compensa = std::sqrt(1 - fb * fb);
      efeitoE[i] = efeitoE[i] * seco + copiaE * compensa * molhado;
      efeitoD[i] = efeitoD[i] * seco + copiaD * compensa * molhado;
      fase += passoFase;
      if (fase >= 1) fase -= 1;
    }
    if (!ligado && molhado < 1e-4 && std::fabs(seco - 1) < 1e-4) {
      dormindo = true;
      memE.limpar();
      memD.limpar();
      entrada = 0;
      seco = 1;
      molhado = 0;
    }
  }
};
Flanger flanger;

// ---------- Chorus: 2 cópias por lado com o atraso balançando ----------
enum { CH_LIGADO, CH_RATE, CH_DEPTH, CH_MIX, CH_ATRASO, CH_FEEDBACK, CH_WIDTH, N_CAMPOS_CH };
constexpr double PROFUNDIDADE_MAXIMA_CHORUS = 0.006; // segundos (±6 ms com Depth 100%)
constexpr double ATRASO_MAXIMO_CHORUS = 0.03;
constexpr double TAMANHO_MEMORIA_CHORUS = ATRASO_MAXIMO_CHORUS + PROFUNDIDADE_MAXIMA_CHORUS + 0.004;

struct Chorus {
  Memoria memE, memD;
  int escrita;
  double fase, entrada, seco, molhado, profundidade, base, voltaE, voltaD, width, silencio;
  bool dormindo;

  bool alocar() {
    const int n = static_cast<int>(std::ceil(TAMANHO_MEMORIA_CHORUS * taxa));
    return memE.alocar(n) && memD.alocar(n);
  }

  void zerar() {
    memE.limpar();
    memD.limpar();
    escrita = 0;
    fase = entrada = 0;
    seco = 1;
    molhado = 0;
    profundidade = 0.5;
    base = 0.012 * taxa;
    voltaE = voltaD = 0;
    width = 1;
    silencio = 0;
    dormindo = true;
  }

  void pular(int tamanho) {
    fase = std::fmod(fase + (ajustesEfeitos[EF_CHORUS][CH_RATE] / taxa) * tamanho, 1.0);
  }

  void processar(int tamanho) {
    if (dormindo) return;
    const double* a = ajustesEfeitos[EF_CHORUS];
    const bool ligado = a[CH_LIGADO] != 0;
    const double alvoEntrada = ligado ? 1 : 0;
    const Mix mix = ganhosMix(a[CH_MIX]);
    const double alvoSeco = ligado ? mix.seco : 1;
    const double alvoMolhado = mix.molhado;
    const double s = suavizar10ms;
    const double passo = a[CH_RATE] / taxa;
    const double alvoBase = std::fmin(ATRASO_MAXIMO_CHORUS, std::fmax(0.005, a[CH_ATRASO])) * taxa;
    const double amplitude = PROFUNDIDADE_MAXIMA_CHORUS * taxa;
    const double fbAjuste = std::fmin(0.9, std::fmax(0.0, a[CH_FEEDBACK]));
    const double alvoWidth = limitar01(a[CH_WIDTH]);
    double energia = 0;

    for (int i = 0; i < tamanho; i++) {
      entrada += (alvoEntrada - entrada) * s;
      seco += (alvoSeco - seco) * s;
      molhado += (alvoMolhado - molhado) * s;
      profundidade += (a[CH_DEPTH] - profundidade) * s;
      if (base != alvoBase) {
        base += (alvoBase - base) * s;
        if (std::fabs(base - alvoBase) < 1e-3) base = alvoBase;
      }
      if (fbAjuste > 0) {
        memE.d[escrita] = static_cast<float>(efeitoE[i] * entrada + voltaE * fbAjuste);
        memD.d[escrita] = static_cast<float>(efeitoD[i] * entrada + voltaD * fbAjuste);
      } else {
        memE.d[escrita] = static_cast<float>(efeitoE[i] * entrada);
        memD.d[escrita] = static_cast<float>(efeitoD[i] * entrada);
      }
      // As 4 cópias estão a 1/4 de ciclo umas das outras: esquerda = base ± seno,
      // direita = base ± cosseno
      const double desvio = amplitude * profundidade;
      const double angulo = 2 * PI * fase;
      const double balancoSeno = desvio * std::sin(angulo);
      const double balancoCosseno = desvio * std::cos(angulo);
      double copiasE = (lerLinear(memE, escrita, base + balancoSeno) + lerLinear(memE, escrita, base - balancoSeno)) * 0.5;
      double copiasD = (lerLinear(memD, escrita, base + balancoCosseno) + lerLinear(memD, escrita, base - balancoCosseno)) * 0.5;
      voltaE = copiasE;
      voltaD = copiasD;
      fase += passo;
      if (fase >= 1) fase -= 1;
      escrita = escrita + 1 == memE.n ? 0 : escrita + 1;
      width = andarWidth(width, alvoWidth, s);
      if (width < 1) aplicarWidth(copiasE, copiasD, width);
      efeitoE[i] = efeitoE[i] * seco + copiasE * molhado;
      efeitoD[i] = efeitoD[i] * seco + copiasD * molhado;
      energia += copiasE * copiasE + copiasD * copiasD;
    }
    // Desligado e sem cópias audíveis por um tempo: dorme e limpa a memória
    silencio = energia / tamanho < 1e-10 ? silencio + tamanho : 0;
    if (!ligado && entrada < 1e-4 && silencio > TAMANHO_MEMORIA_CHORUS * taxa) {
      dormindo = true;
      memE.limpar();
      memD.limpar();
      voltaE = voltaD = 0;
      seco = 1;
    }
  }
};
Chorus chorus;

// ---------- Delay (eco) estéreo, Ping-pong, High/Low Cut nas repetições ----------
enum { DL_LIGADO, DL_TEMPO, DL_FEEDBACK, DL_MIX, DL_PINGPONG, DL_LOWCUT, DL_HIGHCUT, DL_WIDTH, N_CAMPOS_DL };
constexpr double TEMPO_MAXIMO_DELAY = 2; // segundos

struct Delay {
  Memoria linhaE, linhaD;
  int escrita;
  double tempoAtual, tempoNovo; // tempoNovo < 0 = nenhuma troca em andamento
  double rampa, passoRampa, entrada, seco, molhado, feedback;
  double coefAgudo, highcutCalculado, baixasE, baixasD, gravesE, gravesD, width, silencio;
  bool dormindo;

  bool alocar() {
    const int n = static_cast<int>(std::ceil(TEMPO_MAXIMO_DELAY * taxa)) + 4;
    return linhaE.alocar(n) && linhaD.alocar(n);
  }

  void zerar() {
    linhaE.limpar();
    linhaD.limpar();
    escrita = 0;
    tempoAtual = 0.3 * taxa;
    tempoNovo = -1;
    rampa = 0;
    passoRampa = 1 / (0.05 * taxa);
    entrada = 0;
    seco = 1;
    molhado = 0;
    feedback = 0;
    coefAgudo = coefPolo(6000);
    highcutCalculado = 6000;
    baixasE = baixasD = gravesE = gravesD = 0;
    width = 1;
    silencio = 0;
    dormindo = true;
  }

  void processar(int tamanho) {
    if (dormindo) return;
    const double* a = ajustesEfeitos[EF_DELAY];
    const bool ligado = a[DL_LIGADO] != 0;
    const bool pingpong = a[DL_PINGPONG] != 0;
    const double alvoEntrada = ligado ? 1 : 0;
    const Mix mix = ganhosMix(a[DL_MIX]);
    const double alvoSeco = ligado ? mix.seco : 1; // desligado: original cheio, ecos terminando
    const double alvoMolhado = mix.molhado;
    const double alvoTempo = std::fmin(TEMPO_MAXIMO_DELAY, std::fmax(0.001, a[DL_TEMPO])) * taxa;
    const double alvoFeedback = std::fmin(0.95, std::fmax(0.0, a[DL_FEEDBACK]));
    const double s = suavizar10ms;
    if (a[DL_HIGHCUT] != highcutCalculado) {
      coefAgudo = coefPolo(a[DL_HIGHCUT]);
      highcutCalculado = a[DL_HIGHCUT];
    }
    const double c = coefAgudo;
    const bool comLowCut = a[DL_LOWCUT] > 20.5;
    const double cGrave = comLowCut ? coefPolo(a[DL_LOWCUT]) : 0;
    const double alvoWidth = limitar01(a[DL_WIDTH]);
    if (!comLowCut) gravesE = gravesD = 0;
    double energia = 0;

    for (int i = 0; i < tamanho; i++) {
      entrada += (alvoEntrada - entrada) * s;
      seco += (alvoSeco - seco) * s;
      molhado += (alvoMolhado - molhado) * s;
      feedback += (alvoFeedback - feedback) * s;
      // Tempo mudou? Passa do eco antigo para o novo numa rampa de ~50 ms
      if (tempoNovo < 0 && std::fabs(alvoTempo - tempoAtual) > 0.5) {
        tempoNovo = alvoTempo;
        rampa = 0;
      }
      double ecoE = lerLinear(linhaE, escrita, tempoAtual);
      double ecoD = lerLinear(linhaD, escrita, tempoAtual);
      if (tempoNovo >= 0) {
        rampa = std::fmin(1.0, rampa + passoRampa);
        ecoE += (lerLinear(linhaE, escrita, tempoNovo) - ecoE) * rampa;
        ecoD += (lerLinear(linhaD, escrita, tempoNovo) - ecoD) * rampa;
        if (rampa >= 1) {
          tempoAtual = tempoNovo;
          tempoNovo = -1;
        }
      }
      // As repetições perdem agudo (e grave, com o Low Cut)
      baixasE += (ecoE - baixasE) * c;
      baixasD += (ecoD - baixasD) * c;
      double voltaE = baixasE, voltaD = baixasD;
      if (comLowCut) {
        gravesE += (voltaE - gravesE) * cGrave;
        gravesD += (voltaD - gravesD) * cGrave;
        voltaE -= gravesE;
        voltaD -= gravesD;
      }
      const double entradaE = efeitoE[i] * entrada;
      const double entradaD = efeitoD[i] * entrada;
      double novoE, novoD;
      if (pingpong) {
        // O som entra só na esquerda; cada repetição troca de lado
        novoE = (entradaE + entradaD) * 0.5 + voltaD * feedback;
        novoD = voltaE * feedback;
      } else {
        novoE = entradaE + voltaE * feedback;
        novoD = entradaD + voltaD * feedback;
      }
      // Segurança: nunca deixa acumular além de um limite
      linhaE.d[escrita] = static_cast<float>(novoE > 4 ? 4 : novoE < -4 ? -4 : novoE);
      linhaD.d[escrita] = static_cast<float>(novoD > 4 ? 4 : novoD < -4 ? -4 : novoD);
      if (++escrita == linhaE.n) escrita = 0;
      width = andarWidth(width, alvoWidth, s);
      if (width < 1) aplicarWidth(ecoE, ecoD, width);
      efeitoE[i] = efeitoE[i] * seco + ecoE * molhado;
      efeitoD[i] = efeitoD[i] * seco + ecoD * molhado;
      energia += ecoE * ecoE + ecoD * ecoD;
    }
    // Desligado e sem ecos audíveis por mais tempo que o próprio eco: dorme
    silencio = energia / tamanho < 1e-10 ? silencio + tamanho : 0;
    if (!ligado && entrada < 1e-4 && silencio > tempoAtual + tamanho) {
      dormindo = true;
      linhaE.limpar();
      linhaD.limpar();
      baixasE = baixasD = gravesE = gravesD = 0;
      seco = 1;
    }
  }
};
Delay delay;

// ---------- Reverb: 4 difusores + 8 linhas misturadas (FDN) ----------
enum { RV_LIGADO, RV_TAMANHO, RV_BRILHO, RV_MIX, RV_PREDELAY, RV_LOWCUT, RV_WIDTH, N_CAMPOS_RV };
constexpr double TEMPOS_LINHAS_MS[8] = { 29.7, 37.1, 41.1, 43.7, 47.3, 53.1, 59.3, 67.1 };
constexpr double TEMPOS_DIFUSORES_MS[4] = { 4.77, 3.59, 12.73, 9.31 };
constexpr double GANHO_DIFUSOR = 0.6;
constexpr double PRE_DELAY_MAXIMO = 0.2;
constexpr double ESCALA_SAIDA_REVERB = 0.35;

struct Reverb {
  Memoria linhas[8], difusores[4], pre;
  int posLinhas[8], posDifusores[4], posPre;
  double ganhos[8], baixas[8];
  double coefGrave, lowcutCalculado, graveEntrada, coefBrilho, tamanhoCalculado, brilhoCalculado;
  double preAtual, preNovo; // preNovo < 0 = nenhuma troca em andamento
  double rampaPre, passoRampaPre, width, entrada, seco, molhado, silencio;
  bool acordou, dormindo;

  static int amostras(double ms) { return static_cast<int>(std::fmax(1.0, arredondar((ms / 1000) * taxa))); }

  bool alocar() {
    bool ok = true;
    for (int k = 0; k < 8; k++) ok = linhas[k].alocar(amostras(TEMPOS_LINHAS_MS[k])) && ok;
    for (int k = 0; k < 4; k++) ok = difusores[k].alocar(amostras(TEMPOS_DIFUSORES_MS[k])) && ok;
    return pre.alocar(static_cast<int>(std::ceil(PRE_DELAY_MAXIMO * taxa)) + 2) && ok;
  }

  void limparMemorias() {
    for (auto& l : linhas) l.limpar();
    for (auto& d : difusores) d.limpar();
    pre.limpar();
  }

  void zerar() {
    limparMemorias();
    for (int k = 0; k < 8; k++) posLinhas[k] = 0, ganhos[k] = 0, baixas[k] = 0;
    for (int k = 0; k < 4; k++) posDifusores[k] = 0;
    posPre = 0;
    coefGrave = coefPolo(120);
    lowcutCalculado = 120;
    graveEntrada = 0;
    coefBrilho = 0;
    tamanhoCalculado = brilhoCalculado = -1;
    preAtual = 0;
    preNovo = -1;
    rampaPre = 0;
    passoRampaPre = 1 / (0.02 * taxa);
    acordou = true;
    width = 1;
    entrada = 0;
    seco = 1;
    molhado = 0;
    silencio = 0;
    dormindo = true;
  }

  // Recalcula perdas e abafamento só quando Tamanho/Brilho/Low Cut mudam
  void atualizarCoeficientes(const double* a) {
    if (a[RV_TAMANHO] != tamanhoCalculado) {
      const double rt = 0.3 * std::pow(8 / 0.3, a[RV_TAMANHO]); // tempo até -60 dB
      for (int k = 0; k < 8; k++) ganhos[k] = std::pow(10.0, (-3 * linhas[k].n) / (rt * taxa));
      tamanhoCalculado = a[RV_TAMANHO];
    }
    if (a[RV_BRILHO] != brilhoCalculado) {
      const double fc = 1500 * std::pow(16000.0 / 1500, a[RV_BRILHO]);
      coefBrilho = coefPolo(fc);
      brilhoCalculado = a[RV_BRILHO];
    }
    if (a[RV_LOWCUT] != lowcutCalculado) {
      coefGrave = coefPolo(a[RV_LOWCUT]);
      lowcutCalculado = a[RV_LOWCUT];
    }
  }

  double lerPre(int atraso) const {
    int leitura = posPre - atraso;
    if (leitura < 0) leitura += pre.n;
    return pre.d[leitura];
  }

  // Mistura rápida das 8 linhas (matriz de Hadamard)
  static void misturar8(double* v) {
    for (int h = 1; h < 8; h *= 2) {
      for (int i = 0; i < 8; i += h * 2) {
        for (int j = i; j < i + h; j++) {
          const double x = v[j], y = v[j + h];
          v[j] = x + y;
          v[j + h] = x - y;
        }
      }
    }
    const double escala = 1 / std::sqrt(8.0);
    for (int j = 0; j < 8; j++) v[j] *= escala;
  }

  void processar(int tamanho) {
    if (dormindo) return;
    const double* a = ajustesEfeitos[EF_REVERB];
    atualizarCoeficientes(a);
    const bool ligado = a[RV_LIGADO] != 0;
    const double alvoEntrada = ligado ? 1 : 0;
    const Mix mix = ganhosMix(a[RV_MIX]);
    const double alvoSeco = ligado ? mix.seco : 1;
    const double alvoMolhado = mix.molhado;
    const double s = suavizar10ms;
    const double cb = coefBrilho;
    const int atrasoPre = static_cast<int>(arredondar(std::fmin(PRE_DELAY_MAXIMO, std::fmax(0.0, a[RV_PREDELAY])) * taxa));
    const double alvoWidth = limitar01(a[RV_WIDTH]);
    double v[8];
    double energia = 0;

    for (int i = 0; i < tamanho; i++) {
      entrada += (alvoEntrada - entrada) * s;
      seco += (alvoSeco - seco) * s;
      molhado += (alvoMolhado - molhado) * s;
      // Entrada: soma dos dois lados, sem os graves muito baixos
      double x = (efeitoE[i] + efeitoD[i]) * 0.5 * entrada;
      graveEntrada += (x - graveEntrada) * coefGrave;
      x -= graveEntrada;
      // Pre-delay (memória gravada sempre; troca de tempo numa rampa de ~20 ms)
      pre.d[posPre] = static_cast<float>(x);
      if (acordou) {
        preAtual = atrasoPre;
        preNovo = -1;
        acordou = false;
      }
      if (preNovo < 0 && atrasoPre != preAtual) {
        preNovo = atrasoPre;
        rampaPre = 0;
      }
      if (preAtual > 0) x = lerPre(static_cast<int>(preAtual));
      if (preNovo >= 0) {
        rampaPre = std::fmin(1.0, rampaPre + passoRampaPre);
        x += (lerPre(static_cast<int>(preNovo)) - x) * rampaPre;
        if (rampaPre >= 1) {
          preAtual = preNovo;
          preNovo = -1;
        }
      }
      posPre = posPre + 1 == pre.n ? 0 : posPre + 1;
      // Difusores em série
      for (int d = 0; d < 4; d++) {
        Memoria& buffer = difusores[d];
        const int p = posDifusores[d];
        const double atrasado = buffer.d[p];
        const double y = -GANHO_DIFUSOR * x + atrasado;
        buffer.d[p] = static_cast<float>(x + GANHO_DIFUSOR * y);
        posDifusores[d] = p + 1 == buffer.n ? 0 : p + 1;
        x = y;
      }
      // Lê as 8 linhas, perde força e agudo
      for (int k = 0; k < 8; k++) {
        const double saidaLinha = linhas[k].d[posLinhas[k]] * ganhos[k];
        baixas[k] += (saidaLinha - baixas[k]) * cb;
        v[k] = baixas[k];
      }
      // Saída estéreo: linhas pares à esquerda, ímpares à direita
      double molhadoE = (v[0] - v[2] + v[4] - v[6]) * ESCALA_SAIDA_REVERB;
      double molhadoD = (v[1] - v[3] + v[5] - v[7]) * ESCALA_SAIDA_REVERB;
      width = andarWidth(width, alvoWidth, s);
      if (width < 1) aplicarWidth(molhadoE, molhadoD, width);
      misturar8(v);
      for (int k = 0; k < 8; k++) {
        Memoria& linha = linhas[k];
        const int p = posLinhas[k];
        linha.d[p] = static_cast<float>(v[k] + (k & 1 ? x : -x));
        posLinhas[k] = p + 1 == linha.n ? 0 : p + 1;
      }
      efeitoE[i] = efeitoE[i] * seco + molhadoE * molhado;
      efeitoD[i] = efeitoD[i] * seco + molhadoD * molhado;
      energia += molhadoE * molhadoE + molhadoD * molhadoD;
    }
    // Desligado e cauda inaudível por um tempo: dorme e limpa a memória
    silencio = energia / tamanho < 1e-10 ? silencio + tamanho : 0;
    if (!ligado && entrada < 1e-4 && silencio > 0.1 * taxa) {
      dormindo = true;
      limparMemorias();
      for (double& b : baixas) b = 0;
      acordou = true;
      graveEntrada = 0;
      seco = 1;
    }
  }
};
Reverb reverb;

// Quantos ajustes cada efeito tem (o JS confere se combina com a lista dele)
constexpr int CAMPOS_EFEITO[N_EFEITOS] = {
  N_CAMPOS_SAT, N_CAMPOS_DIS, N_CAMPOS_FT, N_CAMPOS_EQ, N_CAMPOS_CO,
  N_CAMPOS_PH, N_CAMPOS_FL, N_CAMPOS_CH, N_CAMPOS_DL, N_CAMPOS_RV,
};

// ---------- Modulação dos knobs dos efeitos (igual à antiga modularEfeitos do JS) ----------
// Tabela dos knobs moduláveis (MOD_EFEITOS em dsp/efeitos/modulaveis.js), recebida ao ligar:
// efeito, ajuste, faixa do knob e escala (exponencial ou linear). O destino de modulação do
// knob j é "primeiroDestinoEfeito + j".
struct ModEfeito {
  int ef, campo;
  double min, max;
  bool exp;
  // Posição do knob (0 a 1) ↔ valor, na escala dele
  double posicao(double valor) const {
    const double p = exp ? std::log(valor / min) / std::log(max / min) : (valor - min) / (max - min);
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }
  double valor(double posicao) const {
    const double p = posicao < 0 ? 0 : posicao > 1 ? 1 : posicao;
    return exp ? min * std::pow(max / min, p) : min + p * (max - min);
  }
};
constexpr int MAX_MOD_EFEITOS = 96;
ModEfeito modsEfeitos[MAX_MOD_EFEITOS];
double entradaModsEfeitos[MAX_MOD_EFEITOS * 5]; // mesa: efeito, ajuste, min, max, exp (o JS escreve)
int qtdModsEfeitos = 0;
int primeiroDestinoEfeito = 0;
double modSuave[MAX_MOD_EFEITOS]; // modulação de cada knob, suavizada (~5 ms)
bool modulando[MAX_MOD_EFEITOS];  // o knob está sendo modulado?
double suavizarModEfeitos = 0;

// ---------- Caminho do som pelos 10 efeitos ----------
// Economia: um efeito que recebe silêncio e solta silêncio há mais de 2,5 s (mais que o maior
// "buraco" possível dentro de um efeito: Delay de 2 s + folga) fica "parado" (nem é chamado)
// até chegar som de novo. Mesmo LIGADO.
constexpr double LIMIAR_SILENCIO = 1e-6; // -120 dB
double esperaSilencio = 0;
double silencioEfeito[N_EFEITOS];
bool paradoEfeito[N_EFEITOS];
double picoEfeitos = 0; // maior valor do som na saída do último efeito (o JS usa no clipper)

// Maior valor (sem sinal) do bloco, nos dois lados
double picoDoBloco(int tamanho) {
  double pico = 0;
  for (int i = 0; i < tamanho; i++) {
    const double a = std::fabs(efeitoE[i]);
    const double b = std::fabs(efeitoD[i]);
    if (a > pico) pico = a;
    if (b > pico) pico = b;
  }
  return pico;
}

// Algum valor inválido no bloco (NaN ou infinito)?
bool temInvalido(int tamanho) {
  for (int i = 0; i < tamanho; i++) {
    if (!std::isfinite(efeitoE[i]) || !std::isfinite(efeitoD[i])) return true;
  }
  return false;
}

}  // namespace

// ================= Funções que o JavaScript chama =================

// Versão do motor em C++ (sobe a cada etapa; o JavaScript mostra no console).
EXPORTAR int versao() { return 6; }

static void efeitoZerar(int ef); // (mais abaixo)

// Liga o motor na taxa de amostragem do aparelho (chamada uma vez, ao nascer).
// "destinos" = quantos destinos de modulação existem (DESTINOS_MOD.length no JS).
EXPORTAR int iniciar(double taxaAmostragem, int destinos) {
  if (destinos > MAX_DESTINOS) return 0;
  taxa = taxaAmostragem;
  qtdDestinos = destinos;
  suavizar = 1 - std::exp(-1 / (0.005 * taxa));
  suavizarMod = 1 - std::exp(-PEDACO / (0.002 * taxa));
  suavizarLigacoes = 1 - std::exp(-BLOCO / (0.01 * taxa));
  suavizarMacros = 1 - std::exp(-BLOCO / (0.01 * taxa));
  freqMaximaFiltro = std::fmin(20000.0, 0.45 * taxa);
  suavizar10ms = 1 - std::exp(-1 / (0.01 * taxa));
  suavizarModEfeitos = 1 - std::exp(-BLOCO / (0.005 * taxa));
  esperaSilencio = 2.5 * taxa;
  for (int ef = 0; ef < N_EFEITOS; ef++) silencioEfeito[ef] = 0, paradoEfeito[ef] = false;
  tanhDesvioSat = std::tanh(0.25);
  tanhDesvioDist = std::tanh(0.3);
  prepararMeiaBanda();
  // Os 3 trechos de ruído (4 s cada), montados uma vez
  tamanhoTrecho = static_cast<int>(arredondar(SEGUNDOS_TRECHO * taxa));
  for (int t = 0; t < 3; t++) {
    std::free(trechosRuido[t]);
    trechosRuido[t] = static_cast<float*>(std::malloc(sizeof(float) * tamanhoTrecho));
    if (!trechosRuido[t]) return 0;
    montarTrecho(t, trechosRuido[t], tamanhoTrecho);
  }
  for (auto& voz : osciladores)
    for (auto& osc : voz) osc.zerar();
  for (auto& v : vozes) v.zerar();
  // Memórias dos efeitos de espaço (o tamanho depende da taxa)
  if (!flanger.alocar() || !chorus.alocar() || !delay.alocar() || !reverb.alocar()) return 0;
  for (int ef = 0; ef < N_EFEITOS; ef++) efeitoZerar(ef);
  return 1;
}

// Endereços da mesa de troca (o JS escreve/lê direto na memória)
EXPORTAR double* enderecoAjustes() { return &ajustes[0][0]; }
EXPORTAR double* enderecoPosicoes() { return &posicoes[0][0]; }
EXPORTAR double* enderecoFases() { return fasesSorteadas; }
EXPORTAR double* enderecoAjustesLfo() { return &ajustesLfo[0][0]; }
EXPORTAR double* enderecoAjustesEnv() { return &ajustesEnv[0][0]; }
EXPORTAR double* enderecoMacros() { return macrosAlvo; }
EXPORTAR double* enderecoLigacoes() { return entradaLigacoes; }
EXPORTAR double* enderecoAjustesVoz() { return ajustesVoz; }
EXPORTAR double* enderecoCortesResos() { return &cortesResos[0][0]; } // Cutoff 1, Reso 1, Cutoff 2, Reso 2
EXPORTAR double* enderecoBasesEfeito(int ef) { return basesEfeitos[ef]; } // valor dos knobs
EXPORTAR double* enderecoModsEfeitos() { return entradaModsEfeitos; }
EXPORTAR int camposEfeito(int ef) { return CAMPOS_EFEITO[ef]; }
EXPORTAR double* enderecoEfeito() { return efeitoE; } // esquerda; a direita vem logo depois (+ BLOCO)
EXPORTAR int camposVoz() { return N_CAMPOS_VOZ; }
// Som da voz v no bloco: esquerda; a direita vem logo depois (+ BLOCO números)
EXPORTAR double* enderecoVozSaida(int v) { return vozes[v].saidaE; }
EXPORTAR double* enderecoMod(int v) { return vozes[v].mod; } // modulação da voz v (o JS lê)
EXPORTAR int camposOsc() { return N_CAMPOS; }

// Wavetables: pede espaço para uma tabela (o JS copia os harmônicos e as ondas para dentro)
EXPORTAR Tabela* criarTabela(int qtdFrames, int qtdNiveis, int tamanho) {
  if (qtdNiveis > MAX_NIVEIS) return nullptr;
  int bits = 0;
  while ((1 << bits) < tamanho) bits++;
  if ((1 << bits) != tamanho || bits < 1 || bits > 20) return nullptr; // precisa ser potência de 2
  Tabela* t = static_cast<Tabela*>(std::malloc(sizeof(Tabela)));
  if (!t) return nullptr;
  t->tamanho = tamanho;
  t->mascara = tamanho - 1;
  t->bits = bits;
  t->qtdFrames = qtdFrames;
  t->qtdNiveis = qtdNiveis;
  t->dados = static_cast<float*>(std::malloc(sizeof(float) * static_cast<size_t>(qtdFrames) * qtdNiveis * tamanho));
  if (!t->dados) {
    std::free(t);
    return nullptr;
  }
  return t;
}
EXPORTAR int* tabelaHarmonicos(Tabela* t) { return t->harmonicos; }
EXPORTAR float* tabelaDados(Tabela* t) { return t->dados; }
EXPORTAR void apagarTabela(Tabela* t) {
  if (!t) return;
  std::free(t->dados);
  std::free(t);
}

// Voz v: estado de nota nova (como criar a voz de novo): osciladores, envelopes, modulação,
// filtros (com o tipo e o liga/desliga escolhidos) e ruído
EXPORTAR void vozZerar(int v) {
  for (auto& osc : osciladores[v]) osc.zerar();
  vozes[v].zerar();
}

// ---------- Modulação e envelopes (F2a) ----------

// Começo de cada bloco (todas as vozes juntas): LFOs Livres andam, as quantidades das
// ligações andam até o alvo e os Macros andam até o valor escolhido.
// "ultima" = voz da nota tocada por último, se ainda soa (-1 = nenhuma): um LFO Livre com
// o Rate modulado segue a modulação dela.
EXPORTAR void comecarBloco(int ultima, int tamanho) {
  int pedacos = 0;
  for (int l = 0; l < N_LFO; l++) {
    const double rateBase = ajustesLfo[l][L_RATE];
    const double rate = ultima >= 0 ? rateModulado(rateBase, vozes[ultima].mod[D_RATE_LFO[l]]) : rateBase;
    const int forma = static_cast<int>(ajustesLfo[l][L_FORMA]);
    pedacos = 0;
    for (int inicio = 0; inicio < tamanho; inicio += PEDACO, pedacos++) {
      livres[l].avancar((rate * PEDACO) / taxa);
      valoresLivres[l][pedacos] = livres[l].valor(forma);
    }
  }
  ultimoPedacoLivre = pedacos > 0 ? pedacos - 1 : 0;

  for (int d = 0; d < qtdDestinos; d++) usos[d] = 0;
  for (int f = 0; f < N_FONTES; f++) usosFonte[f] = 0;
  for (int k = qtdLigacoes - 1; k >= 0; k--) {
    Ligacao& l = ligacoes[k];
    l.atual += (l.alvo - l.atual) * suavizarLigacoes;
    if (l.removida && std::fabs(l.atual) < 1e-4) {
      for (int j = k; j + 1 < qtdLigacoes; j++) ligacoes[j] = ligacoes[j + 1]; // sai, mantendo a ordem
      qtdLigacoes--;
      continue;
    }
    usos[l.destino] = 1;
    usosFonte[l.fonte] = 1;
  }

  for (int m = 0; m < 4; m++) macros[m] += (macrosAlvo[m] - macros[m]) * suavizarMacros;
}

// Lista nova de ligações (a tela manda a lista completa): "n" trios (fonte, destino,
// quantidade) em entradaLigacoes. O que não vier mais vai sumindo até zero e depois sai.
EXPORTAR void definirLigacoes(int n) {
  for (int k = 0; k < qtdLigacoes; k++) {
    ligacoes[k].alvo = 0;
    ligacoes[k].removida = true;
  }
  for (int j = 0; j < n; j++) {
    const int fonte = static_cast<int>(entradaLigacoes[3 * j]);
    const int destino = static_cast<int>(entradaLigacoes[3 * j + 1]);
    const double quantidade = entradaLigacoes[3 * j + 2];
    if (fonte < 0 || fonte >= N_FONTES || destino < 0 || destino >= qtdDestinos) continue;
    int achada = -1;
    for (int k = 0; k < qtdLigacoes; k++) {
      if (ligacoes[k].fonte == fonte && ligacoes[k].destino == destino) {
        achada = k;
        break;
      }
    }
    if (achada >= 0) {
      ligacoes[achada].alvo = quantidade;
      ligacoes[achada].removida = false;
    } else if (qtdLigacoes < MAX_LIGACOES) {
      ligacoes[qtdLigacoes++] = { fonte, destino, quantidade, 0, false };
    }
  }
}

// Modulação dos knobs dos EFEITOS (soma em modEfeitos): fontes da nota tocada por último
// ("ultima", -1 = nenhuma soando) + Macros e LFOs Livres, que valem sempre.
static void somarEfeitos(int ultima) {
  double fontes[N_FONTES];
  for (int f = 0; f < N_FONTES; f++) fontes[f] = ultima >= 0 ? vozes[ultima].fontes[f] : 0;
  for (int m = 0; m < 4; m++) fontes[INDICES_MACRO[m]] = macros[m];
  for (int l = 0; l < N_LFO; l++) {
    if (ajustesLfo[l][L_LIVRE] != 0) fontes[INDICES_LFO[l]] = valoresLivres[l][ultimoPedacoLivre];
  }
  somarLigacoes(fontes, modEfeitos);
}

// Nota começando na voz v (altura "nota" em semitons MIDI).
// "glideDe"/"glideTempo": escorrega da altura glideDe até a nota em glideTempo segundos
// (tempo 0 = sem glide). "doSilencio" = a voz estava calada: filtros limpos, modulação sem
// rampa e as cópias de unison começam nos pontos sorteados (lidos de "fasesSorteadas").
// "recomecar" = dispara os envelopes (falso no legato); "retrig" = bits dos LFOs em modo
// Retrig (recomeçam do início), com os valores sorteados s0–s2 para o S&H.
EXPORTAR void vozIniciar(int v, double nota, double glideDe, double glideTempo, int doSilencio, int recomecar,
                         int retrig, double s0, double s1, double s2) {
  Voz& voz = vozes[v];
  if (doSilencio) {
    for (Rota& rota : voz.rotas)
      for (int e = 0; e < rota.qtdEtapas; e++)
        for (Filtro& f : rota.etapas[e].par) f.reiniciar();
    for (int c = 0; c < MAX_UNISON; c++) voz.fases[c] = fasesSorteadas[c];
    voz.fasesPendentes = true;
    voz.modNova = true;
    for (auto& f : voz.filtrosMod) f.novo = true;
  }
  if (glideTempo > 0 && glideDe != nota) {
    voz.altura = glideDe;
    voz.passoGlide = std::fabs(nota - glideDe) / (glideTempo * taxa);
  } else {
    voz.altura = nota;
    voz.passoGlide = 0;
  }
  voz.alturaAlvo = nota;
  voz.frequencia = notaParaFrequencia(voz.altura);
  if (!recomecar) return;
  for (auto& e : voz.envs) e.disparar();
  const double sorteios[N_LFO] = { s0, s1, s2 };
  for (int l = 0; l < N_LFO; l++) {
    if (retrig & (1 << l)) {
      voz.lfos[l].fase = 0;
      voz.lfos[l].aleatorio = sorteios[l];
    }
  }
}

// Tecla solta: os 3 envelopes vão para a soltura
EXPORTAR void vozSoltar(int v) {
  for (auto& e : vozes[v].envs) e.soltar();
}
// Voz roubada: some em ~4 ms (só o ENV 1)
EXPORTAR void vozSilenciar(int v) { vozes[v].envs[0].silenciarRapido(); }
EXPORTAR int vozAtiva(int v) { return vozes[v].envs[0].ativo() ? 1 : 0; }
EXPORTAR double vozNivel(int v) { return vozes[v].envs[0].nivel; }

EXPORTAR double vozAltura(int v) { return vozes[v].altura; } // semitons (com o glide)

// Tipo (campo 0: 0 = LP12, 1 = LP24, 2 = HP, 3 = BP) ou liga/desliga (campo 1) do Filtro 1
// (numero 0) ou 2 (numero 1), em todas as vozes. Tipo desconhecido (-1): nada muda.
EXPORTAR void definirFiltro(int numero, int campo, int valor) {
  if (numero < 0 || numero > 1) return;
  if (campo == 0) {
    if (valor < 0 || valor > 3) return;
    tipoFiltroEscolhido[numero] = valor;
  } else {
    filtroLigadoEscolhido[numero] = valor != 0;
  }
  for (Voz& voz : vozes) voz.definirFiltro(numero, campo, valor);
}

// Começo do bloco das vozes: coeficientes dos Filtros 1 e 2 (Cutoff/Reso dos knobs, em
// "cortesResos"), iguais para todas as vozes
EXPORTAR void vozesComecarBloco(int tamanho) {
  for (int n = 0; n < 2; n++) {
    coefsGlobais[n].calcular(cortesResos[2 * n], static_cast<int>(ajustesVoz[V_QTD_CORTES1 + 2 * n]),
                             cortesResos[2 * n + 1], static_cast<int>(ajustesVoz[V_QTD_RESOS1 + 2 * n]), tamanho);
  }
}

// Calcula o som da voz v no bloco (em enderecoVozSaida). "sorteioRuido" (0 a 1, ou < 0 =
// nenhum): nota nova, o ruído recomeça; "dona" = 1 se é a voz da nota mais recente.
EXPORTAR void vozProcessar(int v, int tamanho, double sorteioRuido, int dona) {
  vozes[v].processar(v, tamanho, sorteioRuido, dona != 0);
}

// ---------- Efeitos (todos os 10, na ordem do caminho do som) ----------
// "ef" = número do efeito (EF_SATURACAO...). O som está em "somEfeito"; os ajustes em uso,
// na linha do efeito em ajustesEfeitos.
static void efeitoProcessar(int ef, int tamanho) {
  switch (ef) {
    case EF_SATURACAO: saturacao.processar(tamanho); break;
    case EF_DISTORCAO: distorcao.processar(tamanho); break;
    case EF_FILTRO_TRACK: filtroTrack.processar(tamanho); break;
    case EF_EQ: eq.processar(tamanho); break;
    case EF_COMPRESSOR: compressor.processar(tamanho); break;
    case EF_PHASER: phaser.processar(tamanho); break;
    case EF_FLANGER: flanger.processar(tamanho); break;
    case EF_CHORUS: chorus.processar(tamanho); break;
    case EF_DELAY: delay.processar(tamanho); break;
    case EF_REVERB: reverb.processar(tamanho); break;
  }
}
// Memória limpa (como novo); volta dormindo
static void efeitoZerar(int ef) {
  switch (ef) {
    case EF_SATURACAO: saturacao.zerar(); break;
    case EF_DISTORCAO: distorcao.zerar(); break;
    case EF_FILTRO_TRACK: filtroTrack.zerar(); break;
    case EF_EQ: eq.zerar(); break;
    case EF_COMPRESSOR: compressor.zerar(); break;
    case EF_PHASER: phaser.zerar(); break;
    case EF_FLANGER: flanger.zerar(); break;
    case EF_CHORUS: chorus.zerar(); break;
    case EF_DELAY: delay.zerar(); break;
    case EF_REVERB: reverb.zerar(); break;
  }
}
static bool* dormindoDe(int ef) {
  switch (ef) {
    case EF_SATURACAO: return &saturacao.dormindo;
    case EF_DISTORCAO: return &distorcao.dormindo;
    case EF_FILTRO_TRACK: return &filtroTrack.dormindo;
    case EF_EQ: return &eq.dormindo;
    case EF_COMPRESSOR: return &compressor.dormindo;
    case EF_PHASER: return &phaser.dormindo;
    case EF_FLANGER: return &flanger.dormindo;
    case EF_CHORUS: return &chorus.dormindo;
    case EF_DELAY: return &delay.dormindo;
    case EF_REVERB: return &reverb.dormindo;
  }
  return nullptr;
}
// Efeito parado no silêncio (nem é processado): o LFO do Phaser/Flanger/Chorus continua andando
static void efeitoPular(int ef, int tamanho) {
  switch (ef) {
    case EF_PHASER: phaser.pular(tamanho); break;
    case EF_FLANGER: flanger.pular(tamanho); break;
    case EF_CHORUS: chorus.pular(tamanho); break;
  }
}
// Ligado: acorda (mesmo jeito dos efeitos em JavaScript: cada "definir" com ligado acorda)
EXPORTAR void efeitoAcordar(int ef) {
  if (bool* d = dormindoDe(ef)) *d = false;
}

// Tabela dos knobs moduláveis: o JS escreveu "n" linhas (efeito, ajuste, min, max, exp) na mesa
// (enderecoModsEfeitos). "primeiro" = destino de modulação do 1º knob. Devolve 0 se não cabe.
EXPORTAR int definirModsEfeitos(int n, int primeiro) {
  if (n > MAX_MOD_EFEITOS || primeiro + n > MAX_DESTINOS) return 0;
  for (int j = 0; j < n; j++) {
    const double* e = entradaModsEfeitos + 5 * j;
    ModEfeito& m = modsEfeitos[j];
    m.ef = static_cast<int>(e[0]);
    m.campo = static_cast<int>(e[1]);
    if (m.ef < 0 || m.ef >= N_EFEITOS || m.campo < 0 || m.campo >= MAX_CAMPOS_EFEITO) return 0;
    m.min = e[2];
    m.max = e[3];
    m.exp = e[4] != 0;
    modSuave[j] = 0;
    modulando[j] = false;
  }
  qtdModsEfeitos = n;
  primeiroDestinoEfeito = primeiro;
  return 1;
}

// Knobs dos efeitos ligados a LFO/ENV/Macro: os efeitos tratam todas as notas juntas, então
// usam as fontes da nota tocada por último ("ultima", enquanto soa; -1 = nenhuma); um LFO
// Livre e os Macros valem sempre. Em uso = knob + modulação (na escala do knob), suavizada
// ~5 ms. Tirou a ligação: volta ao valor exato do knob.
static void modularEfeitos(int ultima) {
  bool algum = false;
  for (int j = 0; j < qtdModsEfeitos && !algum; j++) algum = modulando[j] || usos[primeiroDestinoEfeito + j];
  if (!algum) return;
  somarEfeitos(ultima);
  for (int j = 0; j < qtdModsEfeitos; j++) {
    const bool usa = usos[primeiroDestinoEfeito + j];
    if (!usa && !modulando[j]) continue;
    const ModEfeito& m = modsEfeitos[j];
    if (!usa) {
      modSuave[j] = 0; // (o valor em uso já é o do knob)
      modulando[j] = false;
      continue;
    }
    modSuave[j] += (modEfeitos[primeiroDestinoEfeito + j] - modSuave[j]) * suavizarModEfeitos;
    ajustesEfeitos[m.ef][m.campo] = m.valor(m.posicao(basesEfeitos[m.ef][m.campo]) + modSuave[j]);
    modulando[j] = true;
  }
}

// O bloco inteiro pelos 10 efeitos: o som já está em "somEfeito" (o JS copiou) e volta lá.
// Efeitos parados no silêncio nem são chamados (só o LFO deles anda). Um efeito que soltar
// valores inválidos (NaN, infinito) tem o bloco trocado por silêncio e a memória limpa (fica
// como novo, com os mesmos ajustes). Devolve os bits dos efeitos consertados (o JS avisa).
EXPORTAR int efeitosProcessar(int ultima, int tamanho) {
  for (int ef = 0; ef < N_EFEITOS; ef++) {
    for (int k = 0; k < CAMPOS_EFEITO[ef]; k++) ajustesEfeitos[ef][k] = basesEfeitos[ef][k];
  }
  modularEfeitos(ultima);
  int consertos = 0;
  double pico = picoDoBloco(tamanho);
  for (int ef = 0; ef < N_EFEITOS; ef++) {
    const bool entradaSilenciosa = pico < LIMIAR_SILENCIO;
    if (paradoEfeito[ef]) {
      if (entradaSilenciosa) {
        // silêncio entra, silêncio sai: nada a fazer (só o LFO dos efeitos que têm um anda)
        if (!*dormindoDe(ef)) efeitoPular(ef, tamanho);
        continue;
      }
      paradoEfeito[ef] = false; // chegou som: acorda
      silencioEfeito[ef] = 0;
    }
    efeitoProcessar(ef, tamanho);
    if (temInvalido(tamanho)) {
      for (int i = 0; i < tamanho; i++) efeitoE[i] = efeitoD[i] = 0;
      efeitoZerar(ef);
      if (ajustesEfeitos[ef][0] != 0) *dormindoDe(ef) = false; // (o 1º ajuste é sempre o "ligado")
      consertos |= 1 << ef;
    }
    pico = picoDoBloco(tamanho);
    silencioEfeito[ef] = entradaSilenciosa && pico < LIMIAR_SILENCIO ? silencioEfeito[ef] + tamanho : 0;
    if (silencioEfeito[ef] > esperaSilencio) paradoEfeito[ef] = true;
  }
  picoEfeitos = pico;
  return consertos;
}
EXPORTAR double efeitosPico() { return picoEfeitos; }
// Filtro Track: troca de tipo (LP 12, LP 24, HP, BP), com a transição suave do filtro
EXPORTAR void ftTipo(int tipo) {
  filtroTrack.esquerdo.definirTipo(tipo);
  filtroTrack.direito.definirTipo(tipo);
}

// Nível atual do oscilador k da voz v (o motor usa para trocar a wavetable no silêncio)
EXPORTAR double oscNivel(int v, int k) { return osciladores[v][k].nivel; }
