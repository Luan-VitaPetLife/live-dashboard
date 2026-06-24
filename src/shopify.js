// ─────────────────────────────────────────────
//  shopify.js — integração com a Shopify Admin API
//  - Pedidos via GraphQL (exclui cancelados/expirados)
//  - Sessões diárias via ShopifyQL (shopifyqlQuery)
// ─────────────────────────────────────────────
import 'dotenv/config';

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

function endpoint() {
  return `https://${STORE}/admin/api/${VERSION}/graphql.json`;
}

async function gql(query, variables = {}) {
  if (!STORE || !TOKEN) throw new Error('Shopify não configurado (.env: SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN).');
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors && !json.data) throw new Error('Shopify GraphQL: ' + JSON.stringify(json.errors));
  return json.data;
}

const CANCELLED = new Set(['EXPIRED', 'VOIDED', 'CANCELLED']);

// Busca pedidos no intervalo [sinceISO, untilISO] (datas YYYY-MM-DD), normalizados.
export async function fetchOrders(sinceISO, untilISO) {
  const q = `created_at:>=${sinceISO}T00:00:00-03:00 created_at:<=${untilISO}T23:59:59-03:00`;
  let after = null, out = [], guard = 0;
  do {
    const data = await gql(`
      query($q: String!, $after: String) {
        orders(first: 100, sortKey: CREATED_AT, query: $q, after: $after) {
          edges { node {
            id name createdAt displayFinancialStatus cancelledAt
            currentTotalPriceSet { shopMoney { amount } }
            customerJourneySummary { lastVisit { source } }
            customer { displayName }
            shippingAddress { provinceCode }
            lineItems(first: 20) { edges { node { title quantity discountedTotalSet { shopMoney { amount } } } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { q, after });
    const conn = data.orders;
    for (const e of conn.edges) {
      const n = e.node;
      const status = n.displayFinancialStatus;
      out.push({
        id: n.id,
        channel: 'shopify',
        name: n.name,
        createdAt: n.createdAt,
        status,
        cancelled: !!n.cancelledAt || CANCELLED.has(status),
        total: parseFloat(n.currentTotalPriceSet?.shopMoney?.amount || '0'),
        source: n.customerJourneySummary?.lastVisit?.source || '',
        customer: n.customer?.displayName || '',
        state: n.shippingAddress?.provinceCode || null,
        items: (n.lineItems?.edges || []).map(x => ({
          title: x.node.title,
          qty: x.node.quantity,
          amount: parseFloat(x.node.discountedTotalSet?.shopMoney?.amount || '0'),
        })),
      });
    }
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    guard++;
  } while (after && guard < 50);
  return out;
}

// Sessões diárias via ShopifyQL para os últimos N dias.
export async function fetchSessionsDaily(days = 90) {
  const query = `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day SINCE -${days}d UNTIL today`;
  const data = await gql(`
    query($q: String!) {
      shopifyqlQuery(query: $q) {
        tableData {
          columns { name }
          rows
        }
        parseErrors
      }
    }`, { q: query });
  const r = data.shopifyqlQuery;
  if (r?.parseErrors?.length) throw new Error('ShopifyQL: ' + JSON.stringify(r.parseErrors));
  const rows = r?.tableData?.rows || [];
  // rows: array de objetos com chaves nomeadas pelas colunas
  return rows.map(row => ({
    date: String(row.day).slice(0, 10),
    sessions: Number(row.sessions) || 0,
    visitors: Number(row.online_store_visitors) || 0,
    cart: Number(row.sessions_with_cart_additions) || 0,
    checkout: Number(row.sessions_that_reached_checkout) || 0,
    completed: Number(row.sessions_that_completed_checkout) || 0,
  }));
}
