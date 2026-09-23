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

## Ideias para o futuro (sem data)
- Filtro: opção de ajustar/mostrar o Cutoff em semitons/notas musicais
  (ex.: "C4 + 7 st"), em vez de só Hz. Combina bem com keytracking
  (o Cutoff acompanhar a nota tocada).
- Glide (portamento): a nota "escorrega" até a próxima; ótimo para reese/baixos no modo Mono.
  Lugar reservado: aba Global.
- Qualidade (aba Global): escolher a taxa de amostragem (44,1/48 kHz — exige religar o
  motor de som por um instante) e/ou um modo "qualidade alta" (mais limpo, mais pesado).
- Aviso de proteção no celular ao escolher mais de 8 vozes de unison (pode pesar/estalar).
- Oscilador: knobs Blend (volume das cópias de fora vs. centro), Phase (ponto de início
  da onda) e Rand (quanto esse início é sorteado). Hoje: Blend fixo (todas iguais) e
  fase sorteada a cada nota.
- LFO: desenhar a forma com pontos e curvas (estilo Serum/Vital); sincronismo com BPM
  (1/4, 1/8...) quando existir o sequenciador; talvez LFO 3 e 4.

## Distribuição (caminho combinado)
1. Colocar online (https, ex.: GitHub Pages) e testar no celular. ✔ online (falta o teste no celular)
2. PWA: ícone na tela inicial, tela cheia, funciona sem internet.
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
- `dsp/envelope.js`, `dsp/filtro.js` — envelope ADSR e filtro (usados pelas vozes)
- `dsp/lfo.js`, `dsp/modulacao.js` — LFO e ligações de modulação (dentro do motor)
- `interface/knob.js` — knob reutilizável (escalas e formatos de número)
- `interface/seletor.js` — seletor de número inteiro ‹ N ›
- `interface/modulacao.js` — fichas, arrastar/tocar para ligar, listas de ligações
- `wavetable.js` — monta as wavetables (frames × níveis anti-aliasing)
- `visualizacao.js` — desenha a onda, o envelope e a curva do filtro
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
- Medido: 852×340 (Safari) e 852×393 (instalado) sem rolagem e sem cortes.
- Margens da ilha/câmera: `viewport-fit=cover` + `env(safe-area-inset-*)`.
- PWA básico: `manifest.json`, ícones em `icones/`, metas da Apple → "Adicionar à
  Tela de Início" abre em tela cheia (ganha ~50 px de altura).

**Online (GitHub Pages) — no ar desde 23/09/2026:**
- Endereço: https://jjsantosyt-byte.github.io/MySynth/
- Repositório público: https://github.com/jjsantosyt-byte/MySynth (branch `main`, pasta raiz).
- Publicar = commit + `git push`; o Pages atualiza sozinho em ~1 minuto.
- Commits usam o e-mail "fantasma" do GitHub (333051203+jjsantosyt-byte@users.noreply.github.com);
  o histórico foi reescrito para tirar o e-mail pessoal. Nunca usar o e-mail pessoal no Git.

**Pendências:**
- Testar no celular: som, peso (acordes + unison) e latência.
- Visualização em perspectiva (frames empilhados) fica para a fase de aparência.
- Próximo: item 4 (LFOs e envelopes de modulação com arrastar-e-soltar).
