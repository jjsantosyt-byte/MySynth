// scripts/gradle.mjs
// Roda o Gradle do projeto Android (android/gradlew) com a tarefa pedida, ex.:
//   node scripts/gradle.mjs assembleDebug   → .apk de teste
//   node scripts/gradle.mjs bundleRelease   → .aab para a Play Store
// Se o JAVA_HOME não estiver definido, usa o Java 21 que vem com o Android Studio.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pastaAndroid = join(dirname(fileURLToPath(import.meta.url)), '..', 'android');
const windows = process.platform === 'win32';
const env = { ...process.env };
const javaDoStudio = 'C:\\Program Files\\Android\\Android Studio\\jbr';
if (!env.JAVA_HOME && windows && existsSync(javaDoStudio)) env.JAVA_HOME = javaDoStudio;

// O Java no Windows falha ("Unable to establish loopback connection") quando a pasta
// temporária tem acento no caminho (ex.: C:\Users\Eli Júlio\...). Durante o build, usa uma
// pasta temporária sem acento.
if (windows) {
  const temporaria = 'C:\\Users\\Public\\mysynth-tmp';
  mkdirSync(temporaria, { recursive: true });
  env.TEMP = env.TMP = temporaria;
  env.JAVA_TOOL_OPTIONS = `${env.JAVA_TOOL_OPTIONS || ''} -Djava.io.tmpdir=${temporaria} -Djdk.net.unixdomain.tmpdir=${temporaria}`.trim();
}

// Caminho completo (com aspas: a pasta pode ter espaços e acentos). Alguns Windows não
// procuram programas na pasta atual, então "gradlew.bat" sozinho não seria achado.
const gradlew = windows ? `"${join(pastaAndroid, 'gradlew.bat')}"` : './gradlew';
const resultado = spawnSync(gradlew, process.argv.slice(2), {
  cwd: pastaAndroid,
  env,
  stdio: 'inherit',
  shell: windows,
});
process.exit(resultado.status ?? 1);
