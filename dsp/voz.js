// dsp/voz.js
// Uma "voz" = uma nota tocando, completa:
//   OSC A, B, C (cópias de unison, ver oscilador-voz.js) ─┐
//                                                          ├─ cada um pela sua rota de filtro ─→ ENV 1 (volume)
//   ruído ─────────────────────────────────────────────────┘
// e as fontes de modulação da própria nota: LFO 1 e 2 (modo Retrig), ENV 2 e 3.
//
// Rotas de filtro (escolhidas para cada oscilador e para o ruído, separadamente):
//   f1 = Filtro 1 · f2 = Filtro 2 · f12 = Filtro 1 e depois Filtro 2 · f21 = o contrário
// Cada rota tem os seus próprios filtros (a "memória" de um não mistura com a de outro).
//
// Modulação: a voz trabalha em pedaços de 32 amostras (< 1 ms). A cada pedaço
// ela lê as fontes, soma as ligações e aplica nos controles. Entre um pedaço e
// outro os valores andam em linha reta, então não há "degraus" (zíper).

import { Envelope } from './envelope.js';
import { Filtro, CoeficientesFiltro } from './filtro.js';
import { OsciladorVoz, MAX_UNISON } from './oscilador-voz.js';
import { EstadoLFO } from './lfo.js';
import { DESTINOS_MOD, DESTINOS_OSC, FONTES_MOD, D_CUTOFF, D_RESO, D_RUIDO, D_CUTOFF2, D_RESO2 } from './modulacao.js';
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
    // Osciladores A, B e C (cada um com os seus destinos de modulação)
    this.oscs = DESTINOS_OSC.map((destinos) => new OsciladorVoz(taxaAmostragem, TAMANHO_BLOCO, destinos));
    this.tocou = [false, false, false]; // cada oscilador fez som neste bloco?
    this.fasesSorteadas = new Float64Array(MAX_UNISON); // ponto de início de cada cópia (sorteado por nota)

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

    // Rascunho de um bloco de áudio (128 amostras): ruído (mono), separado dos osciladores
    this.ruidoBloco = new Float64Array(TAMANHO_BLOCO);

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
      for (const { cadeia } of this.listaRotas) {
        for (const { par } of cadeia) for (const filtro of par) filtro.reiniciar();
      }
      // Um sorteio por nota (um ponto de início por cópia de unison), igual para os 3 osciladores
      for (let c = 0; c < this.fasesSorteadas.length; c++) this.fasesSorteadas[c] = Math.random();
      for (const osc of this.oscs) osc.reiniciar(this.fasesSorteadas);
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
    if (this.pendente && !this.envelope.ativo) {
      const { nota, idade, glide } = this.pendente;
      this.iniciar(nota, idade, true, comum.ajustesLfo, glide);
    }
    if (!this.envelope.ativo) return;

    const { cortes, resonancias, cortes2, resonancias2, coef, coef2 } = comum;
    const { matriz, rotaRuido, ruidoLigado, ruidoNivel, ruidoTipo } = comum;
    // Ajustes de cada oscilador neste bloco (ver OsciladorVoz.processarPedaco)
    const ajustesOscs = comum.oscs;
    const oscs = this.oscs;
    for (let k = 0; k < oscs.length; k++) {
      oscs[k].limpar(tamanhoBloco);
      this.tocou[k] = false;
    }

    const s = this.suavizar;
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

      // 2) Osciladores A, B, C (unison, WT Pos, nível; tudo com modulação).
      // Desligado e já em silêncio: não calcula nada.
      for (let k = 0; k < oscs.length; k++) {
        oscs[k].processarPedaco(inicio, fim, this.frequencia, ajustesOscs[k], this.mod, this.modAnterior);
        if (!oscs[k].calado) this.tocou[k] = true;
      }

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

    // --- Caixas das rotas: cada fonte soma o seu som na caixa da sua rota ---
    // (várias fontes na mesma rota passam juntas por um filtro só)
    for (const rota of this.listaRotas) rota.usada = false;
    const usadas = this.usadas;
    usadas.length = 0;
    for (let k = 0; k < oscs.length; k++) {
      if (!this.tocou[k]) continue;
      const rota = this.caixa(ajustesOscs[k].rota, tamanhoBloco);
      const { somaE, somaD } = oscs[k];
      for (let i = 0; i < tamanhoBloco; i++) {
        rota.somaE[i] += somaE[i];
        rota.somaD[i] += somaD[i];
      }
    }
    if (temRuido) {
      const rota = this.caixa(rotaRuido, tamanhoBloco);
      for (let i = 0; i < tamanhoBloco; i++) {
        rota.somaE[i] += ruidoBloco[i];
        rota.somaD[i] += ruidoBloco[i];
      }
    }

    // --- Filtros (estéreo) e envelope de volume ---
    const c1 = modulaF1 ? this.filtrosMod[0].coef : coef;
    const c2 = modulaF2 ? this.filtrosMod[1].coef : coef2;
    const envelope = this.envelope;
    const qtdUsadas = usadas.length;
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
      const env = envelope.proximo();
      saidaE[i] += e * env;
      saidaD[i] += d * env;
    }
  }
}
