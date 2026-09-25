package com.jayjaymusictools.mysynth;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

// Tela do app MySynth: a WebView do Capacitor com os arquivos do app dentro (sem internet).
// - Tela cheia "imersiva": esconde as barras do Android (voltam deslizando da borda).
// - O som pode tocar sem exigir um toque antes (o próprio app ainda cria o áudio no 1º toque).
// - Orientação: só deitado (AndroidManifest.xml, screenOrientation="sensorLandscape").
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        WebSettings ajustes = webView.getSettings();
        ajustes.setMediaPlaybackRequiresUserGesture(false);
        ajustes.setDomStorageEnabled(true); // localStorage (presets) — o padrão do Capacitor, garantido
        // O tamanho de fonte do Android (Configurações → Tela → Tamanho da fonte, ex.: 145%) NÃO
        // aumenta as letras do app: o painel do synth tem tamanhos fixos e as letras encavalavam.
        ajustes.setTextZoom(100);
        telaCheia();
    }

    @Override
    public void onWindowFocusChanged(boolean temFoco) {
        super.onWindowFocusChanged(temFoco);
        // Ao voltar para o app (ou fechar um aviso do sistema) as barras podem reaparecer
        if (temFoco) telaCheia();
    }

    private void telaCheia() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controle = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controle.hide(WindowInsetsCompat.Type.systemBars());
        controle.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // não apaga a tela tocando
    }
}
