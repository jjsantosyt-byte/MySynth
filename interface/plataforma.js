// interface/plataforma.js
// Onde o app está rodando:
// - APP_DA_LOJA: app Android feito com o Capacitor (pasta app-android/). Os arquivos do app vão
//   DENTRO do APK e são abertos do próprio celular, no endereço interno https://app.mysynth
//   (não existe na internet). Sem internet nenhuma: o sw.js (modo sem internet do site) não é
//   ligado, e atualizar = nova versão pela loja.
// - senão: navegador (site no GitHub Pages ou app instalado pelo Chrome).
export const APP_DA_LOJA =
  location.hostname === 'app.mysynth' || !!window.Capacitor?.isNativePlatform?.();

// Nome curto para o medidor de desempenho
export const ONDE_RODA = APP_DA_LOJA ? 'App' : 'Navegador';
