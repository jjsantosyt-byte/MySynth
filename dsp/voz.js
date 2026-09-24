// dsp/voz.js
// Uma "voz" = uma nota tocando, completa:
//   cópias de unison (oscilador) ─┐
//                                  ├─ cada um pela sua rota de filtro ─→ envelope de volume (ENV 1)
//   ruído ─────────────────────────┘
// e as fontes de modulação da própria nota: LFO 1 e 2 (modo Retrig), ENV 2 e 3.
//
// Rotas de filtro (escolhidas para o oscilador e para o ruído, separadamente):
//   f1 = Filtro 1 · f2 = Filtro 2 · f12 = Filtro 1 e depois Filtro 2 · f21 = o contrário
// Cada rota tem os seus próprios filtros (a "memória" de um não mistura com a de outro).
//
// Unison: várias cópias do oscilador, desafinadas por igual para cima e
// para baixo (Detune) e abertas entre esquerda e direita (Width).
// Cada cópia começa num ponto sorteado da onda: é o que deixa o som vivo.
//
// Modulação: a voz trabalha em pedaços de 32 amostras (< 1 ms). A cada pedaço
// ela lê as fontes, soma as ligações e aplica nos controles. Entre um pedaço e
// outro os valores andam em linha reta, então não há "degraus" (zíper).

import { Envelope } from './envelope.js';
import { Filtro, CoeficientesFiltro } from './filtro.js';
import { escolherNiveis, lerAmostra } from './oscilador.js';
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

export const MAX_UNISON = 16;

// Com Detune em 100%, as cópias das pontas ficam ±1 semitom da nota.
const DETUNE_MAXIMO = 1;

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
    this.nivelOsc = 1; // nível atual do oscilador (liga/desliga e knob Nível, suavizado)
    this.nivelOscDireto = true;
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

    // Dados de cada cópia de unison
    this.fases = new Float64Array(MAX_UNISON);
    this.passos = new Float64Array(MAX_UNISON);
    this.volumes = new Float64Array(MAX_UNISON); // mudam suavemente (sem estalo)
    this.ganhosE = new Float64Array(MAX_UNISON);
    this.ganhosD = new Float64Array(MAX_UNISON);
    this.niveis = new Int32Array(MAX_UNISON);
    this.niveisB = new Int32Array(MAX_UNISON);
    this.misturas = new Float64Array(MAX_UNISON);
    this.volumesDireto = false; // na primeira vez, os volumes vão direto ao valor certo

    // Rascunhos de um bloco de áudio (128 amostras)
    this.somaE = new Float64Array(TAMANHO_BLOCO); // soma das cópias, lado esquerdo
    this.somaD = new Float64Array(TAMANHO_BLOCO); // soma das cópias, lado direito
    this.ruidoBloco = new Float64Array(TAMANHO_BLOCO); // ruído (mono), separado do oscilador
    this.framesBloco = new Int32Array(TAMANHO_BLOCO); // WT Pos mudando: frame de cada amostra
    this.tsBloco = new Float64Array(TAMANHO_BLOCO); // ...e quanto do frame seguinte

    this.suavizar = 1 - Math.exp(-1 / (0.005 * taxaAmostragem));
    // Modulação suavizada em ~2 ms: saltos bruscos (LFO quadrado, aleatório,
    // ataque zero) viram rampas curtíssimas, sem tique.
    this.suavizarMod = 1 - Math.exp(-PEDACO / (0.002 * taxaAmostragem));
    this.escolha = { nivel: 0, nivelB: 0, mistura: 0 };
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
      for (let c = 0; c < MAX_UNISON; c++) this.fases[c] = Math.random();
      this.volumesDireto = true;
      this.nivelOscDireto = true;
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

  // Ajusta cada cópia de unison (altura, estéreo, nível anti-aliasing).
  ajustarCopias(unison, detune, width, tabela) {
    for (let c = 0; c < unison; c++) {
      // Posição da cópia de -1 (ponta de baixo/esquerda) a +1 (ponta de cima/direita).
      const posicao = unison === 1 ? 0 : (c / (unison - 1)) * 2 - 1;
      const freq = this.frequencia * Math.pow(2, (posicao * detune * DETUNE_MAXIMO) / 12);
      this.passos[c] = freq / this.taxa;
      escolherNiveis(tabela.harmonicos, freq, this.taxa, this.escolha);
      this.niveis[c] = this.escolha.nivel;
      this.niveisB[c] = this.escolha.nivelB;
      this.misturas[c] = this.escolha.mistura;
      // Estéreo "de potência igual": no centro, os dois lados com o mesmo volume.
      const angulo = ((1 + posicao * width) * Math.PI) / 4;
      this.ganhosE[c] = Math.cos(angulo) * Math.SQRT2;
      this.ganhosD[c] = Math.sin(angulo) * Math.SQRT2;
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

    // Volume de cada cópia: 1/√N, para o som não ficar N vezes mais alto.
    const volumeCopia = 1 / Math.sqrt(unison);
    if (this.volumesDireto) {
      for (let c = 0; c < MAX_UNISON; c++) this.volumes[c] = c < unison ? volumeCopia : 0;
      this.volumesDireto = false;
    }
    // Cópias acima do Unison atual continuam só até sumirem (se o Unison diminuiu).
    let qtdCopias = unison;
    for (let c = unison; c < MAX_UNISON; c++) if (this.volumes[c] > 1e-5) qtdCopias = c + 1;

    const frames = tabela.frames;
    const ultimoFrame = frames.length - 1;
    const tamanho = tabela.tamanho;
    const mascara = tamanho - 1;
    const s = this.suavizar;
    const somaE = this.somaE;
    const somaD = this.somaD;
    const ruidoBloco = this.ruidoBloco;
    somaE.fill(0, 0, tamanhoBloco);
    somaD.fill(0, 0, tamanhoBloco);
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

      // 2) Cópias de unison com Detune/Width modulados
      this.ajustarCopias(
        unison,
        limitar01(detune + this.mod[D_DETUNE]),
        limitar01(width + this.mod[D_WIDTH]),
        tabela
      );

      // 3) Posição na wavetable: parada no pedaço ou mudando a cada amostra
      const wtModIni = this.modAnterior[D_WTPOS];
      const wtModFim = this.mod[D_WTPOS];
      const wtParado = posicoesWT.length === 1 && wtModIni === wtModFim;
      let f0Parado = 0;
      let tParado = 0;
      if (wtParado) {
        const wt = limitar01(posicoesWT[0] + wtModFim) * ultimoFrame;
        f0Parado = Math.min(wt | 0, ultimoFrame);
        tParado = wt - f0Parado;
      } else {
        for (let i = inicio; i < fim; i++) {
          const base = posicoesWT.length > 1 ? posicoesWT[i] : posicoesWT[0];
          const m = wtModIni + ((i - inicio + 1) / qtd) * (wtModFim - wtModIni);
          const wt = limitar01(base + m) * ultimoFrame;
          const f0 = Math.min(wt | 0, ultimoFrame);
          this.framesBloco[i] = f0;
          this.tsBloco[i] = wt - f0;
        }
      }

      // 4) Oscilador: uma cópia inteira de cada vez.
      // Com o OSC desligado (e já silencioso), nem calcula: economiza processamento.
      const alvoOsc = oscLigado ? limitar01(oscNivel + this.mod[D_NIVEL_OSC]) : 0;
      if (this.nivelOscDireto) {
        this.nivelOsc = alvoOsc; // nota começando do silêncio: já no nível certo
        this.nivelOscDireto = false;
      }
      const oscCalado = alvoOsc === 0 && this.nivelOsc < 1e-5;
      if (oscCalado) this.nivelOsc = 0;
      for (let c = 0; !oscCalado && c < qtdCopias; c++) {
        let fase = this.fases[c];
        const passo = this.passos[c];
        const ganhoE = this.ganhosE[c];
        const ganhoD = this.ganhosD[c];
        const nivel = this.niveis[c];
        const nivelB = this.niveisB[c];
        const mistura = this.misturas[c];

        // Volume da cópia: só suaviza se ainda não chegou no valor certo.
        const alvo = c < unison ? volumeCopia : 0;
        let volume = this.volumes[c];
        const suavizando = Math.abs(volume - alvo) > 1e-4;
        if (!suavizando) volume = alvo;

        if (wtParado) {
          // Caminho rápido: as tabelas desta cópia são as mesmas no pedaço todo.
          const frameA = frames[f0Parado];
          const frameB = frames[Math.min(f0Parado + 1, ultimoFrame)];
          const oA = frameA[nivel];
          const oAB = frameA[nivelB];
          const oB = frameB[nivel];
          const oBB = frameB[nivelB];
          for (let i = inicio; i < fim; i++) {
            if (suavizando) volume += (alvo - volume) * s;
            const posicao = fase * tamanho;
            const i0 = posicao | 0;
            const i1 = (i0 + 1) & mascara;
            const frac = posicao - i0;

            let amostra = oA[i0] + frac * (oA[i1] - oA[i0]);
            if (mistura > 0) amostra += mistura * (oAB[i0] + frac * (oAB[i1] - oAB[i0]) - amostra);
            if (tParado > 0) {
              let amostraB = oB[i0] + frac * (oB[i1] - oB[i0]);
              if (mistura > 0) amostraB += mistura * (oBB[i0] + frac * (oBB[i1] - oBB[i0]) - amostraB);
              amostra += tParado * (amostraB - amostra);
            }
            amostra *= volume;
            somaE[i] += amostra * ganhoE;
            somaD[i] += amostra * ganhoD;

            fase += passo;
            if (fase >= 1) fase -= 1;
          }
        } else {
          // WT Pos mudando: posição na wavetable a cada amostra (morphing suave).
          for (let i = inicio; i < fim; i++) {
            if (suavizando) volume += (alvo - volume) * s;
            const f0 = this.framesBloco[i];
            const frameA = frames[f0];
            const frameB = frames[Math.min(f0 + 1, ultimoFrame)];
            const amostra =
              lerAmostra(frameA, frameB, this.tsBloco[i], nivel, nivelB, mistura, fase, tamanho, mascara) * volume;
            somaE[i] += amostra * ganhoE;
            somaD[i] += amostra * ganhoD;

            fase += passo;
            if (fase >= 1) fase -= 1;
          }
        }

        this.fases[c] = fase;
        this.volumes[c] = volume;
      }

      // Nível do oscilador (liga/desliga e knob Nível), em rampa suave
      if (!oscCalado && (alvoOsc !== 1 || this.nivelOsc !== 1)) {
        for (let i = inicio; i < fim; i++) {
          this.nivelOsc += (alvoOsc - this.nivelOsc) * s;
          somaE[i] *= this.nivelOsc;
          somaD[i] *= this.nivelOsc;
        }
        if (Math.abs(this.nivelOsc - alvoOsc) < 1e-5) this.nivelOsc = alvoOsc;
      }

      // 4b) Ruído (mono), guardado separado do oscilador: pode ir para outro filtro.
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

      // 5) Filtros com Cutoff/Reso modulados: coeficientes próprios, em rampa suave
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
