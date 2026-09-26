// interface/idioma.js
// Idioma do app: português (padrão) ou inglês.
//
// Como a tradução funciona: os textos continuam escritos em português no código (fácil de
// manter). Com o app em inglês, um "tradutor" olha a tela e troca cada texto pela versão em
// inglês desta lista — inclusive os que aparecem depois (listas, janelas, recados, knobs),
// porque ele fica observando as mudanças da tela. Textos com partes que variam (nomes,
// números) usam os MODELOS. Números com vírgula viram ponto (0,30 Hz → 0.30 Hz).
// Os nomes dos presets de fábrica já são em inglês (não passam por aqui).
// Trocar o idioma recarrega o app (mais simples e à prova de esquecimentos).
//
// Texto novo na tela? Coloque a tradução em TEXTOS (ou um modelo em MODELOS).

const CHAVE_IDIOMA = 'mysynth.idioma.v1';

export function lerIdioma() {
  try {
    const idioma = localStorage.getItem(CHAVE_IDIOMA);
    return idioma === 'pt' || idioma === 'en' ? idioma : null;
  } catch {
    return null;
  }
}

export function guardarIdioma(idioma) {
  try {
    localStorage.setItem(CHAVE_IDIOMA, idioma);
  } catch {
    // janela anônima / sem permissão: vale só até fechar o app
  }
}

// Idioma desta abertura do app (trocar = recarregar)
export const IDIOMA = lerIdioma() || 'pt';
export const EM_INGLES = IDIOMA === 'en';

// Troca o idioma: guarda e recarrega (se mudou)
export function mudarIdioma(idioma) {
  guardarIdioma(idioma);
  if (idioma !== IDIOMA) location.reload();
}

// ---------- Português → inglês ----------
const TEXTOS = new Map(
  Object.entries({
    // Barra de cima, abas, geral
    'Ligar som': 'Start sound',
    'Ligando...': 'Starting...',
    'Som ligado': 'Sound on',
    'Som parado': 'Sound stopped',
    Oitava: 'Octave',
    'Oitava abaixo': 'Octave down',
    'Oitava acima': 'Octave up',
    Salvar: 'Save',
    Desfazer: 'Undo',
    Refazer: 'Redo',
    'Segura as notas depois de soltar as teclas': 'Keeps notes playing after you release the keys',
    'Sem nome': 'Untitled',
    'Preset anterior': 'Previous preset',
    'Próximo preset': 'Next preset',
    'Som modificado (não salvo)': 'Sound changed (not saved)',
    'Menu do MySynth': 'MySynth menu',
    Filtro: 'Filter',
    'Páginas de efeitos': 'Effect pages',
    Fechar: 'Close',
    'em breve': 'coming soon',
    'Em breve': 'Coming soon',

    // Carregamento
    'Preparando o som…': 'Preparing the sound…',
    'Montando a tela…': 'Building the screen…',
    'Lendo suas wavetables…': 'Reading your wavetables…',
    'Carregando presets…': 'Loading presets…',
    Pronto: 'Ready',

    // Menu da logo, Configurações, Sobre
    Configurações: 'Settings',
    'Política de privacidade': 'Privacy policy',
    Arquivo: 'File',
    'Salvar nota como one shot (.wav)': 'Save note as one shot (.wav)',
    'Salvar escala como .wav': 'Save scale as .wav',
    'Gravar o que eu tocar (.wav)': 'Record what I play (.wav)',
    'Sobre o MySynth': 'About MySynth',
    'Idioma · Language': 'Language · Idioma',
    'Tamanho do teclado e oitavas, letras do teclado do computador, qualidade do som, vibração e restaurar tudo.':
      'Keyboard size and octaves, computer keyboard letters, sound quality, vibration and reset everything.',
    Tema: 'Theme',
    Básico: 'Basic',
    Comum: 'Standard',
    Claro: 'Light',
    'Sintetizador wavetable feito para tocar no celular: 3 osciladores, 2 filtros, 3 LFOs e 2 envelopes arrastáveis e 10 efeitos.':
      'A wavetable synthesizer made to play on your phone: 3 oscillators, 2 filters, 3 draggable LFOs and 2 envelopes, and 10 effects.',
    'Versão beta · setembro de 2026': 'Beta version · September 2026',

    // Osciladores e wavetables
    Básica: 'Basic',
    Harmônicos: 'Harmonics',
    Formante: 'Formant',
    Seno: 'Sine',
    Triângulo: 'Triangle',
    Serra: 'Saw',
    Quadrada: 'Square',
    Quad: 'Square',
    Puro: 'Pure',
    Pouco: 'Few',
    Médio: 'Mid',
    Cheio: 'Full',
    Nível: 'Level',
    'Wavetable anterior': 'Previous wavetable',
    'Próxima wavetable': 'Next wavetable',
    'Modo de Warp anterior': 'Previous Warp mode',
    'Próximo modo de Warp': 'Next Warp mode',
    'Para qual filtro o oscilador vai': 'Which filter the oscillator goes to',
    'Para qual filtro o ruído vai': 'Which filter the noise goes to',
    Fábrica: 'Factory',
    Minhas: 'Mine',
    'Importar .wav': 'Import .wav',
    'Importe um .wav de wavetable (ciclos de 2048 pontos, estilo Serum/Vital) ou uma onda de ciclo único.':
      'Import a wavetable .wav (2048-point cycles, Serum/Vital style) or a single-cycle wave.',
    'Não consegui apagar do aparelho (o navegador não deixou).': "Couldn't delete it from this device (the browser didn't allow it).",
    'Não consegui ler esse arquivo.': "Couldn't read this file.",
    'Esse arquivo não é um .wav.': "This file isn't a .wav.",
    'Esse .wav está incompleto (sem formato ou sem áudio).': 'This .wav is incomplete (no format or no audio).',
    'Esse .wav não tem canais de áudio.': 'This .wav has no audio channels.',
    'Esse .wav é curto demais para ser uma onda.': 'This .wav is too short to be a wave.',
    'Esse .wav não parece uma wavetable (ciclos de 2048 pontos) nem uma onda de ciclo único. Transformar samples comuns em wavetable fica para uma próxima etapa.':
      "This .wav doesn't look like a wavetable (2048-point cycles) or a single-cycle wave. Turning regular samples into wavetables will come later.",

    // Ruído
    Ruído: 'Noise',
    Ligado: 'On',
    Desligado: 'Off',
    '1 ruído': '1 noise',
    Duração: 'Length',
    'Pitch Ruído': 'Noise Pitch',
    'Duração Ruído': 'Noise Length',
    'Tipo de ruído anterior': 'Previous noise type',
    'Próximo tipo de ruído': 'Next noise type',
    'A cor do ruído acompanha a nota': 'Noise color follows the note',
    'Acordes: só a nota mais recente toca ruído': 'Chords: only the newest note plays noise',

    // Filtros e rotas
    'Filtro 1': 'Filter 1',
    'Filtro 2': 'Filter 2',
    'Passa pelo Filtro 1': 'Goes through Filter 1',
    'Passa pelo Filtro 2': 'Goes through Filter 2',
    'Passa pelo Filtro 1 e depois pelo Filtro 2': 'Goes through Filter 1, then Filter 2',
    'Passa pelo Filtro 2 e depois pelo Filtro 1': 'Goes through Filter 2, then Filter 1',

    // LFO
    'Serra ↑': 'Saw ↑',
    'Serra ↓': 'Saw ↓',
    Sen: 'Sin',
    Qd: 'Sq',
    Livre: 'Free',
    'Recomeça a cada nota': 'Restarts on every note',
    'Roda sem parar (as notas pegam ele andando)': 'Runs nonstop (notes catch it wherever it is)',

    // Efeitos
    Cor: 'Color',
    'Filtro Track': 'Track Filter',
    Espaço: 'Space',
    Saturação: 'Saturation',
    Distorção: 'Distortion',
    Fita: 'Tape',
    Válvula: 'Tube',
    Suave: 'Soft',
    Dura: 'Hard',
    Tom: 'Tone',
    Aberto: 'Open',
    Grave: 'Low',
    Agudo: 'High',
    Saída: 'Output',
    Ganho: 'Gain',
    Brilho: 'Bright',
    Tamanho: 'Size',
    Tempo: 'Time',
    'Quanto o compressor está abaixando o volume': 'How much the compressor is turning the volume down',

    // Global
    Voz: 'Voice',
    Vozes: 'Voices',
    'Poly: acordes · Mono: uma nota por vez': 'Poly: chords · Mono: one note at a time',
    'notas ao mesmo tempo (Poly)': 'notes at once (Poly)',
    'notas ao mesmo tempo (Poly · máx. 6 no celular)': 'notes at once (Poly · max. 6 on phones)',
    'deslizar não reinicia o envelope (Mono)': "sliding doesn't restart the envelope (Mono)",
    'Legato só funciona no modo Mono': 'Legato only works in Mono mode',
    Sempre: 'Always',
    'Emende as notas para escorregar (ou ligue "Sempre")': 'Overlap notes to glide (or turn on "Always")',
    Qualidade: 'Quality',

    // Presets
    'Exportar todos os meus': 'Export all mine',
    Importar: 'Import',
    meu: 'mine',
    'Exportar só este preset (.synth)': 'Export only this preset (.synth)',
    'Salvar preset': 'Save preset',
    Nome: 'Name',
    Categoria: 'Category',
    Cancelar: 'Cancel',
    Confirmar: 'Confirm',
    Apagar: 'Delete',
    Substituir: 'Replace',
    'Nome do preset': 'Preset name',
    Início: 'Init',
    Baixo: 'Bass',
    Outros: 'Other',
    'Dê um nome ao preset.': 'Give the preset a name.',
    'Esse nome é de um preset que vem com o app. Escolha outro.': 'That name belongs to a preset that comes with the app. Choose another.',
    'Não consegui salvar: o navegador não deixou gravar neste aparelho.': "Couldn't save: the browser didn't allow saving on this device.",
    'Não consegui apagar: o navegador não deixou gravar.': "Couldn't delete: the browser didn't allow saving.",
    'Você ainda não salvou nenhum preset.': "You haven't saved any presets yet.",
    'Não consegui guardar: o navegador não deixou gravar.': "Couldn't save: the browser didn't allow it.",
    'Esse arquivo não parece ser de presets do MySynth.': "This file doesn't look like MySynth presets.",

    // Avisos
    'O motor de som parou por um erro. Recarregue o app para voltar a tocar.':
      'The sound engine stopped because of an error. Reload the app to play again.',
    'Este navegador não liberou o motor de som. Abra pelo endereço http://localhost:8080 (no computador) ou por um endereço https (no celular).':
      "This browser didn't allow the sound engine. Open it at http://localhost:8080 (on a computer) or at an https address (on a phone).",
  })
);

// Traduz uma parte (usado dentro dos modelos): o próprio texto se não houver tradução
const parte = (texto) => traduzirTexto(texto);

const MODELOS = [
  [/^Arraste a ficha (.+) até um controle \(ou toque nela e depois no controle\)\.$/, (m) => `Drag the ${m[1]} chip onto a control (or tap it, then tap the control).`],
  [/^Toque nos controles para ligar o (.+)\. Toque na ficha de novo para terminar\.$/, (m) => `Tap controls to connect ${m[1]}. Tap the chip again to finish.`],
  [/^Toque nos controles para ligar o (.+)\. Toque no M para terminar\.$/, (m) => `Tap controls to connect ${m[1]}. Tap M to finish.`],
  [/^Quantidade: (.+) → (.+)$/, (m) => `Amount: ${m[1]} → ${parte(m[2])}`],
  [/^Remover ligação com (.+)$/, (m) => `Remove connection to ${parte(m[1])}`],
  [/^Nível ([ABC])$/, (m) => `Level ${m[1]}`],
  // Knob de efeito na lista de ligações: "Distorção · Tom" → "Distortion · Tone"
  [/^(Saturação|Distorção|Filtro Track|EQ|Compressor|Phaser|Flanger|Chorus|Delay|Reverb) · (.+)$/, (m) => `${parte(m[1])} · ${parte(m[2])}`],
  [/^Apagar o preset "(.+)"\? Isso não pode ser desfeito\.$/, (m) => `Delete the preset "${m[1]}"? This can't be undone.`],
  [/^Apagar a wavetable "(.+)" deste aparelho\? Presets que usam ela passam a abrir com a Básica\.$/, (m) => `Delete the wavetable "${m[1]}" from this device? Presets that use it will open with Basic.`],
  [/^Exportar (.+)$/, (m) => `Export ${m[1]}`],
  [/^Apagar (.+)$/, (m) => `Delete ${m[1]}`],
  [/^Oscilador ([ABC]): mostrar Pan, Blend, Phase e Rand$/, (m) => `Oscillator ${m[1]}: show Pan, Blend, Phase and Rand`],
  [/^Oscilador ([ABC]): voltar para a página Onda$/, (m) => `Oscillator ${m[1]}: back to the Wave page`],
  [/^Oscilador ([ABC]) (ligado|desligado)$/, (m) => `Oscillator ${m[1]} ${m[2] === 'ligado' ? 'on' : 'off'}`],
  [/^(Ligado|Desligado): toque para (desligar|ligar)$/, (m) => `${m[1] === 'Ligado' ? 'On' : 'Off'}: tap to turn ${m[2] === 'ligar' ? 'on' : 'off'}`],
  [/^Rota de filtro: (.+)\. Toque para trocar\.$/, (m) => `Filter route: ${parte(m[1])}. Tap to change.`],
  [/^(.+): (mais|menos)$/, (m) => `${parte(m[1])}: ${m[2] === 'mais' ? 'more' : 'less'}`],
  [/^(.+) → (.+?)  (\d+%)$/, (m) => `${parte(m[1])} → ${parte(m[2])}  ${m[3]}`],
  [/^(.+) (\d+%)$/, (m) => `${parte(m[1])} ${m[2]}`],
  [/^A wavetable "(.+)" não está neste aparelho: usando a Básica\.$/, (m) => `The wavetable "${m[1]}" isn't on this device: using Basic.`],
  [/^Não consegui carregar alguns presets do app \((.+)\)\.$/, (m) => `Couldn't load some of the app's presets (${m[1]}).`],
  [/^(.+): em breve\.$/, (m) => `${parte(m[1])}: coming soon.`],
  [
    /^Soft clipper segurando picos ~(\d+) dB acima do máximo \(o som pode ficar mais sujo\)\. Se não quiser, abaixe o Volume ou o Nível dos osciladores\.$/,
    (m) => `Soft clipper holding peaks ~${m[1]} dB above the maximum (the sound may get dirtier). If you don't want that, lower the Volume or the oscillator Level.`,
  ],
  [/^Não consegui ligar o som: (.*)$/, (m) => `Couldn't start the sound: ${m[1]}`],
  [/^"(.+)" exportado(.*)\.$/, (m) => `"${m[1]}" exported${extrasWavetables(m[2])}.`],
  [/^(\d+) preset\(s\) exportado\(s\)(.*)\.$/, (m) => `${m[1]} preset(s) exported${extrasWavetables(m[2])}.`],
  [/^(\d+) preset\(s\) importado\(s\)(.*)\.$/, (m) => `${m[1]} preset(s) imported${extrasWavetables(m[2])}.`],
  [/^Já existe um preset seu chamado "(.+)": ele será substituído\.$/, (m) => `You already have a preset called "${m[1]}": it will be replaced.`],
  [/^"(.+)" apagada\.$/, (m) => `"${m[1]}" deleted.`],
  [
    /^"(.+)" (substituída|importada): (\d+) frame\(s\)(?: \(o arquivo tem (\d+); guardei (\d+) espalhados\))?\.( Atenção: não consegui guardar no aparelho, ela some ao fechar o app\.)?$/,
    (m) =>
      `"${m[1]}" ${m[2] === 'substituída' ? 'replaced' : 'imported'}: ${m[3]} frame(s)` +
      (m[4] ? ` (the file has ${m[4]}; kept ${m[5]} spread across it)` : '') +
      '.' +
      (m[6] ? " Warning: couldn't save it on this device; it will disappear when you close the app." : ''),
  ],
  [/^Formato de \.wav não suportado \((\d+) bits, código (\d+)\)\.$/, (m) => `Unsupported .wav format (${m[1]} bits, code ${m[2]}).`],
  // "Categoria · Nome" (título do nome do preset) e outros pares com "·"
  [/^(.+) · (.+)$/, (m) => `${parte(m[1])} · ${parte(m[2])}`],
];

// Pedaços opcionais das mensagens de presets
function extrasWavetables(texto) {
  return texto
    .replace(/ \(com (\d+) wavetable\(s\) importada\(s\)\)/, ' (with $1 imported wavetable(s))')
    .replace(/ e (\d+) wavetable\(s\) nova\(s\)/, ' and $1 new wavetable(s)');
}

// Traduz um texto inteiro (sem os espaços das pontas). Devolve o próprio texto se não souber.
function traduzirTexto(texto) {
  const direto = TEXTOS.get(texto);
  if (direto !== undefined) return direto;
  for (const [modelo, montar] of MODELOS) {
    const achado = modelo.exec(texto);
    if (achado) {
      const traduzido = montar(achado);
      if (traduzido !== texto) return traduzido;
    }
  }
  // Valores de knob etc.: "0,30 Hz" → "0.30 Hz" (só textos que começam com número)
  if (/^[-+−~]?\d/.test(texto) && /\d,\d/.test(texto)) return texto.replace(/(\d),(\d)/g, '$1.$2');
  return texto;
}

// Para textos que não passam pela tela (ex.: perguntas de confirmação)
export function t(texto) {
  return EM_INGLES ? traduzirTexto(texto) : texto;
}

// ---------- O tradutor da tela (só com o app em inglês) ----------
const ATRIBUTOS = ['aria-label', 'title', 'placeholder'];

function traduzirNoTexto(no) {
  const valor = no.nodeValue;
  const limpo = valor.trim();
  if (!limpo) return;
  const traduzido = traduzirTexto(limpo);
  if (traduzido !== limpo) no.nodeValue = valor.replace(limpo, traduzido);
}

function traduzirAtributo(el, nome) {
  const valor = el.getAttribute(nome);
  if (!valor) return;
  const traduzido = traduzirTexto(valor.trim());
  if (traduzido !== valor.trim()) el.setAttribute(nome, traduzido);
}

function traduzirArvore(raiz) {
  if (raiz.nodeType === Node.TEXT_NODE) {
    traduzirNoTexto(raiz);
    return;
  }
  if (raiz.nodeType !== Node.ELEMENT_NODE || raiz.closest?.('script, style')) return;
  for (const nome of ATRIBUTOS) traduzirAtributo(raiz, nome);
  const caminhante = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  while (caminhante.nextNode()) {
    const no = caminhante.currentNode;
    if (no.nodeType === Node.TEXT_NODE) traduzirNoTexto(no);
    else for (const nome of ATRIBUTOS) traduzirAtributo(no, nome);
  }
}

if (EM_INGLES) {
  document.documentElement.lang = 'en';
  traduzirArvore(document.body);
  // Tudo que aparecer ou mudar depois também é traduzido
  new MutationObserver((mudancas) => {
    for (const m of mudancas) {
      if (m.type === 'childList') m.addedNodes.forEach(traduzirArvore);
      else if (m.type === 'characterData') traduzirNoTexto(m.target);
      else if (m.type === 'attributes') traduzirAtributo(m.target, m.attributeName);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
}
