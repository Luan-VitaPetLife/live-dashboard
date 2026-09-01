// A Amazon não marca devolução em pedido nenhum: nem a Orders API nem o relatório de pedidos
// têm status 'Refunded' (conferido contra 165 mil pedidos de produção). Quem sabe é o relatório
// de devoluções da FBA, lido por `fetchCustomerReturns` (src/amazon.js) e casado com os pedidos
// já gravados por `reconcileAmazonReturns` (src/sync.js).
//
// O que este teste protege, que falha em silêncio se quebrar:
//   1. agrupar as linhas por pedido (uma linha é UMA unidade devolvida) sem perder unidade;
//   2. decidir devolução total × parcial;
//   3. a garantia de que essa reconciliação NUNCA insere pedido — é ela que impede o
//      vazamento de mercado de sempre (CLAUDE.md 4.7.8), já que este relatório não traz país
//      de entrega pra filtrar por mercado.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, ROOT } from './_lib.mjs';

const t = criarTeste('Devoluções da Amazon');

// Executa UMA função a partir do texto do arquivo. Não importa os módulos: amazon.js e sync.js
// puxam store.js junto, e nenhum teste toca no banco.
function carregar(arquivo, nomeFn) {
  const src = fs.readFileSync(arquivo, 'utf8');
  const i = src.indexOf(`function ${nomeFn}(`);
  if (i < 0) return null;
  let prof = 0, fim = i;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(src.slice(i, fim), ctx);
  return ctx[nomeFn];
}

const AMAZON = path.join(ROOT, 'src', 'amazon.js');
const SYNC   = path.join(ROOT, 'src', 'sync.js');
const STORE  = path.join(ROOT, 'src', 'store.js');

// ── 1. Agrupar as linhas do relatório ─────────────────────────────────────────
const agrupar = carregar(AMAZON, 'devolucoesDasLinhas');
t.ok(typeof agrupar === 'function', 'achou devolucoesDasLinhas em amazon.js');

if (typeof agrupar === 'function') {
  // Colunas reais do relatório, confirmadas contra a conta BR de produção.
  const linhas = [
    { 'return-date': '2026-08-30T19:06:13+00:00', 'order-id': '702-1111111-1111111', quantity: '1' },
    // Mesmo pedido voltando em duas remessas: soma as unidades e fica com a data mais recente.
    { 'return-date': '2026-08-20T10:00:00+00:00', 'order-id': '702-2222222-2222222', quantity: '1' },
    { 'return-date': '2026-08-25T10:00:00+00:00', 'order-id': '702-2222222-2222222', quantity: '2' },
    // Lixo que o relatório pode trazer: linha sem pedido e linha com zero unidade.
    { 'return-date': '2026-08-21T10:00:00+00:00', 'order-id': '',                    quantity: '1' },
    { 'return-date': '2026-08-22T10:00:00+00:00', 'order-id': '702-3333333-3333333', quantity: '0' },
  ];
  const devs = agrupar(linhas, 'br');
  t.eq(devs.length, 2, 'duas devoluções (linha sem pedido e linha com 0 unidade caem fora)');

  const um = devs.find(d => d.orderId === '702-1111111-1111111');
  t.eq(um.id, 'amazon-br:702-1111111-1111111', 'id sai carimbado com o mercado do relatório');
  t.eq(um.qty, 1, 'uma unidade');

  const dois = devs.find(d => d.orderId === '702-2222222-2222222');
  t.eq(dois.qty, 3, 'duas remessas do mesmo pedido somam as unidades');
  t.eq(dois.returnedAt, '2026-08-25T10:00:00+00:00', 'fica a devolução mais recente do pedido');

  // O mercado vem do relatório, não da linha: é ele que decide de quem é o id.
  t.eq(agrupar([linhas[0]], 'us')[0].id, 'amazon-us:702-1111111-1111111', 'mercado us carimba amazon-us:');
}

// ── 2. Total ou parcial ───────────────────────────────────────────────────────
const classificar = carregar(SYNC, 'classificarDevolucao');
t.ok(typeof classificar === 'function', 'achou classificarDevolucao em sync.js');

if (typeof classificar === 'function') {
  t.eq(classificar({ items: [{ qty: 1 }] }, 1), 'total',   'pedido de 1 unidade, 1 devolvida');
  t.eq(classificar({ items: [{ qty: 3 }] }, 3), 'total',   'pedido de 3 unidades, 3 devolvidas');
  t.eq(classificar({ items: [{ qty: 3 }] }, 1), 'parcial', 'pedido de 3 unidades, 1 devolvida');
  t.eq(classificar({ items: [{ qty: 1 }, { qty: 1 }] }, 1), 'parcial', 'soma as unidades de todos os itens');
  // Pedido sem item conhecido (a Orders API não traz item) cai em 'total': quase todo pedido
  // da Amazon BR é de uma unidade só. O número real fica em refundedQty de qualquer jeito.
  t.eq(classificar({ items: [] }, 1),      'total', 'pedido sem item conhecido → total');
  t.eq(classificar({},           1),       'total', 'pedido sem o campo items → total');
  // Devolveu mais do que o pedido tinha (relatório com linha duplicada): não vira 'parcial'.
  t.eq(classificar({ items: [{ qty: 1 }] }, 2), 'total', 'devolveu mais que o pedido → total');
}

// ── 3. Patch-only: nunca inserir pedido ───────────────────────────────────────
// Sem país de entrega no relatório, é ESTA garantia que impede um id do outro mercado de
// virar pedido novo no mercado errado — o mesmo incidente que o patchOrderItems já sofreu.
const store = fs.readFileSync(STORE, 'utf8');
const iPatch = store.indexOf('export function patchOrderRefunds(');
t.ok(iPatch > 0, 'store.js exporta patchOrderRefunds');
if (iPatch > 0) {
  const corpo = store.slice(iPatch, store.indexOf('\n}\n', iPatch));
  t.ok(/if \(!existing[^)]*\)\s*\{\s*skipped\+\+;\s*continue;/.test(corpo),
    'patchOrderRefunds pula pedido inexistente em vez de inserir');
  t.ok(!/db\.orders\[[^\]]+\]\s*=/.test(corpo),
    'patchOrderRefunds não escreve em db.orders[...] (não insere pedido novo)');
  for (const campo of ['total', 'status', 'items', 'cancelled']) {
    t.ok(!new RegExp(`existing\\.${campo}\\s*=`).test(corpo),
      `patchOrderRefunds não mexe em ${campo}`);
  }
  t.ok(/existing\.refunded\s*===\s*p\.refunded/.test(corpo),
    'não regrava o que já está igual (a janela do relatório é móvel, a mesma devolução volta sempre)');
}

// ── 4. As pontas continuam ligadas ────────────────────────────────────────────
const amazon = fs.readFileSync(AMAZON, 'utf8');
const sync   = fs.readFileSync(SYNC, 'utf8');
const semComentario = txt => txt.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const amazonSC = semComentario(amazon);
const syncSC   = semComentario(sync);

t.ok(amazonSC.includes("const RETURNS_REPORT_TYPE = 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA'"),
  'o relatório é o de devoluções da FBA (o único que o papel do app alcança)');
const iBusca = amazonSC.indexOf('export async function fetchCustomerReturns');
t.ok(iBusca > 0, 'amazon.js exporta fetchCustomerReturns');
// Recorta o corpo da função: a asserção solta casava com o `reportType` do diagnóstico
// `inspectReturns` logo abaixo, e por isso continuava passando com a busca de verdade
// apontada pro relatório errado.
if (iBusca > 0) {
  const corpoBusca = amazonSC.slice(iBusca, amazonSC.indexOf('\n}\n', iBusca));
  t.ok(/reportType:\s*RETURNS_REPORT_TYPE/.test(corpoBusca),
    'fetchCustomerReturns pede o relatório de devoluções, não o de pedidos');
}

t.ok(/export async function reconcileAmazonReturns/.test(syncSC), 'sync.js exporta reconcileAmazonReturns');
t.ok(/patchOrderRefunds\(patches\)/.test(syncSC), 'a reconciliação grava via patchOrderRefunds');
t.ok(/setAmazonCursor\(`returns-\$\{market\}`/.test(syncSC), 'grava o cursor de throttle por mercado');
// Janela curta veria a venda e nunca a volta dela: o pedido que originou isso foi vendido em
// 18/08 e a mercadoria só voltou em 30/08.
const dias = syncSC.match(/AMAZON_RETURNS_DAYS \|\| (\d+)/);
t.ok(dias && Number(dias[1]) >= 30, `a janela de devoluções é de pelo menos 30 dias (é ${dias?.[1]})`);

const server = semComentario(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
t.ok(/reconcileAmazonReturns/.test(server), 'server.js chama a reconciliação de devoluções');
t.ok(/app\.post\('\/api\/amazon\/sync-returns', requireAdmin/.test(server),
  'o disparo manual existe e é só de admin');

// ── 5. O desconto de verdade: unidade devolvida não conta como vendida ───────
// É a parte que mexe em número, não em rótulo. Roda a função de cálculo de verdade.
const liquido = carregar(path.join(ROOT, 'src', 'metrics.js'), 'pedidoLiquido');
t.ok(typeof liquido === 'function', 'achou pedidoLiquido em metrics.js');

if (typeof liquido === 'function') {
  // Pedido da Shopify: já vem líquido da própria API (currentQuantity/currentTotalPriceSet), não
  // carrega campo de devolução nenhum e não pode ser mexido aqui — descontar de novo seria
  // descontar duas vezes.
  const shopify = { total: 119, items: [{ title: 'Lisina', qty: 1, amount: 119 }] };
  t.eq(liquido(shopify), shopify, 'pedido sem marca de devolução passa intacto (Shopify já vem líquido)');

  // O caso do Luan: 3 areias + 1 suplemento, uma areia devolvida. A baixa tem que sair da AREIA.
  const misto = liquido({
    total: 239.96,
    items: [
      { title: 'Areia', qty: 3, amount: 179.97, asin: 'A1', refundedQty: 1 },
      { title: 'Suplemento', qty: 1, amount: 59.99, asin: 'A2' },
    ],
  });
  t.eq(misto.items[0].qty, 2, 'areia cai de 3 para 2 unidades');
  t.eq(misto.items[1].qty, 1, 'o suplemento não é tocado');
  t.eq(Math.round(misto.items[0].amount * 100) / 100, 119.98, 'a receita da areia cai junto');
  t.eq(misto.total, 179.97, 'o total do pedido perde exatamente a unidade devolvida');

  // Sabemos quantas unidades voltaram, mas não de qual linha (canal que não informa o produto):
  // distribui linha a linha. Pode errar de qual produto saiu, nunca erra o total de unidades.
  const semProduto = liquido({
    total: 200, refundedQty: 2,
    items: [{ title: 'A', qty: 1, amount: 100 }, { title: 'B', qty: 3, amount: 100 }],
  });
  t.eq(semProduto.items[0].qty + semProduto.items[1].qty, 2, 'sem saber o produto, o total de unidades ainda fecha (4 - 2)');
  // A baixa sai da linha A inteira (R$100) e de 1 das 3 unidades de B (R$33,33). O dinheiro
  // acompanha exatamente as unidades tiradas, seja qual for a linha de onde saíram.
  t.eq(semProduto.total, 66.67, 'e o dinheiro acompanha as unidades tiradas');

  // Amazon BR: a Orders API não traz item nenhum. Se a mercadoria voltou e não sabemos o que
  // era, o pedido não pode continuar valendo o total cheio.
  const semItem = liquido({ total: 59.99, refundedQty: 1, items: [] });
  t.eq(semItem.total, 0, 'pedido devolvido sem item conhecido zera');

  // Mercado Livre, reembolso parcial: sabemos o dinheiro, não a unidade. Só o dinheiro sai.
  const parcialML = liquido({ total: 128.76, refundedTotal: 28.76, items: [{ title: 'X', qty: 2, amount: 128.76 }] });
  t.eq(parcialML.total, 100, 'reembolso parcial desconta o valor informado pelo canal');
  t.eq(parcialML.items[0].qty, 2, 'e não chuta qual unidade saiu');

  // O toggle "Vendas de produto" da Amazon acompanha, senão os dois modos de receita
  // discordariam só no pedido devolvido.
  const comProductSales = liquido({ total: 100, productSales: 80, refundedQty: 1, items: [{ title: 'X', qty: 2, amount: 100 }] });
  t.eq(comProductSales.total, 50, 'metade da unidade sai do total');
  t.eq(comProductSales.productSales, 40, 'e a mesma proporção sai de productSales');

  // Nunca negativo, mesmo com relatório repetindo linha. Os dois caminhos precisam do caso:
  // pelo total do pedido e pela linha, que são contas diferentes.
  const exagero = liquido({ total: 50, refundedQty: 9, items: [{ title: 'X', qty: 1, amount: 50 }] });
  t.eq(exagero.items[0].qty, 0, 'unidade não fica negativa (baixa pelo pedido)');
  t.eq(exagero.total, 0, 'total não fica negativo');
  const exageroLinha = liquido({ total: 50, items: [{ title: 'X', qty: 1, amount: 50, refundedQty: 9 }] });
  t.eq(exageroLinha.items[0].qty, 0, 'unidade não fica negativa (baixa pela linha)');
  t.eq(exageroLinha.total, 0, 'e o total também não');
}

// Toda leitura de pedido em metrics.js passa pelo desconto: `lerPedidosBrutos` só pode aparecer
// duas vezes, no import e dentro do getOrders local. Um getOrders novo importado direto do store
// furaria o desconto em silêncio — KPI e Top produtos voltariam ao número bruto sem erro nenhum.
const metrics = fs.readFileSync(path.join(ROOT, 'src', 'metrics.js'), 'utf8');
t.eq((metrics.match(/lerPedidosBrutos/g) || []).length, 2,
  'metrics.js lê pedido cru num lugar só (o resto passa pelo desconto)');
t.ok(/function getOrders\(args\)\s*\{\s*return lerPedidosBrutos\(args\)\.map\(pedidoLiquido\);/.test(metrics),
  'a porta de entrada de pedido aplica o desconto');

// O sync de 15 min não pode apagar a marca que a reconciliação de 12h gravou.
const iUpsert = store.indexOf('export function upsertOrders(');
t.ok(iUpsert > 0, 'achou upsertOrders');
if (iUpsert > 0) {
  const corpo = store.slice(iUpsert, store.indexOf('\n}\n', iUpsert));
  t.ok(/o\.refunded == null && existing\.refunded != null/.test(corpo),
    'upsertOrders preserva a marca de devolução quando o pedido novo não a traz');
  t.ok(/velho\.refundedQty != null\) novo\.refundedQty = velho\.refundedQty/.test(corpo),
    'e preserva a marca por linha quando a lista de itens é substituída');
}

// Mercado Livre: o reembolso vem no próprio pedido, sem chamada nova.
const mlSrc = semComentario(fs.readFileSync(path.join(ROOT, 'src', 'mercadolivre.js'), 'utf8'));
t.ok(/transaction_amount_refunded/.test(mlSrc), 'ML lê o reembolso de payments[]');
t.ok(/refundedQty: unidades/.test(mlSrc), 'reembolso integral do ML leva as unidades junto');

t.fim();
