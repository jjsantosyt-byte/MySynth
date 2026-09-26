// interface/historico.js
// Desfazer / Refazer mudanças no som.
//
// Como funciona: o histórico guarda "fotos" do som (o mesmo que um preset guarda). Quando algo
// muda, ele espera o som ficar parado por um instante (ESPERA_MS) e só então tira a foto:
// girar um knob do começo ao fim vira UM passo, não centenas. Trocar de preset também é um
// passo (dá para voltar ao som de antes). Guarda no máximo LIMITE passos.

const ESPERA_MS = 450;
const LIMITE = 60;

// opcoes:
//   obter(): o som atual (objeto)
//   aplicar(som): põe um som de volta (motor + tela)
//   aoMudar(): avisa a tela (para ligar/desligar os botões ↶ ↷)
//   mesmoSom(a, b) (opcional): true se duas fotos têm o mesmo som. Aí a mudança não vira passo
//     (ex.: só o nome do preset no visor mudou ao salvar): a foto é só atualizada.
export function criarHistorico({ obter, aplicar, aoMudar = () => {}, mesmoSom = null }) {
  let estavel = JSON.stringify(obter()); // a última foto (o som "de agora" no histórico)
  const passosDesfazer = [];
  const passosRefazer = [];
  let pendente = false; // mudou algo que ainda não virou foto
  let temporizador = 0;

  // Algo mudou no som: tira a foto quando parar de mexer
  function registrar() {
    pendente = true;
    clearTimeout(temporizador);
    temporizador = setTimeout(fechar, ESPERA_MS);
    aoMudar();
  }

  // Tira a foto agora (se o som realmente mudou)
  function fechar() {
    clearTimeout(temporizador);
    pendente = false;
    const agora = obter();
    const atual = JSON.stringify(agora);
    if (atual !== estavel && mesmoSom?.(JSON.parse(estavel), agora)) {
      estavel = atual; // o som não mudou: só atualiza a foto
    } else if (atual !== estavel) {
      passosDesfazer.push(estavel);
      if (passosDesfazer.length > LIMITE) passosDesfazer.shift();
      passosRefazer.length = 0;
      estavel = atual;
    }
    aoMudar();
  }

  function desfazer() {
    fechar();
    if (passosDesfazer.length === 0) return;
    passosRefazer.push(estavel);
    estavel = passosDesfazer.pop();
    aplicar(JSON.parse(estavel));
    aoMudar();
  }

  function refazer() {
    fechar();
    if (passosRefazer.length === 0) return;
    passosDesfazer.push(estavel);
    estavel = passosRefazer.pop();
    aplicar(JSON.parse(estavel));
    aoMudar();
  }

  return {
    registrar,
    desfazer,
    refazer,
    podeDesfazer: () => pendente || passosDesfazer.length > 0,
    podeRefazer: () => !pendente && passosRefazer.length > 0,
  };
}
