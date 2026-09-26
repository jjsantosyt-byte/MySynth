// motor.cpp
// Motor de som em C++, compilado para WebAssembly (motor.wasm) e usado pelo
// processador-synth.js dentro do AudioWorklet.
//
// Regras (as mesmas do dsp/): só contas de áudio, nada de navegador. Assim este mesmo
// código pode, no futuro, virar um motor nativo (Android/Oboe, JUCE).
//
// Etapa F0: só o "esqueleto" — prova que o .wasm carrega dentro do motor. As partes do som
// entram nas próximas etapas (e o JavaScript delas, em dsp/, é apagado).
//
// Para compilar: motor\compilar.bat (gera motor\motor.wasm).

// "EXPORTAR" = a função fica visível para o JavaScript (processador-synth.js).
#define EXPORTAR extern "C" __attribute__((visibility("default")))

// Versão do motor em C++ (sobe a cada etapa; o JavaScript mostra no console).
EXPORTAR int versao() { return 0; }
