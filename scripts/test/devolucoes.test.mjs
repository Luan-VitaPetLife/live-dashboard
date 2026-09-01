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

t.fim();
