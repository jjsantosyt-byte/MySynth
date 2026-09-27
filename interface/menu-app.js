// interface/menu-app.js
// Logo do app (canto superior esquerdo): tocar abre um PAINEL LATERAL (sai da esquerda, altura
// toda da tela, o resto escurece) com
//   - Configurações (janela: idioma, tema e medidor de desempenho; as outras opções vêm depois)
//   - Sobre o MySynth
//   - Política de privacidade (link para privacidade.html)
// Fecha tocando fora, tocando na logo de novo ou com Esc.

import { criar, criarJanela } from './janela.js';
import { IDIOMA, mudarIdioma } from './idioma.js';
import { TEMA, TEMAS, NOMES_TEMAS, mudarTema } from './tema.js';
import { medidor } from './medidor.js';

export function criarMenuApp() {
  const botao = document.getElementById('botao-logo');
  const menu = document.getElementById('menu-logo');

  // ---------- Painel lateral ----------
  // Vai para o fim da página (fica por cima de tudo, fora da barra de cima), com um fundo
  // escurecido atrás e a logo + "MySynth" no topo.
  const fundo = criar('div', 'menu-fundo');
  fundo.hidden = true;
  const cabecalho = criar('div', 'menu-cabecalho');
  cabecalho.innerHTML = botao.innerHTML;
  cabecalho.appendChild(criar('span', 'menu-nome', 'MySynth'));
  menu.prepend(cabecalho);
  document.body.append(fundo, menu);

  const abrir = () => {
    menu.hidden = false;
    fundo.hidden = false;
    botao.setAttribute('aria-expanded', 'true');
    botao.classList.add('aberto');
  };
  const fechar = () => {
    menu.hidden = true;
    fundo.hidden = true;
    botao.setAttribute('aria-expanded', 'false');
    botao.classList.remove('aberto');
  };
  botao.addEventListener('click', () => (menu.hidden ? abrir() : fechar()));
  // Tocar fora fecha (tocar na logo é tratado pelo clique acima)
  document.addEventListener(
    'pointerdown',
    (evento) => {
      if (!menu.hidden && !menu.contains(evento.target) && !botao.contains(evento.target)) fechar();
    },
    true
  );
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !menu.hidden) fechar();
  });

  menu.querySelectorAll('[data-acao]').forEach((item) => {
    item.addEventListener('click', () => {
      fechar();
      const acao = item.dataset.acao;
      if (acao === 'configuracoes') abrirConfiguracoes();
      else if (acao === 'sobre') janelaSobre.abrir();
    });
  });

  // ---------- Janela: Configurações ----------
  const janelaConfig = criarJanela('Configurações');
  const secaoIdioma = criar('section', 'config-secao');
  secaoIdioma.appendChild(criar('h3', 'config-titulo', 'Idioma · Language'));
  const grupoIdioma = criar('div', 'grupo-botoes config-idioma');
  const botoesIdioma = [
    ['pt', 'Português'],
    ['en', 'English'],
  ].map(([codigo, nome]) => {
    const b = criar('button', 'botao', nome);
    b.dataset.idioma = codigo;
    // Trocar o idioma recarrega o app já no idioma novo
    b.addEventListener('click', () => mudarIdioma(codigo));
    grupoIdioma.appendChild(b);
    return b;
  });
  secaoIdioma.appendChild(grupoIdioma);
  const marcarIdioma = () => {
    for (const b of botoesIdioma) b.classList.toggle('escolhido', b.dataset.idioma === IDIOMA);
  };

  // Tema (trocar recarrega o app já no tema novo)
  const secaoTema = criar('section', 'config-secao');
  secaoTema.appendChild(criar('h3', 'config-titulo', 'Tema'));
  const grupoTema = criar('div', 'grupo-botoes config-tema');
  const botoesTema = TEMAS.map((tema) => {
    const b = criar('button', 'botao', NOMES_TEMAS[tema]);
    b.dataset.tema = tema;
    b.addEventListener('click', () => mudarTema(tema));
    grupoTema.appendChild(b);
    return b;
  });
  secaoTema.appendChild(grupoTema);
  const marcarTema = () => {
    for (const b of botoesTema) b.classList.toggle('escolhido', b.dataset.tema === TEMA);
  };

  // Medidor de desempenho: chave On/Off (caixinha no canto da tela; ver medidor.js)
  const secaoMedidor = criar('section', 'config-secao');
  const topoMedidor = criar('div', 'config-linha');
  topoMedidor.appendChild(criar('h3', 'config-titulo', 'Medidor de desempenho'));
  const chaveMedidor = criar('button', 'chave');
  const marcarMedidor = () => {
    chaveMedidor.setAttribute('aria-pressed', medidor.ligado);
    chaveMedidor.textContent = medidor.ligado ? 'On' : 'Off';
    chaveMedidor.setAttribute(
      'aria-label',
      `${medidor.ligado ? 'Ligado' : 'Desligado'}: toque para ${medidor.ligado ? 'desligar' : 'ligar'}`
    );
  };
  chaveMedidor.addEventListener('click', () => {
    medidor.ligar(!medidor.ligado);
    marcarMedidor();
  });
  topoMedidor.appendChild(chaveMedidor);
  secaoMedidor.append(
    topoMedidor,
    criar(
      'p',
      'config-texto',
      'Mostra no canto da tela quanto o motor de som está ocupado (100% = no limite), os atrasos do som (engasgos) e as travadas da tela. Ligar de novo zera os números.'
    )
  );

  const secaoBreve = criar('section', 'config-secao');
  secaoBreve.appendChild(criar('h3', 'config-titulo', 'Em breve'));
  secaoBreve.appendChild(
    criar('p', 'config-texto', 'Tamanho do teclado e oitavas, letras do teclado do computador, qualidade do som, vibração e restaurar tudo.')
  );
  janelaConfig.corpo.append(secaoIdioma, secaoTema, secaoMedidor, secaoBreve);

  function abrirConfiguracoes() {
    marcarIdioma();
    marcarTema();
    marcarMedidor();
    janelaConfig.abrir();
  }

  // ---------- Janela: Sobre ----------
  const janelaSobre = criarJanela('Sobre o MySynth');
  janelaSobre.corpo.append(
    criar('p', 'config-texto', 'Sintetizador wavetable feito para tocar no celular: 3 osciladores, 2 filtros, 3 LFOs e 2 envelopes arrastáveis e 10 efeitos.'),
    criar('p', 'config-texto', 'Versão beta · setembro de 2026')
  );

  return { fechar };
}
