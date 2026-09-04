// Devoluções da Shopee — o último canal em que a unidade devolvida ainda contava como vendida.
//
// A Shopee tem API de devolução própria, mas a documentação pública não expõe os nomes de campo
// da resposta. O mapeamento foi escrito em cima da resposta REAL (GET /api/shopee/probe-returns,
// rodado em produção em 04/09/2026), e é por isso que os casos abaixo usam os campos de verdade.
//
// O que este teste protege, que quebra em silêncio:
//   1. `item[].amount` é QUANTIDADE, não dinheiro — trocar pelos R$ 101,15 daria 101 unidades
//      devolvidas num pedido de uma;
//   2. a allowlist de status: só reembolso que aconteceu de verdade desconta venda. Um pedido de
//      devolução ainda em análise não pode tirar a unidade;
//   3. status fora da lista não pode sumir calado — ele volta contado, pra vocabulário novo da
//      Shopee aparecer no relatório em vez de virar número errado;
//   4. a mesma devolução vindo em duas páginas não pode descontar duas vezes;
//   5. a reconciliação é patch-only: nunca insere pedido nem toca em total/status/items.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, ROOT } from './_lib.mjs';

const t = criarTeste('Devoluções da Shopee');

// Executa UMA função a partir do texto do arquivo. Não importa os módulos: shopee.js e sync.js
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

const SHOPEE = path.join(ROOT, 'src', 'shopee.js');
const SYNC   = path.join(ROOT, 'src', 'sync.js');

// Uma devolução no formato exato que a API devolve. `amount` no item é a quantidade; o dinheiro
// é `refund_amount`. Os valores vêm da resposta real de produção.
function devolucao(over = {}) {
  return {
    return_sn: '2512190QNHEFYNN',
    order_sn:  '25121012A6411U',
    status:    'ACCEPTED',
    reason:    'NOT_RECEIPT',
    refund_amount: 101.15,
    currency:  'BRL',
    create_time: 1766114209,
    update_time: 1766120110,
    item: [{
      item_id: 18499671853, model_id: 0,
      name: 'L-Lisina para Gatos - Suporte Imunológico, Ocular e Respiratório',
      amount: 1, item_sku: 'LYSINEPOWDER-UPC-GS1-BR', refund_amount: 101.15,
    }],
    ...over,
  };
}

// ── 1. O caso real ────────────────────────────────────────────────────────────
const agrupar = carregar(SHOPEE, 'reembolsosDaLista');
t.ok(typeof agrupar === 'function', 'achou reembolsosDaLista em shopee.js');

if (typeof agrupar === 'function') {
  const { reembolsos, porStatus } = agrupar([devolucao()]);
  t.eq(reembolsos.length, 1, 'a devolução real vira um reembolso');
  const r = reembolsos[0];
  t.eq(r.id, 'shopee:25121012A6411U', 'o id sai no formato que o store usa pro canal');
  // Se alguém ler `refund_amount` como quantidade, isto vira 101.
  t.eq(r.qty, 1, '`amount` do item é lido como QUANTIDADE, não como dinheiro');
  t.eq(r.refundedTotal, 101.15, 'e o dinheiro devolvido vem de refund_amount');
  t.eq(r.porProduto.length, 1, 'com o produto identificado');
  t.eq(r.porProduto[0].sku, 'LYSINEPOWDER-UPC-GS1-BR', 'pelo SKU, que é como a linha do pedido casa');
  t.eq(r.porProduto[0].qty, 1, 'e a unidade daquela linha');
  t.ok(r.returnedAt.startsWith('2025-12-19'), 'a data vem do update_time em segundos');
  t.eq(porStatus.ACCEPTED, 1, 'o status aparece contado no resumo');

  // ── 2. Só reembolso de verdade desconta venda ───────────────────────────────
  // Um pedido de devolução aberto e ainda em análise (ou recusado) não pode tirar a unidade.
  const emAnalise = ['REQUESTED', 'PROCESSING', 'JUDGING', 'CANCELLED', 'CLOSED'].map((status, i) =>
    devolucao({ status, return_sn: 'RS' + i, order_sn: 'ORD' + i }));
  const parados = agrupar(emAnalise);
  t.eq(parados.reembolsos.length, 0, 'devolução em análise, recusada ou cancelada não desconta nada');
  t.eq(parados.porStatus.REQUESTED, 1, 'mas ela aparece no resumo por status');
  t.eq(parados.porStatus.CLOSED, 1, 'inclusive a fechada, que é ambígua e fica de fora por ora');

  // Allowlist positiva: um status que a Shopee invente amanhã não pode começar a descontar
  // venda sozinho. Ele fica de fora E aparece contado, pra alguém decidir o que fazer.
  const novo = agrupar([devolucao({ status: 'REFUND_PAID', return_sn: 'RSX', order_sn: 'ORDX' })]);
  t.eq(novo.reembolsos.length, 0, 'status desconhecido não desconta venda por conta própria');
  t.eq(novo.porStatus.REFUND_PAID, 1, 'e não some calado: volta contado no resumo');

  // ── 3. Duas devoluções no mesmo pedido somam ────────────────────────────────
  const duas = agrupar([
    devolucao({ return_sn: 'A', refund_amount: 50, item: [{ name: 'Lisina', amount: 1, item_sku: 'LIS', refund_amount: 50 }] }),
    devolucao({ return_sn: 'B', refund_amount: 30, item: [{ name: 'Daily',  amount: 2, item_sku: 'DAI', refund_amount: 30 }] }),
  ]);
  t.eq(duas.reembolsos.length, 1, 'duas devoluções do mesmo pedido viram um registro só');
  t.eq(duas.reembolsos[0].qty, 3, 'com as unidades somadas');
  t.eq(duas.reembolsos[0].refundedTotal, 80, 'e o dinheiro somado');
  t.eq(duas.reembolsos[0].porProduto.length, 2, 'guardando cada produto separado');

  // ── 4. A mesma devolução em duas páginas conta uma vez ──────────────────────
  // A lista é paginada sem filtro de data; uma sobreposição entre páginas dobraria a baixa.
  const repetida = agrupar([devolucao(), devolucao()]);
  t.eq(repetida.reembolsos[0].qty, 1, 'a mesma devolução repetida não desconta duas vezes');

  // ── 5. Casos de borda que não podem virar unidade fantasma ──────────────────
  const semItem = agrupar([devolucao({ item: [] })]);
  t.eq(semItem.reembolsos[0].qty, 0, 'devolução sem item conhecido não inventa unidade');
  t.eq(semItem.reembolsos[0].refundedTotal, 101.15, 'mas o dinheiro devolvido continua valendo');

  const semPedido = agrupar([devolucao({ order_sn: '' })]);
  t.eq(semPedido.reembolsos.length, 0, 'devolução sem pedido não vira registro solto');

  const semSn = agrupar([devolucao({ return_sn: '' })]);
  t.eq(semSn.reembolsos.length, 0, 'linha sem identificador de devolução é descartada');
}

// ── 6. Devolveu tudo ou só parte ──────────────────────────────────────────────
// Duas funções no MESMO contexto: classificarReembolsoShopee chama classificarDevolucao.
function carregarJuntas(arquivo, nomes) {
  const src = fs.readFileSync(arquivo, 'utf8');
  const ctx = { console };
  vm.createContext(ctx);
  for (const nome of nomes) {
    const i = src.indexOf(`function ${nome}(`);
    if (i < 0) return {};
    let prof = 0, fim = i;
    for (let j = src.indexOf('{', i); j < src.length; j++) {
      if (src[j] === '{') prof++;
      else if (src[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
    }
    vm.runInContext(src.slice(i, fim), ctx);
  }
  return ctx;
}

const { classificarReembolsoShopee: classificar } = carregarJuntas(SYNC, ['classificarDevolucao', 'classificarReembolsoShopee']);
t.ok(typeof classificar === 'function', 'achou classificarReembolsoShopee em sync.js');

if (typeof classificar === 'function') {
  const doisItens = { total: 202.30, items: [{ qty: 2 }] };
  t.eq(classificar(doisItens, { qty: 2, refundedTotal: 202.30 }), 'total', 'voltaram as duas unidades: devolução total');
  t.eq(classificar(doisItens, { qty: 1, refundedTotal: 101.15 }), 'parcial', 'voltou uma das duas: parcial');
  // Com unidade conhecida, quem manda é ela e não o dinheiro: um reembolso que não devolve o
  // frete vale menos que o pedido, e mesmo assim as duas unidades voltaram.
  t.eq(classificar(doisItens, { qty: 2, refundedTotal: 180 }), 'total', 'as duas unidades voltaram, mesmo o estorno sendo menor que o pedido');
  // Sem unidade detalhada, comparar quantidade daria "parcial" pra um estorno do pedido inteiro.
  t.eq(classificar(doisItens, { qty: 0, refundedTotal: 202.30 }), 'total', 'estorno do valor inteiro sem item detalhado é total');
  t.eq(classificar(doisItens, { qty: 0, refundedTotal: 50 }), 'parcial', 'estorno de parte do valor é parcial');
}

// ── 7. O desconto chega de verdade no número da tela ──────────────────────────
// `pedidoLiquido` (metrics.js) é quem aplica a marca em toda a dashboard. Aqui ele roda com o
// pedido real: duas unidades vendidas, uma devolvida, o valor exato informado pela Shopee.
const liquido = carregar(path.join(ROOT, 'src', 'metrics.js'), 'pedidoLiquido');
t.ok(typeof liquido === 'function', 'achou pedidoLiquido em metrics.js');

if (typeof liquido === 'function') {
  const pedido = {
    id: 'shopee:25121012A6411U', channel: 'shopee', total: 202.30,
    items: [{ title: 'L-Lisina para Gatos', sku: 'LYSINEPOWDER-UPC-GS1-BR', qty: 2, amount: 202.30, refundedQty: 1 }],
    refunded: 'parcial', refundedQty: 1, refundedTotal: 101.15,
  };
  const r = liquido(pedido);
  t.eq(r.items[0].qty, 1, 'a unidade devolvida sai da quantidade vendida');
  t.eq(r.total, 101.15, 'e o dinheiro dela sai da receita, pelo valor que a Shopee informou');
}

// ── 8. Guardas de estrutura (falham em silêncio se quebrarem) ─────────────────
const shopeeSrc = fs.readFileSync(SHOPEE, 'utf8');
const syncSrc   = fs.readFileSync(SYNC, 'utf8');

t.ok(/export async function fetchReturns/.test(shopeeSrc), 'shopee.js expõe fetchReturns');
// O item do pedido precisa carregar o SKU: é por ele que a baixa acha a LINHA certa num pedido
// com mais de um produto. Sem isso, a devolução da areia poderia sair do suplemento.
// Escopado no map de itens do PEDIDO: o mesmo `sku: it.item_sku` aparece no mapeamento da
// devolução, e uma busca no arquivo inteiro passaria com o campo do pedido apagado.
const iItens = shopeeSrc.indexOf('items: (o.item_list || []).map(');
const blocoItens = shopeeSrc.slice(iItens, shopeeSrc.indexOf('})),', iItens));
t.ok(/sku:\s*it\.item_sku/.test(blocoItens), 'o item do pedido guarda o SKU pra casar com a devolução');

// A sonda promete não trazer comentário de comprador — `text_reason` é exatamente isso.
// Comentário fora antes de conferir: o comentário que EXPLICA a ausência de `text_reason` cita o
// nome do campo, e sem isso ele sozinho reprovaria a lista correta.
const iSeguros = shopeeSrc.indexOf('const CAMPOS_SEGUROS');
const blocoSeguros = shopeeSrc.slice(iSeguros, shopeeSrc.indexOf(']', iSeguros)).replace(/\/\/.*$/gm, '');
t.ok(!/'text_reason'/.test(blocoSeguros), 'a sonda não expõe o texto livre que o comprador escreveu');

// Leitura incompleta não pode passar por completa: foi assim que a varredura da Amazon disse
// "não teve reembolso" num período que nem chegou a ser lido.
t.ok(/incompleta = true/.test(shopeeSrc), 'a paginação declara quando a leitura ficou incompleta');
t.ok(/shopee\.returns: lista veio incompleta/.test(syncSrc), 'e o sync reporta isso em vez de engolir');

t.ok(/export async function reconcileShopeeReturns/.test(syncSrc), 'sync.js exporta reconcileShopeeReturns');
t.ok(/await reconcileShopeeReturns\(\)/.test(syncSrc), 'e o sync normal chama a reconciliação a cada ciclo');

// Patch-only: a reconciliação só MARCA pedido que já existe. Se ela passar a inserir, uma
// devolução de pedido que não temos criaria um pedido do nada.
const iRec = syncSrc.indexOf('export async function reconcileShopeeReturns');
const corpoRec = syncSrc.slice(iRec, syncSrc.indexOf('\n}', iRec));
t.ok(/patchOrderRefunds\(/.test(corpoRec), 'a reconciliação grava por patchOrderRefunds');
t.ok(!/upsertOrders\(/.test(corpoRec), 'e nunca insere pedido');

t.fim();
