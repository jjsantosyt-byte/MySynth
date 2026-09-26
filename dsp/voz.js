// dsp/voz.js
// Uma "voz" = uma nota tocando, completa:
//   OSC A, B, C (cópias de unison; calculados no C++, motor/motor.cpp) ─┐
//                                                          ├─ cada um pela sua rota de filtro ─→ ENV 1 (volume)
//   ruído ─────────────────────────────────────────────────┘
// A modulação da nota (LFO 1, 2, 3, ENV 2 e 3, Macros e a soma das ligações) e os 3
// envelopes também estão no C++ (etapa F2a). Aqui ficam, por enquanto, o ruído, os filtros,
// as rotas e o glide (vão para o C++ na F2b).
//
// Rotas de filtro (escolhidas para cada oscilador e para o ruído, separadamente):
//   f1 = Filtro 1 · f2 = Filtro 2 · f12 = Filtro 1 e depois Filtro 2 · f21 = o contrário
// Cada rota tem os seus próprios filtros (a "memória" de um não mistura com a de outro).
//
// Modulação: a voz trabalha em pedaços de 64 amostras (~1,3 ms). A cada pedaço o C++
// lê as fontes, soma as ligações e aplica nos controles. Entre um pedaço e outro os
// valores andam em linha reta, então não há "degraus" (zíper).

import { Filtro, CoeficientesFiltro } from './filtro.js';
import { BLOCO } from '../motor/ponte.js';
import { D_RUIDO_PITCH, D_RUIDO_DURACAO, D_CUTOFF, D_RESO, D_RUIDO, D_CUTOFF2, D_RESO2 } from './modulacao.js';
import { NOTA_BASE_RUIDO } from './ruido.js';

const TAMANHO_BLOCO = 128;
const MAX_UNISON = 16;
const N_OSC = 3;
const PEDACO = 64; // amostras por pedaço de modulação (o mesmo PEDACO do motor.cpp)

// Cutoff: a modulação anda na mesma escala do knob (20 Hz a 20 kHz, exponencial).
const CORTE_MIN = 20;
const LOG_FAIXA_CORTE = Math.log(1000); // 20 kHz / 20 Hz

// Ruído: faixas dos knobs Pitch (±24 semitons) e Duração (5 ms a 2 s, exponencial),
// para a modulação andar na mesma escala
const PITCH_RUIDO_MAX = 24;
const DURACAO_RUIDO_MIN = 0.005;
const LOG_FAIXA_DURACAO = Math.log(2 / DURACAO_RUIDO_MIN);

const limitar01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function notaParaFrequencia(nota) {
  return 440 * Math.pow(2, (nota - 69) / 12);
}

export class Voz {
  // "indice" = número desta voz (0 a 15): os osciladores e a modulação dela ficam no C++
  // com esse número. "ponte" = ligação com o motor em C++ (motor/ponte.js).
  constructor(taxaAmostragem, indice, ponte) {
    this.taxa = taxaAmostragem;
    this.indice = indice;
    this.ponte = ponte;
    // Onde o C++ deixa o som de cada oscilador desta voz e a modulação dela (posição na memória)
    this.saidas = [0, 1, 2].map((k) => ponte.saida(indice, k));
    this.iMod = ponte.mod(indice);
    // Ruído: posição no trecho de ruído (dsp/ruido.js), nível suavizado e o nível do
    // One Shot (1 no ataque, caindo até sumir)
    this.ruidoPos = 0;
    this.nivelRuido = 0;
    this.ruidoOneShot = 1;
    this.ruidoNovo = false;
    this.tocou = [false, false, false]; // cada oscilador (A, B, C) fez som neste bloco?
    this.fasesSorteadas = new Float64Array(MAX_UNISON); // ponto de início de cada cópia (sorteado por nota)
    this.fasesPendentes = false; // nota nova: os osciladores ainda não receberam o ponto de início

    // Rotas de filtro. Cada uma tem a sua cadeia de filtros (cada etapa: qual filtro,
    // 1 ou 2, e um par [esquerdo, direito] com a memória própria daquela etapa) e uma
    // "caixa" onde as fontes daquela rota somam o seu som antes de passar pelos filtros.
    const etapa = (numero) => ({ numero, par: [new Filtro(taxaAmostragem), new Filtro(taxaAmostragem)] });
    const rota = (...numeros) => ({
      cadeia: numeros.map(etapa),
      somaE: new Float64Array(TAMANHO_BLOCO),
      somaD: new Float64Array(TAMANHO_BLOCO),
      usada: false,
    });
    this.rotas = { f1: rota(1), f2: rota(2), f12: rota(1, 2), f21: rota(2, 1) };
    this.listaRotas = Object.values(this.rotas);
    this.usadas = []; // rotas com som neste bloco (reaproveitada, sem criar lixo na memória)

    // Filtros com Cutoff/Reso modulados: coeficientes próprios desta voz (um por filtro)
    this.filtrosMod = [1, 2].map(() => {
      const coef = new CoeficientesFiltro(taxaAmostragem);
      coef.variavel = true;
      // pontas: [0] = início, [1] = fim do pedaço
      return { coef, pontas: new CoeficientesFiltro(taxaAmostragem), novo: true };
    });

    this.nota = null;
    this.frequencia = 440;
    // Glide: altura atual (em semitons, pode ser "entre" notas), altura de chegada
    // e quanto anda por amostra (tempo igual para qualquer intervalo).
    this.altura = 69;
    this.alturaAlvo = 69;
    this.passoGlide = 0;
    this.segurada = false; // tecla ainda apertada?
    this.idade = 0; // ordem em que a nota começou (para saber qual é a mais antiga)
    this.pendente = null; // nota que vai tocar assim que esta voz terminar de sumir

    // Rascunho de um bloco de áudio (128 amostras): ruído (mono), separado dos osciladores
    this.ruidoBloco = new Float64Array(TAMANHO_BLOCO);

    this.suavizar = 1 - Math.exp(-1 / (0.005 * taxaAmostragem));
  }

  // O ENV 1 (volume, no C++) ainda está soando?
  get envelopeAtivo() {
    return this.ponte.c.vozAtiva(this.indice) === 1;
  }

  // Está fazendo som (ou prestes a fazer)?
  get ativa() {
    return this.envelopeAtivo || this.pendente !== null;
  }

  get nivel() {
    return this.ponte.c.vozNivel(this.indice);
  }

  // Começa uma nota. "recomecar" = dispara os envelopes (falso no legato).
  // "ajustesLfo" diz quais LFOs estão em modo Retrig (recomeçam a cada nota).
  // "glide" (opcional): { de: altura de partida em semitons, tempo: segundos }.
  iniciar(nota, idade, recomecar = true, ajustesLfo = null, glide = null) {
    const doSilencio = !this.envelopeAtivo;
    if (doSilencio) {
      // Vindo do silêncio: filtros limpos e cada cópia num ponto sorteado da onda.
      for (const { cadeia } of this.listaRotas) {
        for (const { par } of cadeia) for (const filtro of par) filtro.reiniciar();
      }
      // Um sorteio por nota (um ponto de início por cópia de unison), igual para os 3 osciladores
      // (Phase/Rand de cada oscilador entram no primeiro bloco de som: ver processar)
      for (let c = 0; c < this.fasesSorteadas.length; c++) this.fasesSorteadas[c] = Math.random();
      this.fasesPendentes = true;
      for (const f of this.filtrosMod) f.novo = true;
    }
    this.nota = nota;
    if (glide && glide.tempo > 0 && glide.de !== nota) {
      // Escorrega da altura de partida até a nota nova, no tempo escolhido.
      this.altura = glide.de;
      this.passoGlide = Math.abs(nota - glide.de) / (glide.tempo * this.taxa);
    } else {
      this.altura = nota;
      this.passoGlide = 0;
    }
    this.alturaAlvo = nota;
    this.frequencia = notaParaFrequencia(this.altura);
    this.segurada = true;
    this.idade = idade;
    this.pendente = null;
    // Envelopes e LFOs (no C++). LFOs em Retrig recomeçam do início, com um valor sorteado
    // para o S&H (sorteado aqui, na mesma ordem de antes).
    let retrig = 0;
    const sorteios = [0, 0, 0];
    if (recomecar) {
      this.ruidoNovo = true; // o ruído recomeça (ver processar)
      if (ajustesLfo) {
        for (let l = 0; l < ajustesLfo.length; l++) {
          if (ajustesLfo[l].modo !== 'retrig') continue;
          retrig |= 1 << l;
          sorteios[l] = Math.random() * 2 - 1;
        }
      }
    }
    this.ponte.c.vozIniciar(this.indice, doSilencio ? 1 : 0, recomecar ? 1 : 0, retrig, sorteios[0], sorteios[1], sorteios[2]);
  }

  soltar() {
    this.segurada = false;
    this.ponte.c.vozSoltar(this.indice);
  }

  // Voz roubada: some em ~4 ms e depois toca a nota nova.
  roubar(nota, idade, glide = null) {
    this.segurada = false;
    this.pendente = { nota, idade, glide };
    this.ponte.c.vozSilenciar(this.indice);
  }

  // Liga/desliga e tipo de um filtro (1 ou 2): vale para todas as etapas desse filtro.
  definirFiltro(numero, nome, valor) {
    for (const { cadeia } of this.listaRotas) {
      for (const etapa of cadeia) {
        if (etapa.numero !== numero) continue;
        for (const filtro of etapa.par) {
          if (nome === 'tipo') filtro.definirTipo(valor);
          if (nome === 'ligado') filtro.definirLigado(valor);
        }
      }
    }
  }

  // Coeficientes de um filtro com Cutoff/Reso modulados, em rampa suave no pedaço.
  atualizarFiltroModulado(f, cortes, resonancias, modCorte, modReso, inicio, fim) {
    const j = fim - 1;
    const corteBase = cortes.length > 1 ? cortes[j] : cortes[0];
    const resoBase = resonancias.length > 1 ? resonancias[j] : resonancias[0];
    const posicaoCorte = Math.log(Math.max(corteBase, CORTE_MIN) / CORTE_MIN) / LOG_FAIXA_CORTE;
    const corte = CORTE_MIN * Math.exp(limitar01(posicaoCorte + modCorte) * LOG_FAIXA_CORTE);
    const reso = limitar01(resoBase + modReso);
    f.pontas.calcularEm(1, corte, reso);
    if (f.novo) {
      f.pontas.avancarPontas();
      f.novo = false;
    }
    f.coef.interpolar(f.pontas, inicio, fim);
    f.pontas.avancarPontas();
  }

  // Caixa de uma rota neste bloco (na primeira vez que é usada: zera e entra na lista).
  caixa(nome, tamanhoBloco) {
    const rota = this.rotas[nome] || this.rotas.f1;
    if (!rota.usada) {
      rota.somaE.fill(0, 0, tamanhoBloco);
      rota.somaD.fill(0, 0, tamanhoBloco);
      rota.usada = true;
      this.usadas.push(rota);
    }
    return rota;
  }

  // Calcula o som desta voz e SOMA nas saídas (esquerda e direita).
  processar(saidaE, saidaD, tamanhoBloco, comum) {
    // Terminou de sumir e tem nota esperando? Começa ela agora.
    if (this.pendente && !this.envelopeAtivo) {
      const { nota, idade, glide } = this.pendente;
      this.iniciar(nota, idade, true, comum.ajustesLfo, glide);
    }
    if (!this.envelopeAtivo) return;

    const { cortes, resonancias, cortes2, resonancias2, coef, coef2 } = comum;
    const { rotaRuido, ruidoLigado, ruidoNivel, ruidoTipo } = comum;
    // Ajustes de cada oscilador (aqui só a rota de filtro; o resto já está no C++)
    const ajustesOscs = comum.oscs;
    const ponte = this.ponte;
    const motor = ponte.c;
    const v = this.indice;
    // Nota nova (com ataque): o ruído recomeça. One Shot = do início do trecho (todo ataque
    // igual); Loop = de um ponto sorteado (cada nota com um ruído diferente).
    if (this.ruidoNovo) {
      const tamanhoTrecho = comum.trechosRuido[ruidoTipo].length;
      this.ruidoPos = comum.ruidoModo === 'oneshot' ? 0 : Math.floor(Math.random() * tamanhoTrecho);
      this.ruidoOneShot = 1;
      this.ruidoNovo = false;
    }
    // Nota nova: os osciladores (no C++) recebem os pontos de início sorteados
    if (this.fasesPendentes) {
      ponte.f64.set(this.fasesSorteadas, ponte.iFases);
      motor.oscReiniciar(v);
      this.fasesPendentes = false;
    }
    motor.vozComecarBloco(v, tamanhoBloco);
    for (let k = 0; k < N_OSC; k++) this.tocou[k] = false;

    const s = this.suavizar;
    const ruidoBloco = this.ruidoBloco;
    ruidoBloco.fill(0, 0, tamanhoBloco);
    let temRuido = false;

    const modulaF1 = ponte.usa(D_CUTOFF) || ponte.usa(D_RESO);
    const modulaF2 = ponte.usa(D_CUTOFF2) || ponte.usa(D_RESO2);
    if (!modulaF1) this.filtrosMod[0].novo = true;
    if (!modulaF2) this.filtrosMod[1].novo = true;
    const f64 = ponte.f64;
    const m = this.iMod; // modulação desta voz (no C++): f64[m + destino]

    for (let inicio = 0, pedaco = 0; inicio < tamanhoBloco; inicio += PEDACO, pedaco++) {
      const fim = Math.min(inicio + PEDACO, tamanhoBloco);

      // 0) Glide: anda a altura um pedaço em direção à nota de chegada
      if (this.altura !== this.alturaAlvo) {
        const passo = this.passoGlide * (fim - inicio);
        const falta = this.alturaAlvo - this.altura;
        this.altura = Math.abs(falta) <= passo ? this.alturaAlvo : this.altura + Math.sign(falta) * passo;
        this.frequencia = notaParaFrequencia(this.altura);
      }

      // 1) e 2) No C++: fontes de modulação, soma das ligações e osciladores A, B, C
      // (unison, WT Pos, nível, Warp). Devolve quais tocaram (desligado e já em silêncio: não
      // calcula nada).
      const tocaram = motor.vozPedaco(v, inicio, fim, pedaco, this.frequencia);
      for (let k = 0; k < N_OSC; k++) if (tocaram & (1 << k)) this.tocou[k] = true;

      // 3) Ruído (mono), guardado separado do oscilador: pode ir para outro filtro.
      // É um trecho de ruído tocado como sample (dsp/ruido.js), na velocidade do Pitch
      // (+ a nota, com Track). Com "1 ruído", só a nota mais recente (a "dona") toca
      // ruído: as outras somem em ~5 ms. O nível anda suavemente (sem estalos).
      // One Shot: cada nota nova recomeça o trecho do início e o ruído cai até sumir
      // no tempo da Duração.
      const dona = !comum.ruidoUnico || comum.ruidoDona === this;
      const oneShot = comum.ruidoModo === 'oneshot';
      const calouOneShot = oneShot && this.ruidoOneShot < 1e-5;
      const alvoRuido = ruidoLigado && dona && !calouOneShot ? limitar01(ruidoNivel + f64[m + D_RUIDO]) : 0;
      if (alvoRuido > 0 || this.nivelRuido > 1e-5) {
        temRuido = true;
        const trecho = comum.trechosRuido[ruidoTipo];
        const tamanhoTrecho = trecho.length;
        // Pitch modulado: 100% = a faixa toda do knob (48 semitons), sem degraus
        let pitch = comum.ruidoPitch;
        const modPitch = f64[m + D_RUIDO_PITCH];
        if (modPitch !== 0) {
          pitch = Math.min(PITCH_RUIDO_MAX, Math.max(-PITCH_RUIDO_MAX, pitch + modPitch * 2 * PITCH_RUIDO_MAX));
        }
        const semitons = pitch + (comum.ruidoTrack ? this.altura - NOTA_BASE_RUIDO : 0);
        const velocidade = semitons === 0 ? 1 : Math.pow(2, semitons / 12);
        let queda = comum.ruidoQueda;
        const modDuracao = f64[m + D_RUIDO_DURACAO];
        if (oneShot && modDuracao !== 0) {
          // Duração modulada (na escala do knob: exponencial de 5 ms a 2 s)
          const posicao = Math.log(comum.ruidoDuracao / DURACAO_RUIDO_MIN) / LOG_FAIXA_DURACAO + modDuracao;
          const duracao = DURACAO_RUIDO_MIN * Math.exp(limitar01(posicao) * LOG_FAIXA_DURACAO);
          queda = Math.exp(Math.log(0.001) / (duracao * this.taxa));
        }
        let pos = this.ruidoPos;
        for (let i = inicio; i < fim; i++) {
          this.nivelRuido += (alvoRuido - this.nivelRuido) * s;
          const i0 = pos | 0;
          const i1 = i0 + 1 === tamanhoTrecho ? 0 : i0 + 1;
          const amostra = trecho[i0] + (pos - i0) * (trecho[i1] - trecho[i0]);
          let nivel = this.nivelRuido;
          if (oneShot) {
            nivel *= this.ruidoOneShot;
            this.ruidoOneShot *= queda;
          }
          ruidoBloco[i] = amostra * nivel;
          pos += velocidade;
          if (pos >= tamanhoTrecho) pos -= tamanhoTrecho;
        }
        this.ruidoPos = pos;
      } else {
        this.nivelRuido = 0;
      }

      // 4) Filtros com Cutoff/Reso modulados: coeficientes próprios, em rampa suave
      if (modulaF1) this.atualizarFiltroModulado(this.filtrosMod[0], cortes, resonancias, f64[m + D_CUTOFF], f64[m + D_RESO], inicio, fim);
      if (modulaF2) this.atualizarFiltroModulado(this.filtrosMod[1], cortes2, resonancias2, f64[m + D_CUTOFF2], f64[m + D_RESO2], inicio, fim);

      motor.vozFimPedaco(v);
    }

    // --- Caixas das rotas: cada fonte soma o seu som na caixa da sua rota ---
    // (várias fontes na mesma rota passam juntas por um filtro só)
    for (const rota of this.listaRotas) rota.usada = false;
    const usadas = this.usadas;
    usadas.length = 0;
    // (o som dos osciladores é lido direto da memória do C++: esquerda em "e", direita BLOCO depois)
    for (let k = 0; k < N_OSC; k++) {
      if (!this.tocou[k]) continue;
      const rota = this.caixa(ajustesOscs[k].rota, tamanhoBloco);
      const e = this.saidas[k];
      const d = e + BLOCO;
      for (let i = 0; i < tamanhoBloco; i++) {
        rota.somaE[i] += f64[e + i];
        rota.somaD[i] += f64[d + i];
      }
    }
    if (temRuido) {
      const rota = this.caixa(rotaRuido, tamanhoBloco);
      for (let i = 0; i < tamanhoBloco; i++) {
        rota.somaE[i] += ruidoBloco[i];
        rota.somaD[i] += ruidoBloco[i];
      }
    }

    // --- Filtros (estéreo) e envelope de volume (ENV 1, calculado no C++) ---
    const c1 = modulaF1 ? this.filtrosMod[0].coef : coef;
    const c2 = modulaF2 ? this.filtrosMod[1].coef : coef2;
    motor.vozEnvelope(v, tamanhoBloco);
    const iEnv = ponte.iEnvSaida;
    const qtdUsadas = usadas.length;

    // Nenhum filtro ativo nas rotas usadas (o caso de muitos sons): só soma as caixas e aplica
    // o envelope, sem passar pelo "caminho" do filtro amostra por amostra (mesmo resultado).
    let algumFiltro = false;
    for (let g = 0; g < qtdUsadas; g++) {
      for (const etapa of usadas[g].cadeia) if (etapa.par[0].ativo || etapa.par[1].ativo) algumFiltro = true;
    }
    if (!algumFiltro) {
      for (let i = 0; i < tamanhoBloco; i++) {
        let e = 0;
        let d = 0;
        for (let g = 0; g < qtdUsadas; g++) {
          e += usadas[g].somaE[i];
          d += usadas[g].somaD[i];
        }
        const env = f64[iEnv + i];
        saidaE[i] += e * env;
        saidaD[i] += d * env;
      }
      return;
    }

    for (let i = 0; i < tamanhoBloco; i++) {
      const j1 = c1.variavel ? i : 0;
      const j2 = c2.variavel ? i : 0;
      let e = 0;
      let d = 0;
      for (let g = 0; g < qtdUsadas; g++) {
        const rota = usadas[g];
        let xe = rota.somaE[i];
        let xd = rota.somaD[i];
        const cadeia = rota.cadeia;
        for (let k = 0; k < cadeia.length; k++) {
          const etapa = cadeia[k];
          const um = etapa.numero === 1;
          xe = etapa.par[0].processar(xe, um ? c1 : c2, um ? j1 : j2);
          xd = etapa.par[1].processar(xd, um ? c1 : c2, um ? j1 : j2);
        }
        e += xe;
        d += xd;
      }
      const env = f64[iEnv + i];
      saidaE[i] += e * env;
      saidaD[i] += d * env;
    }
  }
}
