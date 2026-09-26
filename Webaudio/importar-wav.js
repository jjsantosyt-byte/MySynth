// importar-wav.js
// Lê um arquivo .wav e o divide em ciclos de onda (frames de wavetable).
// Só contas com os bytes do arquivo: não depende de nada da tela.
//
// Formatos aceitos: PCM 8, 16, 24 e 32 bits, e ponto flutuante 32/64 bits.
// Estéreo (ou mais canais) vira mono: a média dos canais.
//
// Como descobrir o tamanho de cada ciclo:
// 1. Se o arquivo tem a marca do Serum (pedaço "clm " com "<!>2048 ..."), usa ela.
// 2. Se o tamanho total é múltiplo de 2048 (padrão Serum/Vital), ciclos de 2048.
// 3. Se o arquivo é curto (até 8192 pontos), é UM ciclo só ("single cycle").
// 4. Senão, não é uma wavetable (ex.: um sample comum) → erro.

export const TAMANHO_CICLO_PADRAO = 2048;
const MAXIMO_CICLO_UNICO = 8192;

// Erro com uma mensagem pronta para mostrar na tela.
export class ErroWav extends Error {}

// Texto de 4 letras na posição "p" (ex.: "RIFF", "fmt ")
function letras(dados, p) {
  return String.fromCharCode(dados.getUint8(p), dados.getUint8(p + 1), dados.getUint8(p + 2), dados.getUint8(p + 3));
}

// Lê os bytes do arquivo. Devolve { amostras (mono), taxa, tamanhoMarcado }.
export function lerWav(buffer) {
  const dados = new DataView(buffer);
  if (dados.byteLength < 12 || letras(dados, 0) !== 'RIFF' || letras(dados, 8) !== 'WAVE') {
    throw new ErroWav('Esse arquivo não é um .wav.');
  }

  let formato = null;
  let inicioDados = -1;
  let tamanhoDados = 0;
  let tamanhoMarcado = null;

  // Percorre os "pedaços" (chunks) do arquivo
  let p = 12;
  while (p + 8 <= dados.byteLength) {
    const id = letras(dados, p);
    const tamanho = dados.getUint32(p + 4, true);
    const corpo = p + 8;
    if (id === 'fmt ') {
      let codigo = dados.getUint16(corpo, true);
      const canais = dados.getUint16(corpo + 2, true);
      const taxa = dados.getUint32(corpo + 4, true);
      const bits = dados.getUint16(corpo + 14, true);
      // "Extensible": o formato de verdade fica mais para dentro
      if (codigo === 0xfffe && tamanho >= 26) codigo = dados.getUint16(corpo + 24, true);
      formato = { codigo, canais, taxa, bits };
    } else if (id === 'data') {
      inicioDados = corpo;
      tamanhoDados = Math.min(tamanho, dados.byteLength - corpo);
    } else if (id === 'clm ') {
      // Marca do Serum: "<!>2048 ..." = tamanho do ciclo
      let texto = '';
      for (let i = 0; i < Math.min(tamanho, 64); i++) texto += String.fromCharCode(dados.getUint8(corpo + i));
      const achado = /<!>\s*(\d+)/.exec(texto);
      if (achado) tamanhoMarcado = Number(achado[1]);
    }
    p = corpo + tamanho + (tamanho % 2); // pedaços de tamanho ímpar têm 1 byte de folga
  }

  if (!formato || inicioDados < 0) throw new ErroWav('Esse .wav está incompleto (sem formato ou sem áudio).');
  const { codigo, canais, taxa, bits } = formato;
  const ehPCM = codigo === 1 && [8, 16, 24, 32].includes(bits);
  const ehFloat = codigo === 3 && (bits === 32 || bits === 64);
  if (!ehPCM && !ehFloat) throw new ErroWav(`Formato de .wav não suportado (${bits} bits, código ${codigo}).`);
  if (canais < 1) throw new ErroWav('Esse .wav não tem canais de áudio.');

  const bytes = bits / 8;
  const quadros = Math.floor(tamanhoDados / (bytes * canais));
  const amostras = new Float32Array(quadros);

  // Lê uma amostra (de -1 a 1) na posição q
  const ler = (q) => {
    if (ehFloat) return bits === 32 ? dados.getFloat32(q, true) : dados.getFloat64(q, true);
    switch (bits) {
      case 8:
        return (dados.getUint8(q) - 128) / 128;
      case 16:
        return dados.getInt16(q, true) / 32768;
      case 24: {
        let v = dados.getUint8(q) | (dados.getUint8(q + 1) << 8) | (dados.getUint8(q + 2) << 16);
        if (v & 0x800000) v -= 0x1000000;
        return v / 8388608;
      }
      default:
        return dados.getInt32(q, true) / 2147483648;
    }
  };

  for (let i = 0; i < quadros; i++) {
    let soma = 0;
    for (let c = 0; c < canais; c++) soma += ler(inicioDados + (i * canais + c) * bytes);
    amostras[i] = soma / canais;
  }

  return { amostras, taxa, tamanhoMarcado };
}

// Divide as amostras em ciclos (veja as regras no topo do arquivo).
export function dividirEmCiclos({ amostras, tamanhoMarcado }) {
  const total = amostras.length;
  if (total < 16) throw new ErroWav('Esse .wav é curto demais para ser uma onda.');

  let tamanho;
  if (tamanhoMarcado && tamanhoMarcado >= 16 && tamanhoMarcado <= total) tamanho = tamanhoMarcado;
  else if (total % TAMANHO_CICLO_PADRAO === 0) tamanho = TAMANHO_CICLO_PADRAO;
  else if (total <= MAXIMO_CICLO_UNICO) tamanho = total;
  else {
    throw new ErroWav(
      'Esse .wav não parece uma wavetable (ciclos de 2048 pontos) nem uma onda de ciclo único. ' +
        'Transformar samples comuns em wavetable fica para uma próxima etapa.'
    );
  }

  const quantidade = Math.floor(total / tamanho);
  return Array.from({ length: quantidade }, (_, k) => amostras.subarray(k * tamanho, (k + 1) * tamanho));
}
