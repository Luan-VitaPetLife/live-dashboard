// ─────────────────────────────────────────────
//  shopify.js — Shopify Admin GraphQL API
//  fetchOrders e fetchSessionsDaily aceitam cfg opcional
//  para suportar múltiplas lojas (BR + US).
// ─────────────────────────────────────────────
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

const CANCELLED = new Set(['EXPIRED', 'VOIDED', 'CANCELLED']);

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
            lineItems(first: 20) { edges { node { title quantity discountedTotalSet { shopMoney { amount } } product { tags productType } lineItemGroup { id title quantity } } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { q, after });
    const conn = data.orders;
    for (const e of conn.edges) {
      const n = e.node, status = n.displayFinancialStatus;
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
          title:       x.node.title,
          qty:         x.node.quantity,
          amount:      parseFloat(x.node.discountedTotalSet?.shopMoney?.amount || '0'),
          tags:        x.node.product?.tags || [],
          productType: x.node.product?.productType || null,
          // Presente quando o item foi vendido através de um combo (Shopify Bundles):
          // o produto aparece como item individual, mas com qty/preço do combo.
          bundle:      x.node.lineItemGroup ? { id: x.node.lineItemGroup.id, title: x.node.lineItemGroup.title } : null,
        })),
      });
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
