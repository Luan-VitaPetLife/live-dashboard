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
import { upsertOrders, upsertSessionsDaily, setLastSync, getMetaInsightsDaily, setMetaInsightsDaily, getMetaUSInsightsDaily, setMetaUSInsightsDaily, setMlAdCosts, patchOrderItems, getAmazonCursor, setAmazonCursor } from './store.js';

// Janela padrão de sincronização: últimos 60 dias.
function defaultWindow(days = 60) {
  const today = new Date();
  const since = new Date(today); since.setDate(since.getDate() - days);
  const iso = d => d.toISOString().slice(0, 10);
  return { since: iso(since), until: iso(today) };
}

let syncInFlight = false;

export async function runSync() {
  // O sync da Amazon pode paginar por minutos (cota de 1 req/min). Sem essa trava, o
  // timer de SYNC_INTERVAL_MINUTES dispararia um segundo sync por cima, dobrando as
  // requisições contra o mesmo balde de cota e provocando o 429 que queremos evitar.
  if (syncInFlight) {
    console.log('Sync já em andamento — ignorando disparo.');
    return { skipped: true, reason: 'sync já em andamento', errors: [] };
  }
  syncInFlight = true;
  try {
    return await doSync();
  } finally {
    syncInFlight = false;
  }
}

async function doSync() {
  const { since, until } = defaultWindow();
  // Só usada no primeiro sync (sem cursor). Depois amazon.js passa a buscar apenas o que
  // mudou desde o último sync completo, então uma janela inicial curta basta e mantém a
  // primeira execução dentro do burst de 20 requisições da SP-API.
  const { since: sinceAmazon } = defaultWindow(Number(process.env.AMAZON_BACKFILL_DAYS || 2));
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

  // Amazon US + BR — amazon.js decide sozinho se combina numa chamada só (tokens
  // ainda idênticos, mesma conta/cota) ou faz duas separadas (tokens já distintos).
  // Backoff gerenciado internamente em amazon.js. Ver CLAUDE.md 4.7.
  try {
    if (!amazon.isConfigured()) {
      report.errors.push('amazon: credenciais LWA ausentes (AMAZON_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN)');
    } else if (!amazon.hasAwsCreds()) {
      report.errors.push('amazon: credenciais AWS ausentes (AMAZON_AWS_ACCESS_KEY / AMAZON_AWS_SECRET_KEY)');
    } else {
      const orders = await amazon.fetchOrders(sinceAmazon, until);
      upsertOrders(orders);
      report.amazon    = orders.filter(o => o.market === 'us').length;
      report.amazon_br = orders.filter(o => o.market === 'br').length;
    }
  } catch (e) { report.errors.push('amazon.orders: ' + e.message); }

  setLastSync(new Date().toISOString());
  return report;
}

// ── Reconciliação de nomes de produto da Amazon (Reports API) ──────────────────
//  O sync de pedidos (Orders API) não traz o título do item, então pedidos novos da
//  Amazon entram com items[].title vazio e as telas de Produtos/Estoque vão
//  desatualizando (ver CLAUDE.md 4.7.6 / backlog item 8). Aqui buscamos um relatório
//  curto dos últimos dias (balde de cota próprio, não concorre com o sync de pedidos)
//  e preenchemos os títulos por id, sem tocar em total/status.
//
//  Roda como job separado (server.js), não dentro do runSync, para não deixar o
//  "Sincronizar agora" travado enquanto a Amazon monta o relatório (leva ~1-2 min).
//  Throttle por mercado via cursor 'names-<market>': dispara no máximo a cada
//  AMAZON_NAMES_EVERY_HOURS (padrão 12h), então pode ser chamado com folga sem custo.
const NAMES_EVERY_MS = Number(process.env.AMAZON_NAMES_EVERY_HOURS || 12) * 3600 * 1000;
const NAMES_DAYS     = Number(process.env.AMAZON_NAMES_DAYS || 2);

function namesDue(market) {
  const last = getAmazonCursor(`names-${market}`);
  return !last || (Date.now() - Date.parse(last)) >= NAMES_EVERY_MS;
}

export async function reconcileAmazonNames({ markets = ['us', 'br'], force = false } = {}) {
  const out = { patched: 0, inserted: 0, byMarket: {}, skipped: [], errors: [] };
  if (!amazon.hasAwsCreds()) { out.errors.push('amazon.names: credenciais AWS ausentes'); return out; }

  for (const market of markets) {
    const configured = market === 'us' ? amazon.isConfigured() : amazon.isConfiguredBR();
    if (!configured) { out.skipped.push(`${market}: sem token`); continue; }
    if (!force && !namesDue(market)) { out.skipped.push(`${market}: throttle`); continue; }
    try {
      const named = await amazon.fetchRecentNamedOrders({ market, days: NAMES_DAYS });
      const r = patchOrderItems(named);
      setAmazonCursor(`names-${market}`, new Date().toISOString());
      out.patched  += r.patched;
      out.inserted += r.inserted;
      out.byMarket[market] = r;
    } catch (e) {
      out.errors.push(`amazon.names.${market}: ${e.message}`);
    }
  }
  return out;
}

// Execução direta: node src/sync.js
if (import.meta.url === `file://${process.argv[1]}`) {
  runSync().then(r => { console.log('Sync concluído:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
