// Cache em memória com prazo, que ESVAZIA. Puro, pra o teste executar de verdade.
//
// O cache da tela de Campanhas era um Map que só crescia: cada período consultado ficava guardado
// até o próximo deploy, mesmo vencido há dias (análise de custo do Railway, 22/09/2026). Era o
// único vazamento real de memória do servidor. Aqui, cada gravação varre o que venceu, e um teto
// segura o caso de muitos períodos diferentes dentro do prazo (tira o mais antigo primeiro: o Map
// guarda a ordem de inserção).

export function lerDoCache(mapa, chave, { agora = Date.now(), validadeMs }) {
  const item = mapa.get(chave);
  if (!item) return undefined;
  if (agora - item.ts >= validadeMs) { mapa.delete(chave); return undefined; }
  return item.data;
}

export function guardarNoCache(mapa, chave, data, { agora = Date.now(), validadeMs, teto = 50 }) {
  for (const [k, item] of mapa) if (agora - item.ts >= validadeMs) mapa.delete(k);
  mapa.delete(chave); // regravar a mesma chave a leva pro fim da fila
  mapa.set(chave, { ts: agora, data });
  while (mapa.size > teto) mapa.delete(mapa.keys().next().value);
}
