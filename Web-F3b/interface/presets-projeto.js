// interface/presets-projeto.js
// Lê os presets que vêm com o app: arquivos .synth nas pastas do projeto.
//
//   presets/lista.json      → índice: categorias + nomes dos arquivos de cada pasta
//   presets/fabrica/*.synth → presets de fábrica
//   presets/usuario/*.synth → presets seus, trazidos para o projeto
//
// Cada .synth tem o mesmo formato do "Exportar" do app ({ app, versao, presets, wavetables }),
// então pode ter um ou vários presets (e as wavetables importadas que eles usam).
// Nenhum destes pode ser apagado ou substituído pelo app.

// Se a lista não puder ser lida (ex.: sem internet e sem cópia guardada), o app
// continua funcionando só com o Init.
const RESERVA = {
  categorias: ['Início', 'Baixo', 'Lead', 'Pad', 'Pluck', 'Keys', 'FX', 'Outros'],
  presets: [{ nome: 'Init', categoria: 'Início', som: {}, fabrica: true, pasta: 'fabrica' }],
};

async function lerJson(endereco) {
  const resposta = await fetch(endereco);
  if (!resposta.ok) throw new Error(`${endereco}: ${resposta.status}`);
  return resposta.json();
}

// receberWavetables(lista): guarda as wavetables importadas que vierem nos arquivos.
// Devolve { categorias, presets: [{ nome, categoria, som, fabrica: true, pasta }], erros }.
export async function carregarPresetsDoProjeto(receberWavetables) {
  let indice;
  try {
    indice = await lerJson('presets/lista.json');
  } catch (erro) {
    console.warn('Não consegui ler presets/lista.json:', erro);
    return { ...RESERVA, erros: ['a lista de presets'] };
  }

  // Busca todos os arquivos ao mesmo tempo (mais rápido no celular); depois monta a lista
  // na ordem do índice.
  const arquivos = ['fabrica', 'usuario'].flatMap((pasta) => (indice[pasta] || []).map((arquivo) => ({ pasta, arquivo })));
  const lidos = await Promise.allSettled(
    arquivos.map(({ pasta, arquivo }) => lerJson(`presets/${pasta}/${encodeURIComponent(arquivo)}`))
  );

  const presets = [];
  const erros = [];
  for (let i = 0; i < arquivos.length; i++) {
    const { pasta, arquivo } = arquivos[i];
    if (lidos[i].status !== 'fulfilled') {
      console.warn(`Não consegui ler o preset ${pasta}/${arquivo}:`, lidos[i].reason);
      erros.push(arquivo);
      continue;
    }
    const dados = lidos[i].value;
    // Wavetables que vieram no arquivo; se alguma entrou com outro nome ("Nome (2)"),
    // os presets deste arquivo passam a usar o nome novo.
    const { trocas = {} } = dados.wavetables ? await receberWavetables(dados.wavetables) : {};
    for (const p of dados.presets || []) {
      if (!p || typeof p.nome !== 'string' || !p.som) continue;
      const som = { ...p.som, opcoes: { ...p.som.opcoes } };
      for (const nome of ['wavetable', 'wavetableB', 'wavetableC']) {
        if (trocas[som.opcoes[nome]]) som.opcoes[nome] = trocas[som.opcoes[nome]];
      }
      presets.push({ nome: p.nome, categoria: p.categoria || 'Outros', som, fabrica: true, pasta });
    }
  }
  if (presets.length === 0) return { ...RESERVA, erros };
  // O Init sempre primeiro (é o som inicial do app)
  presets.sort((a, b) => Number(b.nome === 'Init') - Number(a.nome === 'Init'));
  return { categorias: indice.categorias || RESERVA.categorias, presets, erros };
}
