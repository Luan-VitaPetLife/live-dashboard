// "Esqueci a senha": código de 6 dígitos enviado pro e-mail cadastrado do usuário. Puro — quem busca
// usuário, troca a senha e derruba as sessões é injetado — pra o teste executar a regra de verdade.
// Pedido do Luan, 24/09/2026 (antes disso, esquecer a senha exigia mexer no banco).
//
// A tela diz com clareza o que aconteceu: usuário não encontrado, usuário sem e-mail, código enviado
// (pra qual e-mail, mascarado), código errado com as tentativas que restam, código vencido. Decisão do
// Luan (24/09/2026): "não adianta enganar o usuário falando 'se existir, chega o código'". O preço é
// que alguém de fora consegue testar se um usuário existe; numa dashboard interna, de poucos usuários,
// com limite de tentativas por IP na rota (senhaLimiter), esse preço foi aceito.
//
// As regras que continuam, cada uma fecha um abuso:
//   - O código vale 10 minutos, serve uma vez só e aceita 5 tentativas. Sem teto de tentativas, 6
//     dígitos são um milhão de chutes, e um script acerta.
//   - Reenvio limitado: um pedido por minuto e 5 por hora por usuário. Sem isso, qualquer um enche a
//     caixa de e-mail de alguém (e a cota do envio) só sabendo o usuário.
//   - O código NÃO fica guardado em texto: guarda-se o hash dele. E a comparação é em tempo constante.
//   - Redefinir derruba todas as sessões abertas do usuário: se alguém estava usando a conta, sai.
//   - Senha nova fraca é recusada ANTES de gastar o código, senão a pessoa perderia o código por
//     um erro de digitação e teria que pedir outro.
//
// Fica em MEMÓRIA, de propósito: é um processo só no Railway, o código vive 10 minutos, e um
// reinício no meio só obriga a pedir outro. Gravar no banco seria escrever segredo em disco à toa.
import crypto from 'node:crypto';

export const VALIDADE_MS = 10 * 60 * 1000;
export const MAX_TENTATIVAS = 5;
export const INTERVALO_REENVIO_MS = 60 * 1000;
export const MAX_POR_HORA = 5;
export const SENHA_MINIMA = 8;
const HORA_MS = 60 * 60 * 1000;

export const MENSAGENS = {
  naoEncontrado: 'Não encontramos nenhum usuário com esse nome de usuário ou e-mail.',
  semEmail: 'Esse usuário não tem e-mail cadastrado. Peça a um administrador pra cadastrar em Configurações.',
  semPedido: 'Nenhum código foi pedido pra esse usuário. Peça um código primeiro.',
  vencido: 'Esse código venceu. Peça um novo.',
  esgotado: 'Tentativas esgotadas. Peça um novo código.',
  limiteHora: 'Limite de 5 códigos por hora atingido. Tente de novo mais tarde.',
};

const hashDoCodigo = (userId, codigo) =>
  crypto.createHash('sha256').update(`${userId}:${codigo}`).digest();

export function gerarCodigo() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// "maria.silva@gmail.com" → "m***@gmail.com": confirma pra onde foi, sem expor o endereço inteiro
// na tela de quem digitou o nome de usuário.
export function mascararEmail(email) {
  const [nome, dominio] = String(email || '').split('@');
  if (!nome || !dominio) return '';
  return nome[0] + '***@' + dominio;
}

export function criarRecuperacao({ acharUsuario, trocarSenha, derrubarSessoes, agora = () => Date.now(), gerar = gerarCodigo }) {
  const pendentes = new Map(); // userId → { hash, expiraEm, tentativas }
  const envios = new Map();    // userId → [instantes dos últimos pedidos]

  // Devolve { status, ... }:
  //   'naoEncontrado' | 'semEmail' | 'aguarde' (com `segundos`) | 'limiteHora' | 'enviar' (com
  //   `usuario` e `codigo`, quem chama envia o e-mail).
  function pedir(login) {
    const u = acharUsuario(login);
    if (!u) return { status: 'naoEncontrado' };
    if (!u.email) return { status: 'semEmail' };
    const t = agora();
    const recentes = (envios.get(u.id) || []).filter(x => t - x < HORA_MS);
    const ultimo = recentes[recentes.length - 1];
    if (ultimo != null && t - ultimo < INTERVALO_REENVIO_MS) {
      return { status: 'aguarde', segundos: Math.ceil((INTERVALO_REENVIO_MS - (t - ultimo)) / 1000) };
    }
    if (recentes.length >= MAX_POR_HORA) return { status: 'limiteHora' };
    recentes.push(t);
    envios.set(u.id, recentes);

    const codigo = gerar();
    // Pedir de novo substitui o código anterior: só o último vale.
    pendentes.set(u.id, { hash: hashDoCodigo(u.id, codigo), expiraEm: t + VALIDADE_MS, tentativas: 0 });
    return { status: 'enviar', usuario: u, codigo };
  }

  // O e-mail não saiu: o código não vale e o pedido não conta pro limite, senão a pessoa teria que
  // esperar um minuto por uma falha que não foi dela.
  function desfazer(userId) {
    pendentes.delete(userId);
    const recentes = envios.get(userId) || [];
    recentes.pop();
    envios.set(userId, recentes);
  }

  // Lança Error com a mensagem pra tela, ou devolve o usuário cuja senha foi trocada.
  function redefinir(login, codigo, novaSenha) {
    if (!novaSenha || String(novaSenha).length < SENHA_MINIMA) {
      throw new Error(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
    }
    const u = acharUsuario(login);
    if (!u) throw new Error(MENSAGENS.naoEncontrado);
    const p = pendentes.get(u.id);
    if (!p) throw new Error(MENSAGENS.semPedido);
    if (agora() > p.expiraEm) { pendentes.delete(u.id); throw new Error(MENSAGENS.vencido); }

    const digitado = hashDoCodigo(u.id, String(codigo || '').trim());
    if (!crypto.timingSafeEqual(digitado, p.hash)) {
      p.tentativas++;
      const restam = MAX_TENTATIVAS - p.tentativas;
      if (restam <= 0) { pendentes.delete(u.id); throw new Error(MENSAGENS.esgotado); }
      throw new Error(`Código errado. ${restam === 1 ? 'Resta 1 tentativa' : `Restam ${restam} tentativas`}.`);
    }
    pendentes.delete(u.id);
    trocarSenha(u, novaSenha); // o usuário inteiro: quem chama marca o autor no Histórico
    derrubarSessoes(u.id);
    return u;
  }

  return { pedir, desfazer, redefinir };
}
