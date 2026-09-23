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

**Arquivos:**
- `index.html`, `estilo.css` — a página e a aparência
- `principal.js` — liga o som, teclado, toques, abas e controles
- `processador-synth.js` — motor de som (AudioWorklet)
- `dsp/envelope.js`, `dsp/filtro.js` — envelope ADSR e filtro (usados pelo motor)
- `interface/knob.js` — knob reutilizável (escalas e formatos de número)
- `wavetable.js` — monta as wavetables (frames × níveis anti-aliasing)
- `visualizacao.js` — desenha a onda, o envelope e a curva do filtro
- `servidor.ps1` + `Iniciar.bat` — servidor local para testar no computador (http://localhost:8080)

**Pendências:**
- Teste no celular exige endereço https (ex.: GitHub Pages).
- Visualização em perspectiva (frames empilhados) fica para a fase de aparência.
- Próximo: item 3 (unison, polifonia e detune).
