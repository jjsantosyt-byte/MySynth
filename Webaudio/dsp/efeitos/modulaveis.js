// dsp/efeitos/modulaveis.js
// Knobs dos efeitos que aceitam modulação (LFO, ENV), com a escala de cada um: a mesma
// do knob na tela (a tela monta os knobs com esta tabela), para a modulação andar
// igual ao dedo girando o knob. "exp" = escala exponencial (Hz, tempos); senão, linear.
//
// Os efeitos tratam o som de todas as notas juntas, então seguem a modulação da nota
// tocada por último (um LFO em modo Livre mexe no efeito mesmo sem nota tocando).
// Só contas: nada do navegador.

const lin = (efeito, nome, min, max) => ({ efeito, nome, min, max, exp: false });
const exp = (efeito, nome, min, max) => ({ efeito, nome, min, max, exp: true });

export const MOD_EFEITOS = [
  lin('saturacao', 'drive', 0, 1),
  lin('saturacao', 'tom', 0, 1),
  lin('saturacao', 'mix', 0, 1),

  lin('distorcao', 'drive', 0, 1),
  lin('distorcao', 'tom', 0, 1),
  exp('distorcao', 'lowcut', 20, 1000),
  lin('distorcao', 'mix', 0, 1),

  lin('filtroTrack', 'nota', 24, 132), // Cutoff em notas (sem degraus quando modulado)
  lin('filtroTrack', 'track', 0, 1),
  lin('filtroTrack', 'reso', 0, 1),
  lin('filtroTrack', 'mix', 0, 1),

  lin('eq', 'grave', -15, 15),
  lin('eq', 'medio', -15, 15),
  lin('eq', 'agudo', -15, 15),
  exp('eq', 'freq', 200, 8000),
  exp('eq', 'q', 0.3, 5),
  lin('eq', 'saida', -12, 12),

  lin('compressor', 'threshold', -40, 0),
  exp('compressor', 'ratio', 1, 20),
  exp('compressor', 'attack', 0.0001, 0.1),
  exp('compressor', 'release', 0.01, 1),
  lin('compressor', 'ganho', -12, 24),
  lin('compressor', 'mix', 0, 1),

  exp('phaser', 'rate', 0.02, 10),
  lin('phaser', 'depth', 0, 1),
  exp('phaser', 'freq', 100, 4000),
  lin('phaser', 'feedback', 0, 0.9),
  lin('phaser', 'stereo', 0, 1),
  lin('phaser', 'mix', 0, 1),

  exp('flanger', 'rate', 0.02, 10),
  lin('flanger', 'depth', 0, 1),
  exp('flanger', 'atraso', 0.0005, 0.01),
  lin('flanger', 'feedback', -0.95, 0.95),
  lin('flanger', 'stereo', 0, 1),
  lin('flanger', 'mix', 0, 1),

  exp('chorus', 'rate', 0.05, 5),
  lin('chorus', 'depth', 0, 1),
  lin('chorus', 'atraso', 0.005, 0.03),
  lin('chorus', 'feedback', 0, 0.9),
  lin('chorus', 'width', 0, 1),
  lin('chorus', 'mix', 0, 1),

  exp('delay', 'tempo', 0.01, 2),
  lin('delay', 'feedback', 0, 0.95),
  exp('delay', 'lowcut', 20, 2000),
  exp('delay', 'highcut', 1000, 20000),
  lin('delay', 'width', 0, 1),
  lin('delay', 'mix', 0, 1),

  lin('reverb', 'tamanho', 0, 1),
  lin('reverb', 'brilho', 0, 1),
  lin('reverb', 'predelay', 0, 0.2),
  exp('reverb', 'lowcut', 20, 1000),
  lin('reverb', 'width', 0, 1),
  lin('reverb', 'mix', 0, 1),
];

// Nome do destino de modulação: "delay.mix", "reverb.tamanho"...
for (const m of MOD_EFEITOS) m.destino = `${m.efeito}.${m.nome}`;

// Posição do knob (0 a 1) ↔ valor
export function posicaoDoValor(m, valor) {
  const p = m.exp ? Math.log(valor / m.min) / Math.log(m.max / m.min) : (valor - m.min) / (m.max - m.min);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export function valorDaPosicao(m, posicao) {
  const p = posicao < 0 ? 0 : posicao > 1 ? 1 : posicao;
  return m.exp ? m.min * Math.pow(m.max / m.min, p) : m.min + p * (m.max - m.min);
}
