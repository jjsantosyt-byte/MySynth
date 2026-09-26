// motor.cpp
// Motor de som em C++, compilado para WebAssembly (motor.wasm) e usado pelo
// processador-synth.js dentro do AudioWorklet.
//
// Regras (as mesmas do dsp/): só contas de áudio, nada de navegador. Assim este mesmo
// código pode, no futuro, virar um motor nativo (Android/Oboe, JUCE).
//
// Etapa F1: os OSCILADORES das notas (leitura da wavetable sem chiado, WT Pos, unison,
// Warp e FM). O resto da voz (filtros, envelopes, modulação) ainda está em dsp/voz.js e
// chama estas funções a cada pedaço de modulação.
//
// Como o JavaScript conversa com o C++ ("mesa de troca"):
//   - wavetables: o JS pede espaço (criarTabela) e copia as ondas para dentro, uma vez só;
//     depois só usa o endereço da tabela (um número).
//   - ajustes dos 3 osciladores (Unison, Detune, Warp...): o JS escreve em "ajustes" e
//     "posicoes" (WT Pos) uma vez por bloco;
//   - modulação da voz: o JS escreve em "modAtual"/"modAnterior" a cada pedaço;
//   - o som de cada oscilador de cada voz sai em "saidas" (esquerda e direita), que o JS lê.
//
// Para compilar: motor\compilar.bat (gera motor\motor.wasm).

#include <cmath>
#include <cstdint>
#include <cstdlib>

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
  int tamanho;               // pontos por ciclo (2048)
  int mascara;               // tamanho - 1
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
double modAtual[N_MOD_OSC];                 // modulação da voz: fim deste pedaço
double modAnterior[N_MOD_OSC];              // ...e fim do pedaço anterior
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
      const int tamanho = tab->tamanho;
      const int mascara = tab->mascara;
      // Sem Warp: uma cópia inteira de cada vez
      for (int c = 0; c < qtdCopias; c++) {
        double fase = fases[c];
        const double passo = passos[c];
        const double gE = ganhosE[c], gD = ganhosD[c];
        const int nv = niveis[c], nvB = niveisB[c];
        const double mistura = misturas[c];
        const double alvo = volumeDaCopia(c, unison);
        double volume = volumes[c];
        const bool suavizando = std::fabs(volume - alvo) > 1e-4;
        if (!suavizando) volume = alvo;

        if (wtParado) {
          // Caminho rápido: as mesmas ondas no pedaço todo
          const int fB = f0Parado + 1 < ultimoFrame ? f0Parado + 1 : ultimoFrame;
          const float* oA = tab->onda(f0Parado, nv);
          const float* oAB = tab->onda(f0Parado, nvB);
          const float* oB = tab->onda(fB, nv);
          const float* oBB = tab->onda(fB, nvB);
          for (int i = inicio; i < fim; i++) {
            if (suavizando) volume += (alvo - volume) * s;
            const double posicao = fase * tamanho;
            const int i0 = static_cast<int>(posicao);
            const int i1 = (i0 + 1) & mascara;
            const double frac = posicao - i0;
            double amostra = oA[i0] + frac * (oA[i1] - oA[i0]);
            if (mistura > 0) amostra += mistura * (oAB[i0] + frac * (oAB[i1] - oAB[i0]) - amostra);
            if (tParado > 0) {
              double amostraB = oB[i0] + frac * (oB[i1] - oB[i0]);
              if (mistura > 0) amostraB += mistura * (oBB[i0] + frac * (oBB[i1] - oBB[i0]) - amostraB);
              amostra += tParado * (amostraB - amostra);
            }
            amostra *= volume;
            somaE[i] += amostra * gE;
            somaD[i] += amostra * gD;
            fase += passo;
            if (fase >= 1) fase -= 1;
          }
        } else {
          // WT Pos mudando: posição na wavetable a cada amostra (morphing suave)
          for (int i = inicio; i < fim; i++) {
            if (suavizando) volume += (alvo - volume) * s;
            const int f0 = framesBloco[i];
            const int fB = f0 + 1 < ultimoFrame ? f0 + 1 : ultimoFrame;
            const double amostra = lerAmostra(tab, f0, fB, tsBloco[i], nv, nvB, mistura, fase) * volume;
            somaE[i] += amostra * gE;
            somaD[i] += amostra * gD;
            fase += passo;
            if (fase >= 1) fase -= 1;
          }
        }
        fases[c] = fase;
        volumes[c] = volume;
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

}  // namespace

// ================= Funções que o JavaScript chama =================

// Versão do motor em C++ (sobe a cada etapa; o JavaScript mostra no console).
EXPORTAR int versao() { return 1; }

// Liga o motor na taxa de amostragem do aparelho (chamada uma vez, ao nascer).
EXPORTAR void iniciar(double taxaAmostragem) {
  taxa = taxaAmostragem;
  suavizar = 1 - std::exp(-1 / (0.005 * taxa));
  prepararMeiaBanda();
  for (auto& voz : osciladores)
    for (auto& osc : voz) osc.zerar();
}

// Endereços da mesa de troca (o JS escreve/lê direto na memória)
EXPORTAR double* enderecoAjustes() { return &ajustes[0][0]; }
EXPORTAR double* enderecoPosicoes() { return &posicoes[0][0]; }
EXPORTAR double* enderecoModAtual() { return modAtual; }
EXPORTAR double* enderecoModAnterior() { return modAnterior; }
EXPORTAR double* enderecoFases() { return fasesSorteadas; }
// Som do oscilador k da voz v: esquerda; a direita vem logo depois (+ BLOCO números)
EXPORTAR double* enderecoSaida(int v, int k) { return osciladores[v][k].somaE; }
EXPORTAR int camposOsc() { return N_CAMPOS; }

// Wavetables: pede espaço para uma tabela (o JS copia os harmônicos e as ondas para dentro)
EXPORTAR Tabela* criarTabela(int qtdFrames, int qtdNiveis, int tamanho) {
  if (qtdNiveis > MAX_NIVEIS) return nullptr;
  Tabela* t = static_cast<Tabela*>(std::malloc(sizeof(Tabela)));
  if (!t) return nullptr;
  t->tamanho = tamanho;
  t->mascara = tamanho - 1;
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

// Voz v: estado de nota nova (como criar a voz de novo)
EXPORTAR void oscZerarVoz(int v) {
  for (auto& osc : osciladores[v]) osc.zerar();
}

// Voz v começando do silêncio: pontos de início das cópias (lidos de "fasesSorteadas")
EXPORTAR void oscReiniciar(int v) {
  for (int k = 0; k < N_OSC; k++) osciladores[v][k].reiniciar(k);
}

// Começo de um bloco da voz v: zera o som dos 3 osciladores
EXPORTAR void oscComecarBloco(int v, int tamanho) {
  for (auto& osc : osciladores[v]) osc.limpar(tamanho);
}

// Um pedaço da voz v nos 3 osciladores (modulação em modAtual/modAnterior).
// Devolve quais osciladores fizeram som: bit 0 = A, bit 1 = B, bit 2 = C.
EXPORTAR int oscPedaco(int v, int inicio, int fim, double frequencia) {
  int tocou = 0;
  for (int k = 0; k < N_OSC; k++) {
    OscVoz& osc = osciladores[v][k];
    osc.processarPedaco(k, inicio, fim, frequencia, modAtual, modAnterior);
    if (!osc.calado) tocou |= 1 << k;
  }
  return tocou;
}

// Nível atual do oscilador k da voz v (o motor usa para trocar a wavetable no silêncio)
EXPORTAR double oscNivel(int v, int k) { return osciladores[v][k].nivel; }
