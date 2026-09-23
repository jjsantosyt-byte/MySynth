// processador-synth.js
// O "motor" de som. Roda num processo de áudio separado (AudioWorklet),
// para o som não falhar mesmo se a tela ficar lenta.
//
// Nesta etapa: 1 voz (monofônico), tocando a wavetable recebida.
// - Sem aliasing: escolhe o nível da tabela certo para cada nota e mistura
//   suavemente entre dois níveis vizinhos.
// - Sem estalos: o volume sobe e desce em poucos milissegundos.

// Converte número de nota MIDI em frequência (Hz). Nota 69 = Lá 440 Hz.
function notaParaFrequencia(nota) {
  return 440 * Math.pow(2, (nota - 69) / 12);
}

class ProcessadorSynth extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tabela = null; // wavetable recebida da página
    this.fase = 0; // posição dentro do ciclo da onda (0 a 1)
    this.frequencia = 440;
    this.notasPresas = []; // notas seguradas, na ordem em que foram tocadas

    // Volume "anti-estalo": vai suavemente até o alvo (0 = mudo, 1 = soando).
    this.volume = 0;
    this.alvo = 0;
    this.suavizarSubida = 1 - Math.exp(-1 / (0.002 * sampleRate)); // ~2 ms
    this.suavizarDescida = 1 - Math.exp(-1 / (0.01 * sampleRate)); // ~10 ms

    this.port.onmessage = (evento) => this.receberMensagem(evento.data);
  }

  receberMensagem(msg) {
    switch (msg.tipo) {
      case 'wavetable':
        this.tabela = msg.wavetable;
        break;

      case 'notaOn':
        // Se a nota já estava na lista, tira e coloca no fim (vira a mais recente).
        this.notasPresas = this.notasPresas.filter((n) => n !== msg.nota);
        this.notasPresas.push(msg.nota);
        this.frequencia = notaParaFrequencia(msg.nota);
        this.alvo = 1;
        break;

      case 'notaOff':
        this.notasPresas = this.notasPresas.filter((n) => n !== msg.nota);
        if (this.notasPresas.length === 0) {
          this.alvo = 0; // soltou tudo: silencia suavemente
        } else {
          // Ainda tem nota segurada: volta para a última delas.
          const ultima = this.notasPresas[this.notasPresas.length - 1];
          this.frequencia = notaParaFrequencia(ultima);
        }
        break;

      case 'tudoOff':
        this.notasPresas = [];
        this.alvo = 0;
        break;
    }
  }

  // Decide quais 2 níveis da tabela usar para esta frequência e quanto de cada.
  escolherNiveis(frequencia) {
    const h = this.tabela.harmonicos;
    const ultimo = h.length - 1;
    // Quantos harmônicos cabem sem passar do limite (metade da taxa de amostragem).
    const limite = (0.5 * sampleRate) / frequencia;

    // Primeiro nível (o mais cheio) que ainda não gera aliasing.
    let nivel = 0;
    while (nivel < ultimo && h[nivel] > limite) nivel++;
    if (nivel === ultimo) return { nivel, mistura: 0 };

    // Mistura com o próximo nível conforme a nota sobe, para a troca ser
    // gradual. Chega em 100% do próximo exatamente no limite deste nível.
    const freqMaxima = (0.5 * sampleRate) / h[nivel];
    const razao = nivel > 0 ? h[nivel] / h[nivel - 1] : h[1] / h[0];
    const freqMinima = freqMaxima * razao;
    let mistura = Math.log(frequencia / freqMinima) / Math.log(freqMaxima / freqMinima);
    mistura = Math.min(1, Math.max(0, mistura));
    return { nivel, mistura };
  }

  process(entradas, saidas) {
    const saida = saidas[0][0];
    const tamanhoBloco = saida.length;

    // Sem tabela, ou em silêncio total: não calcula nada.
    if (!this.tabela || (this.alvo === 0 && this.volume < 1e-5)) {
      this.volume = 0;
      saida.fill(0);
      return true;
    }

    const frame = this.tabela.frames[0];
    const tamanho = this.tabela.tamanho;
    const mascara = tamanho - 1;
    const { nivel, mistura } = this.escolherNiveis(this.frequencia);
    const ondaA = frame[nivel];
    const ondaB = frame[Math.min(nivel + 1, frame.length - 1)];
    const passo = this.frequencia / sampleRate;
    const suavizar = this.alvo > this.volume ? this.suavizarSubida : this.suavizarDescida;

    for (let i = 0; i < tamanhoBloco; i++) {
      // Leitura da tabela com interpolação (liga os pontos por retas).
      const posicao = this.fase * tamanho;
      const i0 = posicao | 0;
      const i1 = (i0 + 1) & mascara;
      const frac = posicao - i0;
      const a = ondaA[i0] + frac * (ondaA[i1] - ondaA[i0]);
      const b = ondaB[i0] + frac * (ondaB[i1] - ondaB[i0]);
      const amostra = a + mistura * (b - a);

      this.volume += (this.alvo - this.volume) * suavizar;
      saida[i] = amostra * this.volume;

      this.fase += passo;
      if (this.fase >= 1) this.fase -= 1;
    }
    return true;
  }
}

registerProcessor('processador-synth', ProcessadorSynth);
