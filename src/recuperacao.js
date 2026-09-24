// "Esqueci a senha": código de 6 dígitos enviado pro e-mail cadastrado do usuário. Puro — quem busca
// usuário, troca a senha e derruba as sessões é injetado — pra o teste executar a regra de verdade.
// Pedido do Luan, 24/09/2026 (antes disso, esquecer a senha exigia mexer no banco).
//
// As regras que não podem sair, cada uma fecha um jeito de abusar da tela de login:
//   - A resposta de "pedir código" é SEMPRE a mesma, exista o usuário ou não, tenha e-mail ou não.
//     Resposta diferente diria a um estranho quais usuários existem.
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

// Uma mensagem só pra todo erro de código: dizer "vencido" ou "não existe pedido" também vaza
// informação sobre a conta.
export const ERRO_CODIGO = 'Código inválido ou vencido. Peça um novo código.';

const hashDoCodigo = (userId, codigo) =>
  crypto.createHash('sha256').update(`${userId}:${codigo}`).digest();

export function gerarCodigo() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function criarRecuperacao({ acharUsuario, trocarSenha, derrubarSessoes, agora = () => Date.now(), gerar = gerarCodigo }) {
  const pendentes = new Map(); // userId → { hash, expiraEm, tentativas }
  const envios = new Map();    // userId → [instantes dos últimos pedidos]

  // Devolve { usuario, codigo } quando um e-mail deve ser enviado, ou null. Quem chama responde a
  // MESMA coisa nos dois casos.
  function pedir(login) {
    const u = acharUsuario(login);
    if (!u || !u.email) return null;
    const t = agora();
    const recentes = (envios.get(u.id) || []).filter(x => t - x < 60 * 60 * 1000);
    if (recentes.length && t - recentes[recentes.length - 1] < INTERVALO_REENVIO_MS) return null;
    if (recentes.length >= MAX_POR_HORA) return null;
    recentes.push(t);
    envios.set(u.id, recentes);

    const codigo = gerar();
    // Pedir de novo substitui o código anterior: só o último vale.
    pendentes.set(u.id, { hash: hashDoCodigo(u.id, codigo), expiraEm: t + VALIDADE_MS, tentativas: 0 });
    return { usuario: u, codigo };
  }

  // Lança Error com a mensagem pra tela, ou devolve o usuário cuja senha foi trocada.
  function redefinir(login, codigo, novaSenha) {
    if (!novaSenha || String(novaSenha).length < SENHA_MINIMA) {
      throw new Error(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
    }
    const u = acharUsuario(login);
    const p = u && pendentes.get(u.id);
    if (!p) throw new Error(ERRO_CODIGO);
    if (agora() > p.expiraEm) { pendentes.delete(u.id); throw new Error(ERRO_CODIGO); }

    const digitado = hashDoCodigo(u.id, String(codigo || '').trim());
    if (!crypto.timingSafeEqual(digitado, p.hash)) {
      p.tentativas++;
      if (p.tentativas >= MAX_TENTATIVAS) pendentes.delete(u.id);
      throw new Error(ERRO_CODIGO);
    }
    pendentes.delete(u.id);
    trocarSenha(u, novaSenha); // o usuário inteiro: quem chama marca o autor no Histórico

    derrubarSessoes(u.id);
    return u;
  }

  return { pedir, redefinir };
}
