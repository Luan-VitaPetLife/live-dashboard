// autor.js — quem está fazendo a edição, disponível em qualquer profundidade da pilha sem passar
// por parâmetro.
//
// É o que permite o registro do "Histórico" morar DENTRO das funções de gravação do store, que é
// o único lugar onde o valor ANTIGO ainda existe. A alternativa seria cada função de gravação
// receber um argumento a mais com o autor — e aí a próxima tela que salvasse algo esqueceria de
// passá-lo, sem erro nenhum, e a edição sumiria do histórico em silêncio.
//
// `AsyncLocalStorage` e não uma variável de módulo: o servidor atende requisições concorrentes, e
// uma variável global seria sobrescrita pela requisição seguinte no meio de um `await`, gravando
// a edição de uma pessoa no nome de outra. É biblioteca do próprio Node (`node:async_hooks`),
// então não entra dependência nova (ver Convenções no CLAUDE.md).
import { AsyncLocalStorage } from 'node:async_hooks';

const contexto = new AsyncLocalStorage();

// Roda `fn` marcando tudo que acontecer dentro dela como feito por `autor`.
export function comAutor(autor, fn) {
  return contexto.run({ autor }, fn);
}

// Quem está editando agora, ou null. Null é legítimo e quer dizer "não veio de pessoa nenhuma":
// job automático, sincronização, script. O histórico mostra isso como "automático", mesmo
// vocabulário do card de processos.
export function autorAtual() {
  const s = contexto.getStore();
  return s && s.autor ? s.autor : null;
}
