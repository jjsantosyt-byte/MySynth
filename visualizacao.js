// visualizacao.js
// Desenha a forma de onda atual num painel (canvas).

// Cores do desenho (combinam com as de estilo.css)
const COR_ONDA = '#3fb8ff';
const COR_BRILHO = 'rgba(63, 184, 255, 0.7)';
const COR_LINHA_ZERO = '#3d4661';

// "amostras" é um ciclo da onda, com valores entre -1 e 1.
export function desenharOnda(canvas, amostras) {
  const escalaTela = window.devicePixelRatio || 1;
  const largura = canvas.clientWidth;
  const altura = canvas.clientHeight;
  if (largura === 0 || altura === 0) return; // aba escondida: não desenha

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
  const amplitude = meio * 0.8; // deixa uma folga em cima e embaixo

  // Linha do zero (silêncio).
  g.strokeStyle = COR_LINHA_ZERO;
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

  // Preenchimento até a linha do zero: mais forte longe do zero, some perto dele.
  const degrade = g.createLinearGradient(0, 0, 0, altura);
  degrade.addColorStop(0, 'rgba(63, 184, 255, 0.35)');
  degrade.addColorStop(0.5, 'rgba(63, 184, 255, 0.04)');
  degrade.addColorStop(1, 'rgba(63, 184, 255, 0.35)');
  tracarOnda();
  g.lineTo(largura, meio);
  g.lineTo(0, meio);
  g.closePath();
  g.fillStyle = degrade;
  g.fill();

  // Traço da onda, com um leve brilho em volta.
  tracarOnda();
  g.save();
  g.shadowColor = COR_BRILHO;
  g.shadowBlur = 8;
  g.strokeStyle = COR_ONDA;
  g.lineWidth = 2.5;
  g.lineJoin = 'round';
  g.stroke();
  g.restore();
}
