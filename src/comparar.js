// "Esse pedido mudou?" — o que decide se o sync grava no banco (ver upsertOrders em store.js).
// Puro, pra o teste executar de verdade.
//
// Não é JSON.stringify(a) === JSON.stringify(b), e por dois motivos que davam errado em silêncio:
// - o Postgres REORDENA as chaves ao gravar em JSONB, então todo pedido lido do banco depois de um
//   reinício teria texto diferente do mesmo pedido montado pelo sync, e tudo seria regravado;
// - chave com valor `undefined` não existe no JSON gravado, mas existe no objeto montado pelo
//   sync. As duas formas são o mesmo pedido.
// O erro que importa evitar é o outro lado: dizer "igual" pra um pedido que mudou faria a mudança
// nunca chegar no banco. Na dúvida, "mudou" (tipos diferentes, tamanhos de lista diferentes).
export function mesmoPedido(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!mesmoPedido(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).filter(k => a[k] !== undefined);
  const kb = Object.keys(b).filter(k => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || !mesmoPedido(a[k], b[k])) return false;
  }
  return true;
}
