// interface/wavetables.js
// Janela com a lista de wavetables: Fábrica, Minhas (importadas) e o botão Importar .wav.
// Abre ao tocar no nome da wavetable, no cabeçalho do OSC A.
// As importadas ficam guardadas neste aparelho (armazem-wavetables.js) e podem ser apagadas (🗑).

import { criar, criarJanela } from './janela.js';
import {
  WAVETABLES,
  IMPORTADAS,
  MAX_FRAMES_IMPORTADOS,
  escolherCiclos,
  registrarImportada,
  removerImportada,
} from '../wavetable.js';
import { lerWav, dividirEmCiclos, ErroWav } from '../importar-wav.js';
import { listarGuardadas, guardarWavetable, apagarWavetable, desempacotar } from './armazem-wavetables.js';

const TAMANHO_MAXIMO_NOME = 40;

// Coloca no catálogo as wavetables guardadas no aparelho (chamar ao abrir o app).
export async function carregarWavetablesGuardadas() {
  try {
    for (const item of await listarGuardadas()) registrarImportada(item.nome, desempacotar(item));
  } catch (erro) {
    console.warn('Não consegui ler as wavetables guardadas:', erro);
  }
}

// opcoes:
//   botaoNome: o nome da wavetable (tocar abre a lista)
//   idAtual(): id da wavetable em uso
//   escolher(id): troca a wavetable do oscilador
//   aoApagar(id): uma importada foi apagada
export function criarListaWavetables({ botaoNome, idAtual, escolher, aoApagar }) {
  const janela = criarJanela('Wavetables');
  const botaoImportar = criar('button', 'botao', 'Importar .wav');
  // Aceita qualquer arquivo (o iPhone às vezes esconde extensões); o conteúdo é conferido.
  const escolherArquivo = criar('input');
  escolherArquivo.type = 'file';
  escolherArquivo.hidden = true;
  janela.rodape.append(botaoImportar, escolherArquivo);

  function secao(titulo, lista, apagavel) {
    const bloco = criar('section', 'presets-secao');
    bloco.appendChild(criar('h3', 'presets-categoria', titulo));
    for (const { id, nome } of lista) {
      const linha = criar('div', 'presets-linha');
      const item = criar('button', 'presets-item', nome);
      if (id === idAtual()) item.classList.add('atual');
      item.addEventListener('click', () => {
        escolher(id);
        janela.fechar();
      });
      linha.appendChild(item);
      if (apagavel) {
        const apagar = criar('button', 'presets-apagar', '🗑');
        apagar.setAttribute('aria-label', `Apagar ${nome}`);
        apagar.addEventListener('click', () => apagarImportada(id, nome));
        linha.appendChild(apagar);
      }
      bloco.appendChild(linha);
    }
    return bloco;
  }

  function montarLista() {
    janela.corpo.innerHTML = '';
    janela.corpo.appendChild(secao('Fábrica', WAVETABLES, false));
    if (IMPORTADAS.length > 0) {
      janela.corpo.appendChild(secao('Minhas', IMPORTADAS, true));
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

  async function apagarImportada(id, nome) {
    if (!window.confirm(`Apagar a wavetable "${nome}" deste aparelho? Presets que usam ela passam a abrir com a Básica.`)) return;
    try {
      await apagarWavetable(nome);
    } catch {
      janela.avisar('Não consegui apagar do aparelho (o navegador não deixou).');
      return;
    }
    removerImportada(id);
    aoApagar(id);
    montarLista();
    janela.avisar(`"${nome}" apagada.`);
  }

  botaoImportar.addEventListener('click', () => escolherArquivo.click());
  escolherArquivo.addEventListener('change', async () => {
    const arquivo = escolherArquivo.files?.[0];
    escolherArquivo.value = '';
    if (!arquivo) return;
    let ciclos;
    try {
      ciclos = dividirEmCiclos(lerWav(await arquivo.arrayBuffer()));
    } catch (erro) {
      janela.avisar(erro instanceof ErroWav ? erro.message : 'Não consegui ler esse arquivo.');
      if (!(erro instanceof ErroWav)) console.error(erro);
      return;
    }
    const nome = arquivo.name.replace(/\.[^.]*$/, '').slice(0, TAMANHO_MAXIMO_NOME).trim() || 'Wavetable';
    const existia = IMPORTADAS.some((w) => w.nome === nome);
    // Guarda só os ciclos que vão ser usados (no máximo 64): ocupa menos espaço.
    // Cópia de cada ciclo: não prende o arquivo inteiro na memória.
    const escolhidos = escolherCiclos(ciclos).map((ciclo) => Float32Array.from(ciclo));
    escolher(registrarImportada(nome, escolhidos));
    montarLista();

    let guardou = true;
    try {
      await guardarWavetable(nome, escolhidos);
    } catch (erro) {
      guardou = false;
      console.warn('Não consegui guardar a wavetable:', erro);
    }
    const reduzida =
      ciclos.length > MAX_FRAMES_IMPORTADOS ? ` (o arquivo tem ${ciclos.length}; guardei ${MAX_FRAMES_IMPORTADOS} espalhados)` : '';
    const guardada = guardou ? '' : ' Atenção: não consegui guardar no aparelho, ela some ao fechar o app.';
    janela.avisar(`"${nome}" ${existia ? 'substituída' : 'importada'}: ${escolhidos.length} frame(s)${reduzida}.${guardada}`);
  });
}
