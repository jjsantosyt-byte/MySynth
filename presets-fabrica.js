// presets-fabrica.js
// Presets que já vêm com o app (não podem ser apagados nem substituídos).
//
// Cada preset só descreve o que MUDA em relação ao "Init" (o som inicial):
// o que não estiver aqui fica com o valor padrão. Os nomes dos campos são os
// mesmos do estado do app (principal.js): parametros, opcoes, fontes, ligacoes, efeitos.
//
// Posições da wavetable Básica: Seno = 0, Triângulo = 1/3, Serra = 2/3, Quadrada = 1.

const SENO = 0;
const TRIANGULO = 1 / 3;
const SERRA = 2 / 3;
const QUADRADA = 1;

export const CATEGORIAS = ['Início', 'Baixo', 'Lead', 'Pad', 'Pluck', 'Keys', 'FX', 'Outros'];

export const PRESETS_FABRICA = [
  { nome: 'Init', categoria: 'Início', som: {} },

  // ---------- Baixo ----------
  {
    nome: 'Reese Bass',
    categoria: 'Baixo',
    som: {
      parametros: { wtPos: SERRA, detune: 0.08, width: 0.4, cutoff: 600, resonancia: 0.15, soltura: 0.15 },
      opcoes: { filtroLigado: true, filtroTipo: 'lp24', modo: 'mono', legato: true, unison: 3, glide: 0.06 },
      fontes: { lfo2: { forma: 'triangulo', rate: 0.15, modo: 'livre' } },
      ligacoes: [{ fonte: 'lfo2', destino: 'cutoff', quantidade: 0.1 }],
      efeitos: { distorcao: { ligado: true, tipo: 'suave', drive: 0.3, mix: 1 } },
    },
  },
  {
    nome: 'Sub Bass',
    categoria: 'Baixo',
    som: {
      parametros: { wtPos: SENO, decaimento: 0.3, soltura: 0.1 },
      opcoes: { modo: 'mono', glide: 0.04 },
      efeitos: { distorcao: { ligado: true, tipo: 'suave', drive: 0.25, mix: 0.5 } },
    },
  },
  {
    nome: 'Wobble',
    categoria: 'Baixo',
    som: {
      parametros: { wtPos: SERRA, detune: 0.1, cutoff: 150, resonancia: 0.45, soltura: 0.12 },
      opcoes: { filtroLigado: true, filtroTipo: 'lp24', modo: 'mono', unison: 2 },
      fontes: { lfo1: { forma: 'seno', rate: 3, modo: 'retrig' } },
      ligacoes: [{ fonte: 'lfo1', destino: 'cutoff', quantidade: 0.6 }],
      efeitos: { distorcao: { ligado: true, tipo: 'valvula', drive: 0.5, mix: 1 } },
    },
  },

  // ---------- Lead ----------
  {
    nome: 'Supersaw',
    categoria: 'Lead',
    som: {
      parametros: { wtPos: SERRA, detune: 0.3, width: 1, ataque: 0.01, soltura: 0.3 },
      opcoes: { unison: 7 },
      efeitos: {
        delay: { ligado: true, tempo: 0.3, feedback: 0.3, mix: 0.2 },
        reverb: { ligado: true, tamanho: 0.5, brilho: 0.6, mix: 0.25 },
      },
    },
  },
  {
    nome: 'Lead Quadrado',
    categoria: 'Lead',
    som: {
      parametros: { wtPos: QUADRADA, detune: 0.12, width: 0.6, cutoff: 3000, resonancia: 0.2, soltura: 0.2 },
      opcoes: { filtroLigado: true, filtroTipo: 'lp12', modo: 'mono', legato: true, unison: 2, glide: 0.08 },
      fontes: { env2: { ataque: 0.005, decaimento: 0.4, sustentacao: 0, soltura: 0.2 } },
      ligacoes: [{ fonte: 'env2', destino: 'cutoff', quantidade: 0.2 }],
      efeitos: {
        delay: { ligado: true, tempo: 0.35, feedback: 0.35, mix: 0.25 },
        reverb: { ligado: true, mix: 0.2 },
      },
    },
  },

  // ---------- Pad ----------
  {
    nome: 'Pad Suave',
    categoria: 'Pad',
    som: {
      parametros: {
        wtPos: 0.4, detune: 0.2, width: 1, cutoff: 1500, resonancia: 0.1,
        ataque: 1.2, decaimento: 1, sustentacao: 0.8, soltura: 2.5,
      },
      opcoes: { filtroLigado: true, filtroTipo: 'lp12', unison: 5 },
      fontes: { lfo2: { forma: 'seno', rate: 0.2, modo: 'livre' } },
      ligacoes: [{ fonte: 'lfo2', destino: 'wtPos', quantidade: 0.25 }],
      efeitos: {
        chorus: { ligado: true, rate: 0.5, depth: 0.5, mix: 0.5 },
        reverb: { ligado: true, tamanho: 0.8, brilho: 0.5, mix: 0.4 },
      },
    },
  },

  // ---------- Pluck ----------
  {
    nome: 'Pluck',
    categoria: 'Pluck',
    som: {
      parametros: { wtPos: SERRA, cutoff: 300, resonancia: 0.2, ataque: 0, decaimento: 0.25, sustentacao: 0, soltura: 0.25 },
      opcoes: { filtroLigado: true, filtroTipo: 'lp24' },
      fontes: { env2: { ataque: 0, decaimento: 0.2, sustentacao: 0, soltura: 0.2 } },
      ligacoes: [{ fonte: 'env2', destino: 'cutoff', quantidade: 0.55 }],
      efeitos: {
        delay: { ligado: true, tempo: 0.25, feedback: 0.35, mix: 0.25, pingpong: true },
        reverb: { ligado: true, mix: 0.3 },
      },
    },
  },

  // ---------- Keys ----------
  {
    nome: 'Keys',
    categoria: 'Keys',
    som: {
      parametros: { wtPos: TRIANGULO, cutoff: 2500, decaimento: 0.8, sustentacao: 0.3, soltura: 0.4 },
      opcoes: { filtroLigado: true, filtroTipo: 'lp12' },
      fontes: { env2: { ataque: 0.005, decaimento: 0.6, sustentacao: 0, soltura: 0.3 } },
      ligacoes: [{ fonte: 'env2', destino: 'cutoff', quantidade: 0.3 }],
      efeitos: {
        chorus: { ligado: true, mix: 0.4 },
        reverb: { ligado: true, mix: 0.25 },
      },
    },
  },

  // ---------- FX ----------
  {
    nome: 'Rise FX',
    categoria: 'FX',
    som: {
      parametros: { wtPos: SERRA, detune: 0.5, cutoff: 400, resonancia: 0.5, ataque: 0.5, soltura: 1.5 },
      opcoes: { filtroLigado: true, filtroTipo: 'lp24', unison: 8 },
      fontes: { lfo2: { forma: 'serraSobe', rate: 0.25, modo: 'retrig' } },
      ligacoes: [
        { fonte: 'lfo2', destino: 'cutoff', quantidade: 0.6 },
        { fonte: 'lfo2', destino: 'wtPos', quantidade: 0.3 },
      ],
      efeitos: {
        delay: { ligado: true, tempo: 0.4, feedback: 0.6, mix: 0.35, pingpong: true },
        reverb: { ligado: true, tamanho: 1, brilho: 0.7, mix: 0.5 },
      },
    },
  },
];
