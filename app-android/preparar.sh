#!/usr/bin/env bash
# app-android/preparar.sh
# Monta o projeto Android do MySynth com o Capacitor (usado pelo GitHub Actions, que gera o APK;
# também roda num PC com Node 22 + Java 21 + Android SDK).
#
#   1. Copia o app (a pasta de cima) para www/ — só o que o app usa (sem as cópias Webaudio/ e
#      Web-F3b/, sem o código C++, sem textos da loja).
#   2. Cria o projeto Android (android/) com o Capacitor, se ainda não existir, e copia www/ para ele.
#   3. Ajustes no Android:
#      - TIRA a permissão de Internet (o app não consegue falar com nada fora do celular);
#      - sempre DEITADO (vira para os dois lados deitados, nunca em pé);
#      - tela cheia de verdade (sem a barra de status e sem a de navegação) e texto sempre em
#        100% (sem o "tamanho da fonte" do Android): MainActivity.java desta pasta;
#      - ícone do MySynth;
#      - número da versão: VERSAO_NUMERO (o GitHub passa o número da execução; a Play Store exige
#        um número maior a cada envio). Nome da versão: 0.9.<número> (beta).
set -euo pipefail
cd "$(dirname "$0")"
RAIZ=..

echo "== 1. Copiando o app para www/"
rm -rf www
mkdir -p www
for item in index.html estilo.css principal.js processador-synth.js visualizacao.js wavetable.js \
  importar-wav.js manifest.json privacidade.html dsp interface presets icones; do
  cp -R "$RAIZ/$item" www/
done
mkdir -p www/motor
cp "$RAIZ/motor/motor.wasm" "$RAIZ/motor/ponte.js" www/motor/
# (sw.js fica de fora: dentro do app ele não é usado; ver interface/plataforma.js)

echo "== 2. Projeto Android (Capacitor)"
if [ ! -d android ]; then
  npx cap add android
fi
npx cap sync android

echo "== 3. Ajustes no Android"
MANIFESTO=android/app/src/main/AndroidManifest.xml
# Sem permissão de Internet
sed -i '/android.permission.INTERNET/d' "$MANIFESTO"
if grep -q 'android.permission' "$MANIFESTO"; then
  echo "Atenção: sobrou alguma permissão no AndroidManifest.xml:"; grep 'android.permission' "$MANIFESTO"
fi

# Sempre deitado (pedido do dono, 27/09/2026). "sensorLandscape" = gira entre os 2 lados deitados.
# (Obs.: no Android 16, em tablets grandes, o sistema pode ignorar e deixar girar: o app também
# funciona em pé.)
if ! grep -q 'screenOrientation' "$MANIFESTO"; then
  sed -i 's#android:name=".MainActivity"#&\n            android:screenOrientation="sensorLandscape"#' "$MANIFESTO"
fi

# Tela cheia (o tema do app sem a barra de status)
ESTILOS=android/app/src/main/res/values/styles.xml
if ! grep -q 'windowFullscreen' "$ESTILOS"; then
  sed -i 's#<style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">#&\n        <item name="android:windowFullscreen">true</item>#' "$ESTILOS"
fi

# Tela cheia + texto em 100% (MainActivity.java desta pasta)
cp MainActivity.java android/app/src/main/java/io/github/jjsantosytbyte/mysynth/MainActivity.java

# Ícone: o do MySynth (192 px) no lugar do ícone padrão do Capacitor
RES=android/app/src/main/res
rm -f "$RES"/mipmap-anydpi-v26/ic_launcher.xml "$RES"/mipmap-anydpi-v26/ic_launcher_round.xml
for pasta in "$RES"/mipmap-*dpi; do
  cp "$RAIZ/icones/icone-192.png" "$pasta/ic_launcher.png"
  cp "$RAIZ/icones/icone-192.png" "$pasta/ic_launcher_round.png"
  rm -f "$pasta/ic_launcher_foreground.png"
done

# Número da versão
VERSAO_NUMERO="${VERSAO_NUMERO:-1}"
sed -i "s/versionCode [0-9]*/versionCode $VERSAO_NUMERO/; s/versionName \"[^\"]*\"/versionName \"0.9.$VERSAO_NUMERO\"/" android/app/build.gradle

echo "== Pronto. Para gerar o APK: cd android && ./gradlew assembleRelease"
