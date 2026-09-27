// motor/ponte.js
// A "ponte" entre o JavaScript (processador-synth.js) e o motor em C++
// (motor/motor.cpp → motor.wasm): guarda as funções do C++ e as "vistas" da memória dele,
// para o JavaScript escrever os ajustes e ler o som direto lá dentro (sem cópias extras).
//
// Quando o C++ pede mais memória (ex.: ao guardar uma wavetable grande), a memória muda de
// lugar e as vistas antigas deixam de valer: renovar() cria de novo (chamar depois de guardar
// uma tabela e no começo de cada bloco — é só uma comparação quando nada mudou).

import { TIPOS_SATURACAO, TIPOS_DISTORCAO } from '../dsp/efeitos/modulaveis.js';

// Campos dos ajustes de cada oscilador (mesma ordem do enum Campo em motor.cpp)
export const CAMPOS_OSC = {
  tabela: 0,
  unison: 1,
  detune: 2,
  width: 3,
  ligado: 4,
  nivel: 5,
  ganho: 6,
  oitava: 7,
  semi: 8,
  fine: 9,
  pan: 10,
  blend: 11,
  fase: 12,
  rand: 13,
  warpModo: 14,
  warp: 15,
  qtdPosicoes: 16,
};
export const BLOCO = 128;
// Campos dos ajustes de cada LFO (mesma ordem do enum em motor.cpp)
export const CAMPOS_LFO = { forma: 0, rate: 1, livre: 2 };
// Ajustes das vozes (mesma ordem do enum CampoVoz em motor.cpp)
export const CAMPOS_VOZ = {
  rotaA: 0, rotaB: 1, rotaC: 2, rotaRuido: 3,
  ruidoLigado: 4, ruidoTipo: 5, ruidoNivel: 6, ruidoOneShot: 7, ruidoDuracao: 8, ruidoTrack: 9,
  ruidoPitch: 10, ruidoUnico: 11,
  qtdCortes1: 12, qtdResos1: 13, qtdCortes2: 14, qtdResos2: 15,
};
// Efeitos calculados no C++: número de cada um (enum EF_... em motor.cpp) e os seus ajustes,
// na mesma ordem dos enums SAT_/DIS_/CampoFt/EQ_/CO_ de lá. "tipos" = a lista que vira número.
// (O Filtro Track troca de tipo por ftTipo, com transição suave; "referencia" = nota tocada.)
export const EFEITOS_NO_MOTOR = {
  saturacao: { numero: 0, campos: ['ligado', 'tipo', 'drive', 'tom', 'mix'], tipos: TIPOS_SATURACAO },
  distorcao: { numero: 1, campos: ['ligado', 'tipo', 'drive', 'mix', 'tom', 'lowcut'], tipos: TIPOS_DISTORCAO },
  filtroTrack: { numero: 2, campos: ['ligado', 'nota', 'track', 'reso', 'mix', 'referencia'] },
  eq: { numero: 3, campos: ['ligado', 'grave', 'medio', 'agudo', 'freq', 'q', 'saida', 'mix'] },
  compressor: { numero: 4, campos: ['ligado', 'threshold', 'ratio', 'attack', 'release', 'ganho', 'mix'] },
};
// Rotas de filtro → número no C++
export const ROTAS = { f1: 0, f2: 1, f12: 2, f21: 3 };

export class Ponte {
  // "destinos" = quantos destinos de modulação existem (DESTINOS_MOD.length)
  constructor(modulo, taxaAmostragem, destinos) {
    this.c = new WebAssembly.Instance(modulo, {}).exports; // as funções do C++
    if (!this.c.iniciar(taxaAmostragem, destinos)) throw new Error('motor.wasm: destinos de modulação demais');
    this.destinos = destinos;
    this.buffer = null;
    this.renovar();
    // Endereços da mesa de troca, contados em números de 8 bytes (posição dentro de f64)
    const n = this.c.camposOsc();
    if (n !== Object.keys(CAMPOS_OSC).length || this.c.camposVoz() !== Object.keys(CAMPOS_VOZ).length) {
      throw new Error('motor.wasm e ponte.js não combinam');
    }
    this.nCampos = n;
    this.iAjustes = this.c.enderecoAjustes() / 8;
    this.iPosicoes = this.c.enderecoPosicoes() / 8;
    this.iFases = this.c.enderecoFases() / 8;
    this.iAjustesLfo = this.c.enderecoAjustesLfo() / 8;
    this.iAjustesEnv = this.c.enderecoAjustesEnv() / 8;
    this.iMacros = this.c.enderecoMacros() / 8;
    this.iLigacoes = this.c.enderecoLigacoes() / 8;
    this.iAjustesVoz = this.c.enderecoAjustesVoz() / 8;
    this.iCortesResos = this.c.enderecoCortesResos() / 8; // Cutoff 1, Reso 1, Cutoff 2, Reso 2 (BLOCO cada)
    for (const { numero, campos } of Object.values(EFEITOS_NO_MOTOR)) {
      if (this.c.camposEfeito(numero) !== campos.length) throw new Error('motor.wasm e ponte.js não combinam (efeitos)');
    }
    this.iEfeito = this.c.enderecoEfeito() / 8; // som passando pelos efeitos: esquerda; direita BLOCO depois
    this.renovar(true); // (as vistas somE/somD precisam de iEfeito)
    this.iModEfeitos = this.c.enderecoModEfeitos() / 8;
    this.iUsos = this.c.enderecoUsos(); // (em bytes: lido com u8)
  }

  renovar(forcar = false) {
    const b = this.c.memory.buffer;
    if (b === this.buffer && !forcar) return;
    this.buffer = b;
    this.f64 = new Float64Array(b);
    this.f32 = new Float32Array(b);
    this.i32 = new Int32Array(b);
    this.u8 = new Uint8Array(b);
    // Som passando pelos efeitos do C++ (esquerda e direita)
    if (this.iEfeito !== undefined) {
      this.somE = this.f64.subarray(this.iEfeito, this.iEfeito + BLOCO);
      this.somD = this.f64.subarray(this.iEfeito + BLOCO, this.iEfeito + 2 * BLOCO);
    }
  }

  // Onde fica a modulação da voz v (posição em f64; um número por destino)
  mod(v) {
    return this.c.enderecoMod(v) / 8;
  }

  // Onde fica o som da voz v no bloco (posição em f64; a direita vem BLOCO depois)
  vozSaida(v) {
    return this.c.enderecoVozSaida(v) / 8;
  }

  // O destino d está sendo modulado por alguma ligação?
  usa(d) {
    return this.u8[this.iUsos + d] === 1;
  }

  // Lista nova de ligações: [{ fonte, destino, quantidade }] com os índices já convertidos
  definirLigacoes(lista) {
    const n = Math.min(lista.length, 256);
    for (let j = 0; j < n; j++) {
      this.f64[this.iLigacoes + 3 * j] = lista[j].fonte;
      this.f64[this.iLigacoes + 3 * j + 1] = lista[j].destino;
      this.f64[this.iLigacoes + 3 * j + 2] = lista[j].quantidade;
    }
    this.c.definirLigacoes(n);
  }

  // Guarda uma wavetable (vinda da tela) dentro do C++. Devolve o endereço dela (0 = falhou).
  guardarTabela(tabela) {
    const { frames, harmonicos, tamanho } = tabela;
    const qtdNiveis = frames[0].length;
    const t = this.c.criarTabela(frames.length, qtdNiveis, tamanho);
    if (!t) return 0;
    this.renovar(); // a memória pode ter crescido
    this.i32.set(harmonicos, this.c.tabelaHarmonicos(t) / 4);
    let i = this.c.tabelaDados(t) / 4;
    for (const niveis of frames) {
      for (const onda of niveis) {
        this.f32.set(onda, i);
        i += tamanho;
      }
    }
    return t;
  }
}
