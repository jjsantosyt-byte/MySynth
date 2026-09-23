// visualizacao.js
// Desenha a forma de onda atual num painel (canvas).

// "amostras" é um ciclo da onda, com valores entre -1 e 1.
export function desenharOnda(canvas, amostras) {
  const escalaTela = window.devicePixelRatio || 1;
  const largura = canvas.clientWidth;
  const altura = canvas.clientHeight;
  if (largura === 0 || altura === 0) return;

  // Ajusta a resolução para ficar nítido em telas de celular.
  const larguraReal = Math.round(largura * escalaTela);
  const alturaReal = Math.round(altura * escalaTela);
  if (canvas.width !== larguraReal || canvas.height !== alturaReal) {
    canvas.width = larguraReal;
    canvas.height = alturaReal;
  }

  const g = canvas.getContext('2d');
  g.setTransform(escalaTela, 0, 0, escalaTela, 0, 0);
  g.clearRect(0, 0, largura, altura);

  const meio = altura / 2;
  const amplitude = meio * 0.85; // deixa uma folga em cima e embaixo

  // Linha do zero (silêncio).
  g.strokeStyle = '#2c2e36';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, meio);
  g.lineTo(largura, meio);
  g.stroke();

  // Caminho da onda: um ponto a cada meio pixel.
  const total = amostras.length;
  const pontos = Math.max(2, Math.floor(largura * 2));
  const tracarOnda = () => {
    g.beginPath();
    for (let k = 0; k <= pontos; k++) {
      const indice = Math.min(total - 1, Math.floor((k / pontos) * total));
      const x = (k / pontos) * largura;
      const y = meio - amostras[indice] * amplitude;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  };

  // Preenchimento suave até a linha do zero...
  tracarOnda();
  g.lineTo(largura, meio);
  g.lineTo(0, meio);
  g.closePath();
  g.fillStyle = 'rgba(143, 211, 255, 0.12)';
  g.fill();

  // ...e depois o traço da onda por cima.
  tracarOnda();
  g.strokeStyle = '#8fd3ff';
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.stroke();
}
