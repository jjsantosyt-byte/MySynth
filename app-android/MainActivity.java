package io.github.jjsantosytbyte.mysynth;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

// Tela do app Android (copiada para o projeto pelo preparar.sh).
public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Texto sempre em 100%: a janela de navegador do app seguia o "tamanho da fonte" do Android
    // (o Chrome não segue) e o texto ficava grande demais para os controles.
    if (getBridge() != null) getBridge().getWebView().getSettings().setTextZoom(100);
    telaCheia();
  }

  // Ao voltar para o app (ou depois de mostrar as barras arrastando da borda), esconde de novo.
  @Override
  public void onWindowFocusChanged(boolean temFoco) {
    super.onWindowFocusChanged(temFoco);
    if (temFoco) telaCheia();
  }

  // Tela cheia de verdade: sem a barra de status (em cima) e sem a de navegação (◁ ○ ☰).
  // Arrastar da borda mostra as barras por um instante.
  private void telaCheia() {
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    WindowInsetsControllerCompat barras =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    barras.hide(WindowInsetsCompat.Type.systemBars());
    barras.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
  }
}
