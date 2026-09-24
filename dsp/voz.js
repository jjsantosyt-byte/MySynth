// dsp/voz.js
// Uma "voz" = uma nota tocando, completa:
//   oscilador (cópias de unison, ver oscilador-voz.js) ─┐
//                                                        ├─ cada um pela sua rota de filtro ─→ ENV 1 (volume)
//   ruído ───────────────────────────────────────────────┘
// e as fontes de modulação da própria nota: LFO 1 e 2 (modo Retrig), ENV 2 e 3.
//
// Rotas de filtro (escolhidas para o oscilador e para o ruído, separadamente):
//   f1 = Filtro 1 · f2 = Filtro 2 · f12 = Filtro 1 e depois Filtro 2 · f21 = o contrário
// Cada rota tem os seus próprios filtros (a "memória" de um não mistura com a de outro).
//
// Modulação: a voz trabalha em pedaços de 32 amostras (< 1 ms). A cada pedaço
// ela lê as fontes, soma as ligações e aplica nos controles. Entre um pedaço e
// outro os valores andam em linha reta, então não há "degraus" (zíper).

import { Envelope } from './envelope.js';
import { Filtro, CoeficientesFiltro } from './filtro.js';
import { OsciladorVoz } from './oscilador-voz.js';
import { EstadoLFO } from './lfo.js';
import {
  DESTINOS_MOD,
  FONTES_MOD,
  D_WTPOS,
  D_DETUNE,
  D_WIDTH,
  D_CUTOFF,
  D_RESO,
  D_RUIDO,
  D_NIVEL_OSC,
  D_CUTOFF2,
  D_RESO2,
} from './modulacao.js';
import { Ruido } from './ruido.js';

const TAMANHO_BLOCO = 128;
const PEDACO = 32; // amostras por pedaço de modulação

// Cutoff: a modulação anda na mesma escala do knob (20 Hz a 20 kHz, exponencial).
const CORTE_MIN = 20;
const LOG_FAIXA_CORTE = Math.log(1000); // 20 kHz / 20 Hz

const limitar01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function notaParaFrequencia(nota) {
  return 440 * Math.pow(2, (nota - 69) / 12);
}

export class Voz {
  // "numero" = qual voz é (1, 2, 3...): usado para cada voz ter um ruído diferente.
  constructor(taxaAmostragem, numero = 1) {
    this.taxa = taxaAmostragem;
    this.envelope = new Envelope(taxaAmostragem); // ENV 1: volume
    this.ruido = new Ruido(numero);
    this.nivelRuido = 0;
    // Oscilador A (com os seus destinos de modulação)
    this.oscA = new OsciladorVoz(taxaAmostragem, TAMANHO_BLOCO, {
      wtPos: D_WTPOS,
      detune: D_DETUNE,
      width: D_WIDTH,
      nivel: D_NIVEL_OSC,
    });
    // Cadeias de filtro, uma por rota. Cada etapa: qual filtro (1 ou 2) e um par
    // [esquerdo, direito] com a memória própria daquela etapa.
    const etapa = (numero) => ({ numero, par: [new Filtro(taxaAmostragem), new Filtro(taxaAmostragem)] });
    this.cadeias = {
      f1: [etapa(1)],
      f2: [etapa(2)],
      f12: [etapa(1), etapa(2)],
      f21: [etapa(2), etapa(1)],
    };
    // Grupos deste bloco (quem passa por qual cadeia); fixos para não criar lixo na memória
    this.grupos = [
      { cadeia: null, osc: false, ruido: false },
      { cadeia: null, osc: false, ruido: false },
    ];

    // Fontes de modulação desta nota
    this.lfos = [new EstadoLFO(), new EstadoLFO()];
    this.envsMod = [new Envelope(taxaAmostragem), new Envelope(taxaAmostragem)]; // ENV 2 e 3
    this.valoresFontes = new Float64Array(FONTES_MOD.length);
    this.modAlvo = new Float64Array(DESTINOS_MOD.length); // soma "crua" das ligações
    this.mod = new Float64Array(DESTINOS_MOD.length); // modulação deste pedaço (suavizada)
    this.modAnterior = new Float64Array(DESTINOS_MOD.length); // do pedaço anterior
    this.modNova = true; // true = ainda não tem "pedaço anterior"

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

    // Rascunho de um bloco de áudio (128 amostras): ruído (mono), separado do oscilador
    this.ruidoBloco = new Float64Array(TAMANHO_BLOCO);
    // Ajustes do oscilador A neste bloco (reaproveitado, sem criar lixo na memória)
    this.ajustesA = { tabela: null, posicoesWT: null, unison: 1, detune: 0, width: 0, ligado: true, nivel: 1 };

    this.suavizar = 1 - Math.exp(-1 / (0.005 * taxaAmostragem));
    // Modulação suavizada em ~2 ms: saltos bruscos (LFO quadrado, aleatório,
    // ataque zero) viram rampas curtíssimas, sem tique.
    this.suavizarMod = 1 - Math.exp(-PEDACO / (0.002 * taxaAmostragem));
  }

  // Está fazendo som (ou prestes a fazer)?
  get ativa() {
    return this.envelope.ativo || this.pendente !== null;
  }

  get nivel() {
    return this.envelope.nivel;
  }

  // Começa uma nota. "recomecar" = dispara os envelopes (falso no legato).
  // "ajustesLfo" diz quais LFOs estão em modo Retrig (recomeçam a cada nota).
  // "glide" (opcional): { de: altura de partida em semitons, tempo: segundos }.
  iniciar(nota, idade, recomecar = true, ajustesLfo = null, glide = null) {
    if (!this.envelope.ativo) {
      // Vindo do silêncio: filtros limpos e cada cópia num ponto sorteado da onda.
      for (const cadeia of Object.values(this.cadeias)) {
        for (const { par } of cadeia) for (const filtro of par) filtro.reiniciar();
      }
      this.oscA.reiniciar();
      this.modNova = true;
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
    if (recomecar) {
      this.envelope.disparar();
      for (const env of this.envsMod) env.disparar();
      if (ajustesLfo) {
        this.lfos.forEach((lfo, l) => {
          if (ajustesLfo[l].modo === 'retrig') lfo.reiniciar();
        });
      }
    }
  }

  soltar() {
    this.segurada = false;
    this.envelope.soltar();
    for (const env of this.envsMod) env.soltar();
  }

  // Voz roubada: some em ~4 ms e depois toca a nota nova.
  roubar(nota, idade, glide = null) {
    this.segurada = false;
    this.pendente = { nota, idade, glide };
    this.envelope.silenciarRapido();
  }

  // Liga/desliga e tipo de um filtro (1 ou 2): vale para todas as etapas desse filtro.
  definirFiltro(numero, nome, valor) {
    for (const cadeia of Object.values(this.cadeias)) {
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
  atualizarFiltroModulado(f, cortes, resonancias, dCorte, dReso, inicio, fim) {
    const j = fim - 1;
    const corteBase = cortes.length > 1 ? cortes[j] : cortes[0];
    const resoBase = resonancias.length > 1 ? resonancias[j] : resonancias[0];
    const posicaoCorte = Math.log(Math.max(corteBase, CORTE_MIN) / CORTE_MIN) / LOG_FAIXA_CORTE;
    const corte = CORTE_MIN * Math.exp(limitar01(posicaoCorte + this.mod[dCorte]) * LOG_FAIXA_CORTE);
    const reso = limitar01(resoBase + this.mod[dReso]);
    f.pontas.calcularEm(1, corte, reso);
    if (f.novo) {
      f.pontas.avancarPontas();
      f.novo = false;
    }
    f.coef.interpolar(f.pontas, inicio, fim);
    f.pontas.avancarPontas();
  }

  // Lê as fontes de modulação no fim de um pedaço de "qtd" amostras.
  lerFontes(qtd, comum, pedaco) {
    const { ajustesLfo, lfosLivres } = comum;
    for (let l = 0; l < 2; l++) {
      const ajustes = ajustesLfo[l];
      if (ajustes.modo === 'livre') {
        // Livre: todas as notas usam o mesmo LFO, que roda sem parar.
        this.valoresFontes[l] = lfosLivres[l][pedaco];
      } else {
        this.lfos[l].avancar((ajustes.rate * qtd) / this.taxa);
        this.valoresFontes[l] = this.lfos[l].valor(ajustes.forma);
      }
    }
    for (let e = 0; e < 2; e++) {
      const env = this.envsMod[e];
      for (let k = 0; k < qtd; k++) env.proximo();
      this.valoresFontes[2 + e] = env.nivel;
    }
  }

  // Calcula o som desta voz e SOMA nas saídas (esquerda e direita).
  processar(saidaE, saidaD, tamanhoBloco, comum) {
    // Terminou de sumir e tem nota esperando? Começa ela agora.
    if (this.pendente && !this.envelope.ativo) {
      const { nota, idade, glide } = this.pendente;
      this.iniciar(nota, idade, true, comum.ajustesLfo, glide);
    }
    if (!this.envelope.ativo) return;

    const { tabela, posicoesWT, cortes, resonancias, cortes2, resonancias2, coef, coef2 } = comum;
    const { unison, detune, width, matriz, rotaOsc, rotaRuido } = comum;
    const { ruidoLigado, ruidoNivel, ruidoTipo, oscLigado, oscNivel } = comum;

    // Ajustes do oscilador A neste bloco
    const ajustesA = this.ajustesA;
    ajustesA.tabela = tabela;
    ajustesA.posicoesWT = posicoesWT;
    ajustesA.unison = unison;
    ajustesA.detune = detune;
    ajustesA.width = width;
    ajustesA.ligado = oscLigado;
    ajustesA.nivel = oscNivel;
    const oscA = this.oscA;
    oscA.limpar(tamanhoBloco);

    const s = this.suavizar;
    const somaE = oscA.somaE;
    const somaD = oscA.somaD;
    const ruidoBloco = this.ruidoBloco;
    ruidoBloco.fill(0, 0, tamanhoBloco);
    let temRuido = false;

    const modulaF1 = matriz.usa(D_CUTOFF) || matriz.usa(D_RESO);
    const modulaF2 = matriz.usa(D_CUTOFF2) || matriz.usa(D_RESO2);
    if (!modulaF1) this.filtrosMod[0].novo = true;
    if (!modulaF2) this.filtrosMod[1].novo = true;

    for (let inicio = 0, pedaco = 0; inicio < tamanhoBloco; inicio += PEDACO, pedaco++) {
      const fim = Math.min(inicio + PEDACO, tamanhoBloco);
      const qtd = fim - inicio;

      // 0) Glide: anda a altura um pedaço em direção à nota de chegada
      if (this.altura !== this.alturaAlvo) {
        const passo = this.passoGlide * qtd;
        const falta = this.alturaAlvo - this.altura;
        this.altura = Math.abs(falta) <= passo ? this.alturaAlvo : this.altura + Math.sign(falta) * passo;
        this.frequencia = notaParaFrequencia(this.altura);
      }

      // 1) Fontes e soma das ligações neste pedaço
      this.lerFontes(qtd, comum, pedaco);
      matriz.somar(this.valoresFontes, this.modAlvo);
      if (this.modNova) {
        this.mod.set(this.modAlvo);
        this.modAnterior.set(this.modAlvo);
        this.modNova = false;
      } else {
        for (let d = 0; d < this.mod.length; d++) {
          this.mod[d] += (this.modAlvo[d] - this.mod[d]) * this.suavizarMod;
        }
      }

      // 2) Oscilador A (unison, WT Pos, nível; tudo com modulação)
      oscA.processarPedaco(inicio, fim, this.frequencia, ajustesA, this.mod, this.modAnterior);

      // 3) Ruído (mono), guardado separado do oscilador: pode ir para outro filtro.
      // O nível anda suavemente (ligar, desligar e modular não estalam).
      const alvoRuido = ruidoLigado ? limitar01(ruidoNivel + this.mod[D_RUIDO]) : 0;
      if (alvoRuido > 0 || this.nivelRuido > 1e-5) {
        temRuido = true;
        for (let i = inicio; i < fim; i++) {
          this.nivelRuido += (alvoRuido - this.nivelRuido) * s;
          ruidoBloco[i] = this.ruido.proximo(ruidoTipo) * this.nivelRuido;
        }
      } else {
        this.nivelRuido = 0;
      }

      // 4) Filtros com Cutoff/Reso modulados: coeficientes próprios, em rampa suave
      if (modulaF1) this.atualizarFiltroModulado(this.filtrosMod[0], cortes, resonancias, D_CUTOFF, D_RESO, inicio, fim);
      if (modulaF2) this.atualizarFiltroModulado(this.filtrosMod[1], cortes2, resonancias2, D_CUTOFF2, D_RESO2, inicio, fim);

      this.modAnterior.set(this.mod);
    }

    // --- Grupos: quem passa por qual cadeia de filtro neste bloco ---
    // (oscilador e ruído na mesma rota = um grupo só; em rotas diferentes = dois)
    const grupos = this.grupos;
    grupos[0].cadeia = this.cadeias[rotaOsc] || this.cadeias.f1;
    grupos[0].osc = true;
    grupos[0].ruido = temRuido && rotaRuido === rotaOsc;
    let qtdGrupos = 1;
    if (temRuido && rotaRuido !== rotaOsc) {
      grupos[1].cadeia = this.cadeias[rotaRuido] || this.cadeias.f1;
      grupos[1].osc = false;
      grupos[1].ruido = true;
      qtdGrupos = 2;
    }

    // --- Filtros (estéreo) e envelope de volume ---
    const c1 = modulaF1 ? this.filtrosMod[0].coef : coef;
    const c2 = modulaF2 ? this.filtrosMod[1].coef : coef2;
    const envelope = this.envelope;
    for (let i = 0; i < tamanhoBloco; i++) {
      const j1 = c1.variavel ? i : 0;
      const j2 = c2.variavel ? i : 0;
      let e = 0;
      let d = 0;
      for (let g = 0; g < qtdGrupos; g++) {
        const grupo = grupos[g];
        let xe = grupo.osc ? somaE[i] : 0;
        let xd = grupo.osc ? somaD[i] : 0;
        if (grupo.ruido) {
          xe += ruidoBloco[i];
          xd += ruidoBloco[i];
        }
        const cadeia = grupo.cadeia;
        for (let k = 0; k < cadeia.length; k++) {
          const etapa = cadeia[k];
          const um = etapa.numero === 1;
          xe = etapa.par[0].processar(xe, um ? c1 : c2, um ? j1 : j2);
          xd = etapa.par[1].processar(xd, um ? c1 : c2, um ? j1 : j2);
        }
        e += xe;
        d += xd;
      }
      const env = envelope.proximo();
      saidaE[i] += e * env;
      saidaD[i] += d * env;
    }
  }
}
