// Envolve uma função assíncrona pra que só UMA execução aconteça por vez: quem chama enquanto uma
// está em andamento recebe a MESMA promessa, em vez de disparar outra. Terminada (com sucesso ou
// erro), a próxima chamada executa de novo. Puro, pra o teste executar.
//
// Existe pela renovação de token do Bling (src/bling.js): duas renovações simultâneas usariam o
// mesmo refresh token, que o Bling invalida na primeira.
export function umaPorVez(fn) {
  let emCurso = null;
  return function () {
    if (emCurso) return emCurso;
    emCurso = Promise.resolve()
      .then(() => fn())
      .finally(() => { emCurso = null; });
    return emCurso;
  };
}
