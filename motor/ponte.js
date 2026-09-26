// motor/ponte.js
// A "ponte" entre o JavaScript (processador-synth.js, dsp/voz.js) e o motor em C++
// (motor/motor.cpp → motor.wasm): guarda as funções do C++ e as "vistas" da memória dele,
// para o JavaScript escrever os ajustes e ler o som direto lá dentro (sem cópias extras).
//
// Quando o C++ pede mais memória (ex.: ao guardar uma wavetable grande), a memória muda de
// lugar e as vistas antigas deixam de valer: renovar() cria de novo (chamar depois de guardar
// uma tabela e no começo de cada bloco — é só uma comparação quando nada mudou).

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
export const N_MOD_OSC = 35; // destinos de modulação dos osciladores (índices 0 a 34)

export class Ponte {
  constructor(modulo, taxaAmostragem) {
    this.c = new WebAssembly.Instance(modulo, {}).exports; // as funções do C++
    this.c.iniciar(taxaAmostragem);
    this.buffer = null;
    this.renovar();
    // Endereços da mesa de troca, contados em números de 8 bytes (posição dentro de f64)
    const n = this.c.camposOsc();
    if (n !== Object.keys(CAMPOS_OSC).length) throw new Error('motor.wasm e ponte.js não combinam');
    this.nCampos = n;
    this.iAjustes = this.c.enderecoAjustes() / 8;
    this.iPosicoes = this.c.enderecoPosicoes() / 8;
    this.iModAtual = this.c.enderecoModAtual() / 8;
    this.iModAnterior = this.c.enderecoModAnterior() / 8;
    this.iFases = this.c.enderecoFases() / 8;
  }

  renovar() {
    const b = this.c.memory.buffer;
    if (b === this.buffer) return;
    this.buffer = b;
    this.f64 = new Float64Array(b);
    this.f32 = new Float32Array(b);
    this.i32 = new Int32Array(b);
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

  // Onde fica o som do oscilador k da voz v (posição em f64; a direita vem BLOCO depois)
  saida(v, k) {
    return this.c.enderecoSaida(v, k) / 8;
  }
}
