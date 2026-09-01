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
// As duas fontes precisam continuar ligadas ao job. Sem esta trava, alguém removeria a consulta
// ao extrato e o único sintoma seria reembolso sem devolução física parando de ser descontado —
// ou seja, quantidade vendida errada, em silêncio.
t.ok(/amazon\.fetchCustomerReturns\(/.test(syncSC), 'o job consulta o relatório de devoluções');
t.ok(/amazon\.fetchSettlementRefunds\(/.test(syncSC), 'o job consulta o extrato de repasse');
t.ok(/juntarFontesDeReembolso\(devolucoes, repasse\.reembolsos\)/.test(syncSC),
  'e junta as duas antes de gravar');
t.ok(/for \(const d of reembolsos\)/.test(syncSC),
  'o job percorre a lista JUNTADA, não só as devoluções físicas');
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

// ── 6. Extrato de repasse: a segunda fonte de reembolso ─────────────────────
// Ela existe porque o relatório de devoluções só vê mercadoria que voltou fisicamente. Um pedido
// real de 08/08/2026, com "Reembolso aplicado (2)" no Seller Central, não existe naquele relatório
// nem numa janela de 90 dias — o dinheiro voltou e o produto ficou com o cliente. Sem esta fonte
// aquelas duas unidades continuam contando como vendidas, que é justamente o número errado.
const doRepasse = carregar(AMAZON, 'reembolsosDoRepasse');
t.ok(typeof doRepasse === 'function', 'achou reembolsosDoRepasse em amazon.js');

if (typeof doRepasse === 'function') {
  // Linhas no formato real do extrato (colunas conferidas contra a conta BR de produção).
  const lin = (extra) => ({ 'transaction-type': 'Refund', 'order-id': '701-0000000-0000001',
    'posted-date': '2026-08-15T03:12:08+00:00', sku: 'AREIA-4.5KG', ...extra });

  // A função recebe DOCUMENTOS (uma lista de linhas por repasse), não linhas soltas.
  const repasseUm = [
    // O pedido de verdade: duas unidades reembolsadas, cada uma com a SUA linha Principal.
    lin({ 'settlement-id': 'R1', 'price-type': 'Principal', 'price-amount': '-67.49' }),
    lin({ 'settlement-id': 'R1', 'price-type': 'Shipping',  'price-amount': '-4.45' }),
    lin({ 'settlement-id': 'R1', 'price-type': 'Principal', 'price-amount': '-67.49' }),
    lin({ 'settlement-id': 'R1', 'price-type': 'Shipping',  'price-amount': '-4.45' }),
    // Comissão estornada ao VENDEDOR: não é dinheiro que saiu da venda, não entra no desconto.
    lin({ 'settlement-id': 'R1', 'item-related-fee-type': 'Commission', 'item-related-fee-amount': '14.98' }),
    // Venda normal do mesmo período não pode virar reembolso.
    { 'settlement-id': 'R1', 'transaction-type': 'Order', 'order-id': '701-0000000-0000002',
      'price-type': 'Principal', 'price-amount': '59.99', sku: 'AREIA-4.5KG' },
  ];
  const r = doRepasse([repasseUm], 'br');

  t.eq(r.length, 1, 'só o pedido reembolsado entra (venda normal fica de fora)');
  t.eq(r[0].id, 'amazon-br:701-0000000-0000001', 'id sai carimbado com o mercado');
  t.eq(r[0].qty, 2, 'duas linhas Principal = duas unidades reembolsadas');
  t.eq(r[0].refundedTotal, 143.88, 'soma produto e frete, positivo (2x67,49 + 2x4,45)');
  t.eq(r[0].porProduto.length, 1, 'as duas unidades são do mesmo SKU');
  t.eq(r[0].porProduto[0].sku, 'AREIA-4.5KG', 'guarda o SKU, que é como o extrato identifica o produto');
  t.eq(r[0].porProduto[0].qty, 2, 'com as duas unidades');

  // Linha sem pedido não vira registro fantasma.
  t.eq(doRepasse([[{ 'transaction-type': 'Refund', 'order-id': '', 'price-type': 'Principal', 'price-amount': '-10' }]], 'br').length,
    0, 'linha sem número de pedido é descartada');

  // O MESMO repasse chega em mais de um relatório da Amazon. Lê-lo duas vezes dobraria o
  // reembolso, que é o erro mais caro possível aqui: descontaria o dobro do que voltou.
  const repetido = doRepasse([repasseUm, repasseUm.map(l => ({ ...l }))], 'br');
  t.eq(repetido.length, 1, 'repasse repetido não vira um segundo pedido');
  t.eq(repetido[0].qty, 2, 'e não dobra as unidades');
  t.eq(repetido[0].refundedTotal, 143.88, 'nem o valor');

  // Descartar por LINHA repetida, em vez de por repasse, contaria a menos: as duas unidades do
  // mesmo produto geram duas linhas idênticas de propósito.
  t.eq(doRepasse([[
    lin({ 'settlement-id': 'R9', 'price-type': 'Principal', 'price-amount': '-10.00' }),
    lin({ 'settlement-id': 'R9', 'price-type': 'Principal', 'price-amount': '-10.00' }),
  ]], 'br')[0].qty, 2, 'duas linhas idênticas no MESMO repasse são duas unidades de verdade');

  // Repasses diferentes do mesmo pedido somam (reembolso parcelado em dois ciclos).
  const doisCiclos = doRepasse([
    [lin({ 'settlement-id': 'R1', 'price-type': 'Principal', 'price-amount': '-10.00' })],
    [lin({ 'settlement-id': 'R2', 'price-type': 'Principal', 'price-amount': '-10.00' })],
  ], 'br');
  t.eq(doisCiclos[0].qty, 2, 'repasses diferentes somam');
}

// ── 7. As duas fontes juntas não podem contar a mesma unidade duas vezes ────
const juntar = carregar(SYNC, 'juntarFontesDeReembolso');
t.ok(typeof juntar === 'function', 'achou juntarFontesDeReembolso em sync.js');

if (typeof juntar === 'function') {
  const devolucao = { id: 'amazon-br:X', orderId: 'X', qty: 1, returnedAt: '2026-08-30',
    porProduto: [{ asin: 'A1', sku: null, title: null, qty: 1 }] };
  const repasse   = { id: 'amazon-br:X', orderId: 'X', qty: 1, refundedTotal: 59.99, returnedAt: '2026-08-28',
    porProduto: [{ asin: null, sku: 'S1', title: null, qty: 1 }] };

  const juntos = juntar([devolucao], [repasse]);
  t.eq(juntos.length, 1, 'o mesmo pedido nas duas fontes vira um registro só');
  t.eq(juntos[0].qty, 1, 'UMA unidade devolvida continua sendo uma (não soma as duas fontes)');
  t.eq(juntos[0].refundedTotal, 59.99, 'o valor exato vem do extrato');
  t.eq(juntos[0].porProduto.length, 1, 'e um produto só');
  t.eq(juntos[0].porProduto[0].asin, 'A1', 'guarda o ASIN, que só a devolução tem');
  t.eq(juntos[0].porProduto[0].sku,  'S1', 'e o SKU, que só o extrato tem');

  // Cada fonte sozinha continua valendo: é isso que faz o reembolso sem devolução física entrar.
  t.eq(juntar([devolucao], []).length, 1, 'pedido só no relatório de devoluções entra');
  const soRepasse = juntar([], [{ ...repasse, id: 'amazon-br:Y', orderId: 'Y' }]);
  t.eq(soRepasse.length, 1, 'pedido só no extrato de repasse entra (reembolso sem devolução)');
  t.eq(soRepasse[0].refundedTotal, 59.99, 'com o valor do extrato');

  // Quando as fontes discordam do produto, vale o extrato — concatenar marcaria duas unidades
  // onde só uma voltou.
  const discordam = juntar(
    [{ ...devolucao, qty: 2, porProduto: [{ asin: 'A1', qty: 1 }, { asin: 'A2', qty: 1 }] }],
    [{ ...repasse, qty: 2, porProduto: [{ sku: 'S1', qty: 2 }] }]);
  t.eq(discordam[0].porProduto.length, 1, 'fontes em desacordo: vale o extrato, sem concatenar');
  t.eq(discordam[0].porProduto.reduce((a, p) => a + p.qty, 0), 2, 'e o total de unidades não infla');
}

// ── 8. O que a tela recebe precisa carregar a marca ─────────────────────────
// A tela monta o rótulo a partir de status + cancelled + refunded (statusTag). Mandar os dois
// primeiros e esquecer o terceiro não dá erro nenhum: o pedido devolvido aparece "Autorizado" com
// valor R$ 0,00, que é a pior combinação — o número já descontou e o rótulo diz que está tudo bem.
// Foi o que aconteceu no primeiro deploy.
// Duas formas de estar certo: mandar `refunded` (e a tela monta o rótulo) ou mandar o
// `statusLabel` já pronto do servidor (é o caso da exportação em CSV). O que não pode é mandar só
// `status` e `cancelled`, porque aí a devolução não tem como chegar do outro lado.
for (const bloco of metrics.split('.map(o => ({').slice(1)) {
  const corpo = bloco.slice(0, bloco.indexOf('}))'));
  if (!corpo.includes('status: o.status')) continue;
  t.ok(corpo.includes('refunded') || corpo.includes('statusLabel'),
    'lista de pedidos com status leva também a devolução (campo refunded ou rótulo pronto)');
}

t.fim();
