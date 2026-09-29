// processador-synth.js
// O "motor" de som. Roda num processo de áudio separado (AudioWorklet),
// para o som não falhar mesmo se a tela ficar lenta.
//
// Todo o som é calculado no motor em C++ (motor/motor.cpp → motor.wasm, etapas F1 a F4):
// o gerente de vozes (quem toca qual nota: Poly/Mono, roubo de voz, Legato, Glide), as vozes
// (OSC A, B, C + ruído → filtros → envelopes, modulação), os 10 efeitos, o volume geral, o
// soft clipper, a proteção contra valores inválidos e os sorteios. A saída é estéreo.
//
// Aqui fica só o "carteiro": as mensagens da tela (notas, opções, efeitos, wavetables) e os
// valores dos knobs vão para a mesa de troca do C++; a cada bloco, uma chamada só
// (processarBloco) e o som pronto é copiado para o alto-falante.

import { codigoWarp } from './dsp/warp.js';
import { TIPOS_RUIDO } from './dsp/ruido.js';
import { TIPOS_FILTRO } from './dsp/filtro.js';
import { DESTINOS_MOD, D_PRIMEIRO_EFEITO, ligacoesEmNumeros } from './dsp/modulacao.js';
import { MOD_EFEITOS } from './dsp/efeitos/modulaveis.js';
import { FORMAS_LFO } from './dsp/lfo.js';
import { Ponte, BLOCO, CAMPOS_OSC, CAMPOS_LFO, CAMPOS_VOZ, EFEITOS_NO_MOTOR, ROTAS } from './motor/ponte.js';

const MAX_VOZES = 16;
const UNISON_MAXIMO = 8; // escolha máxima no app (decisão do dono, 27/09/2026: leveza no celular)

// Opções do gerente de vozes no C++ (mesma ordem do enum G_... em motor.cpp)
const GERENTE = { modo: 0, vozes: 1, legato: 2, glide: 3, glideSempre: 4 };

// Soft clipper (no C++): a partir de -1 dB ele começa a arredondar os picos
const LIMIAR_CLIPPER = 0.891;

// Bits dos consertos que o C++ devolve (0 a 9 = efeitos, pelo número de cada um)
const CONSERTO_VOZES = 1 << 10;
const CONSERTO_CLIPPER = 1 << 11;

// Efeito calculado no C++ (os 10: Saturação, Distorção, Filtro Track, EQ, Compressor, Phaser,
// Flanger, Chorus, Delay, Reverb). Esta peça só guarda o valor dos knobs (a tela manda) e os
// escreve na mesa do C++ quando mudam. A modulação dos knobs e o som são calculados lá.
class EfeitoNoMotor {
  constructor(ponte, id, ajustes) {
    const { numero, campos, tipos } = EFEITOS_NO_MOTOR[id];
    this.ponte = ponte;
    this.numero = numero;
    this.campos = campos;
    this.tipos = tipos ?? null;
    this.ajustes = ajustes;
    this.iBases = ponte.c.enderecoBasesEfeito(numero) / 8;
    this.escreverAjustes();
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    this.escreverAjustes();
    if (this.ajustes.ligado) this.ponte.c.efeitoAcordar(this.numero);
  }

  // Valor dos knobs → mesa do C++ (liga/desliga = 1/0; tipo = número na lista, desconhecido =
  // o 1º). Um valor inválido (NaN, infinito, texto) é ignorado: fica o último valor bom.
  escreverAjustes() {
    const f64 = this.ponte.f64;
    const a = this.ajustes;
    for (let k = 0; k < this.campos.length; k++) {
      const nome = this.campos[k];
      const v = a[nome];
      if (nome === 'tipo') f64[this.iBases + k] = Math.max(0, this.tipos.indexOf(v));
      else if (typeof v === 'boolean') f64[this.iBases + k] = v ? 1 : 0;
      else if (Number.isFinite(v)) f64[this.iBases + k] = v;
    }
  }

  // O C++ limpou a memória deste efeito (conserto de valores inválidos)
  depoisDoConserto() {}
}

// Filtro Track: a troca de tipo passa pela transição suave do filtro (ftTipo). O Cutoff segue a
// nota tocada por último (o C++ escreve a nota de referência sozinho; aqui só o valor inicial).
class FiltroTrack extends EfeitoNoMotor {
  constructor(ponte) {
    super(ponte, 'filtroTrack', { ligado: false, tipo: 'lp24', nota: 72, track: 1, reso: 0.2, mix: 1 });
    this.tipoAtual = 'lp24';
    ponte.f64[this.iBases + this.campos.indexOf('referencia')] = 60; // antes da 1ª nota: C4
  }

  definir(ajustes) {
    Object.assign(this.ajustes, ajustes);
    if (this.ajustes.tipo !== this.tipoAtual) {
      this.ponte.c.ftTipo(TIPOS_FILTRO.indexOf(this.ajustes.tipo));
      this.tipoAtual = this.ajustes.tipo;
    }
    super.definir({});
  }

  // O conserto no C++ volta o filtro para LP 24: manda de novo o tipo escolhido
  depoisDoConserto() {
    this.tipoAtual = 'lp24';
    this.definir({});
  }
}

// A cada quantos blocos o recado do soft clipper vai para a tela (~6 vezes por segundo; o
// pico é o maior desde a última leitura, então nada escapa).
const BLOCOS_ENTRE_ENVIOS = Math.round(sampleRate / 128 / 6);

// ---------- Medidor de desempenho (Configurações → Medidor) ----------
// Só olha o relógio: não muda nada no som. Dentro do motor o único relógio é o Date.now(), que
// anda de 1 em 1 ms (um bloco leva ~3 ms): um bloco sozinho não dá para medir, mas somando
// muitos os erros se cancelam (a média fica certa).
// - Ocupado: quanto do tempo o motor passa calculando (100% = no limite: o som engasga).
//   Média de 1 s e o pior trecho de 250 ms.
// - Atrasos: o relógio do som anda junto com o relógio do aparelho enquanto o motor dá conta.
//   Se o motor não entrega a tempo, o som fica para trás (é quando engasga). A cada 250 ms
//   pega a MAIOR diferença entre os dois relógios (o momento mais atrasado do trecho: pega
//   até uma travada curta); se ela passou mais de 8 ms do normal (referência), conta um
//   atraso (e guarda o maior, em ms). Obs.: um atraso que o buffer do aparelho consegue
//   esconder não chega a estalar; e atrasos com o motor leve (%) vêm do sistema, não do motor.
// O recado para a tela vai 1 vez por segundo, só com o medidor ligado.
const MEDIDOR_JANELA = Math.round((sampleRate * 0.25) / 128); // blocos em 250 ms
const MEDIDOR_LIMIAR_MS = 8;
const MEDIDOR_AQUECER = 8; // janelas ignoradas depois de ligar/voltar (2 s: o áudio se acomoda)

class Medidor {
  constructor(port) {
    this.port = port;
    this.ligado = false;
    this.zerar();
  }

  zerar() {
    this.inicio = -1; // relógio do aparelho no começo da contagem (ms)
    this.quadros = 0; // amostras entregues desde o começo
    this.ultimo = 0;
    this.blocos = 0;
    this.ocupadoJanela = 0;
    this.quadrosJanela = 0;
    this.maiorDiferenca = -Infinity;
    this.referencia = null;
    this.aquecendo = MEDIDOR_AQUECER;
    this.atrasado = false;
    this.atrasos = 0;
    this.maiorAtraso = 0;
    this.janelas = 0;
    this.ocupadoSegundo = 0;
    this.quadrosSegundo = 0;
    this.picoSegundo = 0;
  }

  // Chamado no fim de cada bloco: antes/depois = relógio no começo e no fim do process()
  bloco(antes, depois, tamanho, vozes) {
    // Motor parado por mais de 1 s (app no fundo, áudio pausado): recomeça a comparação
    if (this.inicio < 0 || antes - this.ultimo > 1000) {
      const { atrasos, maiorAtraso } = this;
      this.zerar();
      this.atrasos = atrasos;
      this.maiorAtraso = maiorAtraso;
      this.inicio = antes;
    }
    this.ultimo = antes;
    const diferenca = antes - this.inicio - (this.quadros * 1000) / sampleRate;
    if (diferenca > this.maiorDiferenca) this.maiorDiferenca = diferenca;
    this.quadros += tamanho;
    this.ocupadoJanela += depois - antes;
    this.quadrosJanela += tamanho;
    if (++this.blocos < MEDIDOR_JANELA) return;

    // Fim de uma janela de 250 ms
    const duracao = (this.quadrosJanela * 1000) / sampleRate;
    const ocupado = this.ocupadoJanela / duracao;
    if (this.aquecendo > 0) {
      this.aquecendo--;
      this.referencia = this.maiorDiferenca;
    } else {
      if (ocupado > this.picoSegundo) this.picoSegundo = ocupado;
      this.ocupadoSegundo += this.ocupadoJanela;
      this.quadrosSegundo += this.quadrosJanela;
      const acima = this.maiorDiferenca - this.referencia;
      if (acima > MEDIDOR_LIMIAR_MS) {
        if (!this.atrasado) this.atrasos++;
        this.atrasado = true;
        if (acima > this.maiorAtraso) this.maiorAtraso = acima;
      } else {
        this.atrasado = false;
        // A referência acompanha devagar (os 2 relógios nunca andam exatamente juntos)
        this.referencia = Math.min(this.referencia + 0.025, this.maiorDiferenca);
      }
    }
    this.blocos = 0;
    this.ocupadoJanela = 0;
    this.quadrosJanela = 0;
    this.maiorDiferenca = -Infinity;

    if (++this.janelas < 4) return;
    this.janelas = 0;
    if (this.ligado && this.quadrosSegundo > 0) {
      this.port.postMessage({
        tipo: 'medidor',
        media: this.ocupadoSegundo / ((this.quadrosSegundo * 1000) / sampleRate),
        pico: this.picoSegundo,
        atrasos: this.atrasos,
        maiorAtraso: this.maiorAtraso,
        vozes,
      });
    }
    this.ocupadoSegundo = 0;
    this.quadrosSegundo = 0;
    this.picoSegundo = 0;
  }
}

class ProcessadorSynth extends AudioWorkletProcessor {
  // Controles que a página pode mexer de forma suave.
  static get parameterDescriptors() {
    return [
      // Oscilador: 0 = primeiro frame, 1 = último frame
      { name: 'wtPos', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Unison: Detune e Width de 0 a 1
      { name: 'detune', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'width', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Oscilador: nível de 0 a 1
      { name: 'nivelOsc', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Afinação fina do oscilador A, em centésimos de semitom (-100 a +100)
      { name: 'fineOsc', defaultValue: 0, minValue: -100, maxValue: 100, automationRate: 'k-rate' },
      // Pan (-1 = esquerda, 0 = centro, 1 = direita) e Blend (0 = só as cópias do meio,
      // 1 = todas as cópias de unison com o mesmo volume)
      { name: 'panOsc', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'blendOsc', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Warp: quantidade da deformação da onda (0 a 1); o modo é uma opção (warpModoOsc)
      { name: 'warpOsc', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // OSC B e C: os mesmos controles, com a letra no fim
      ...['B', 'C'].flatMap((letra) => [
        { name: 'fineOsc' + letra, defaultValue: 0, minValue: -100, maxValue: 100, automationRate: 'k-rate' },
        { name: 'panOsc' + letra, defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
        { name: 'blendOsc' + letra, defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'warpOsc' + letra, defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'wtPos' + letra, defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
        { name: 'detune' + letra, defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'width' + letra, defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'nivelOsc' + letra, defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      ]),
      // Ruído: nível de 0 a 1
      { name: 'ruido', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Filtro
      { name: 'cutoff', defaultValue: 2000, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'resonancia', defaultValue: 0.1, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Filtro 2
      { name: 'cutoff2', defaultValue: 2000, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'resonancia2', defaultValue: 0.1, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Volume geral (ganho, já com a curva da barra), aplicado antes do soft clipper
      { name: 'volume', defaultValue: 0.174, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Envelope de volume (tempos em segundos)
      { name: 'ataque', defaultValue: 0.005, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
      { name: 'decaimento', defaultValue: 0.5, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
      { name: 'sustentacao', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'soltura', defaultValue: 0.08, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
    ];
  }

  constructor(opcoes) {
    super();
    // Motor em C++ (motor/motor.wasm), já compilado pela tela e entregue aqui
    this.ponte = new Ponte(opcoes.processorOptions.moduloWasm, sampleRate, DESTINOS_MOD.length);
    this.port.postMessage({ tipo: 'wasm', versao: this.ponte.c.versao() });
    // Semente dos sorteios das notas (pontos de início do unison, S&H, ruído): uma por vez
    // que o app liga (os sorteios em si são feitos no C++)
    this.ponte.c.definirSemente(Math.floor(Math.random() * 2147483646) + 1);
    this.ultimoConserto = {}; // hora do último aviso de conserto de cada peça

    // Osciladores A, B, C. "ajustes" vai para o C++ a cada bloco (ver enviarAjustesVozes).
    // Nomes dos parâmetros: os do A sem letra (wtPos...), os do B e C com (wtPosB...).
    // A wavetable e o modo de Warp vão como "pedido": o C++ troca sem estalo.
    this.oscs = ['', 'B', 'C'].map((letra) => ({
      params: {
        wtPos: 'wtPos' + letra,
        detune: 'detune' + letra,
        width: 'width' + letra,
        nivel: 'nivelOsc' + letra,
        fine: 'fineOsc' + letra,
        pan: 'panOsc' + letra,
        blend: 'blendOsc' + letra,
        warp: 'warpOsc' + letra,
      },
      tabelaPedida: 0, // wavetable escolhida: endereço dela no C++ (0 = nenhuma ainda)
      ajustes: {
        unison: 1,
        ligado: letra === '', // só o A começa ligado
        rota: 'f1',
        oitava: 0, // afinação: oitavas (-3 a +3), semitons (-12 a +12)
        semi: 0,
        fase: 0, // ponto de início da onda (0 a 1 = 0° a 360°)
        rand: 1, // quanto o início é sorteado a cada nota (0 a 1)
      },
    }));
    this.tabelas = new Map(); // wavetables recebidas da tela (id → endereço no C++)
    this.tabelasSoltas = []; // substituídas/esquecidas: apagadas quando ninguém mais usa

    // Rota de filtro do ruído: 'f1', 'f2', 'f12' (1 depois 2) ou 'f21' (2 depois 1)
    this.rotaRuido = 'f1';
    // Ruído (o nível é o parâmetro "ruido")
    this.ruidoLigado = false;
    this.ruidoTipo = 'white';
    this.ruidoModo = 'loop'; // 'loop' (contínuo) ou 'oneshot' (rajada no ataque)
    this.ruidoDuracao = 0.2; // One Shot: segundos até sumir
    this.ruidoTrack = false; // a cor acompanha a nota?
    this.ruidoPitch = 0; // semitons (-24 a +24): mais rápido = mais brilhante
    this.ruidoUnico = true; // só a nota mais recente toca ruído (acordes: 1 ruído só)

    // Modulação (as contas estão no C++; aqui ficam os ajustes)
    this.ajustesLfo = [
      { forma: 'seno', rate: 2, modo: 'retrig' },
      { forma: 'triangulo', rate: 0.5, modo: 'retrig' },
      { forma: 'seno', rate: 1, modo: 'retrig' }, // LFO 3
    ];
    this.ajustesEnv = [
      { ataque: 0.005, decaimento: 0.3, sustentacao: 0, soltura: 0.2 },
      { ataque: 0.005, decaimento: 0.3, sustentacao: 0, soltura: 0.2 },
    ];
    // Macros M1–M4: valor escolhido na tela (o C++ suaviza ~10 ms)
    this.macrosAlvo = new Float64Array(4);
    this.escreverLfos();

    // Efeitos (depois das notas somadas):
    // Saturação → Distorção → Filtro Track → EQ → Compressor → Phaser → Flanger → Chorus → Delay → Reverb
    const ponte = this.ponte;
    this.efeitos = {
      saturacao: new EfeitoNoMotor(ponte, 'saturacao', { ligado: false, tipo: 'fita', drive: 0.3, tom: 1, mix: 1 }),
      distorcao: new EfeitoNoMotor(ponte, 'distorcao', { ligado: false, tipo: 'suave', drive: 0.4, mix: 1, tom: 1, lowcut: 20 }),
      filtroTrack: new FiltroTrack(ponte),
      eq: new EfeitoNoMotor(ponte, 'eq', { ligado: false, grave: 0, medio: 0, agudo: 0, freq: 1000, q: 1, saida: 0, mix: 1 }),
      compressor: new EfeitoNoMotor(ponte, 'compressor', {
        ligado: false, threshold: -18, ratio: 4, attack: 0.01, release: 0.15, ganho: 0, mix: 1,
      }),
      phaser: new EfeitoNoMotor(ponte, 'phaser', {
        ligado: false, rate: 0.5, depth: 0.7, freq: 800, feedback: 0.5, stereo: 0.5, mix: 0.5,
      }),
      flanger: new EfeitoNoMotor(ponte, 'flanger', {
        ligado: false, rate: 0.3, depth: 0.7, atraso: 0.002, feedback: 0.5, stereo: 0.5, mix: 0.5,
      }),
      chorus: new EfeitoNoMotor(ponte, 'chorus', {
        ligado: false, rate: 0.8, depth: 0.5, mix: 0.5, atraso: 0.012, feedback: 0, width: 1,
      }),
      delay: new EfeitoNoMotor(ponte, 'delay', {
        ligado: false, tempo: 0.3, feedback: 0.4, mix: 0.3, pingpong: false, lowcut: 20, highcut: 6000, width: 1,
      }),
      reverb: new EfeitoNoMotor(ponte, 'reverb', {
        ligado: false, tamanho: 0.5, brilho: 0.6, mix: 0.3, predelay: 0, lowcut: 120, width: 1,
      }),
    };
    // Nome de cada efeito pelo número dele no C++ (para o aviso de conserto)
    this.nomesEfeitos = [];
    for (const [id, { numero }] of Object.entries(EFEITOS_NO_MOTOR)) this.nomesEfeitos[numero] = id;

    // Modulação dos knobs dos efeitos: a tabela dos knobs moduláveis (faixa e escala de cada
    // um, a mesma da tela) vai para o C++ uma vez; lá, a cada bloco, efeito = knob + modulação.
    this.ponte.definirModsEfeitos(
      MOD_EFEITOS.map((m) => {
        const { numero, campos } = EFEITOS_NO_MOTOR[m.efeito];
        return [numero, campos.indexOf(m.nome), m.min, m.max, m.exp ? 1 : 0];
      }),
      D_PRIMEIRO_EFEITO
    );

    // Recado do soft clipper (ver vigiarClipper)
    this.enviouPico = false;
    this.blocosDesdeEnvio = 0;
    this.medidor = new Medidor(this.port);

    this.port.onmessage = (evento) => this.receberMensagem(evento.data);
  }

  receberMensagem(msg) {
    const c = this.ponte.c;
    switch (msg.tipo) {
      case 'medidor': // ligar/desligar o medidor de desempenho (ligar = começa do zero)
        if (msg.ligado && !this.medidor.ligado) this.medidor.zerar();
        this.medidor.ligado = !!msg.ligado;
        break;
      case 'wavetable': {
        // Qual oscilador: 'A' (padrão), 'B' ou 'C'.
        // A tela manda a tabela inteira só na primeira vez (uma importada grande tem ~9 MB);
        // depois, só o id. As ondas são copiadas para dentro do C++ (ponte.guardarTabela):
        // o motor guarda só o endereço delas (this.tabelas: id → endereço).
        const id = msg.id ?? msg.wavetable?.id;
        if (msg.wavetable) {
          const endereco = this.ponte.guardarTabela(msg.wavetable);
          if (endereco) {
            if (this.tabelas.has(id)) this.tabelasSoltas.push(this.tabelas.get(id)); // substituída
            this.tabelas.set(id, endereco);
          }
        }
        const tabela = this.tabelas.get(id);
        if (!tabela) break;
        // O C++ troca sem estalo (com notas tocando, abaixa aquele oscilador, troca e sobe)
        const k = { B: 1, C: 2 }[msg.osc] || 0;
        this.oscs[k].tabelaPedida = tabela;
        this.ponte.f64[this.ponte.iPedidos + 2 * k] = tabela;
        break;
      }
      case 'esquecerWavetable':
        // A tela não usa mais esta tabela (libera memória; se um oscilador ainda estiver
        // tocando com ela, ele continua até trocar: ver liberarTabelas)
        if (this.tabelas.has(msg.id)) this.tabelasSoltas.push(this.tabelas.get(msg.id));
        this.tabelas.delete(msg.id);
        break;
      case 'notaOn':
        c.notaOn(msg.nota);
        break;
      case 'notaOff':
        c.notaOff(msg.nota);
        break;
      case 'tudoOff':
        c.tudoOff();
        break;
      case 'opcao':
        this.definirOpcao(msg.nome, msg.valor);
        break;
      case 'modulacoes':
        this.ponte.definirLigacoes(ligacoesEmNumeros(msg.lista));
        break;
      case 'fonte':
        this.definirFonte(msg.id, msg.ajustes);
        break;
      case 'efeito':
        this.efeitos[msg.id]?.definir(msg.ajustes);
        break;
    }
  }

  // Ajustes de uma fonte de modulação (LFO: forma, rate, modo; ENV: A, D, S, R; Macro: valor).
  definirFonte(id, ajustes) {
    const macro = { macro1: 0, macro2: 1, macro3: 2, macro4: 3 }[id];
    if (macro !== undefined && typeof ajustes.valor === 'number') {
      this.macrosAlvo[macro] = Math.min(1, Math.max(0, ajustes.valor));
    }
    const lfo = { lfo1: 0, lfo2: 1, lfo3: 2 }[id];
    if (lfo !== undefined) {
      Object.assign(this.ajustesLfo[lfo], ajustes);
      // Já na mesa: uma nota que chegar antes do próximo bloco usa o modo novo (Retrig/Livre)
      this.escreverLfos();
    }
    const env = { env2: 0, env3: 1 }[id];
    if (env !== undefined) Object.assign(this.ajustesEnv[env], ajustes);
  }

  definirOpcao(nome, valor) {
    const c = this.ponte.c;
    // Opções dos osciladores: A sem letra (unison, oscLigado, rotaOsc),
    // B e C com a letra (unisonB, oscBLigado, rotaOscB...)
    const ajustesOsc = (letra) => this.oscs[{ '': 0, B: 1, C: 2 }[letra]].ajustes;
    let achado = /^oitavaOsc([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).oitava = Math.min(3, Math.max(-3, Math.round(valor)));
      return;
    }
    achado = /^semiOsc([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).semi = Math.min(12, Math.max(-12, Math.round(valor)));
      return;
    }
    achado = /^warpModoOsc([BC]?)$/.exec(nome);
    if (achado) {
      // O C++ troca o modo sem estalo, como a wavetable (mesmo modo de agora: nada muda)
      const k = { '': 0, B: 1, C: 2 }[achado[1]];
      this.ponte.f64[this.ponte.iPedidos + 2 * k + 1] = codigoWarp(valor);
      return;
    }
    achado = /^faseOsc([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).fase = Math.min(1, Math.max(0, valor));
      return;
    }
    achado = /^randOsc([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).rand = Math.min(1, Math.max(0, valor));
      return;
    }
    achado = /^unison([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).unison = Math.min(UNISON_MAXIMO, Math.max(1, Math.round(valor) || 1));
      return;
    }
    achado = /^osc([BC]?)Ligado$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).ligado = valor;
      return;
    }
    achado = /^rotaOsc([BC]?)$/.exec(nome);
    if (achado) {
      ajustesOsc(achado[1]).rota = valor;
      return;
    }
    switch (nome) {
      // Gerente de vozes (no C++)
      case 'modo': // trocar de modo solta as notas
        c.definirGerente(GERENTE.modo, valor === 'mono' ? 1 : 0);
        break;
      case 'vozes':
        c.definirGerente(GERENTE.vozes, Math.min(MAX_VOZES, Math.max(1, Math.round(valor) || 1)));
        break;
      case 'legato':
        c.definirGerente(GERENTE.legato, valor ? 1 : 0);
        break;
      case 'glide':
        c.definirGerente(GERENTE.glide, Math.max(0, valor));
        break;
      case 'glideSempre':
        c.definirGerente(GERENTE.glideSempre, valor ? 1 : 0);
        break;
      case 'ruidoLigado':
        this.ruidoLigado = valor;
        break;
      case 'ruidoModo':
        this.ruidoModo = valor === 'oneshot' ? 'oneshot' : 'loop';
        break;
      case 'ruidoDuracao':
        this.ruidoDuracao = Math.min(2, Math.max(0.005, valor));
        break;
      case 'ruidoTrack':
        this.ruidoTrack = !!valor;
        break;
      case 'ruidoPitch':
        this.ruidoPitch = Math.min(24, Math.max(-24, valor));
        break;
      case 'ruidoUnico':
        this.ruidoUnico = !!valor;
        break;
      case 'ruidoTipo':
        // Tipo desconhecido (ex.: preset editado à mão) vira White
        this.ruidoTipo = TIPOS_RUIDO.includes(valor) ? valor : 'white';
        break;
      case 'filtroTipo':
      case 'filtroLigado':
      case 'filtro2Tipo':
      case 'filtro2Ligado': {
        // No C++: Filtro 1 = 0, Filtro 2 = 1; campo 0 = tipo (número em TIPOS_FILTRO; desconhecido
        // = -1, nada muda), campo 1 = liga/desliga. Vale para todas as vozes.
        const numero = nome.startsWith('filtro2') ? 1 : 0;
        if (nome.endsWith('Tipo')) c.definirFiltro(numero, 0, TIPOS_FILTRO.indexOf(valor));
        else c.definirFiltro(numero, 1, valor ? 1 : 0);
        break;
      }
      case 'rotaRuido':
        this.rotaRuido = valor;
        break;
    }
  }

  // ---------- Som ----------

  process(entradas, saidas, parametros) {
    const antes = Date.now(); // (medidor de desempenho)
    const saidaE = saidas[0][0];
    const saidaD = saidas[0][1];
    const tamanhoBloco = saidaE.length;
    const ponte = this.ponte;
    ponte.renovar(); // (se a memória do C++ cresceu, as vistas são refeitas)

    // Valores dos knobs → mesa do C++; depois, o bloco inteiro lá dentro
    this.enviarAjustesModulacao(parametros);
    this.enviarAjustesVozes(parametros);
    const volume = parametros.volume;
    ponte.f64.set(volume, ponte.iVolume);
    const consertos = ponte.c.processarBloco(tamanhoBloco, volume.length);
    saidaE.set(ponte.saidaE.subarray(0, tamanhoBloco));
    saidaD.set(ponte.saidaD.subarray(0, tamanhoBloco));

    if (consertos) this.avisarConsertos(consertos);
    if (this.tabelasSoltas.length) this.liberarTabelas();
    this.vigiarClipper();
    this.medidor.bloco(antes, Date.now(), tamanhoBloco, ponte.c.vozesTocando());
    return true;
  }

  // Alguma peça do motor soltou valores inválidos (NaN ou infinito) e o C++ consertou (o bloco
  // virou silêncio e a peça ficou como nova): a tela é avisada de qual foi (aparece no
  // console: serve para achar a causa). No máximo 1 aviso por segundo por peça.
  avisarConsertos(bits) {
    for (let ef = 0; ef < this.nomesEfeitos.length; ef++) {
      if (!(bits & (1 << ef))) continue;
      this.efeitos[this.nomesEfeitos[ef]].depoisDoConserto();
      this.avisarConserto(this.nomesEfeitos[ef]);
    }
    if (bits & CONSERTO_VOZES) this.avisarConserto('vozes');
    if (bits & CONSERTO_CLIPPER) this.avisarConserto('clipper');
  }

  avisarConserto(origem) {
    if ((this.ultimoConserto[origem] ?? -1) > currentTime - 1) return;
    this.ultimoConserto[origem] = currentTime;
    this.port.postMessage({ tipo: 'consertado', origem });
  }

  // Apaga do C++ as wavetables soltas (substituídas ou esquecidas) que nenhum oscilador
  // está usando (a em uso fica na mesa do C++) nem esperando para usar (a pedida).
  liberarTabelas() {
    const { f64, iAjustes, nCampos } = this.ponte;
    this.tabelasSoltas = this.tabelasSoltas.filter((t) => {
      const emUso = this.oscs.some((o, k) => f64[iAjustes + k * nCampos + CAMPOS_OSC.tabela] === t || o.tabelaPedida === t);
      if (!emUso) this.ponte.c.apagarTabela(t);
      return emUso;
    });
  }

  // Ajustes dos LFOs → mesa do C++ (a cada bloco e quando mudam)
  escreverLfos() {
    const ponte = this.ponte;
    const f64 = ponte.f64;
    for (let l = 0; l < this.ajustesLfo.length; l++) {
      const a = this.ajustesLfo[l];
      const i = ponte.iAjustesLfo + l * 3;
      f64[i + CAMPOS_LFO.forma] = FORMAS_LFO.indexOf(a.forma); // (desconhecida = -1: valor 0)
      f64[i + CAMPOS_LFO.rate] = a.rate;
      f64[i + CAMPOS_LFO.livre] = a.modo === 'livre' ? 1 : 0;
    }
  }

  // Ajustes dos LFOs, dos envelopes (ENV 1 = knobs da aba ENV; ENV 2 e 3) e dos Macros
  // → mesa de troca do C++ (motor/ponte.js), uma vez por bloco
  enviarAjustesModulacao(parametros) {
    const ponte = this.ponte;
    const f64 = ponte.f64;
    this.escreverLfos();
    const e = ponte.iAjustesEnv;
    f64[e] = parametros.ataque[0];
    f64[e + 1] = parametros.decaimento[0];
    f64[e + 2] = parametros.sustentacao[0];
    f64[e + 3] = parametros.soltura[0];
    for (let k = 0; k < 2; k++) {
      const env = this.ajustesEnv[k];
      const i = e + 4 * (k + 1);
      f64[i] = env.ataque;
      f64[i + 1] = env.decaimento;
      f64[i + 2] = env.sustentacao;
      f64[i + 3] = env.soltura;
    }
    f64.set(this.macrosAlvo, ponte.iMacros);
  }

  // Ajustes dos 3 osciladores, das vozes (rotas, ruído) e Cutoff/Reso dos Filtros 1 e 2
  // (1 valor ou 1 por amostra) → mesa do C++, uma vez por bloco
  enviarAjustesVozes(parametros) {
    const ponte = this.ponte;
    const f64 = ponte.f64;
    const C = CAMPOS_OSC;
    for (let k = 0; k < this.oscs.length; k++) {
      const { params, ajustes } = this.oscs[k];
      const a = ponte.iAjustes + k * ponte.nCampos;
      f64[a + C.unison] = ajustes.unison;
      f64[a + C.detune] = parametros[params.detune][0];
      f64[a + C.width] = parametros[params.width][0];
      f64[a + C.ligado] = ajustes.ligado ? 1 : 0;
      f64[a + C.nivel] = parametros[params.nivel][0];
      f64[a + C.oitava] = ajustes.oitava;
      f64[a + C.semi] = ajustes.semi;
      f64[a + C.fine] = parametros[params.fine][0];
      f64[a + C.pan] = parametros[params.pan][0];
      f64[a + C.blend] = parametros[params.blend][0];
      f64[a + C.fase] = ajustes.fase;
      f64[a + C.rand] = ajustes.rand;
      f64[a + C.warp] = parametros[params.warp][0];
      // WT Pos: 1 valor (parado) ou 1 por amostra (mexendo)
      const posicoes = parametros[params.wtPos];
      f64.set(posicoes, ponte.iPosicoes + k * 128);
      f64[a + C.qtdPosicoes] = posicoes.length;
    }
    const V = CAMPOS_VOZ;
    const iv = ponte.iAjustesVoz;
    for (let k = 0; k < this.oscs.length; k++) f64[iv + V.rotaA + k] = ROTAS[this.oscs[k].ajustes.rota] ?? 0;
    f64[iv + V.rotaRuido] = ROTAS[this.rotaRuido] ?? 0;
    f64[iv + V.ruidoLigado] = this.ruidoLigado ? 1 : 0;
    f64[iv + V.ruidoTipo] = TIPOS_RUIDO.indexOf(this.ruidoTipo);
    f64[iv + V.ruidoNivel] = parametros.ruido[0];
    f64[iv + V.ruidoOneShot] = this.ruidoModo === 'oneshot' ? 1 : 0;
    f64[iv + V.ruidoDuracao] = this.ruidoDuracao;
    f64[iv + V.ruidoTrack] = this.ruidoTrack ? 1 : 0;
    f64[iv + V.ruidoPitch] = this.ruidoPitch;
    f64[iv + V.ruidoUnico] = this.ruidoUnico ? 1 : 0;
    const filtros = [parametros.cutoff, parametros.resonancia, parametros.cutoff2, parametros.resonancia2];
    for (let n = 0; n < 4; n++) {
      f64.set(filtros[n], ponte.iCortesResos + n * BLOCO);
      f64[iv + V.qtdCortes1 + n] = filtros[n].length;
    }
  }

  // Recado do soft clipper para a tela (~6 vezes por segundo): o maior pico que chegou nele
  // (antes de arredondar), quando passa do ponto em que ele começa a agir; e um 0 quando volta
  // a ficar abaixo (a tela para de avisar). É o ÚNICO recado frequente: a modulação e o
  // Compressor não mandam valores "ao vivo" (a tela do celular pesava e atrasava as notas).
  vigiarClipper() {
    if (++this.blocosDesdeEnvio < BLOCOS_ENTRE_ENVIOS) return;
    this.blocosDesdeEnvio = 0;
    const picoSaida = this.ponte.c.clipperPico();
    if (picoSaida > LIMIAR_CLIPPER || this.enviouPico) {
      this.port.postMessage({ tipo: 'clipper', pico: picoSaida > LIMIAR_CLIPPER ? picoSaida : 0 });
      this.enviouPico = picoSaida > LIMIAR_CLIPPER;
    }
  }
}

registerProcessor('processador-synth', ProcessadorSynth);
