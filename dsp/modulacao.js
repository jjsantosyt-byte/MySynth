// dsp/modulacao.js
// As "ligações" de modulação: qual fonte mexe em qual controle, e quanto.
//
// Fontes: LFO 1, LFO 2 (de -1 a +1) e ENV 2, ENV 3 (de 0 a 1).
// Destinos: controles de som. A modulação soma na posição do knob (0 a 1):
// quantidade +50% com a fonte no máximo = knob meio giro para cima.

export const FONTES_MOD = ['lfo1', 'lfo2', 'env2', 'env3'];
export const DESTINOS_MOD = ['wtPos', 'detune', 'width', 'cutoff', 'resonancia', 'ruido', 'nivelOsc'];

// Índices para acesso rápido
export const D_WTPOS = 0;
export const D_DETUNE = 1;
export const D_WIDTH = 2;
export const D_CUTOFF = 3;
export const D_RESO = 4;
export const D_RUIDO = 5;
export const D_NIVEL_OSC = 6;

export class MatrizModulacao {
  constructor(taxaAmostragem, tamanhoBloco = 128) {
    this.ligacoes = [];
    // Quantidade muda suavemente (~10 ms): ligar/desligar/ajustar não estala.
    this.suavizar = 1 - Math.exp(-tamanhoBloco / (0.01 * taxaAmostragem));
    this.usos = new Uint8Array(DESTINOS_MOD.length); // 1 = algum destino está sendo modulado
  }

  // Recebe a lista completa da página: [{ fonte, destino, quantidade }].
  definir(lista) {
    // O que não vier mais na lista vai sumindo até zero e depois sai.
    for (const ligacao of this.ligacoes) {
      ligacao.alvo = 0;
      ligacao.removida = true;
    }
    for (const nova of lista) {
      const iFonte = FONTES_MOD.indexOf(nova.fonte);
      const iDestino = DESTINOS_MOD.indexOf(nova.destino);
      if (iFonte < 0 || iDestino < 0) continue;
      const existente = this.ligacoes.find((l) => l.iFonte === iFonte && l.iDestino === iDestino);
      if (existente) {
        existente.alvo = nova.quantidade;
        existente.removida = false;
      } else {
        this.ligacoes.push({ iFonte, iDestino, alvo: nova.quantidade, atual: 0, removida: false });
      }
    }
  }

  // Uma vez por bloco: quantidades andam até o alvo; removidas saem ao chegar em zero.
  avancarBloco() {
    this.usos.fill(0);
    for (let k = this.ligacoes.length - 1; k >= 0; k--) {
      const ligacao = this.ligacoes[k];
      ligacao.atual += (ligacao.alvo - ligacao.atual) * this.suavizar;
      if (ligacao.removida && Math.abs(ligacao.atual) < 1e-4) {
        this.ligacoes.splice(k, 1);
        continue;
      }
      this.usos[ligacao.iDestino] = 1;
    }
  }

  usa(iDestino) {
    return this.usos[iDestino] === 1;
  }

  // Soma a modulação de cada destino, dados os valores atuais das fontes.
  somar(valoresFontes, destino) {
    destino.fill(0);
    for (const ligacao of this.ligacoes) {
      destino[ligacao.iDestino] += ligacao.atual * valoresFontes[ligacao.iFonte];
    }
  }
}
