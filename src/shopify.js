// shopify.js — Shopify Admin GraphQL API
// fetchOrders e fetchSessionsDaily aceitam cfg opcional
// para suportar múltiplas lojas (BR + US).
import 'dotenv/config';

const STORE   = process.env.SHOPIFY_STORE;
const TOKEN   = process.env.SHOPIFY_ADMIN_TOKEN;
const VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

async function gqlFetch(store, token, version, query, variables = {}) {
  if (!store || !token) throw new Error(`Shopify não configurado (store: ${store || '?'}).`);
  const res = await fetch(`https://${store}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors && !json.data) throw new Error('Shopify GraphQL: ' + JSON.stringify(json.errors));
  return json.data;
}

// Decisão (CLAUDE.md 4.1 — "decisão em aberto" resolvida): só pedido com pagamento de verdade
// recebido conta como venda. EXPIRED/VOIDED já eram excluídos (pagamento nunca aconteceu).
// Adicionado PENDING (aguardando, pode falhar — Pix/boleto) e AUTHORIZED (cartão autorizado mas
// NÃO capturado, dinheiro ainda não foi cobrado).
// PAID/PARTIALLY_PAID/PARTIALLY_REFUNDED/REFUNDED continuam contando — teve pagamento real
// (REFUNDED já zera sozinho via ajuste de devolução, ver 4.15).
const CANCELLED = new Set(['EXPIRED', 'VOIDED', 'CANCELLED', 'PENDING', 'AUTHORIZED']);

// cfg: { store, token, version, market, channel, tz }
export async function fetchOrders(sinceISO, untilISO, cfg = {}) {
  const store   = cfg.store   || STORE;
  const token   = cfg.token   || TOKEN;
  const version = cfg.version || VERSION;
  const market  = cfg.market  || 'br';
  const channel = cfg.channel || 'shopify';
  const tz      = cfg.tz      || (market === 'us' ? 'Z' : '-03:00');

  const q = `created_at:>=${sinceISO}T00:00:00${tz} created_at:<=${untilISO}T23:59:59${tz}`;
  let after = null, out = [], guard = 0;
  do {
    const data = await gqlFetch(store, token, version, `
      query($q: String!, $after: String) {
        orders(first: 100, sortKey: CREATED_AT, query: $q, after: $after) {
          edges { node {
            id name createdAt displayFinancialStatus cancelledAt
            currentTotalPriceSet { shopMoney { amount } }
            customerJourneySummary { lastVisit { source } }
            customer { displayName }
            shippingAddress { provinceCode }
            lineItems(first: 20) { edges { node { id title variantTitle currentQuantity discountedTotalSet { shopMoney { amount } } product { tags productType } lineItemGroup { id title quantity } image { url } } } }
            refunds { refundLineItems(first: 20) { edges { node { lineItem { id } subtotalSet { shopMoney { amount } } } } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { q, after });
    const conn = data.orders;
    for (const e of conn.edges) {
      const n = e.node, status = n.displayFinancialStatus;
      // Mapa lineItemId -> valor total devolvido nesse item (pode haver mais de um
      // reembolso por pedido/item; somamos todos antes de descontar do amount bruto).
      const refundByLineItemId = {};
      for (const r of n.refunds || []) {
        for (const rli of r.refundLineItems?.edges || []) {
          const liId = rli.node.lineItem?.id;
          if (!liId) continue;
          refundByLineItemId[liId] = (refundByLineItemId[liId] || 0) + parseFloat(rli.node.subtotalSet?.shopMoney?.amount || '0');
        }
      }
      out.push({
        id:        n.id,
        channel,
        market,
        name:      n.name,
        createdAt: n.createdAt,
        status,
        cancelled: !!n.cancelledAt || CANCELLED.has(status),
        total:     parseFloat(n.currentTotalPriceSet?.shopMoney?.amount || '0'),
        source:    n.customerJourneySummary?.lastVisit?.source || '',
        customer:  n.customer?.displayName || '',
        state:     n.shippingAddress?.provinceCode || null,
        items:     (n.lineItems?.edges || []).map(x => ({
          title:       tituloDoItem(x.node.title, x.node.variantTitle),
          qty:         x.node.currentQuantity,
          // `currentQuantity` 0 quer dizer que esta linha não faz mais parte do pedido (item
          // devolvido, removido numa edição, ou reposto no estoque ao cancelar). O
          // `discountedTotalSet` NÃO acompanha: fica com o valor original. Sem zerar aqui, a
          // dashboard guarda o dinheiro de mercadoria que saiu do pedido e o produto aparece no
          // Top produtos com receita e nenhuma unidade. Achado em produção (pedido #19681). O
          // próprio `currentTotalPriceSet` do pedido já desconta essas linhas, então manter o
          // valor no item fazia a soma dos itens discordar do total do pedido.
          amount:      x.node.currentQuantity > 0
                         ? parseFloat(x.node.discountedTotalSet?.shopMoney?.amount || '0') - (refundByLineItemId[x.node.id] || 0)
                         : 0,
          tags:        x.node.product?.tags || [],
          productType: x.node.product?.productType || null,
          // Presente quando o item foi vendido através de um combo (Shopify Bundles):
          // o produto aparece como item individual, mas com qty/preço do combo.
          bundle:      x.node.lineItemGroup ? { id: x.node.lineItemGroup.id, title: x.node.lineItemGroup.title, qty: x.node.lineItemGroup.quantity } : null,
          image:       x.node.image?.url || null,
        })),
      });
    }
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    guard++;
  } while (after && guard < 50);
  return out;
}

// Catálogo bruto de produtos cadastrados (vendidos ou não) — usado pelo Unificador pra
// organizar produtos ANTES de terem qualquer venda. Diferente de fetchOrders/aggregateProductsByChannel,
// que só enxergam produto que já apareceu em algum pedido.
// Nome do produto como a dashboard conta.
//
// A Shopify manda o título do PRODUTO e o da VARIANTE separados, e um produto com quatro variantes
// chega com o mesmo `title` nas quatro: foi assim que o "Urinary Tract" da loja dos EUA virou uma
// linha só somando Soft Chews, Tablet, Powder e Liquid (relatado pelo Luan, 08/09/2026). Não era o
// Unificador juntando: elas nunca chegaram separadas.
//
// Variante é produto diferente pra tudo que importa aqui: tem estoque próprio, custo próprio e
// venda própria. Somá-las esconde qual das quatro está vendendo e qual está parada.
//
// "Default Title" é o nome que a Shopify dá à variante única de um produto sem variação — ele
// jamais pode aparecer no nome. Variante com o mesmo nome do produto também não vira sufixo.
export function tituloDoItem(title, variantTitle) {
  const t = String(title || '').trim();
  const v = String(variantTitle || '').trim();
  if (!v || v.toLowerCase() === 'default title' || v === t) return t;
  return `${t} - ${v}`;
}

export async function fetchProductCatalog(cfg = {}) {
  const store   = cfg.store   || STORE;
  const token   = cfg.token   || TOKEN;
  const version = cfg.version || VERSION;

  // Por VARIANTE, não por produto. O item do pedido carrega o nome da variante (ver tituloDoItem),
  // então um catálogo por produto deixaria de casar com ele em tudo que cruza os dois: o produto-pai
  // viraria uma linha sem venda nenhuma em Produtos/Estoque, e a tag e o Type atuais do catálogo
  // deixariam de ser encontrados pro produto com variação — a decisão de ocultar voltaria a depender
  // da tag presa no pedido antigo, que é exatamente o que o catálogo existe pra evitar.
  //
  // `productVariants` na raiz em vez de variantes aninhadas em `products`: conexão dentro de
  // conexão multiplica o custo da consulta na Shopify, e 100 produtos × 100 variantes estoura o
  // limite. Todo produto tem pelo menos uma variante ("Default Title"), então nada fica de fora.
  let after = null, out = [], guard = 0;
  do {
    const data = await gqlFetch(store, token, version, `
      query($after: String) {
        productVariants(first: 100, after: $after) {
          edges { node { title product { title status productType tags featuredImage { url } } } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { after });
    const conn = data.productVariants;
    for (const e of conn.edges) {
      const v = e.node, n = v.product || {};
      // `status` é ACTIVE / DRAFT / ARCHIVED. A consulta traz os três, e é isso que queremos pros
      // índices de tag e tipo (produto arquivado que já vendeu continua precisando das tags atuais
      // pra decisão de ocultar). Quem separa é o mergeShopifyCatalog, que só LISTA produto ativo.
      out.push({ title: tituloDoItem(n.title, v.title), status: n.status || null, image: n.featuredImage?.url || null, productType: n.productType || null, tags: n.tags || [] });
    }
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    guard++;
  } while (after && guard < 50);
  return out;
}

export async function fetchSessionsDaily(days = 90, cfg = {}) {
  const store   = cfg.store   || STORE;
  const token   = cfg.token   || TOKEN;
  const version = cfg.version || VERSION;
  const query = `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day SINCE -${days}d UNTIL today`;
  const data = await gqlFetch(store, token, version, `
    query($q: String!) {
      shopifyqlQuery(query: $q) {
        tableData { columns { name } rows }
        parseErrors
      }
    }`, { q: query });
  const r = data.shopifyqlQuery;
  if (r?.parseErrors?.length) throw new Error('ShopifyQL: ' + JSON.stringify(r.parseErrors));
  return (r?.tableData?.rows || []).map(row => ({
    date:      String(row.day).slice(0, 10),
    sessions:  Number(row.sessions) || 0,
    visitors:  Number(row.online_store_visitors) || 0,
    cart:      Number(row.sessions_with_cart_additions) || 0,
    checkout:  Number(row.sessions_that_reached_checkout) || 0,
    completed: Number(row.sessions_that_completed_checkout) || 0,
  }));
}
