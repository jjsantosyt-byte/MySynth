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
// Macros e a soma das ligações (matriz). O resto da voz (ruído, filtros, rotas, glide)
// ainda está em dsp/voz.js e chama estas funções a cada pedaço de modulação.
//
// Como o JavaScript conversa com o C++ ("mesa de troca"):
//   - wavetables: o JS pede espaço (criarTabela) e copia as ondas para dentro, uma vez só;
//     depois só usa o endereço da tabela (um número).
//   - ajustes dos 3 osciladores (Unison, Detune, Warp...), dos LFOs, dos envelopes e dos
//     Macros: o JS escreve na mesa uma vez por bloco;
//   - ligações de modulação: o JS escreve a lista (fonte, destino, quantidade) quando muda;
//   - o som de cada oscilador de cada voz sai em "saidas" (esquerda e direita), o ENV 1 em
//     "envSaida" e a modulação de cada voz fica em "mod" (o JS lê para o ruído e os filtros).
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

void prepararMeiaBanda() {
  double coefs[TAPS];
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
  void reiniciar(int k) {
    const double fase = ajustes[k][C_FASE];
    const double rand = ajustes[k][C_RAND];
    for (int c = 0; c < MAX_UNISON; c++) {
      const double inicio = fase + rand * fasesSorteadas[c];
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
const double QUEDA_60DB = std::log(0.001);

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
const double LOG_FAIXA_RATE = std::log(RATE_MAX / RATE_MIN);

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
double envSaida[BLOCO];    // ENV 1 de uma voz no bloco (vozEnvelope; o JS lê)

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

// ---------- Modulação de cada voz ----------
struct VozMod {
  Envelope envs[3];       // [0] = ENV 1 (volume), [1] = ENV 2, [2] = ENV 3
  EstadoLfo lfos[N_LFO];  // LFOs em modo Retrig (um por nota)
  double fontes[N_FONTES];
  double modAlvo[MAX_DESTINOS];     // soma "crua" das ligações
  double mod[MAX_DESTINOS];         // modulação deste pedaço (suavizada ~2 ms)
  double modAnterior[MAX_DESTINOS]; // do pedaço anterior (os osciladores fazem rampa entre os dois)
  bool modNova;   // ainda não tem "pedaço anterior"
  bool modZerada; // mod e modAnterior todos em zero
  bool pulouMod;  // este pedaço pulou a soma (sem ligações e tudo em zero)

  void zerar() {
    for (auto& e : envs) e.zerar();
    for (auto& l : lfos) l = EstadoLfo();
    for (double& f : fontes) f = 0;
    for (int d = 0; d < MAX_DESTINOS; d++) modAlvo[d] = mod[d] = modAnterior[d] = 0;
    modNova = true;
    modZerada = true;
    pulouMod = false;
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
};

VozMod vozesMod[MAX_VOZES];
double suavizarMod = 0; // ~2 ms por pedaço: saltos (LFO quadrado, S&H) viram rampas curtíssimas

}  // namespace

// ================= Funções que o JavaScript chama =================

// Versão do motor em C++ (sobe a cada etapa; o JavaScript mostra no console).
EXPORTAR int versao() { return 3; }

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
  prepararMeiaBanda();
  for (auto& voz : osciladores)
    for (auto& osc : voz) osc.zerar();
  for (auto& v : vozesMod) v.zerar();
  return 1;
}

// Endereços da mesa de troca (o JS escreve/lê direto na memória)
EXPORTAR double* enderecoAjustes() { return &ajustes[0][0]; }
EXPORTAR double* enderecoPosicoes() { return &posicoes[0][0]; }
EXPORTAR double* enderecoFases() { return fasesSorteadas; }
EXPORTAR double* enderecoAjustesLfo() { return &ajustesLfo[0][0]; }
EXPORTAR double* enderecoAjustesEnv() { return &ajustesEnv[0][0]; }
EXPORTAR double* enderecoMacros() { return macrosAlvo; }
EXPORTAR double* enderecoEnvSaida() { return envSaida; }
EXPORTAR double* enderecoLigacoes() { return entradaLigacoes; }
EXPORTAR uint8_t* enderecoUsos() { return usos; }
EXPORTAR double* enderecoModEfeitos() { return modEfeitos; }
EXPORTAR double* enderecoMod(int v) { return vozesMod[v].mod; } // modulação da voz v (o JS lê)
// Som do oscilador k da voz v: esquerda; a direita vem logo depois (+ BLOCO números)
EXPORTAR double* enderecoSaida(int v, int k) { return osciladores[v][k].somaE; }
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

// Voz v: estado de nota nova (como criar a voz de novo): osciladores, envelopes e modulação
EXPORTAR void vozZerar(int v) {
  for (auto& osc : osciladores[v]) osc.zerar();
  vozesMod[v].zerar();
}

// Voz v começando do silêncio: pontos de início das cópias (lidos de "fasesSorteadas")
EXPORTAR void oscReiniciar(int v) {
  for (int k = 0; k < N_OSC; k++) osciladores[v][k].reiniciar(k);
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
    const double rate = ultima >= 0 ? rateModulado(rateBase, vozesMod[ultima].mod[D_RATE_LFO[l]]) : rateBase;
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
EXPORTAR void somarEfeitos(int ultima) {
  double fontes[N_FONTES];
  for (int f = 0; f < N_FONTES; f++) fontes[f] = ultima >= 0 ? vozesMod[ultima].fontes[f] : 0;
  for (int m = 0; m < 4; m++) fontes[INDICES_MACRO[m]] = macros[m];
  for (int l = 0; l < N_LFO; l++) {
    if (ajustesLfo[l][L_LIVRE] != 0) fontes[INDICES_LFO[l]] = valoresLivres[l][ultimoPedacoLivre];
  }
  somarLigacoes(fontes, modEfeitos);
}

// Nota começando na voz v. "doSilencio" = a voz estava calada (modulação recomeça sem
// rampa); "recomecar" = dispara os envelopes (falso no legato); "retrig" = bits dos LFOs em
// modo Retrig (recomeçam do início), com os valores sorteados s0–s2 para o S&H.
EXPORTAR void vozIniciar(int v, int doSilencio, int recomecar, int retrig, double s0, double s1, double s2) {
  VozMod& vm = vozesMod[v];
  if (doSilencio) vm.modNova = true;
  if (!recomecar) return;
  for (auto& e : vm.envs) e.disparar();
  const double sorteios[N_LFO] = { s0, s1, s2 };
  for (int l = 0; l < N_LFO; l++) {
    if (retrig & (1 << l)) {
      vm.lfos[l].fase = 0;
      vm.lfos[l].aleatorio = sorteios[l];
    }
  }
}

// Tecla solta: os 3 envelopes vão para a soltura
EXPORTAR void vozSoltar(int v) {
  for (auto& e : vozesMod[v].envs) e.soltar();
}
// Voz roubada: some em ~4 ms (só o ENV 1)
EXPORTAR void vozSilenciar(int v) { vozesMod[v].envs[0].silenciarRapido(); }
EXPORTAR int vozAtiva(int v) { return vozesMod[v].envs[0].ativo() ? 1 : 0; }
EXPORTAR double vozNivel(int v) { return vozesMod[v].envs[0].nivel; }

// Começo de um bloco da voz v: ajustes dos envelopes e zera o som dos 3 osciladores
EXPORTAR void vozComecarBloco(int v, int tamanho) {
  VozMod& vm = vozesMod[v];
  for (int e = 0; e < 3; e++) vm.envs[e].definir(ajustesEnv[e][0], ajustesEnv[e][1], ajustesEnv[e][2], ajustesEnv[e][3]);
  for (auto& osc : osciladores[v]) osc.limpar(tamanho);
}

// Um pedaço da voz v: lê as fontes, soma as ligações (suavizado) e calcula os 3 osciladores.
// Devolve quais osciladores fizeram som: bit 0 = A, bit 1 = B, bit 2 = C.
EXPORTAR int vozPedaco(int v, int inicio, int fim, int pedaco, double frequencia) {
  VozMod& vm = vozesMod[v];
  vm.lerFontes(fim - inicio, pedaco);
  // Sem nenhuma ligação e com a modulação já toda em zero: somar e suavizar daria zero de
  // novo: pula (som idêntico)
  vm.pulouMod = qtdLigacoes == 0 && vm.modZerada;
  if (vm.pulouMod) {
    vm.modNova = false;
  } else {
    somarLigacoes(vm.fontes, vm.modAlvo);
    if (vm.modNova) {
      for (int d = 0; d < qtdDestinos; d++) vm.mod[d] = vm.modAnterior[d] = vm.modAlvo[d];
      vm.modNova = false;
    } else {
      for (int d = 0; d < qtdDestinos; d++) vm.mod[d] += (vm.modAlvo[d] - vm.mod[d]) * suavizarMod;
    }
  }
  int tocou = 0;
  for (int k = 0; k < N_OSC; k++) {
    OscVoz& osc = osciladores[v][k];
    osc.processarPedaco(k, inicio, fim, frequencia, vm.mod, vm.modAnterior);
    if (!osc.calado) tocou |= 1 << k;
  }
  return tocou;
}

// Fim de um pedaço da voz v (depois de o JS usar a modulação no ruído e nos filtros)
EXPORTAR void vozFimPedaco(int v) {
  VozMod& vm = vozesMod[v];
  if (vm.pulouMod) return; // (mod e modAnterior continuam zerados)
  for (int d = 0; d < qtdDestinos; d++) vm.modAnterior[d] = vm.mod[d];
  // Sem ligações: quando a modulação chega exatamente a zero, os próximos pedaços pulam
  vm.modZerada = false;
  if (qtdLigacoes == 0) {
    bool zerada = true;
    for (int d = 0; d < qtdDestinos; d++) {
      if (vm.mod[d] != 0) {
        zerada = false;
        break;
      }
    }
    vm.modZerada = zerada;
  }
}

// ENV 1 (volume) da voz v neste bloco: um valor por amostra em envSaida
EXPORTAR void vozEnvelope(int v, int tamanho) {
  Envelope& env = vozesMod[v].envs[0];
  for (int i = 0; i < tamanho; i++) envSaida[i] = env.proximo();
}

// Para a tela (pontinhos ao vivo): fase e valor do LFO l na voz v (v = -1: o LFO Livre)
EXPORTAR double lfoFase(int v, int l) { return v < 0 ? livres[l].fase : vozesMod[v].lfos[l].fase; }
EXPORTAR double lfoValor(int v, int l) {
  return v < 0 ? valoresLivres[l][ultimoPedacoLivre] : vozesMod[v].fontes[INDICES_LFO[l]];
}

// Nível atual do oscilador k da voz v (o motor usa para trocar a wavetable no silêncio)
EXPORTAR double oscNivel(int v, int k) { return osciladores[v][k].nivel; }
