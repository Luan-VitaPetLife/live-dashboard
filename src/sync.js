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
import * as amazon from './amazon.js';
import { upsertOrders, upsertSessionsDaily, setLastSync, getMetaInsightsDaily, setMetaInsightsDaily, getMetaUSInsightsDaily, setMetaUSInsightsDaily, setMlAdCosts } from './store.js';

// Janela padrão de sincronização: últimos 60 dias.
function defaultWindow(days = 60) {
  const today = new Date();
  const since = new Date(today); since.setDate(since.getDate() - days);
  const iso = d => d.toISOString().slice(0, 10);
  return { since: iso(since), until: iso(today) };
}

export async function runSync() {
  const { since, until } = defaultWindow();
  const { since: since7 } = defaultWindow(7); // Amazon: janela curta reduz chamadas paginadas
  const report = { shopify: 0, shopify_us: 0, shopee: 0, mercadolivre: 0, amazon: 0, amazon_br: 0, meta: 0, sessions: 0, errors: [] };

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

  // Mercado Livre — custo de anúncios (Product Ads API; retorna zeros se sem acesso)
  try {
    const adCosts = await ml.fetchAdCosts(since, until);
    setMlAdCosts({ since, until, ...adCosts });
    report.ml_ads_spend = adCosts.spend;
  } catch (e) { report.errors.push('mercadolivre.ads: ' + e.message); }

  // Meta BR — gasto diário de anúncios (Coco and Luna)
  try {
    const insights = await meta.fetchInsights(since, until);
    const existing = getMetaInsightsDaily();
    setMetaInsightsDaily({ ...existing, ...insights });
    report.meta = Object.keys(insights).length;
  } catch (e) { report.errors.push('meta.insights: ' + e.message); }

  // Meta EUA — gasto diário de anúncios (Vita Pet Life)
  try {
    const usAccountId = meta.AD_ACCOUNT_ID_US;
    if (usAccountId) {
      const insights = await meta.fetchInsights(since, until, usAccountId);
      const existing = getMetaUSInsightsDaily();
      setMetaUSInsightsDaily({ ...existing, ...insights });
      report.meta_us = Object.keys(insights).length;
    }
  } catch (e) { report.errors.push('meta_us.insights: ' + e.message); }

  // ── Mercado EUA ───────────────────────────────

  // Shopify EUA (opcional — requer SHOPIFY_US_STORE + SHOPIFY_US_ADMIN_TOKEN)
  try {
    const usStore = process.env.SHOPIFY_US_STORE;
    const usToken = process.env.SHOPIFY_US_ADMIN_TOKEN;
    if (usStore && usToken) {
      const orders = await shopify.fetchOrders(since, until, { store: usStore, token: usToken, market: 'us', channel: 'shopify_us' });
      upsertOrders(orders);
      report.shopify_us = orders.length;
    }
  } catch (e) { report.errors.push('shopify_us.orders: ' + e.message); }

  // Shopify EUA — sessões diárias (requer escopo read_analytics no token US)
  try {
    const usStore = process.env.SHOPIFY_US_STORE;
    const usToken = process.env.SHOPIFY_US_ADMIN_TOKEN;
    if (usStore && usToken) {
      const sessions = await shopify.fetchSessionsDaily(90, { store: usStore, token: usToken });
      upsertSessionsDaily(sessions, 'us');
      report.sessions_us = sessions.length;
    }
  } catch (e) { report.errors.push('shopify_us.sessions: ' + e.message); }

  // Amazon US + BR — duas chamadas separadas, cada uma com seu próprio LWA token e backoff.
  // US requer AMAZON_REFRESH_TOKEN (autorizar em sellercentral.amazon.com — NA Seller Central).
  // BR requer AMAZON_BR_REFRESH_TOKEN (autorizar em sellercentral.amazon.com.br — BR Seller Central).
  // Backoff exponencial independente por mercado, gerenciado internamente em amazon.js.
  try {
    if (!amazon.isConfigured()) {
      report.errors.push('amazon: credenciais LWA ausentes (AMAZON_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN)');
    } else if (!amazon.hasAwsCreds()) {
      report.errors.push('amazon: credenciais AWS ausentes (AMAZON_AWS_ACCESS_KEY / AMAZON_AWS_SECRET_KEY)');
    } else {
      const orders = await amazon.fetchOrders(since7, until);
      upsertOrders(orders);
      report.amazon    = orders.filter(o => o.market === 'us').length;
      report.amazon_br = orders.filter(o => o.market === 'br').length;
    }
  } catch (e) { report.errors.push('amazon.orders: ' + e.message); }

  setLastSync(new Date().toISOString());
  return report;
}

// Execução direta: node src/sync.js
if (import.meta.url === `file://${process.argv[1]}`) {
  runSync().then(r => { console.log('Sync concluído:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
