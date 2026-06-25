// ─────────────────────────────────────────────
//  sync.js — busca dados dos canais e grava no store.
//  Pode rodar via "npm run sync" (uma vez) ou pelo
//  agendador do server.js (a cada N minutos).
// ─────────────────────────────────────────────
import 'dotenv/config';
import * as shopify from './shopify.js';
import * as shopee from './shopee.js';
import * as ml from './mercadolivre.js';
import * as meta from './meta.js';
import { upsertOrders, upsertSessionsDaily, setLastSync, getMetaInsightsDaily, setMetaInsightsDaily } from './store.js';

// Janela padrão de sincronização: últimos 60 dias.
function defaultWindow(days = 60) {
  const today = new Date();
  const since = new Date(today); since.setDate(since.getDate() - days);
  const iso = d => d.toISOString().slice(0, 10);
  return { since: iso(since), until: iso(today) };
}

export async function runSync() {
  const { since, until } = defaultWindow();
  const report = { shopify: 0, shopee: 0, mercadolivre: 0, meta: 0, sessions: 0, errors: [] };

  // Shopify — pedidos
  try {
    const orders = await shopify.fetchOrders(since, until);
    upsertOrders(orders);
    report.shopify = orders.length;
  } catch (e) { report.errors.push('shopify.orders: ' + e.message); }

  // Shopify — sessões diárias
  try {
    const sessions = await shopify.fetchSessionsDaily(90);
    upsertSessionsDaily(sessions);
    report.sessions = sessions.length;
  } catch (e) { report.errors.push('shopify.sessions: ' + e.message); }

  // Shopee — pedidos (só se já autorizada)
  try {
    const orders = await shopee.fetchOrders(since, until);
    upsertOrders(orders);
    report.shopee = orders.length;
  } catch (e) { report.errors.push('shopee.orders: ' + e.message); }

  // Mercado Livre — pedidos (só se já autorizado)
  try {
    const orders = await ml.fetchOrders(since, until);
    upsertOrders(orders);
    report.mercadolivre = orders.length;
  } catch (e) { report.errors.push('mercadolivre.orders: ' + e.message); }

  // Meta — gasto diário de anúncios (Instagram + Facebook)
  try {
    const insights = await meta.fetchInsights(since, until);
    const existing = getMetaInsightsDaily();
    setMetaInsightsDaily({ ...existing, ...insights });
    report.meta = Object.keys(insights).length;
  } catch (e) { report.errors.push('meta.insights: ' + e.message); }

  setLastSync(new Date().toISOString());
  return report;
}

// Execução direta: node src/sync.js
if (import.meta.url === `file://${process.argv[1]}`) {
  runSync().then(r => { console.log('Sync concluído:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
