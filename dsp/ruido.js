// dsp/ruido.js
// Ruído, tocado como um "sample" (estilo Serum): para cada tipo, o motor gera UMA vez
// um trecho de ~4 s de ruído e as notas tocam esse trecho, em loop ou uma vez só
// (One Shot), mais rápido ou mais devagar (Pitch e Track mudam a "cor").
//
//   white = todas as frequências com a mesma força (chiado "cheio", brilhante)
//   pink  = cai 3 dB por oitava (mais equilibrado ao ouvido, tipo chuva)
//   brown = cai 6 dB por oitava (grave, tipo vento/trovão)
//
// As contas estão no motor em C++ (motor/motor.cpp, etapa F2b). Aqui fica só a lista dos
// tipos (a tela mostra; o C++ recebe a posição nesta lista).

export const TIPOS_RUIDO = ['white', 'pink', 'brown'];
