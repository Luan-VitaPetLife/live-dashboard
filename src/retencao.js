// Janela de histórico da dashboard: os últimos 90 dias, em TODOS os canais, no Brasil e nos EUA.
// Todo dia o dia mais antigo sai. Decisão do Luan (22/09/2026), pra conta do Railway: 97% dela é
// memória, e o servidor guarda todo pedido na memória o tempo inteiro (ver store.js).
//
// É uma regra FIXA, não um número na tela. A tela de Integrações tinha dois campos de "dias de
// histórico" (Amazon e Shopify), e um deles já quis podar e buscar no mesmo lugar. Com a janela
// fixa não há o que escolher.
//
// Puro de propósito: nenhum I/O, pra o teste executar a regra de verdade sem banco.

export const RETENCAO_DIAS = Math.max(1, Number(process.env.PEDIDOS_RETENCAO_DIAS) || 90);

// Um dia de FOLGA além dos 90. O corte é meia-noite UTC, e o dia da loja não é: no Brasil ele
// começa às 03:00 UTC, nos EUA entre 04:00 e 08:00. Sem a folga, "últimos 90 dias" na tela
// abriria com o primeiro dia pela metade, e o que faltasse pareceria venda que não aconteceu.
const FOLGA_DIAS = 1;

// ISO do corte: tudo criado ANTES disso sai. `agora` é parâmetro pra o teste fixar o relógio.
export function corteDaRetencao(agora = Date.now(), dias = RETENCAO_DIAS) {
  const hoje = new Date(agora);
  const meiaNoiteUtc = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  return new Date(meiaNoiteUtc - (dias + FOLGA_DIAS) * 864e5).toISOString();
}

// Comparação por TEXTO, e é a mesma que o Postgres faz no DELETE (`data->>'createdAt' < $1`).
// Se a memória comparasse de um jeito e o banco de outro, um pedido na beira do corte poderia sair
// de um lado e ficar no outro, e a tela passaria a discordar do banco depois de um reinício.
// Pedido sem data não sai: sem data não há como saber se é velho, e apagar no escuro é pior.
export function foraDaJanela(pedido, corteIso) {
  const c = pedido && pedido.createdAt;
  return typeof c === 'string' && c !== '' && c < corteIso;
}

// Série diária ({ 'AAAA-MM-DD': ... }): as chaves de dia anteriores ao corte. Sessões, gasto de
// anúncio e afins seguem a mesma janela dos pedidos, senão o card de tráfego mostraria visita num
// período em que a dashboard diz que não houve venda nenhuma.
// A data é lida no FIM da chave: as sessões dos EUA são gravadas como "us:AAAA-MM-DD", e comparar a
// chave inteira nunca as apagaria ("u" vem depois de qualquer dígito). Chave que não termina em data
// não é dia e fica onde está.
const DIA = /^\d{4}-\d{2}-\d{2}$/;
export function diasForaDaJanela(serie, corteIso) {
  const corteDia = corteIso.slice(0, 10);
  return Object.keys(serie || {}).filter(k => {
    const dia = k.slice(-10);
    return DIA.test(dia) && dia < corteDia;
  });
}
