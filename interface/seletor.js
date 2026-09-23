// interface/seletor.js
// Caixinha de número inteiro com botões ‹ e › (ex.: Unison, número de vozes).
//
// Como usar na tela:
// - Tocar em ‹ ou › diminui/aumenta 1.
// - Arrastar para cima/baixo em cima do número muda mais rápido.

const PIXELS_POR_PASSO = 16;

// opcoes: { rotulo, min, max, padrao, aoMudar, rotuloAoLado }
// Devolve o elemento; elemento.habilitar(sim/não) liga ou desliga o controle.
export function criarSeletor({ rotulo, min, max, padrao, aoMudar, rotuloAoLado = false }) {
  const elemento = document.createElement('div');
  elemento.className = 'seletor' + (rotuloAoLado ? ' seletor-linha' : '');
  elemento.innerHTML = `
    <div class="seletor-controle">
      <button class="seletor-botao" aria-label="${rotulo}: menos">‹</button>
      <span class="seletor-numero" role="spinbutton" tabindex="0"
        aria-label="${rotulo}" aria-valuemin="${min}" aria-valuemax="${max}"></span>
      <button class="seletor-botao" aria-label="${rotulo}: mais">›</button>
    </div>
    <span class="seletor-rotulo">${rotulo}</span>`;
  if (rotuloAoLado) elemento.prepend(elemento.querySelector('.seletor-rotulo'));

  const [botaoMenos, botaoMais] = elemento.querySelectorAll('.seletor-botao');
  const numero = elemento.querySelector('.seletor-numero');
  let valor = padrao;
  let habilitado = true;

  function mudar(novo) {
    if (!habilitado) return;
    novo = Math.min(max, Math.max(min, Math.round(novo)));
    if (novo === valor) return;
    valor = novo;
    mostrar();
    aoMudar(valor);
  }

  function mostrar() {
    numero.textContent = valor;
    numero.setAttribute('aria-valuenow', valor);
    botaoMenos.disabled = !habilitado || valor <= min;
    botaoMais.disabled = !habilitado || valor >= max;
  }

  botaoMenos.addEventListener('click', () => mudar(valor - 1));
  botaoMais.addEventListener('click', () => mudar(valor + 1));

  // Arrastar em cima do número
  let arraste = null;
  numero.addEventListener('pointerdown', (evento) => {
    evento.preventDefault();
    try {
      numero.setPointerCapture(evento.pointerId);
    } catch {
      // Sem captura, o arraste ainda funciona enquanto o dedo estiver no número.
    }
    arraste = { id: evento.pointerId, y: evento.clientY, inicio: valor };
  });
  numero.addEventListener('pointermove', (evento) => {
    if (!arraste || evento.pointerId !== arraste.id) return;
    mudar(arraste.inicio + (arraste.y - evento.clientY) / PIXELS_POR_PASSO);
  });
  const terminar = (evento) => {
    if (arraste && evento.pointerId === arraste.id) arraste = null;
  };
  numero.addEventListener('pointerup', terminar);
  numero.addEventListener('pointercancel', terminar);

  // Teclado do computador: setas.
  numero.addEventListener('keydown', (evento) => {
    const passos = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
    if (evento.key in passos) {
      evento.preventDefault();
      mudar(valor + passos[evento.key]);
    }
  });

  elemento.habilitar = (sim) => {
    habilitado = sim;
    elemento.classList.toggle('desabilitado', !sim);
    mostrar();
  };

  mostrar();
  aoMudar(valor);
  return elemento;
}
