// dsp/filtro.js
// Filtro do synth, do tipo "SVF" (state variable filter) em versão digital estável (TPT).
// As contas do filtro (vozes e Filtro Track) estão no motor em C++ (motor/motor.cpp, etapa F2b).
// Aqui ficam só a lista dos tipos e as duas fórmulas que a tela usa para DESENHAR a curva
// do filtro (visualizacao.js). São as mesmas do C++: mudou lá, mudar aqui.
//
// Tipos (o C++ recebe a posição nesta lista):
//   lp12 = passa-baixas 12 dB/oitava (corta agudos, mais suave)
//   lp24 = passa-baixas 24 dB/oitava (corta agudos, mais forte)
//   hp   = passa-altas (corta graves)
//   bp   = passa-banda (deixa passar só uma faixa)

export const TIPOS_FILTRO = ['lp12', 'lp24', 'hp', 'bp'];

// Converte a ressonância (0 a 1) no "amortecimento" do filtro.
// 2 = sem ressonância; 0,1 = ressonância forte (assobio), mas ainda estável.
export function amortecimento(resonancia) {
  return 2 - 1.9 * Math.min(1, Math.max(0, resonancia));
}

// Com ressonância alta, o volume do LP/HP baixa conforme a ressonância sobe (não estoura).
export function compensacaoResonancia(resonancia) {
  return 1 / (1 + 1.5 * Math.min(1, Math.max(0, resonancia)));
}
