// interface/envelope-arrastar.js
// Pontos para arrastar no desenho do envelope (ADSR), além dos knobs:
// - Pico (fim do ataque): para os lados = Attack
// - Fim da queda: para os lados = Decay; para cima/baixo = Sustain
// - Soltar a tecla (começo do Release): para cima/baixo = Sustain
// - Fim do Release: para os lados = Release
// Para os lados funciona como o knob (200 px = de ponta a ponta, mesma escala);
// para cima/baixo o ponto segue o dedo. As posições dos pontos vêm do último desenho
// (visualizacao.js guarda em canvas.geometriaEnvelope).

const RAIO_TOQUE = 22; // px: distância máxima do dedo até o ponto para "pegar"
const PIXELS_PONTA_A_PONTA = 200;

const ALCAS = [
  { nome: 'pico', tempo: 'ataque' },
  { nome: 'queda', tempo: 'decaimento', nivel: true },
  { nome: 'soltar', nivel: true },
  { nome: 'fim', tempo: 'soltura' },
];

// opcoes:
//   ler(): { ataque, decaimento, sustentacao, soltura } atuais
//   mudar(nome, valor): muda um deles (som + knobs)
//   escalaTempo: a escala dos knobs de tempo (paraPosicao / paraValor)
//   redesenhar(): pede um desenho novo (o ponto pego aparece aceso)
export function envelopeArrastavel(canvas, { ler, mudar, escalaTempo, redesenhar }) {
  canvas.classList.add('envelope-arrastavel');
  let arraste = null;

  canvas.addEventListener('pointerdown', (evento) => {
    const geometria = canvas.geometriaEnvelope;
    if (!geometria) return;
    const r = canvas.getBoundingClientRect();
    const px = evento.clientX - r.left;
    const py = evento.clientY - r.top;
    // O ponto mais perto do dedo (se estiver perto o bastante)
    let escolhida = null;
    let menor = RAIO_TOQUE;
    for (const alca of ALCAS) {
      const [x, y] = geometria.pontos[alca.nome];
      const distancia = Math.hypot(px - x, py - y);
      if (distancia < menor) {
        menor = distancia;
        escolhida = alca;
      }
    }
    if (!escolhida) return;
    evento.preventDefault();
    try {
      canvas.setPointerCapture(evento.pointerId);
    } catch {
      // Sem captura, o arraste ainda funciona enquanto o dedo estiver no desenho.
    }
    const env = ler();
    arraste = {
      id: evento.pointerId,
      alca: escolhida,
      x0: evento.clientX,
      posicao0: escolhida.tempo ? escalaTempo.paraPosicao(env[escolhida.tempo]) : 0,
      geometria,
    };
    canvas.dataset.alcaAtiva = escolhida.nome;
    redesenhar();
  });

  canvas.addEventListener('pointermove', (evento) => {
    if (!arraste || evento.pointerId !== arraste.id) return;
    const { alca, geometria } = arraste;
    if (alca.tempo) {
      const p = Math.min(1, Math.max(0, arraste.posicao0 + (evento.clientX - arraste.x0) / PIXELS_PONTA_A_PONTA));
      mudar(alca.tempo, escalaTempo.paraValor(p));
    }
    if (alca.nivel) {
      const r = canvas.getBoundingClientRect();
      const nivel = (geometria.base - (evento.clientY - r.top)) / (geometria.base - geometria.alto);
      mudar('sustentacao', Math.min(1, Math.max(0, nivel)));
    }
  });

  const terminar = (evento) => {
    if (!arraste || evento.pointerId !== arraste.id) return;
    arraste = null;
    delete canvas.dataset.alcaAtiva;
    redesenhar();
  };
  canvas.addEventListener('pointerup', terminar);
  canvas.addEventListener('pointercancel', terminar);
}
