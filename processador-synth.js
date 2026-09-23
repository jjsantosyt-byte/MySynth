// processador-synth.js
// O "motor" de som. Roda num processo de áudio separado (AudioWorklet),
// para o som não falhar mesmo se a tela ficar lenta.
//
// Caminho do som (1 voz, monofônico):
//   oscilador wavetable → filtro → envelope de volume (ENV 1) → saída
//
// - WT Pos: escolhe a posição na wavetable, misturando os 2 frames vizinhos
//   (morphing). É um "parâmetro de áudio", então muda suave, sem degraus,
//   e no futuro poderá ser movido por LFOs e envelopes.
// - Sem aliasing: escolhe o nível da tabela certo para cada nota e mistura
//   suavemente entre dois níveis vizinhos.
// - Sem estalos: o envelope sempre tem uma rampinha mínima de 1,5 ms.
// - Legato (opcional): deslizar entre teclas não reinicia o envelope.

import { Envelope } from './dsp/envelope.js';
import { Filtro } from './dsp/filtro.js';

// Converte número de nota MIDI em frequência (Hz). Nota 69 = Lá 440 Hz.
function notaParaFrequencia(nota) {
  return 440 * Math.pow(2, (nota - 69) / 12);
}

// Lê um ponto da onda com interpolação (liga os pontos da tabela por retas).
function lerOnda(onda, i0, i1, frac) {
  return onda[i0] + frac * (onda[i1] - onda[i0]);
}

class ProcessadorSynth extends AudioWorkletProcessor {
  // Controles que a página pode mexer de forma suave.
  static get parameterDescriptors() {
    return [
      // Oscilador: 0 = primeiro frame, 1 = último frame
      { name: 'wtPos', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Filtro
      { name: 'cutoff', defaultValue: 2000, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'resonancia', defaultValue: 0.1, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // Envelope de volume (tempos em segundos)
      { name: 'ataque', defaultValue: 0.005, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
      { name: 'decaimento', defaultValue: 0.5, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
      { name: 'sustentacao', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'soltura', defaultValue: 0.08, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.tabela = null; // wavetable recebida da página
    this.fase = 0; // posição dentro do ciclo da onda (0 a 1)
    this.frequencia = 440;
    this.notasPresas = []; // notas seguradas, na ordem em que foram tocadas
    this.notaAtual = null; // a nota que está soando
    this.legato = true;

    this.envelope = new Envelope(sampleRate);
    this.filtro = new Filtro(sampleRate);

    this.port.onmessage = (evento) => this.receberMensagem(evento.data);
  }

  // Toca uma nota: muda a altura e decide se o envelope recomeça.
  tocar(nota, recomecar) {
    this.notaAtual = nota;
    this.frequencia = notaParaFrequencia(nota);
    if (recomecar) {
      // Vindo do silêncio, o filtro começa "limpo".
      if (!this.envelope.ativo) this.filtro.reiniciar();
      this.envelope.disparar();
    }
  }

  receberMensagem(msg) {
    switch (msg.tipo) {
      case 'wavetable':
        this.tabela = msg.wavetable;
        break;

      case 'notaOn': {
        const ninguemSegurando = this.notasPresas.length === 0;
        // Se a nota já estava na lista, tira e coloca no fim (vira a mais recente).
        this.notasPresas = this.notasPresas.filter((n) => n !== msg.nota);
        this.notasPresas.push(msg.nota);
        // Com legato, só recomeça o envelope se nenhuma tecla estava segurada.
        this.tocar(msg.nota, ninguemSegurando || !this.legato);
        break;
      }

      case 'notaOff':
        this.notasPresas = this.notasPresas.filter((n) => n !== msg.nota);
        if (this.notasPresas.length === 0) {
          this.envelope.soltar(); // soltou tudo: entra a soltura (R)
        } else if (msg.nota === this.notaAtual) {
          // Soltou a nota que soava, mas ainda tem outra segurada: volta para ela.
          const ultima = this.notasPresas[this.notasPresas.length - 1];
          this.tocar(ultima, !this.legato);
        }
        break;

      case 'tudoOff':
        this.notasPresas = [];
        this.envelope.soltar();
        break;

      // Opções que não são "knobs": tipo de filtro, liga/desliga, legato.
      case 'opcao':
        if (msg.nome === 'filtroTipo') this.filtro.definirTipo(msg.valor);
        if (msg.nome === 'filtroLigado') this.filtro.definirLigado(msg.valor);
        if (msg.nome === 'legato') this.legato = msg.valor;
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

  process(entradas, saidas, parametros) {
    const saida = saidas[0][0];
    const tamanhoBloco = saida.length;

    // Sem tabela, ou envelope parado (silêncio): não calcula nada.
    if (!this.tabela || !this.envelope.ativo) {
      saida.fill(0);
      return true;
    }

    // Envelope: lê os knobs A, D, S, R uma vez por bloco.
    this.envelope.definir(
      parametros.ataque[0],
      parametros.decaimento[0],
      parametros.sustentacao[0],
      parametros.soltura[0]
    );

    // Filtro: se Cutoff/ressonância estão parados, calcula uma vez por bloco;
    // se estão mudando, recalcula a cada amostra (varredura suave).
    const cortes = parametros.cutoff;
    const resonancias = parametros.resonancia;
    const filtroMudando = cortes.length > 1 || resonancias.length > 1;
    if (!filtroMudando) this.filtro.definirCorte(cortes[0], resonancias[0]);

    const frames = this.tabela.frames;
    const ultimoFrame = frames.length - 1;
    const tamanho = this.tabela.tamanho;
    const mascara = tamanho - 1;
    const { nivel, mistura } = this.escolherNiveis(this.frequencia);
    const nivelB = Math.min(nivel + 1, frames[0].length - 1);
    const passo = this.frequencia / sampleRate;
    const posicoesWT = parametros.wtPos; // 1 valor (parado) ou 128 (mudando)

    for (let i = 0; i < tamanhoBloco; i++) {
      // Onde estamos na wavetable: entre o frame f0 e o f1, "t" mede o quanto.
      const wt = (posicoesWT.length > 1 ? posicoesWT[i] : posicoesWT[0]) * ultimoFrame;
      const f0 = Math.min(wt | 0, ultimoFrame);
      const f1 = Math.min(f0 + 1, ultimoFrame);
      const t = wt - f0;

      // Posição dentro do ciclo da onda.
      const posicao = this.fase * tamanho;
      const i0 = posicao | 0;
      const i1 = (i0 + 1) & mascara;
      const frac = posicao - i0;

      // Para cada um dos 2 frames: mistura os 2 níveis anti-aliasing.
      const a0 = lerOnda(frames[f0][nivel], i0, i1, frac);
      const b0 = lerOnda(frames[f0][nivelB], i0, i1, frac);
      const a1 = lerOnda(frames[f1][nivel], i0, i1, frac);
      const b1 = lerOnda(frames[f1][nivelB], i0, i1, frac);
      const som0 = a0 + mistura * (b0 - a0);
      const som1 = a1 + mistura * (b1 - a1);

      // Morphing: mistura os 2 frames conforme o WT Pos.
      const oscilador = som0 + t * (som1 - som0);

      // Filtro e envelope de volume.
      if (filtroMudando) {
        this.filtro.definirCorte(
          cortes.length > 1 ? cortes[i] : cortes[0],
          resonancias.length > 1 ? resonancias[i] : resonancias[0]
        );
      }
      saida[i] = this.filtro.processar(oscilador) * this.envelope.proximo();

      this.fase += passo;
      if (this.fase >= 1) this.fase -= 1;
    }
    return true;
  }
}

registerProcessor('processador-synth', ProcessadorSynth);
