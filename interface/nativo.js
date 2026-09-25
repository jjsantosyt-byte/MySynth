// interface/nativo.js
// O que só existe quando o MySynth roda como APP Android (Capacitor). No navegador (GitHub
// Pages, PWA) nada disto faz efeito.
// O Capacitor põe o objeto window.Capacitor na página do app; os plugins (como o "App")
// são pegos por ele — o projeto não tem etapa de build, então não há "import" do Capacitor.

const capacitor = window.Capacitor;

// true = rodando dentro do app Android
export const NATIVO = !!capacitor?.isNativePlatform?.();

function pluginApp() {
  if (!NATIVO) return null;
  return capacitor.Plugins?.App || capacitor.registerPlugin?.('App') || null;
}

// opcoes:
//   fecharAlgo(): fecha o que estiver aberto por cima (janela, menu, painel...);
//                 devolve true se fechou algo, false se já estava na tela principal
//   aoIrParaFundo(): o app saiu da tela (outro app, tela bloqueada)
//   aoVoltar(): o app voltou para a tela
export function ligarNativo({ fecharAlgo, aoIrParaFundo, aoVoltar }) {
  const app = pluginApp();
  if (!app) return;
  // Botão voltar do Android: fecha o que está aberto; na tela principal, sai do app
  app.addListener('backButton', () => {
    if (!fecharAlgo()) app.exitApp();
  });
  // Segundo plano: pausa/retoma o som (além do "visibilitychange" da página)
  app.addListener('appStateChange', ({ isActive }) => {
    if (isActive) aoVoltar();
    else aoIrParaFundo();
  });
}
