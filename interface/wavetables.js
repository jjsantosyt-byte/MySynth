// interface/wavetables.js
// Janela com a lista de wavetables: Fábrica, Minhas (importadas) e o botão Importar .wav.
// Abre ao tocar no nome da wavetable, no cabeçalho do OSC A.

import { criar, criarJanela } from './janela.js';
import { WAVETABLES, IMPORTADAS, MAX_FRAMES_IMPORTADOS, registrarImportada } from '../wavetable.js';
import { lerWav, dividirEmCiclos, ErroWav } from '../importar-wav.js';

const TAMANHO_MAXIMO_NOME = 40;

// opcoes:
//   botaoNome: o nome da wavetable (tocar abre a lista)
//   idAtual(): id da wavetable em uso
//   escolher(id): troca a wavetable do oscilador
export function criarListaWavetables({ botaoNome, idAtual, escolher }) {
  const janela = criarJanela('Wavetables');
  const botaoImportar = criar('button', 'botao', 'Importar .wav');
  // Aceita qualquer arquivo (o iPhone às vezes esconde extensões); o conteúdo é conferido.
  const escolherArquivo = criar('input');
  escolherArquivo.type = 'file';
  escolherArquivo.hidden = true;
  janela.rodape.append(botaoImportar, escolherArquivo);

  function secao(titulo, lista) {
    const bloco = criar('section', 'presets-secao');
    bloco.appendChild(criar('h3', 'presets-categoria', titulo));
    for (const { id, nome } of lista) {
      const item = criar('button', 'presets-item', nome);
      if (id === idAtual()) item.classList.add('atual');
      item.addEventListener('click', () => {
        escolher(id);
        janela.fechar();
      });
      bloco.appendChild(item);
    }
    return bloco;
  }

  function montarLista() {
    janela.corpo.innerHTML = '';
    janela.corpo.appendChild(secao('Fábrica', WAVETABLES));
    if (IMPORTADAS.length > 0) {
      janela.corpo.appendChild(secao('Minhas', IMPORTADAS));
    } else {
      janela.corpo.appendChild(
        criar('p', 'wavetables-dica', 'Importe um .wav de wavetable (ciclos de 2048 pontos, estilo Serum/Vital) ou uma onda de ciclo único.')
      );
    }
  }

  botaoNome.addEventListener('click', () => {
    montarLista();
    janela.abrir();
    janela.corpo.querySelector('.atual')?.scrollIntoView({ block: 'center' });
  });

  botaoImportar.addEventListener('click', () => escolherArquivo.click());
  escolherArquivo.addEventListener('change', async () => {
    const arquivo = escolherArquivo.files?.[0];
    escolherArquivo.value = '';
    if (!arquivo) return;
    try {
      const ciclos = dividirEmCiclos(lerWav(await arquivo.arrayBuffer()));
      const nome = arquivo.name.replace(/\.[^.]*$/, '').slice(0, TAMANHO_MAXIMO_NOME).trim() || 'Wavetable';
      const existia = IMPORTADAS.some((w) => w.nome === nome);
      const tabela = registrarImportada(nome, ciclos);
      escolher(tabela.id);
      montarLista();
      const reduzida =
        ciclos.length > MAX_FRAMES_IMPORTADOS ? ` (o arquivo tem ${ciclos.length}; guardei ${MAX_FRAMES_IMPORTADOS} espalhados)` : '';
      janela.avisar(
        `"${nome}" ${existia ? 'substituída' : 'importada'}: ${tabela.frames.length} frame(s)${reduzida}.`
      );
    } catch (erro) {
      janela.avisar(erro instanceof ErroWav ? erro.message : 'Não consegui ler esse arquivo.');
      if (!(erro instanceof ErroWav)) console.error(erro);
    }
  });
}
