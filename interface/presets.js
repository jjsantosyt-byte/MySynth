// interface/presets.js
// Presets: salvar e carregar sons.
//
// - Barra: [‹] Nome do preset * [›] [Salvar]  (o * aparece quando o som foi mexido)
// - Tocar no nome abre a lista, por categoria. Presets seus podem ser apagados (🗑).
// - Presets de fábrica não podem ser apagados nem substituídos.
// - Os seus presets ficam guardados NESTE aparelho (no navegador / no app instalado).
//   Exportar/Importar gera um arquivo .synth (texto JSON por dentro) para backup ou
//   para mandar para alguém. Importar também aceita os .json antigos.

import { criar, criarJanela } from './janela.js';

const CHAVE_GUARDADOS = 'mysynth.presets.v1';
const TAMANHO_MAXIMO_NOME = 40;

// ---------- Guardar no aparelho ----------

function lerGuardados() {
  try {
    const texto = localStorage.getItem(CHAVE_GUARDADOS);
    const lista = texto ? JSON.parse(texto) : [];
    return Array.isArray(lista) ? lista.filter((p) => p && typeof p.nome === 'string' && p.som) : [];
  } catch {
    return [];
  }
}

// Devolve true se deu certo.
function gravarGuardados(lista) {
  try {
    localStorage.setItem(CHAVE_GUARDADOS, JSON.stringify(lista));
    return true;
  } catch {
    return false;
  }
}


// ---------- O módulo ----------

// opcoes:
//   lugar: onde colocar a barra dos presets
//   fabrica: lista de presets de fábrica [{ nome, categoria, som }]
//   categorias: ordem das categorias
//   obterSom(): devolve o som atual (para salvar)
//   aplicarSom(som): carrega um som
//   extrasExportar(presets): coisas que vão junto no arquivo (ex.: { wavetables: [...] })
//   receberExtras(dados): lê essas coisas ao importar; devolve { resumo, ajustarSom(som) }
export function criarPresets({ lugar, fabrica, categorias, obterSom, aplicarSom, extrasExportar, receberExtras }) {
  let guardados = lerGuardados();
  let atual = null; // preset carregado por último
  let modificado = false;

  // Lista completa, na ordem das categorias (fábrica antes, depois os seus, por nome)
  function todos() {
    const lista = [
      ...fabrica.map((p) => ({ ...p, fabrica: true })),
      ...guardados.map((p) => ({ ...p, fabrica: false })),
    ];
    const ordemCategoria = (c) => {
      const i = categorias.indexOf(c);
      return i < 0 ? categorias.length : i;
    };
    return lista.sort(
      (a, b) =>
        ordemCategoria(a.categoria) - ordemCategoria(b.categoria) ||
        Number(b.fabrica) - Number(a.fabrica) ||
        a.nome.localeCompare(b.nome, 'pt-BR')
    );
  }

  const mesmoPreset = (a, b) => a && b && a.nome === b.nome && a.fabrica === b.fabrica;

  // ---------- Barra ----------
  const barra = criar('div', 'presets');
  const setaAnterior = criar('button', 'botao presets-seta', '‹');
  setaAnterior.setAttribute('aria-label', 'Preset anterior');
  const botaoNome = criar('button', 'presets-nome');
  botaoNome.setAttribute('aria-haspopup', 'dialog');
  const textoNome = criar('span', 'presets-texto');
  const marcaMudou = criar('span', 'presets-mudou', '*');
  marcaMudou.title = 'Som modificado (não salvo)';
  botaoNome.append(textoNome, marcaMudou);
  const setaProxima = criar('button', 'botao presets-seta', '›');
  setaProxima.setAttribute('aria-label', 'Próximo preset');
  const botaoSalvar = criar('button', 'botao presets-salvar', 'Salvar');
  barra.append(setaAnterior, botaoNome, setaProxima, botaoSalvar);
  lugar.replaceWith(barra);

  function mostrarBarra() {
    textoNome.textContent = atual ? atual.nome : 'Sem nome';
    marcaMudou.hidden = !modificado;
    botaoNome.title = atual ? `${atual.categoria} · ${atual.nome}` : '';
  }

  function carregar(preset) {
    aplicarSom(preset.som);
    atual = preset;
    modificado = false;
    mostrarBarra();
  }

  function andar(passo) {
    const lista = todos();
    const i = lista.findIndex((p) => mesmoPreset(p, atual));
    const proximo = lista[(i + passo + lista.length) % lista.length];
    carregar(proximo);
  }

  setaAnterior.addEventListener('click', () => andar(-1));
  setaProxima.addEventListener('click', () => andar(1));

  // ---------- Janela: lista de presets ----------
  const janelaLista = criarJanela('Presets');
  const botaoExportar = criar('button', 'botao', 'Exportar meus presets');
  const botaoImportar = criar('button', 'botao', 'Importar');
  // Aceita qualquer arquivo (o iPhone às vezes "apaga" extensões que não conhece,
  // como .synth); o conteúdo é conferido ao importar. Arquivos .json antigos também valem.
  const escolherArquivo = criar('input');
  escolherArquivo.type = 'file';
  escolherArquivo.hidden = true;
  janelaLista.rodape.append(botaoExportar, botaoImportar, escolherArquivo);

  function montarLista() {
    const corpo = janelaLista.corpo;
    corpo.innerHTML = '';
    const lista = todos();
    for (const categoria of [...categorias, ...new Set(lista.map((p) => p.categoria))]) {
      const daCategoria = lista.filter((p) => p.categoria === categoria);
      if (daCategoria.length === 0 || corpo.querySelector(`[data-categoria="${CSS.escape(categoria)}"]`)) continue;
      const secao = criar('section', 'presets-secao');
      secao.dataset.categoria = categoria;
      secao.appendChild(criar('h3', 'presets-categoria', categoria));
      for (const preset of daCategoria) {
        const linha = criar('div', 'presets-linha');
        const item = criar('button', 'presets-item', preset.nome);
        if (mesmoPreset(preset, atual)) item.classList.add('atual');
        if (!preset.fabrica) item.appendChild(criar('span', 'presets-meu', 'meu'));
        item.addEventListener('click', () => {
          carregar(preset);
          janelaLista.fechar();
        });
        linha.appendChild(item);
        if (!preset.fabrica) {
          const apagar = criar('button', 'presets-apagar', '🗑');
          apagar.setAttribute('aria-label', `Apagar ${preset.nome}`);
          apagar.addEventListener('click', () => apagarPreset(preset));
          linha.appendChild(apagar);
        }
        secao.appendChild(linha);
      }
      corpo.appendChild(secao);
    }
  }

  botaoNome.addEventListener('click', () => {
    montarLista();
    janelaLista.abrir();
    janelaLista.corpo.querySelector('.atual')?.scrollIntoView({ block: 'center' });
  });

  function apagarPreset(preset) {
    if (!window.confirm(`Apagar o preset "${preset.nome}"? Isso não pode ser desfeito.`)) return;
    const novos = guardados.filter((p) => p.nome !== preset.nome);
    if (!gravarGuardados(novos)) {
      janelaLista.avisar('Não consegui apagar: o navegador não deixou gravar.');
      return;
    }
    guardados = novos;
    if (mesmoPreset(preset, atual)) {
      // O som continua tocando, mas agora não está salvo em lugar nenhum
      modificado = true;
      mostrarBarra();
    }
    montarLista();
  }

  // Exportar: baixa um arquivo .synth com os seus presets
  // (por dentro é texto no formato JSON; o tipo "genérico" evita o navegador trocar a extensão)
  botaoExportar.addEventListener('click', () => {
    if (guardados.length === 0) {
      janelaLista.avisar('Você ainda não salvou nenhum preset.');
      return;
    }
    const extras = extrasExportar?.(guardados) || {};
    const conteudo = JSON.stringify({ app: 'MySynth', versao: 2, presets: guardados, ...extras });
    const endereco = URL.createObjectURL(new Blob([conteudo], { type: 'application/octet-stream' }));
    const link = criar('a');
    link.href = endereco;
    link.download = 'mysynth-presets.synth';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(endereco), 5000);
    const comWavetables = extras.wavetables?.length ? ` (com ${extras.wavetables.length} wavetable(s) importada(s))` : '';
    janelaLista.avisar(`${guardados.length} preset(s) exportado(s)${comWavetables}.`);
  });

  // Importar: lê um arquivo exportado (nomes repetidos ganham um número)
  botaoImportar.addEventListener('click', () => escolherArquivo.click());
  escolherArquivo.addEventListener('change', async () => {
    const arquivo = escolherArquivo.files?.[0];
    escolherArquivo.value = '';
    if (!arquivo) return;
    try {
      const dados = JSON.parse(await arquivo.text());
      const recebidos = (Array.isArray(dados) ? dados : dados.presets || []).filter(
        (p) => p && typeof p.nome === 'string' && p.som && typeof p.som === 'object'
      );
      if (recebidos.length === 0) throw new Error('sem presets');
      // Wavetables que vieram junto (podem mudar de nome se já existir outra igual no aparelho)
      const { resumo = '', ajustarSom = (som) => som } = (await receberExtras?.(dados)) || {};
      const novos = [...guardados];
      const nomeLivre = (nome) => {
        const usado = (n) => novos.some((p) => p.nome === n) || fabrica.some((p) => p.nome === n);
        if (!usado(nome)) return nome;
        let i = 2;
        while (usado(`${nome} (${i})`)) i++;
        return `${nome} (${i})`;
      };
      for (const p of recebidos) {
        novos.push({
          nome: nomeLivre(p.nome.slice(0, TAMANHO_MAXIMO_NOME)),
          categoria: typeof p.categoria === 'string' ? p.categoria : 'Outros',
          som: ajustarSom(p.som),
        });
      }
      if (!gravarGuardados(novos)) throw new Error('gravar');
      guardados = novos;
      montarLista();
      janelaLista.avisar(`${recebidos.length} preset(s) importado(s)${resumo}.`);
    } catch (erro) {
      janelaLista.avisar(
        erro.message === 'gravar'
          ? 'Não consegui guardar: o navegador não deixou gravar.'
          : 'Esse arquivo não parece ser de presets do MySynth.'
      );
    }
  });

  // ---------- Janela: salvar ----------
  const janelaSalvar = criarJanela('Salvar preset');
  const campoNome = criar('input', 'campo');
  campoNome.type = 'text';
  campoNome.maxLength = TAMANHO_MAXIMO_NOME;
  campoNome.placeholder = 'Nome do preset';
  const campoCategoria = criar('select', 'campo');
  for (const categoria of categorias.filter((c) => c !== 'Início')) {
    campoCategoria.appendChild(criar('option', '', categoria));
  }
  const rotuloNome = criar('label', 'campo-rotulo', 'Nome');
  rotuloNome.appendChild(campoNome);
  const rotuloCategoria = criar('label', 'campo-rotulo', 'Categoria');
  rotuloCategoria.appendChild(campoCategoria);
  janelaSalvar.corpo.append(rotuloNome, rotuloCategoria);
  const botaoCancelar = criar('button', 'botao', 'Cancelar');
  const botaoConfirmar = criar('button', 'botao botao-destaque', 'Salvar');
  janelaSalvar.rodape.append(botaoCancelar, botaoConfirmar);

  // O botão vira "Substituir" se já existe um preset seu com esse nome
  function conferirNome() {
    const nome = campoNome.value.trim();
    const existe = guardados.some((p) => p.nome === nome);
    botaoConfirmar.textContent = existe ? 'Substituir' : 'Salvar';
    janelaSalvar.avisar(existe ? `Já existe um preset seu chamado "${nome}": ele será substituído.` : '');
  }
  campoNome.addEventListener('input', conferirNome);

  botaoSalvar.addEventListener('click', () => {
    campoNome.value = atual && !atual.fabrica ? atual.nome : '';
    campoCategoria.value =
      atual && categorias.includes(atual.categoria) && atual.categoria !== 'Início' ? atual.categoria : 'Outros';
    conferirNome();
    janelaSalvar.abrir();
    campoNome.focus();
  });
  botaoCancelar.addEventListener('click', () => janelaSalvar.fechar());

  function confirmarSalvar() {
    const nome = campoNome.value.trim();
    if (!nome) {
      janelaSalvar.avisar('Dê um nome ao preset.');
      return;
    }
    if (fabrica.some((p) => p.nome === nome)) {
      janelaSalvar.avisar('Esse nome é de um preset de fábrica. Escolha outro.');
      return;
    }
    const preset = { nome, categoria: campoCategoria.value, som: obterSom() };
    const novos = [...guardados.filter((p) => p.nome !== nome), preset];
    if (!gravarGuardados(novos)) {
      janelaSalvar.avisar('Não consegui salvar: o navegador não deixou gravar neste aparelho.');
      return;
    }
    guardados = novos;
    atual = { ...preset, fabrica: false };
    modificado = false;
    mostrarBarra();
    janelaSalvar.fechar();
  }
  botaoConfirmar.addEventListener('click', confirmarSalvar);
  campoNome.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') confirmarSalvar();
  });

  // Começa no "Init" (primeiro de fábrica), sem aplicar nada: o som inicial já é ele.
  atual = { ...fabrica[0], fabrica: true };
  mostrarBarra();

  return {
    // Chamado sempre que o som é mexido
    marcarModificado() {
      if (modificado) return;
      modificado = true;
      mostrarBarra();
    },
  };
}
