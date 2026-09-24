# Projeto: [nome provisório do app]

## Sobre mim
Sou músico/produtor e não sei programar. Você é o desenvolvedor,
eu sou o diretor do produto e o "ouvido" do projeto.
- Explique tudo em português simples, sem jargão desnecessário.
- Antes de mudanças grandes, me diga o plano e espere minha aprovação.
- Sempre me diga COMO testar o que você fez (o que abrir, o que tocar, o que ouvir).

## O que é o app
Um sintetizador wavetable que roda no navegador do celular,
com o objetivo de virar, no futuro, um app de música focado em synth
(estilo DAW simplificado: gravar, sequenciar e exportar).

## Para quem
Produtores e sound designers que querem um synth wavetable poderoso
no celular/tablet, sem precisar de computador. Não é focado em um gênero.

## Conceito
Um synth wavetable no estilo Serum e Vital, pensado para toque:
- Mesma lógica de som: osciladores wavetable, filtros, envelopes, LFOs,
  matriz de modulação e efeitos.
- Interface diferente: feita para dedos, não para mouse
  (controles grandes, gestos, arrastar para modular).

## Como imagino usar o app
[Escreva o passo a passo, do jeito que você faria:
"Abro o app, escolho um som, ajusto..., toco..., gravo..."]

## Como deve soar
- Limpo e de alta qualidade, sem aliasing (chiado agudo) nem estalos.
- Wavetables com morphing suave entre os frames.
- Graves fortes e agudos brilhantes sem ficar áspero.
- Deve conseguir fazer: pads, leads, baixos, plucks, sons evolutivos.

## O que NÃO quero
- Som "de brinquedo" ou de baixa qualidade.
- Interface minúscula que só funciona com mouse.
- Copiar código, presets ou wavetables do Serum ou do Vital.
  Use-os só como inspiração de conceito e de fluxo.

## Regras técnicas (mantenha sempre)
- Plataforma inicial: app web (HTML/JavaScript) usando Web Audio / AudioWorklet.
- Foco em toque de tela: botões grandes, funciona bem no celular e no tablet.
- O som vem primeiro; a aparência fica para depois.
- Sem cliques ou estalos ao começar/soltar notas.
- Sem aliasing (chiado agudo) nas notas altas.
- Código simples e organizado, com comentários em português.
- O motor de som (`dsp/` e `processador-synth.js`) não pode depender de nada do navegador
  (DOM, botões, janela): só contas de áudio. Assim ele pode ser traduzido para C++
  no futuro (motor nativo), se a latência no celular exigir.

## Fluxo de trabalho
- Uma coisa de cada vez, em etapas pequenas.
- Use Git: faça um commit a cada etapa que funcionar,
  com mensagem clara em português.
- Se algo quebrar, volte para a última versão que funcionava.

## Recursos em ordem de prioridade
0. Base: teclado na tela tocando uma wavetable simples
1. Oscilador wavetable com posição (WT Pos) e morphing
2. Filtro + envelope de amplitude
3. Unison, polifonia e detune
4. LFOs e envelopes de modulação com arrastar-e-soltar
5. Efeitos (reverb, delay, chorus, distorção)
6. Presets e wavetables próprias
7. Depois: gravação, sequenciador, exportação (o "DAW")

## Próximos passos (ordem combinada em 24/09/2026)
1. **Upgrade dos efeitos** → objetivo: uma versão BETA bem funcional do sintetizador.
   Decidido: entram Saturação, Compressor, EQ, Phaser e Flanger (além dos 4 atuais).
   - E1: knobs novos nos efeitos atuais — FEITO (ver "Efeitos E1" no Estado atual).
   - E2: Compressor — FEITO (ver "Efeitos E2"). Páginas na aba FX ficam para quando passar de
     5 efeitos (hoje: 5 cartões lado a lado cabem).
   - E3: Saturação (Fita / Válvula / Transistor, Drive, Tom, Mix; oversampling).
   - E4: EQ 3 bandas, Phaser e Flanger.
   - Ordem fixa proposta: Saturação → Distorção → EQ → Compressor → Chorus/Phaser → Delay → Reverb
     (reordenar arrastando fica para depois).
2. **Ajustes visuais e de espaço** — o dono decide cada um, aos poucos.
3. **Configurações gerais do app** (tela/aba "Ajustes"): idioma, tema (escuro/claro/cores) e
   outras (tamanho do teclado, oitavas, letras do teclado do PC, qualidade do som, vibração,
   restaurar tudo).
4. Depois: item 7 (o "DAW"): 7a Gravar .wav → 7b sequenciador (piano roll) → 7c gravar no
   sequenciador → 7d exportar (inclui o one shot da nota Dó) → 7e guardar.

## Ideias para o futuro (sem data)
- Filtro: opção de ajustar/mostrar o Cutoff em semitons/notas musicais
  (ex.: "C4 + 7 st"), em vez de só Hz. Combina bem com keytracking
  (o Cutoff acompanhar a nota tocada).
- Qualidade (aba Global): escolher a taxa de amostragem (44,1/48 kHz — exige religar o
  motor de som por um instante) e/ou um modo "qualidade alta" (mais limpo, mais pesado).
- Aviso de proteção no celular ao escolher mais de 8 vozes de unison (pode pesar/estalar).
- Oscilador: talvez modos de Warp Espelho e Quantizar; FM a partir do Ruído.
- Warp: compensar o pequeno atraso (7,5 amostras) do oscilador com Warp, para ele somar
  exatamente em fase com um oscilador sem Warp na mesma altura.
- Ruído: importar samples de ruído (.wav: vinil, fita, ataques/transientes) com One Shot/Loop.
- Efeitos: mais knobs (Distorção: Tom, Filtro antes; Chorus: Delay, Feedback, Width;
  Delay: Low/High Cut, Width, Sync BPM; Reverb: Pre-delay, Low Cut, Width) — planejado.
- LFO: desenhar a forma com pontos e curvas (estilo Serum/Vital); sincronismo com BPM
  (1/4, 1/8...) quando existir o sequenciador; talvez LFO 3 e 4.
- Limitador próprio no motor (`dsp/`), no lugar do DynamicsCompressor do navegador: olha ~1,5 ms
  à frente, solta em ~0,1 s de verdade, não começa "apertado" ao ligar o som. (O do navegador
  solta em > 1 s: o volume parece mudar sozinho depois de um pico.)
- Exportar som como .wav:
  - Salvar uma nota do som como "one shot" .wav para usar no FL Studio e em outras DAWs.
    Nota padrão: Dó (C) — o FL usa C5 como nota base do sampler, então a amostra já
    entra afinada. Escolher a duração; a cauda dos efeitos entra no arquivo.
  - Salvar uma escala específica como .wav (ex.: todas as notas de Dó maior numa
    faixa de oitavas), em um arquivo por nota ou num arquivo só. Serve para montar
    instrumentos de sample em outros apps.

## Aparelhos de teste
- Android: do dono do projeto. FUNCIONA: Chrome → ⋮ → "Instalar app" (o Chrome cria o app,
  com ícone, tela cheia e sem internet) — aprovado pelo dono ("bem legal", 24/09/2026).
  APK do PWABuilder (TWA, opção A com barrinha): instala mas fica parado no ícone (splash) e
  nunca carrega. Próxima tentativa: gerar de novo com "Fallback behavior: WebView" e conferir
  Chrome como navegador padrão/atualizado.
- iPhone 15 Pro: de um amigo que testa junto (o layout "celular deitado" foi feito para ele;
  no iPhone o app é usado pelo Safari / "Adicionar à Tela de Início", não por APK).

## Distribuição (caminho combinado)
1. Colocar online (https, ex.: GitHub Pages) e testar no celular. ✔ online (falta o teste no celular)
2. PWA: ícone na tela inicial, tela cheia, funciona sem internet. ✔ (`sw.js`, 24/09/2026)
3. APK/AAB para a Play Store via TWA (PWABuilder/Bubblewrap). Conta Google: US$ 25 uma vez.
4. Só se a latência no celular incomodar: motor de som em C++ (Oboe no Android),
   tela continua em HTML/JS dentro do Capacitor. Alternativa radical: JUCE (tela + motor
   em C++, gera também VST/AU). iPhone exige Mac + conta Apple.
   Medir a latência no celular antes de decidir.

## Estado atual
**Item 0 (base) — feito e aprovado (testado no computador):**
- Teclado na tela (1 a 4 oitavas conforme a largura da tela), deslizar entre teclas,
  botões de oitava e volume.
- Onda dente de serra criada do zero, com níveis por meia oitava e mistura suave
  entre níveis (sem aliasing — medido: ruído fora dos harmônicos < -77 dB).
- Monofônico (última nota tem prioridade), com rampa anti-estalo de volume.
- O primeiro toque no teclado já liga o som (o botão "Ligar som" é opcional).

**Item 1 (WT Pos e morphing) — feito e aprovado pelo ouvido:**
- Wavetable "Básica" com 4 frames: Seno → Triângulo → Serra → Quadrada
  (criados do zero, alinhados no início do ciclo).
- WT Pos como parâmetro de áudio suavizado (pronto para ser modulado no item 4).
- Morphing contínuo: mistura os 2 frames vizinhos.
- Visualização 2D da onda atual; arrastar no desenho muda o WT Pos;
  botões de atalho para cada forma.

**Visual (organização da tela) — feito e aprovado:**
- Barra fixa em cima (oitava, volume, ligar som) e teclado fixo embaixo.
- Abas, uma função por aba: OSC, Filtro, ENV, LFO, FX (só OSC tem conteúdo).
- Aba OSC com 3 espaços: OSC A funcionando; OSC B e C reservados ("em breve").
  No celular em pé, B e C viram faixas finas.
- Mais contraste: tela quase preta, cartões com borda, onda azul viva com brilho.
- Cores ficam em variáveis no topo do `estilo.css`.

**Item 2 (filtro + envelope de amplitude) — feito e aprovado pelo ouvido (já deu para fazer um reese bass):**
- Caminho do som: oscilador → filtro → ENV 1 (volume) → volume geral → limitador.
- Filtro SVF (TPT) por voz: LP 12, LP 24, HP, BP; Cutoff e Reso; liga/desliga.
  Troca de tipo e liga/desliga com transição suave (~5 ms).
  Volume do LP/HP baixa com a ressonância (compensação) para não estourar.
- ENV 1 (ADSR): ataque linear, D/R em curva (tempo = queda até -60 dB).
  Mínimos anti-estalo: ataque 1,5 ms, queda 6 ms.
- Legato opcional (padrão ligado); sem legato, cada nota recomeça o envelope
  a partir do nível atual.
- Knobs de toque (arrastar para cima/baixo, toque duplo = valor inicial) com número.
- Desenhos: curva do filtro (resposta exata do filtro) e forma do ADSR.
- Volume geral com folga (× 0,5) + limitador neutro (compensa o "makeup gain").
- Envelope do filtro: decidido esperar o item 4 (ENV 2/3 arrastáveis).

**Item 3 (polifonia, unison, detune) — feito e aprovado pelo ouvido:**
- Motor = gerente de vozes (até 16). Cada voz: cópias de unison → filtro estéreo → ENV 1.
- Poly (padrão, 8 vozes) / Mono (voz 1, Legato só no Mono). Trocar de modo solta as notas.
- Roubo de voz: prefere voz já solta e mais baixa; senão a mais antiga. A voz roubada
  some em ~4 ms e depois toca a nota nova (sem estalo).
- Unison 1–16 (seletor ‹ N ›), Detune (100% = pontas a ±1 semitom, espalhadas por igual),
  Width (estéreo de potência igual). Volume por cópia 1/√N. Fase sorteada a cada nota.
- Saída estéreo. Marcas do detune desenhadas no painel da onda (estilo Serum).
- Fileira de voz abaixo das abas: [Mono|Poly] Vozes ‹ 8 › (Legato).
- Otimização: cópia inteira por bloco; caminho rápido com WT Pos parado; mistura entre
  níveis anti-aliasing só no último 1/4 da faixa. Peso medido no PC (render offline):
  8 vozes × 8 cópias ≈ 18% do tempo real; 16 × 16 ≈ 47%.

**Item 4a (modulação: som e ligações) — feito e aprovado pelo ouvido:**
- Fontes: LFO 1 e 2 (Seno, Tri, Serra ↑, Serra ↓, Quad, S&H; Rate 0,02–40 Hz;
  modo Retrig = por nota, Livre = um só para todas, rodando sempre) e ENV 2 e 3 (ADSR).
- Destinos: WT Pos, Detune, Width, Cutoff, Reso. A modulação soma na posição do knob
  (0 a 1); Cutoff na escala exponencial do knob. Quantidade de -100% a +100%.
- Cada voz calcula a modulação em pedaços de 32 amostras, com rampa entre pedaços
  e suavização de ~2 ms (LFO quadrado/S&H sem tique). Filtro modulado: coeficientes
  próprios da voz, interpolados. Quantidades mudam suavemente (~10 ms).
- Tela: fichas coloridas sempre visíveis (abaixo da fileira de voz). Ligar arrastando
  a ficha até o controle, ou tocando na ficha (arma) e depois nos controles.
  Lista de ligações em cada cartão de fonte (barra de quantidade + ✕).
  Bolinhas coloridas no canto dos controles ligados.
- Peso: 8 vozes × 8 cópias com 4 ligações ≈ 33% do tempo real (sem ligações ≈ 23%).

**Item 4b (visual da modulação ao vivo) — feito, aguardando aprovação:**
- O motor manda ~30x/s os valores da nota mais recente (quanto cada destino está
  sendo modulado + fase/valor dos LFOs). Sem nota e sem LFO livre, avisa uma vez e para.
- Knobs: arco externo na cor da fonte (LFO: para os dois lados; ENV: para um lado)
  e ponto branco no valor modulado ao vivo. WT Pos: faixa colorida + ponto embaixo da barra.
- Desenhos ao vivo: onda na posição modulada do WT Pos, marcas do detune modulado,
  curva do filtro com Cutoff/Reso modulados, pontinho andando nos desenhos dos LFOs.
- Teclado e knobs toleram falha no "prender o ponteiro" (setPointerCapture).
- Testes do Claude usam a porta 8091 (`.claude/launch.json`); o `Iniciar.bat` segue na 8080.

**Arquivos:**
- `index.html`, `estilo.css` — a página e a aparência
- `principal.js` — liga o som, teclado, toques, abas e controles
- `processador-synth.js` — motor de som (AudioWorklet): gerente de vozes
- `dsp/voz.js` — uma voz completa (unison → filtro estéreo → envelope)
- `dsp/oscilador.js` — leitura da wavetable sem aliasing
- `dsp/oscilador-voz.js` — um oscilador dentro da nota (unison, WT Pos, nível, Warp)
- `dsp/warp.js` — contas do Warp (Sync, Bend, PWM)
- `dsp/meia-banda.js` — filtro para trabalhar em taxa dobrada (Warp e Distorção)
- `dsp/envelope.js`, `dsp/filtro.js` — envelope ADSR e filtro (usados pelas vozes)
- `dsp/lfo.js`, `dsp/modulacao.js` — LFO e ligações de modulação (dentro do motor)
- `interface/knob.js` — knob reutilizável (escalas e formatos de número)
- `interface/seletor.js` — seletor de número inteiro ‹ N ›
- `interface/modulacao.js` — fichas, arrastar/tocar para ligar, listas de ligações
- `interface/presets.js` — barra de presets, lista, salvar, apagar, exportar/importar
- `interface/janela.js` — janela por cima da tela (usada por presets e wavetables)
- `interface/wavetables.js` — lista de wavetables e botão Importar .wav
- `interface/armazem-wavetables.js` — guarda as wavetables importadas no aparelho (IndexedDB)
- `importar-wav.js` — lê arquivos .wav e divide em ciclos (frames)
- `presets/` — presets que vêm com o app, como arquivos .synth (formato do Exportar):
  `presets/fabrica/` (de fábrica), `presets/usuario/` (seus, trazidos para o projeto) e
  `presets/lista.json` (categorias + ordem dos arquivos; todo .synth novo precisa entrar aqui)
- `interface/presets-projeto.js` — lê os .synth das pastas ao abrir o app
- `dsp/efeitos/` — distorcao.js, chorus.js, delay.js, reverb.js
- `wavetable.js` — monta as wavetables (frames × níveis anti-aliasing)
- `visualizacao.js` — desenha a onda, o envelope e a curva do filtro
- `sw.js` + `manifest.json` — app instalável que funciona sem internet (PWA)
- `servidor.ps1` + `Iniciar.bat` — servidor local para testar no computador (http://localhost:8080)

**Visual para celular deitado (iPhone 15 Pro) — feito e aprovado no aparelho:**
- Prioridade: celular DEITADO, sem rolagem em nenhuma aba. Celular em pé continua
  funcionando (com rolagem permitida).
- Regras do layout deitado (`@media (orientation: landscape) and (max-height: 500px)`):
  barra de cima numa linha; abas + fichas de modulação (sempre visíveis) numa linha;
  teclado ~22% da altura; os desenhos (onda, filtro, envelopes, LFO) encolhem para o
  resto caber; só as listas de ligações rolam; explicações de opções escondidas.
- Aba Global (ajustes do synth todo): cartão Voz (Mono/Poly, Vozes, Legato) +
  espaços reservados para Glide e Qualidade (taxa de amostragem / qualidade do som).
  O botão "Mod" foi removido (as fichas cabem sempre).

**Glide (portamento) — feito e aprovado no iPhone (Mono e Poly):**
- Aba Global, cartão Glide: knob Tempo (0 = desligado, até 2 s) + chave "Sempre".
- Tempo igual para qualquer intervalo; escorrega em semitons (linear na escala musical).
- Por padrão só com notas emendadas (alguma tecla ainda segurada); "Sempre" = toda vez.
- Mono: escorrega de onde o som está (inclusive no meio de outro glide) e volta ao
  soltar a nota de cima. Poly: a nota nova escorrega a partir da última nota tocada.
- Cada voz guarda a altura em semitons (`altura`, `alturaAlvo`, `passoGlide`) e anda
  por pedaço de 32 amostras. Medido: glide de 200 ms passa por ~311 Hz na metade (A3→A4).
- Medido: 852×340 (Safari) e 852×393 (instalado) sem rolagem e sem cortes.
- Margens da ilha/câmera: `viewport-fit=cover` + `env(safe-area-inset-*)`.
- PWA básico: `manifest.json`, ícones em `icones/`, metas da Apple → "Adicionar à
  Tela de Início" abre em tela cheia (ganha ~50 px de altura).

**Item 5a (Delay + Reverb) — feito e aprovado no iPhone:**
- Efeitos no motor (`dsp/efeitos/`), depois das notas somadas, em estéreo:
  [Distorção → Chorus: 5b] → Delay → Reverb → volume geral → limitador.
- Os efeitos rodam mesmo sem notas (caudas terminam) e "dormem" quando silenciam.
  Desligar: para de entrar som novo, a cauda termina naturalmente.
- Mix: até 50% o original fica cheio; de 50% a 100% ele some (`ganhosMix`).
- Delay: até 2 s, Feedback até 95% (ecos sempre somem), repetições perdem agudo (~6 kHz),
  Ping-pong. Mudar o Tempo: transição de 50 ms entre o eco antigo e o novo (sem "zzzp").
- Reverb: FDN de 8 linhas + 4 difusores; Tamanho = tempo da cauda (0,3 a 8 s),
  Brilho = abafamento (1,5 a 16 kHz); tira graves < ~120 Hz da entrada.
- Medido: ecos caem 8 dB por repetição com Feedback 40%; ligar/desligar sem estalo;
  8 vozes × 8 cópias: 24% → 26% com delay + reverb.

**Item 5b (Distorção + Chorus) — feito e aprovado no iPhone. Item 5 (Efeitos) completo.**
- Cadeia completa: Distorção → Chorus → Delay → Reverb.
- Distorção (`dsp/efeitos/distorcao.js`): Suave (tanh), Dura (corte), Válvula
  (assimétrica + filtro que tira o desvio DC). Anti-aliasing: 2x oversampling (filtro
  meia-banda de 31 coeficientes, só os não-zero são calculados) + ADAA de 1ª ordem.
  Volume compensado (máx. ~+3 dB com Drive 100%). O original é atrasado 15 amostras
  (sempre, mesmo dormindo) para alinhar com o distorcido sem estalo.
  Medido: aliasing em A7 com Drive 100% ≈ -44 a -48 dB (sem proteção: -24 dB); custo ~5%.
- Chorus (`dsp/efeitos/chorus.js`): 2 cópias por lado, atraso base 12 ms ± até 6 ms,
  defasadas 1/4 de ciclo (esq. = seno, dir. = cosseno). Rate 0,05–5 Hz. Custo ~1%.
- 8 vozes × 8 cópias com os 4 efeitos: ~33% do tempo real (sem efeitos: ~24%).

**Item 6a (Presets) — feito e aprovado:**
- Barra de cima: [‹] Nome * [›] [Salvar] no lugar do título. "*" = som mexido e não salvo.
  Tocar no nome abre a lista por categoria (Início, Baixo, Lead, Pad, Pluck, Keys, FX, Outros).
- Preset = o "som": parametros, opcoes, fontes, ligacoes, efeitos (sem volume geral e oitava).
  Carregar mescla o preset em cima do som inicial (SOM_PADRAO): presets antigos continuam
  funcionando quando surgirem controles novos.
- 10 de fábrica em `presets-fabrica.js` (só descrevem o que muda em relação ao Init);
  não podem ser apagados nem substituídos.
- Os do usuário ficam no aparelho (localStorage `mysynth.presets.v1`); iPhone: app instalado
  e Safari guardam separado; limpar dados do Safari apaga. Exportar/Importar (.json).
  Importar renomeia nomes repetidos ("Nome (2)").
- Tela acompanha ao carregar: knobs/seletores têm `ler` + `sincronizar()`; botões ficam na
  lista `sincronizadores`. Novo controle = dar `ler` ao knob ou registrar o sincronizador.

**2 filtros com rotas — feito e aprovado:**
- O filtro antigo virou o Filtro 1 (mesmos nomes: cutoff, resonancia, filtroLigado,
  filtroTipo); Filtro 2 = cutoff2, resonancia2, filtro2Ligado, filtro2Tipo. Os dois são
  destinos de modulação ("Cutoff 1/2", "Reso 1/2").
- Rotas por fonte (`rotaOsc`, `rotaRuido`): 'f1', 'f2', 'f12' (1 → 2), 'f21' (2 → 1).
  Botão de rota no OSC A (ao lado do WT Pos) e no Ruído; tocar troca.
- Na voz: cadeias de filtro por rota, cada etapa com memória própria; oscilador e ruído em
  buffers separados; grupos por bloco (mesma rota = um grupo). Filtro desligado não calcula.
- Padrão: tudo em F1 e F2 desligado → presets antigos soam iguais.
- Peso 8×8: sem filtro 22%, F1 26%, F1→F2 31%, osc F1 + ruído F2 33%.

**Ruído + arquivo .synth — feito e aprovado:**
- Ruído (`dsp/ruido.js`), um gerador por voz (semente diferente por voz): White, Pink
  (Paul Kellet, -3 dB/oitava), Brown (-6 dB/oitava); volumes medidos e igualados (~0,35 RMS).
  Somado ao oscilador ANTES do filtro e do ENV 1. Nível = parâmetro `ruido` (0–1), também
  destino de modulação ('ruido'); opções `ruidoLigado` e `ruidoTipo`. Rampa suave ao ligar.
- Aba OSC com 4 colunas: OSC A (1,35) · OSC B · OSC C · Ruído (0,8).
- OSC A: botão On/Off (opção `oscLigado`) no cabeçalho e knob Nível (parâmetro `nivelOsc`,
  destino de modulação 'nivelOsc' = tremolo). Rampa suave; desligado não é calculado
  (8×8: 21% → 15%). Desligado + Ruído ligado = sons só de ruído.
- Presets exportados como `mysynth-presets.synth` (JSON por dentro, tipo octet-stream para o
  navegador não trocar a extensão). Importar aceita qualquer arquivo e confere o conteúdo
  (.synth e .json antigos).

**Item 6b (mais wavetables + seletor) — feito e aprovado:**
- `wavetable.js` reescrito: frames descritos por harmônicos (a = cosseno, b = seno) e
  montados com FFT (rápido: < 50 ms por tabela). `harmonicosDeAmostras()` faz o caminho
  inverso (onda → harmônicos): base para importar .wav na 6c.
- Catálogo `WAVETABLES` (montadas na 1ª vez que são pedidas): Básica (4), PWM (8, pulso
  50%→5%), Harmônicos (8, 1→256 harmônicos), Formante (5, vogais A E I O U, formantes
  calculados para ~110 Hz), Sync (8, razão 1×→6×). Todas do zero, por fórmula.
- Cada tabela tem `atalhos` próprios e, se tiver, `nomesFrames`.
- A wavetable é `opcoes.wavetable` (entra nos presets). Seletor ‹ Nome › no cabeçalho do OSC A.
- Troca com nota tocando: o motor abaixa as notas (~3 ms), troca e sobe (sem estalo).
- Celular deitado: OSC A = [A ‹ wavetable ›] / desenho / WT Pos / unison (atalhos escondidos).
- Medido: chiado em C7 entre -85 e -101 dB nas 5 tabelas.

**Efeitos E2 (Compressor) — feito, em teste:**
- `dsp/efeitos/compressor.js`: estéreo ligado (mesma redução nos 2 lados), detector de pico,
  joelho suave de 6 dB. Threshold (-40–0 dB, padrão -18), Ratio (1–20, padrão 4), Attack
  (0,1–100 ms), Release (10 ms–1 s), Ganho (-12 a +24 dB) por cima da compensação automática
  (metade da redução que um som em 0 dB teria), Mix (paralelo, `ganhosMix`). Dorme desligado.
- Cadeia: Distorção → Compressor → Chorus → Delay → Reverb.
- Medidor: o motor manda `{ tipo: 'compressor', reducao }` ~30×/s enquanto ele está acordado
  (maior redução do período) e 0 quando dorme; a tela mostra barra laranja (0–20 dB) + número.
- Aba FX: 5 cartões lado a lado (`.modulos-fx`, 160 px cada a 852 px); chaves On/Off (antes
  "Ligado/Desligado"), botões e espaços mais justos no celular deitado. Em pé: 1 coluna.
- Medido: 0 dB de entrada, -18 dB/4:1 → -13,2 dB sem compensação (conta: -13,5) e -6,5 dB com
  a compensação automática; medidor mostra ~-12 a -15 dB tocando e volta a 0 ao desligar;
  852×340/393 e em pé sem cortes.

**Efeitos E1 (knobs novos nos 4 efeitos) — feito, em teste:**
- Distorção: Tom (`tom`, 1 = aberto; menos = passa-baixas até ~800 Hz no distorcido) e Low Cut
  (`lowcut`, antes de distorcer, 20 Hz = desligado).
- Chorus: Delay (`atraso`, 5–30 ms, padrão 12 ms, anda suave), Feedback (`feedback`, 0–90%:
  com Delay curto vira flanger), Width (`width`).
- Delay: Low Cut (`lowcut`, 20 = desligado) e High Cut (`highcut`, padrão 6 kHz = o fixo de
  antes) nas repetições; Width dos ecos.
- Reverb: Pre-delay (`predelay`, 0–200 ms), Low Cut (`lowcut`, padrão 120 Hz = o fixo de antes),
  Width da cauda.
- `dsp/efeitos/comum.js`: `coefPolo()` (filtro de 1 polo) e `aplicarWidth()` (meio/lados).
  Valores iniciais = som de antes; Width 100%, Low Cut 20 Hz e Tom aberto nem são calculados.
- Tela: knobs em até 2 linhas de 3 por cartão (`[data-knobs-efeito]`). 852×340/393 e em pé ok.
- Medido: os 4 efeitos ligados com os valores iniciais = motor antigo (diferença 0); Reverb
  Width 0 = cauda mono; Pre-delay 150 ms = silêncio até ~150 ms; Delay Low Cut 800 Hz: 2º eco
  -8 dB, 3º -10 dB; Chorus Feedback 90% estável; Tom 0 escurece a Distorção.

**PWA completo (funciona sem internet) — feito e aprovado (Android, app instalado pelo Chrome):**
- `sw.js` (service worker, registrado no principal.js): na instalação guarda os arquivos do app
  (lista ARQUIVOS) + todos os presets de `presets/lista.json`. A cada pedido: REDE PRIMEIRO
  (até 3 s) e atualiza a cópia; sem rede, usa a cópia. Assim, com internet sempre vem a versão
  nova (bom para a fase de testes); sem internet abre a última versão aberta.
  Arquivo novo no app: colocar na lista ARQUIVOS do sw.js (senão só é guardado quando usado).
  Mudança grande de guardar: trocar o nome da GAVETA ('mysynth-arquivos-v1' → v2).
- `manifest.json` ganhou "id". Ícones 192 e 512 (512 também "maskable").
- Medido (servidor desligado): app abre, 11 presets na lista, motor de som liga.

**Warp W2 (FM entre osciladores) — feito e aprovado:**
- Modos novos no Warp: 'fmA', 'fmB', 'fmC' (cada oscilador mostra só os outros dois: "FM ← B").
  Modulação de FASE (como DX7/Serum): leitura = fase + índice × som do modulador; índice =
  Warp × 2 ciclos (`INDICE_FM_MAXIMO`). O knob Warp (e o destino "Warp A/B/C") é a força.
- Modulador = o outro oscilador (wavetable, WT Pos e afinação DELE, uma cópia sem unison),
  calculado 1× por nota em taxa dobrada (`prepararModulador`, fase recomeça em 0 a cada nota)
  e usado por todas as cópias de unison. Funciona mesmo com o modulador em Off.
- Versão da onda da portadora escolhida pela aceleração 1 + 2π·índice·razão (FM forte deixa a
  portadora com menos harmônicos, como um seno — é o normal do FM).
- Desenho: um ciclo da portadora empurrado pelo modulador na razão das alturas.
- Medido: B em Oct +1 (2:1) → componentes em 220, 660, 1100, 1540 Hz e nada em 440 (-135 dB);
  chiado até 15 kHz entre -78 e -101 dB (só 2:1 no máximo em C7: -48 dB); peso 8×8 com FM ~57%
  (Bend ~47%, sem Warp ~19%); presets antigos idênticos.

**Ruído: One Shot, Track, Pitch e "1 ruído" — feito e aprovado:**
- `dsp/ruido.js`: o ruído virou "sample" (estilo Serum): o motor monta UMA vez um trecho de 4 s
  por tipo (White/Pink/Brown, mesmo gerador de antes) com emenda suave (fim → começo, mistura
  de 4096 amostras; medido: salto na volta menor que um salto normal do Brown). A voz toca o
  trecho com interpolação na velocidade 2^(semitons/12).
- Opções: `ruidoModo` ('loop' | 'oneshot'), `ruidoDuracao` (One Shot, 5 ms–2 s até -60 dB),
  `ruidoTrack` (a cor acompanha a nota; base C4 = velocidade normal), `ruidoPitch` (±24 st),
  `ruidoUnico` (padrão true: acordes com um ruído só — a voz da nota mais recente é a "dona",
  `ruidoDona` no motor; as outras somem em ~5 ms).
- One Shot: nota nova (com ataque) recomeça o trecho do início (todo ataque igual); Loop recomeça
  de um ponto sorteado. Legato não recomeça.
- Tela (cartão Ruído): [‹ tipo ›][rota] / [Loop | One Shot] / knobs Nível, Duração (apagado em
  Loop), Pitch / chaves [Track] [1 ruído]. Cabe a 852×340, 852×393 e em pé.
- Medido: acorde de 4 notas com "1 ruído" = volume de 1 nota (-15,3 × -15,2 dB; sem ele,
  -9,2 dB); One Shot 100 ms: -24 dB no ataque, -80 dB em 100 ms; Track com Pink: brilho médio
  741 Hz (C2) → 4582 Hz (C6). Presets antigos com ruído: acordes agora com um ruído só (pedido)
  e o ruído vem do trecho (mesma cor, não idêntico amostra a amostra).
- Nos synths reais: Serum (oscilador de ruído com One Shot e keytrack) e Vital (sample com
  keytrack/loop) fazem parecido; "1 ruído no acorde" é menos comum (lá cada nota tem o seu).

**Warp W1 (Sync, Bend +, Bend −, PWM) — feito e aprovado:**
- `dsp/warp.js` (só contas, usado pelo motor e pelo desenho): lê a onda na posição
  faseWarp(fase). Sync = corre 1×–8× dentro do ciclo; Bend ± = curva k·f/(1+(k−1)·f) (k 1–8,
  só uma divisão por leitura); PWM = onda apertada em até 10% do ciclo, resto parado.
- Opções `warpModoOsc` (+B/C: 'nenhum', 'sync', 'bendMais', 'bendMenos', 'pwm') e parâmetro
  `warpOsc` (+B/C, 0–1), destino de modulação "Warp A/B/C" (índices 32–34).
- Motor: com Warp, o oscilador lê em taxa DOBRADA e volta com o filtro meia-banda
  (`dsp/meia-banda.js`, agora compartilhado com a Distorção); versão da onda escolhida como se
  a nota fosse "aceleração" × mais aguda. Troca de modo = "abaixa, troca e sobe" (como a
  wavetable; reenviar o mesmo modo não faz nada). Warp "nenhum" = conta de antes (idêntico).
- Tela: página Mais = linha "Warp ‹ Modo ›" + knobs Pan, Blend, Phase, Rand, Warp; o desenho
  mostra a onda deformada (ao vivo com modulação).
- Medido: presets antigos e Distorção idênticos; chiado até 15 kHz (Serra): Sync/Bend -46 a
  -99 dB; PWM limpo até C6 (-55 dB), no máximo em C7 -30 dB (resto do chiado fica entre 18 e
  22 kHz). Testado e descartado: 4× (não melhorava o audível e pesava o dobro) e escolher a
  onda pelo limite da taxa alta (chiava). Peso 8 notas × 8 cópias: sem Warp 19%, com Warp
  ~46–50%. Troca de modo com nota segurada sem estalo. Telas 852×340/393 e em pé sem cortes.

**Exportar um preset só — feito e aprovado:**
- Lista de presets: botão ⤓ em cada preset (inclusive os de fábrica) → baixa "<Nome>.synth"
  só com ele (+ wavetables importadas que ele usa). O botão do rodapé virou "Exportar todos
  os meus" (arquivo único `mysynth-presets.synth`). `baixarSynth()` em interface/presets.js.

**Osciladores: Pan, Blend, Phase, Rand + página "Mais" — feito e aprovado:**
- Pan (`panOsc`, -1 a 1, parâmetro suave) e Blend (`blendOsc`, 0 a 1, padrão 1 = todas as
  cópias iguais) + B/C; ambos destinos de modulação ("Pan A", "Blend B"...; índices 26–31).
  Phase (`faseOsc`, 0 a 1 = 0°–360°) e Rand (`randOsc`, padrão 1) + B/C são opções (valem no
  início da nota).
- Motor: início de cada cópia = Phase + Rand × sorteio da voz (o sorteio é o mesmo para os 3
  osciladores); aplicado no 1º bloco da nota (`fasesPendentes` na voz). Pan soma à posição
  de cada cópia no estéreo (potência igual). Blend: cópias do meio (1 se Unison ímpar, 2 se
  par) × cópias de fora com volume Blend × o do meio, potência total constante.
- Tela: o título do cartão ("A ⋯") é um botão que alterna a página Onda / Mais (Pan, Blend,
  Phase, Rand). Só tela, não vai no preset. Na página Mais a onda cresce (86 px a 852×340).
- Medido: presets antigos idênticos; Pan -1 = só esquerda (L 1,0 / R 0), 0,5 = 0,38/0,92;
  Blend 50% = cópias de fora -6 dB, 25% = -12 dB, 0% = somem, volume total igual;
  Rand 0% = notas idênticas com sorteios diferentes; Phase 90° = onda adiantada 1/4 de ciclo.

**Presets em pastas (.synth) — feito e aprovado:**
- `presets-fabrica.js` saiu; os 10 presets de fábrica viraram arquivos em `presets/fabrica/`
  (um .synth por preset, mesmo formato do Exportar; conferidos idênticos aos antigos).
- `presets/usuario/`: .synth seus levados para o projeto (vão junto no app publicado).
  Aparecem com a marca "meu", sem lixeira. LEIA-ME.txt explica como colocar.
- `presets/lista.json`: categorias + nomes dos arquivos de cada pasta (o site não lista pastas).
- Ao abrir, o app busca tudo em paralelo (espera antes as wavetables guardadas no aparelho,
  porque um .synth pode trazer wavetables importadas). Arquivo que falhar = recado na tela;
  sem a lista, o app funciona só com o Init.

**Consertos pequenos (24/09/2026) — feito e aprovado:**
- Celular em pé: a barra de cima volta a ter 2 linhas ([presets · Ligar som] / [oitava ·
  volume]). Causa: presets e volume com largura base 0 → tudo tentava caber numa linha e o
  volume saía da tela. Agora presets = `calc(100% - 110px)`, volume = 120 px de base;
  Ligar som e Salvar mais estreitos. Medido: 393 e 360 px sem rolagem lateral.
- Safari deitado (altura ≤ 360 px): barra de cima, abas e linhas do cartão do oscilador
  alguns px mais baixas → desenho da onda 22 → 42 px. App instalado (852×393) igual.

**Modulação da afinação (Oct, Semi, Fine) — feito e aprovado:**
- 9 destinos novos no fim de `DESTINOS_MOD`: oitavaOsc, semiOsc, fineOsc (+ B, C); nomes na
  lista "Oct A", "Semi B", "Fine C"... `DESTINOS_OSC` ganhou oitava/semi/fine.
- Faixa como nos knobs (100% = faixa toda: Oct 6 oitavas, Semi 24 semitons, Fine 200 cents).
  Oct e Semi em DEGRAUS (arredondados; decidido: opção A, estilo Serum); Fine contínuo.
  Motor: `OsciladorVoz.afinacao()` por pedaço; sem modulação = conta de antes (idêntico).
- Seletor ‹ N › aceita `destino`: linha colorida embaixo + número ao vivo na cor da fonte.
- Lista de ligações: Oct/Semi/Fine mostram a quantidade na própria medida ("+1 oct", "+7 st",
  "+25 ct") e a barra anda de 1 em 1 unidade (`MEDIDAS` em interface/modulacao.js). Ao ligar:
  Oct +1 oct, Semi +12 st, Fine +50 ct. Os outros destinos seguem em %.
- Medido: Semi com LFO quadrado ±7 pula direto 659 ↔ 294 Hz (nada parado em 440); Fine com
  LFO ±50 = 427,5 a 452,9 Hz; Oct com ENV 2 começa uma oitava acima e volta; presets idênticos.

**Aviso do limitador — feito e aprovado:**
- Recado na tela ("Limitador agindo: ... abaixado ~X dB. Abaixe o Nível dos osciladores ou o
  Volume.") quando o som passa do limiar (-3 dB); no máximo um aviso a cada 6 s; some em 4 s.
- Como mede: um AnalyserNode logo ANTES do limitador (depois do volume geral), lido a cada
  50 ms (4096 amostras ≈ 85 ms, nenhum pico escapa). Só escuta, não muda o som.
- Por que não usar `limitador.reduction`: medido no Chrome, o DynamicsCompressor mostra
  ~-20 dB de redução em silêncio logo ao ligar e solta bem mais devagar que o "release" de
  0,1 s (> 1 s). Proposto trocar por um limitador próprio no motor; decidido manter o do
  navegador por enquanto (ideia guardada).

**Item 6d-3 (afinação por oscilador) — feito e aprovado. Item 6d (3 osciladores) completo.**
- Oct (-3 a +3) e Semi (-12 a +12) são opções (`oitavaOsc`, `semiOsc`, + B/C); Fine é parâmetro
  suave em centésimos (`fineOsc`, + B/C, -100 a +100). Motor: `ajustes.transposicao` =
  Oct×12 + Semi + Fine/100 (semitons), aplicada na frequência de cada oscilador.
- Proteção: cópia acima de 0,45 × taxa (~21,6 kHz) some suavemente (em vez de chiar) e o passo
  de leitura é limitado (nunca pula um ciclo). Ex.: C8 com Oct +3 = silêncio, sem chiado.
- Tela: linha "Oct ‹ 0 › Semi ‹ 0 › Fine ‹ 0 ›" em cada oscilador (números com sinal, ex.: +7).
  Seletor ganhou `pixelsPorPasso` (Fine: 2 px) e `formatar`, e toque duplo = valor inicial.
  Celular deitado: sem os botões ‹ › (arrastar no número); cartão com 5 linhas bem justo
  (onda 22 px a 852×340, 64 px a 852×393).
- Medido: A4 com Oct -1 = 220 Hz; Semi +7 = 659,2 Hz; Fine +50 = 452,9 Hz; presets antigos
  idênticos; 852×340, 852×393 e em pé sem cortes.

**Item 6d-2 (OSC B e C funcionando) — feito e aprovado (com a correção do volume por nota):**
- Os 3 osciladores são iguais: wavetable (fábrica ou importada), On/Off, Nível, WT Pos, rota
  de filtro, Unison/Detune/Width. B e C começam desligados (presets antigos soam iguais).
- Nomes: A sem letra (wtPos, detune, width, nivelOsc, wavetable, oscLigado, unison, rotaOsc);
  B/C com a letra (wtPosB, detuneC, nivelOscB, wavetableC, oscBLigado, unisonB, rotaOscC...).
  Destinos de modulação novos no FIM de `DESTINOS_MOD` (índices antigos não mudam);
  `DESTINOS_OSC` diz os índices de cada oscilador. Nomes na lista: "WT Pos A/B/C", "Nível A"...
- Motor: cada oscilador tem `ajustes` (tabela, unison, ligado, nivel, ganho, rota) enviados às
  vozes. Mensagem `wavetable` tem `osc: 'A'|'B'|'C'`. Troca de wavetable: ganho 0 só naquele
  oscilador (desce em ~5 ms), troca quando todas as notas estão em silêncio, volta.
- Voz: "caixas" por rota (f1, f2, f12, f21): cada fonte soma o som na caixa da sua rota e só as
  caixas usadas passam pelos filtros. Oscilador desligado não calcula nada.
- Tela: cartões com `data-osc="A|B|C"` e peças `data-wt-nome`, `data-tela-onda`, `data-wt-pos`,
  `data-knobs-osc`...; `montarOscilador()` no principal.js liga tudo. Uma janela de wavetables
  para os 3 (`abrir(osc)`, título "Wavetables · OSC B"). Aba OSC: 4 colunas 1 : 1 : 1 : 0,8.
  Oscilador desligado = desenho apagado.
- Medido: presets antigos idênticos ao motor antigo (diferença 0 com sorteio fixo); B e C
  idênticos ao A com os mesmos ajustes; troca de wavetable no B sem estalo e o A não baixa.
  Peso 8 notas × 8 cópias: 1 oscilador ≈ 22%, 3 osciladores ≈ 40%.
  852×340 e 852×393 sem rolagem; cada cartão ~213 px de largura.
- Achado (já existia antes): celular em pé, a barra de volume passava ~30 px da tela
  (rolagem lateral) — corrigido em "Consertos pequenos" (abaixo).
- Correção (volume diferente a cada nota com A + B): o ponto de início das cópias era sorteado
  separado por oscilador; na mesma altura, as ondas somavam ou se cancelavam conforme a sorte
  (variação medida: 6 dB). Agora a voz faz UM sorteio por nota (`fasesSorteadas`) e os 3
  osciladores usam os mesmos pontos → variação 0 dB. Presets antigos seguem idênticos.

**Item 6d-1 (arrumação: oscilador separado da voz) — feito e aprovado (presets iguais):**
- `dsp/oscilador-voz.js` (classe `OsciladorVoz`): cópias de unison, WT Pos, nível e as suas
  somas (somaE/somaD); recebe os índices de modulação dele (wtPos, detune, width, nivel).
  A voz tem `oscA` e chama `processarPedaco()` a cada pedaço de 32 amostras.
- Medido: som idêntico ao anterior (diferença 0 amostra a amostra em 5 cenários, com o
  sorteio de fases fixado); peso igual (8×8 com filtro ≈ 20%).
- Teste A/B: cópia do motor antigo em `_antigo/` (fora do Git, via .git/info/exclude).

**Item 6c-3 (wavetables junto no .synth) — feito e aprovado. Item 6c completo.**
- Exportar presets leva as importadas que eles usam: arquivo versão 2 =
  { app, versao, presets, wavetables: [{ nome, tamanho, amostras (Float32 em base64) }] }.
  Uma tabela de 8 frames ≈ 90 KB no arquivo (64 frames ≈ 700 KB). Sem indentação no JSON.
- Importar: tabela nova entra e é guardada; igual (mesmo nome e mesma onda) não duplica;
  mesmo nome com onda diferente entra como "Nome (2)" e os presets do arquivo são ajustados.
  Arquivos .synth/.json antigos (versão 1) continuam valendo.
- `presets.js` continua genérico: recebe `extrasExportar` e `receberExtras` (ligados no principal.js).

**Item 6c-2 (wavetables importadas guardadas no aparelho) — feito e aprovado:**
- `interface/armazem-wavetables.js`: IndexedDB (banco 'mysynth', gaveta 'wavetables', chave =
  nome). Guarda só os ciclos usados (≤ 64, ~0,5 MB por tabela); montagem anti-chiado na hora
  de usar. Pede `navigator.storage.persist()` ao guardar.
- Ao abrir o app, `carregarWavetablesGuardadas()` põe as guardadas no catálogo (montagem
  preguiçosa). "Minhas" em ordem alfabética. 🗑 apaga (com confirmação); se era a que estava
  tocando, volta para a Básica.
- Preset com importada que não existe no aparelho → abre com a Básica + recado
  (`mostrarRecado()` em `interface/janela.js`: bolha que some sozinha, não empurra o layout).
- Falha ao guardar (ex.: janela anônima): a tabela funciona até fechar, com aviso.
- iPhone: o Safari pode apagar dados de sites não usados por ~7 dias; o app instalado
  na Tela de Início não tem esse limite. Backup completo virá na 6c-3 (junto no .synth).

**Item 6c-1 (importar wavetable .wav) — feito e aprovado:**
- Tocar no nome da wavetable (OSC A) abre a lista: Fábrica, Minhas (importadas) e
  "Importar .wav". As setas ‹ › passam por todas.
- `importar-wav.js` (só contas): lê PCM 8/16/24/32 bits e float 32/64; estéreo vira mono.
  Tamanho do ciclo: marca "clm " do Serum ("<!>2048") → múltiplo de 2048 → arquivo curto
  (até 8192 pontos) = ciclo único (ex.: 600 pontos) → senão, aviso (sample comum fica p/ depois).
- `wavetable.js`: `harmonicosDeCiclo()` (qualquer tamanho, sem esticar a onda),
  `criarWavetableDeCiclos()` (volume ajustado pela tabela inteira), `registrarImportada()`,
  `listaWavetables()`. Máximo 64 frames (tabelas maiores: frames espalhados por igual).
  Id das importadas = 'wav:' + nome; mesmo nome substitui. Id desconhecido → Básica.
- Por enquanto as importadas somem ao fechar o app (guardar = 6c-2; ir junto no .synth = 6c-3).
- A janela virou módulo próprio (`interface/janela.js`), usada por presets e wavetables.
- Medido: 256 frames de 2048 → ~40 ms para montar; chiado em C7/C8 entre -89 e -100 dB.

**Teclado do computador — feito:**
- Padrão FL Studio, pela posição da tecla (`evento.code`, funciona em ABNT e americano):
  Q W E R T Y U I O P [ ] = brancas a partir do 1º C da tela; 2 3 5 6 7 9 0 = = pretas;
  Z X C V B N M (+ S D G H J) = uma oitava abaixo. Botões de oitava mudam tudo junto.
- Segurar não repete; Ctrl/Cmd/Alt e campos de texto são ignorados; perder o foco da
  janela solta tudo; trocar de oitava com tecla apertada não deixa nota presa.
- Letras aparecem nas teclas da tela só em telas com mouse (`@media (hover: none)` esconde).

**Online (GitHub Pages) — no ar desde 23/09/2026:**
- Endereço: https://jjsantosyt-byte.github.io/MySynth/
- Repositório público: https://github.com/jjsantosyt-byte/MySynth (branch `main`, pasta raiz).
- Publicar = commit + `git push`; o Pages atualiza sozinho em ~1 minuto.
- Commits usam o e-mail "fantasma" do GitHub (333051203+jjsantosyt-byte@users.noreply.github.com);
  o histórico foi reescrito para tirar o e-mail pessoal. Nunca usar o e-mail pessoal no Git.

**Pendências:**
- Testar no celular: som, peso (acordes + unison) e latência.
- Visualização em perspectiva (frames empilhados) fica para a fase de aparência.
- Próximo: item 6 (presets e wavetables próprias).
