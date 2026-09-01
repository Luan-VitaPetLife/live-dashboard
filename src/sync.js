// sync.js — busca dados dos canais e grava no store.
// Pode rodar via "npm run sync" (uma vez) ou pelo
// agendador do server.js (a cada N minutos).

import 'dotenv/config';
import * as shopify from './shopify.js';
import * as shopee from './shopee.js';
import * as ml from './mercadolivre.js';
import * as meta from './meta.js';
import * as amazon from './amazon.js';
import * as bling from './bling.js';
import * as shopifyYucaloo from './shopifyYucaloo.js';
import { upsertOrders, upsertSessionsDaily, setLastSync, getMetaInsightsDaily, setMetaInsightsDaily, getMetaUSInsightsDaily, setMetaUSInsightsDaily, getMlAdCostsDaily, setMlAdCostsDaily, patchOrderItems, patchOrderState, patchOrderRefunds, getAmazonCursor, setAmazonCursor, pruneOrders, getOrders, isIntegrationEnabled, setShopifyProductCatalog, getYucalooSessionsDaily, setYucalooSessionsDaily, getAmazonRetentionConfig } from './store.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Janela padrão de sincronização: últimos 60 dias.
function defaultWindow(days = 60) {
  const today = new Date();
  const since = new Date(today); since.setDate(since.getDate() - days);
  const iso = d => d.toISOString().slice(0, 10);
  return { since: iso(since), until: iso(today) };
}

// Grava sessões da Yucaloo no balde dela (por mercado) — kv.yucalooSessionsDaily, separado do
// sessions_daily da Coco and Luna pra não colidir chave de data (ver store.js).
function storeYucalooSessions(mkt, rows) {
  const all = getYucalooSessionsDaily();
  const byDate = { ...(all[mkt] || {}) };
  for (const r of rows) byDate[r.date] = r;
  all[mkt] = byDate;
  setYucalooSessionsDaily(all);
}

// Mantém kv.mlAdCostsDaily em dia — sempre reconfirma os últimos ML_ADS_RECENT_DAYS (o dia de
// hoje ainda está em andamento, gasto sobe ao longo do dia) e preenche até ML_ADS_MAX_BACKFILL
// dias que ainda faltam na janela padrão, um pouco a cada ciclo em vez de tudo de uma vez (evita
// um estouro de chamadas na primeira vez que isso roda). Devolve o gasto total do dia mais
// recente só pra aparecer em report.ml_ads_spend (diagnóstico), não é usado em cálculo nenhum.
const ML_ADS_RECENT_DAYS = 2;
const ML_ADS_MAX_BACKFILL = 10;
async function syncMlAdCostsDaily() {
  const existing = getMlAdCostsDaily();
  const { since } = defaultWindow();
  const allDays = [];
  for (let d = new Date(since + 'T00:00:00Z'); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
    allDays.push(d.toISOString().slice(0, 10));
  }
  const recent = allDays.slice(-ML_ADS_RECENT_DAYS);
  const recentSet = new Set(recent);
  const missing = allDays.filter(day => !existing[day] && !recentSet.has(day)).slice(0, ML_ADS_MAX_BACKFILL);
  const toFetch = [...recent, ...missing];

  const fetched = await ml.fetchAdCostsForDays(toFetch);
  Object.assign(existing, fetched);
  if (Object.keys(fetched).length) setMlAdCostsDaily(existing);
  return fetched[recent[recent.length - 1]]?.spend || 0;
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
  const report = { shopify: 0, shopify_us: 0, shopee: 0, mercadolivre: 0, amazon: 0, amazon_br: 0, meta: 0, sessions: 0, errors: [], disabled: [] };

  // Shopify — pedidos
  if (isIntegrationEnabled('shopify_br')) {
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

    // Shopify — catálogo bruto de produtos (vendido ou não). Ver Unificador,
    // CLAUDE.md 4.20 — antes o Unificador só enxergava produto que já tinha
    // alguma venda; isso preenche kv.shopifyProductCatalog pra ele mostrar tudo.
    try {
      const catalog = await shopify.fetchProductCatalog();
      setShopifyProductCatalog('shopify', catalog);
      report.shopify_catalog = catalog.length;
    } catch (e) { report.errors.push('shopify.catalog: ' + e.message); }
  } else { report.disabled.push('shopify_br'); }

  // Yucaloo BR — pedidos (Shopify, 2ª marca — market igual à Coco and Luna,
  // channel próprio "yucaloo_br". Ver CLAUDE.md 4.20. fetchOrders/fetchProductCatalog
  // devolvem [] sozinhos se ainda não conectada.
  if (isIntegrationEnabled('yucaloo_br')) {
    try {
      const orders = await shopifyYucaloo.fetchOrders(since, until, 'br');
      upsertOrders(orders);
      report.yucaloo_br = orders.length;
    } catch (e) { report.errors.push('yucaloo_br.orders: ' + e.message); }

    // Yucaloo BR — sessões diárias (loja Shopify própria, balde separado da Coco and Luna — ver
    // storeYucalooSessions/CLAUDE.md). Card "Tráfego & conversão" da Visão geral.
    try {
      const sessions = await shopifyYucaloo.fetchSessionsDaily('br', 90);
      storeYucalooSessions('br', sessions);
      report.yucaloo_br_sessions = sessions.length;
    } catch (e) { report.errors.push('yucaloo_br.sessions: ' + e.message); }

    try {
      const catalog = await shopifyYucaloo.fetchProductCatalog('br');
      setShopifyProductCatalog('yucaloo_br', catalog);
      report.yucaloo_br_catalog = catalog.length;
    } catch (e) { report.errors.push('yucaloo_br.catalog: ' + e.message); }
  } else { report.disabled.push('yucaloo_br'); }

  // Shopee — pedidos (só se já autorizada)
  if (isIntegrationEnabled('shopee')) {
    try {
      const orders = await shopee.fetchOrders(since, until);
      upsertOrders(orders);
      report.shopee = orders.length;
    } catch (e) { report.errors.push('shopee.orders: ' + e.message); }
  } else { report.disabled.push('shopee'); }

  // Mercado Livre — pedidos (só se já autorizado)
  if (isIntegrationEnabled('mercadolivre')) {
    try {
      const orders = await ml.fetchOrders(since, until);
      upsertOrders(orders);
      report.mercadolivre = orders.length;
    } catch (e) { report.errors.push('mercadolivre.orders: ' + e.message); }
  } else { report.disabled.push('mercadolivre'); }

  // Mercado Livre — custo de anúncios por dia (Product Ads API; retorna zeros se sem acesso).
  // Ver syncMlAdCostsDaily abaixo — dia a dia em vez de um valor único preso na janela do sync
  // (bug antigo do ROAS/ACOS da Visão geral não respeitar o período, CLAUDE.md backlog).
  if (isIntegrationEnabled('mercadolivre_ads')) {
    try {
      report.ml_ads_spend = await syncMlAdCostsDaily();
    } catch (e) { report.errors.push('mercadolivre.ads: ' + e.message); }
  } else { report.disabled.push('mercadolivre_ads'); }

  // Meta BR — gasto diário de anúncios (Coco and Luna)
  if (isIntegrationEnabled('meta_br')) {
    try {
      const insights = await meta.fetchInsights(since, until);
      const existing = getMetaInsightsDaily();
      setMetaInsightsDaily({ ...existing, ...insights });
      report.meta = Object.keys(insights).length;
    } catch (e) { report.errors.push('meta.insights: ' + e.message); }
  } else { report.disabled.push('meta_br'); }

  // Meta EUA — gasto diário de anúncios (Vita Pet Life)
  if (isIntegrationEnabled('meta_us')) {
    try {
      const usAccountId = meta.AD_ACCOUNT_ID_US;
      if (usAccountId) {
        const insights = await meta.fetchInsights(since, until, usAccountId);
        const existing = getMetaUSInsightsDaily();
        setMetaUSInsightsDaily({ ...existing, ...insights });
        report.meta_us = Object.keys(insights).length;
      }
    } catch (e) { report.errors.push('meta_us.insights: ' + e.message); }
  } else { report.disabled.push('meta_us'); }

  // ── Mercado EUA ───────────────────────────────

  // Shopify EUA (opcional — requer SHOPIFY_US_STORE + SHOPIFY_US_ADMIN_TOKEN)
  if (isIntegrationEnabled('shopify_us')) {
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

    // Shopify EUA — catálogo bruto de produtos (vendido ou não). Ver Unificador.
    try {
      const usStore = process.env.SHOPIFY_US_STORE;
      const usToken = process.env.SHOPIFY_US_ADMIN_TOKEN;
      if (usStore && usToken) {
        const catalog = await shopify.fetchProductCatalog({ store: usStore, token: usToken });
        setShopifyProductCatalog('shopify_us', catalog);
        report.shopify_us_catalog = catalog.length;
      }
    } catch (e) { report.errors.push('shopify_us.catalog: ' + e.message); }
  } else { report.disabled.push('shopify_us'); }

  // Yucaloo EUA — pedidos + catálogo (Shopify, mesmo padrão da Yucaloo BR acima). market:'us',
  // channel próprio "yucaloo_us". Ver CLAUDE.md 4.20.
  if (isIntegrationEnabled('yucaloo_us')) {
    try {
      const orders = await shopifyYucaloo.fetchOrders(since, until, 'us');
      upsertOrders(orders);
      report.yucaloo_us = orders.length;
    } catch (e) { report.errors.push('yucaloo_us.orders: ' + e.message); }

    try {
      const sessions = await shopifyYucaloo.fetchSessionsDaily('us', 90);
      storeYucalooSessions('us', sessions);
      report.yucaloo_us_sessions = sessions.length;
    } catch (e) { report.errors.push('yucaloo_us.sessions: ' + e.message); }

    try {
      const catalog = await shopifyYucaloo.fetchProductCatalog('us');
      setShopifyProductCatalog('yucaloo_us', catalog);
      report.yucaloo_us_catalog = catalog.length;
    } catch (e) { report.errors.push('yucaloo_us.catalog: ' + e.message); }
  } else { report.disabled.push('yucaloo_us'); }

  // Amazon US + BR — amazon.js decide sozinho se combina numa chamada só (tokens
  // ainda idênticos, mesma conta/cota) ou faz duas separadas (tokens já distintos).
  // Backoff gerenciado internamente em amazon.js. Ver CLAUDE.md 4.7.
  //
  // O toggle de Amazon BR/EUA é aplicado DEPOIS da busca, filtrando o array por
  // mercado antes de gravar — não dá pra desligar só um lado dentro de
  // amazon.fetchOrders() sem mexer nessa parte frágil do código (histórico de
  // problemas documentado, CLAUDE.md 4.7). Por isso a chamada de rede continua
  // acontecendo pros dois mercados mesmo com um deles desativado aqui; só o que é
  // gravado no banco respeita o toggle.
  const amazonBrOn = isIntegrationEnabled('amazon_br');
  const amazonUsOn = isIntegrationEnabled('amazon_us');
  if (!amazonBrOn) report.disabled.push('amazon_br');
  if (!amazonUsOn) report.disabled.push('amazon_us');
  try {
    if (!amazon.isConfigured()) {
      report.errors.push('amazon: credenciais LWA ausentes (AMAZON_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN)');
    } else if (!amazon.hasAwsCreds()) {
      report.errors.push('amazon: credenciais AWS ausentes (AMAZON_AWS_ACCESS_KEY / AMAZON_AWS_SECRET_KEY)');
    } else {
      let orders = await amazon.fetchOrders(sinceAmazon, until);
      if (!amazonBrOn) orders = orders.filter(o => o.market !== 'br');
      if (!amazonUsOn) orders = orders.filter(o => o.market !== 'us');
      upsertOrders(orders);
      report.amazon    = orders.filter(o => o.market === 'us').length;
      report.amazon_br = orders.filter(o => o.market === 'br').length;
    }
  } catch (e) { report.errors.push('amazon.orders: ' + e.message); }

  // Poda de retenção da Amazon: mantém só os últimos N dias, por mercado (BR/EUA configurados
  // separadamente na tela Integrações, kv.amazonRetentionConfig, Amazon EUA sozinha tem ~342 mil
  // pedidos/ano, Amazon BR só ~200). Mercado sem config própria ainda cai no legado
  // AMAZON_RETENTION_DAYS (env var) — preserva o comportamento já ativo em produção (365, BR+US
  // juntos) até o usuário mudar algo pela tela. **A primeira poda de uma janela nova nunca
  // acontece sozinha aqui** — mudar o número na tela só grava a config depois de o usuário
  // confirmar (ver POST /api/amazon/retention, que já aplica a poda inicial na hora, com prévia
  // de quantos pedidos seriam apagados). Este bloco só continua a poda incremental de dia-a-dia
  // depois disso (a poda com padrão agressivo quase apagou 9 meses recém-recuperados — daí o
  // cuidado). Só Amazon; Shopify/Shopee/ML ficam completos. Ver CLAUDE.md 4.7.7.
  try {
    const legacyDefault = Number(process.env.AMAZON_RETENTION_DAYS || 0);
    const retentionCfg = getAmazonRetentionConfig();
    const CHANNEL_BY_MARKET = { br: 'amazon', us: 'amazon_us' };
    let pruned = 0;
    for (const mkt of ['br', 'us']) {
      const days = retentionCfg[mkt] ?? legacyDefault;
      if (days > 0) {
        const cutoff = new Date(Date.now() - days * 864e5).toISOString();
        pruned += pruneOrders({ channels: [CHANNEL_BY_MARKET[mkt]], olderThanIso: cutoff });
      }
    }
    if (pruned) report.amazonPruned = pruned;
  } catch (e) { report.errors.push('amazon.prune: ' + e.message); }

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

// ── Devoluções da Amazon (Reports API) ────────────────────────────────────────
//  A Amazon não marca devolução em lugar nenhum do pedido: nem a Orders API nem o relatório
//  de pedidos têm status 'Refunded', os dois contam o ciclo do PEDIDO e não o do dinheiro
//  (um pedido devolvido fica 'Shipped' pra sempre, com o total cheio). Quem sabe da
//  devolução é o relatório de devoluções da FBA, e é o que este job lê.
//
//  Mesmo desenho do reconcileAmazonNames logo acima: job separado (não trava o "Sincronizar
//  agora"), balde de cota próprio da Reports API, throttle por mercado via cursor
//  'returns-<market>', e patch-only — não insere pedido, não mexe em total/status.
//
//  A janela é bem maior que a dos nomes (60 dias contra 2) porque a devolução chega DEPOIS
//  da venda: o pedido que originou este job é de 18/08 e a mercadoria só voltou em 30/08.
//  Uma janela curta veria a venda e nunca a volta dela.
const RETURNS_EVERY_MS = Number(process.env.AMAZON_RETURNS_EVERY_HOURS || 12) * 3600 * 1000;
const RETURNS_DAYS     = Number(process.env.AMAZON_RETURNS_DAYS || 60);

function returnsDue(market) {
  const last = getAmazonCursor(`returns-${market}`);
  return !last || (Date.now() - Date.parse(last)) >= RETURNS_EVERY_MS;
}

// Devolveu tudo ou só parte? Compara as unidades que voltaram com as unidades do pedido.
// Pedido sem item conhecido cai em 'total': quase todo pedido da Amazon BR é de uma unidade
// só, então chutar 'parcial' erraria em praticamente todos eles, enquanto chutar 'total' só
// erra no pedido de várias unidades que teve parte devolvida. De qualquer forma o número real
// fica gravado em `refundedQty`, então nada se perde.
function classificarDevolucao(pedido, qtdDevolvida) {
  const noPedido = (pedido.items || []).reduce((s, it) => s + Number(it?.qty || 0), 0);
  if (!(noPedido > 0)) return 'total';
  return qtdDevolvida >= noPedido ? 'total' : 'parcial';
}

export async function reconcileAmazonReturns({ markets = ['us', 'br'], force = false } = {}) {
  const out = { patched: 0, byMarket: {}, skipped: [], errors: [] };
  if (!amazon.hasAwsCreds()) { out.errors.push('amazon.returns: credenciais AWS ausentes'); return out; }

  for (const market of markets) {
    const configured = market === 'us' ? amazon.isConfigured() : amazon.isConfiguredBR();
    if (!configured) { out.skipped.push(`${market}: sem token`); continue; }
    if (!force && !returnsDue(market)) { out.skipped.push(`${market}: throttle`); continue; }
    try {
      const devolucoes = await amazon.fetchCustomerReturns({ market, days: RETURNS_DAYS });
      const channel = market === 'us' ? 'amazon_us' : 'amazon';
      const porId   = new Map(getOrders({ channel, market }).map(o => [o.id, o]));

      const patches = [];
      let semPedido = 0;
      for (const d of devolucoes) {
        const pedido = porId.get(d.id);
        // Devolução de pedido que não temos: fora da janela de histórico guardada, ou id do
        // outro mercado vindo junto no relatório. Nos dois casos é pra ignorar mesmo.
        if (!pedido) { semPedido++; continue; }
        patches.push({
          id:          d.id,
          refunded:    classificarDevolucao(pedido, d.qty),
          refundedQty: d.qty,
          refundedAt:  d.returnedAt,
        });
      }
      const r = patchOrderRefunds(patches);
      setAmazonCursor(`returns-${market}`, new Date().toISOString());
      out.patched += r.patched;
      out.byMarket[market] = { devolucoes: devolucoes.length, semPedido, ...r };
    } catch (e) {
      out.errors.push(`amazon.returns.${market}: ${e.message}`);
    }
  }
  return out;
}

// ── Nomes de produto da Amazon via getOrderItems (Orders API) ──────────────────
//  Alternativa à Reports API para preencher items[].title. O relatório do marketplace
//  BR vem contaminado com pedidos US (contas vinculadas, ver CLAUDE.md 4.7.8) e NÃO traz
//  os pedidos BR reais, então a reconciliação por relatório não funciona pro BR. Mas o
//  endpoint /orders/v0/orders/{id}/orderItems traz o item (com Title) de UM pedido — e o
//  token BR consegue lê-los (foi ele que trouxe os pedidos). Como o BR tem volume baixo
//  (~120 pedidos), dá pra buscar item por item. Para o US isso é inviável (milhares × cota
//  0,5 req/s) — lá continua a Reports API. Só processa pedidos SEM título, casa por id e
//  patch-only (o pedido já existe). Respeita a cota espaçando as chamadas.
const ITEMS_RATE_MS = 2200; // 0,5 req/s (burst 30) — 2,2s entre chamadas fica folgado

export async function enrichAmazonItems({ market = 'br', limit = 1000, onProgress } = {}) {
  const out = { scanned: 0, patched: 0, empty: 0, errors: [] };
  if (!amazon.hasAwsCreds()) { out.errors.push('sem credenciais AWS'); return out; }
  const configured = market === 'us' ? amazon.isConfigured() : amazon.isConfiguredBR();
  if (!configured) { out.errors.push(`${market}: sem token`); return out; }

  const channel = market === 'us' ? 'amazon_us' : 'amazon';
  const pending = getOrders({ channel, market })
    .filter(o => !o.cancelled && (!o.items || !o.items.length || o.items.every(it => !it.title)))
    .slice(0, limit);
  onProgress?.(`${market}: ${pending.length} pedidos sem nome para buscar`);

  // Se o token não tem acesso ao mercado (ex.: AMAZON_BR_REFRESH_TOKEN apontando pra conta
  // US — ver 4.7.8), TODA chamada dá 400. Abortamos após ABORT_AFTER falhas seguidas sem
  // nenhum sucesso, pra não gastar centenas de chamadas inúteis a cada rodada. Se o token
  // for corrigido, os primeiros pedidos passam a dar certo e a execução segue normal.
  const ABORT_AFTER = 15;
  let consecFails = 0;
  for (const o of pending) {
    out.scanned++;
    const orderId = o.id.slice(o.id.indexOf(':') + 1);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const items = await amazon.fetchOrderItems(orderId, { market });
        if (items.length) { patchOrderItems([{ id: o.id, items }]); out.patched++; }
        else out.empty++;
        consecFails = 0;
        break;
      } catch (e) {
        if (e.isRateLimit && attempt === 1) { await sleep(61000); continue; } // espera a cota e tenta de novo
        out.errors.push(`${orderId}: ${e.message}`);
        consecFails++;
        break;
      }
    }
    if (out.patched === 0 && consecFails >= ABORT_AFTER) {
      out.aborted = `${consecFails} falhas seguidas sem sucesso — token provavelmente sem acesso ao mercado ${market} (ver 4.7.8)`;
      onProgress?.(out.aborted);
      break;
    }
    if (out.scanned % 10 === 0) onProgress?.(`${out.scanned}/${pending.length} — ${out.patched} nomeados`);
    await sleep(ITEMS_RATE_MS);
  }
  onProgress?.(`${market}: concluído — ${out.patched} nomeados, ${out.empty} sem item, ${out.errors.length} erros`);
  return out;
}

// ── Geografia via Bling: preenche `state` de pedidos que já existem ────────────
//  O Bling (ERP que recebe pedidos de todos os canais) traz o endereço de entrega
//  completo (transporte.etiqueta), sem máscara — inclusive de pedidos Shopee, que a
//  própria API da Shopee mascara (ver CLAUDE.md 4.5). Isolado de propósito: nunca cria
//  pedido, nunca mexe em total/status/items — só o campo `state`, e só quando ele ainda
//  está vazio (patchOrderState já garante isso). Só processa canais em
//  bling.KNOWN_CHANNELS — qualquer outro loja.id (Yucaloo, PETLOVE, TikTok Shop) é
//  ignorado, nunca vira pedido nem enriquece nada.
const GEO_DAYS      = Number(process.env.BLING_GEO_DAYS || 14);
const GEO_EVERY_MS  = Number(process.env.BLING_GEO_EVERY_HOURS || 6) * 60 * 60 * 1000;
const GEO_ABORT_AFTER = 15; // mesma cautela do enrichAmazonItems: para se muitas chamadas seguidas falharem

// getAmazonCursor/setAmazonCursor são genéricos (chave arbitrária em kv.amazonCursors,
// apesar do nome) — reaproveitados aqui em vez de criar um cursor store só pro Bling.
function geoDue() {
  const last = getAmazonCursor('bling-geo-br');
  return !last || (Date.now() - Date.parse(last)) >= GEO_EVERY_MS;
}

// Reconstrói o nosso `o.id` a partir do numeroLoja do Bling, por canal — mesmo formato
// que shopify.js/shopee.js/mercadolivre.js já usam pra gravar o pedido (ver CLAUDE.md).
function localOrderId(channel, numeroLoja) {
  if (!numeroLoja) return null;
  if (channel === 'shopify')      return `gid://shopify/Order/${numeroLoja}`;
  if (channel === 'shopee')       return `shopee:${numeroLoja}`;
  if (channel === 'mercadolivre') return `mercadolivre:${numeroLoja}`;
  return null;
}

export async function reconcileGeoFromBling({ market = 'br', force = false, days = GEO_DAYS } = {}) {
  const out = { seen: 0, unmapped: 0, alreadyHadState: 0, notFoundLocally: 0, addressFetched: 0, patched: 0, errors: [],
    // Diagnóstico: distribuição de `unmapped` por loja.id real (pra saber se é Amazon BR/
    // Yucaloo/PETLOVE/etc, sem precisar adivinhar) e amostra de `notFoundLocally` (pra
    // confirmar se o casamento de id está mesmo certo, não só assumir).
    unmappedByLoja: {}, notFoundExamples: [] };
  if (!bling.isConfigured()) { out.errors.push('bling: não configurado'); return out; }
  // Desativado na tela de Integrações: nem a rodada automática nem a manual (force)
  // rodam. Diferente do throttle logo abaixo (que force ignora), aqui "desativado" é
  // desativado mesmo se alguém tentar forçar.
  if (!isIntegrationEnabled('bling')) { out.skipped = 'disabled'; return out; }
  if (!force && !geoDue()) { out.skipped = 'throttle'; return out; }

  // Mapa por canal: id local → pedido (só os canais conhecidos, mercado BR).
  const localMaps = {};
  for (const info of Object.values(bling.KNOWN_CHANNELS)) {
    if (!localMaps[info.channel]) {
      localMaps[info.channel] = new Map(getOrders({ channel: info.channel, market: info.market }).map(o => [o.id, o]));
    }
  }

  const today = new Date();
  const since = new Date(today); since.setDate(since.getDate() - days);
  const iso = d => d.toISOString().slice(0, 10);

  const queue = []; // [{ blingId, localId }]
  let pagina = 1;
  for (;;) {
    const page = await bling.fetchOrdersList(iso(since), iso(today), { pagina, limite: 100 });
    const orders = page.data || [];
    for (const o of orders) {
      out.seen++;
      const info = bling.KNOWN_CHANNELS[o.loja?.id];
      if (!info) {
        out.unmapped++;
        const key = `${o.loja?.id ?? 'sem-loja'}`;
        out.unmappedByLoja[key] = (out.unmappedByLoja[key] || 0) + 1;
        continue;
      }
      let localId = localOrderId(info.channel, o.numeroLoja);
      let localOrder = localId ? localMaps[info.channel]?.get(localId) : null;

      // Mercado Livre: o Bling reporta o pack_id do envio, não o order.id que a gente
      // grava (confirmado via probeOrderOrPack — sempre o caso, não só às vezes). Se o
      // casamento direto falhou, resolve o pack e tenta cada order.id de dentro dele.
      if (!localOrder && info.channel === 'mercadolivre' && o.numeroLoja) {
        const orderIds = await ml.fetchPackOrderIds(o.numeroLoja);
        for (const oid of orderIds) {
          const candidateId = `mercadolivre:${oid}`;
          const candidate = localMaps.mercadolivre?.get(candidateId);
          if (candidate) { localOrder = candidate; localId = candidateId; break; }
        }
      }

      if (!localOrder) {
        out.notFoundLocally++;
        if (out.notFoundExamples.length < 8) {
          out.notFoundExamples.push({ channel: info.channel, lojaId: o.loja?.id, numeroLoja: o.numeroLoja, triedLocalId: localId, blingNumero: o.numero, blingData: o.data });
        }
        continue;
      }
      if (localOrder.state) { out.alreadyHadState++; continue; }
      queue.push({ blingId: o.id, localId });
    }
    if (orders.length < 100) break;
    pagina++;
  }

  const patches = [];
  let consecFails = 0;
  for (const item of queue) {
    try {
      const state = await bling.fetchOrderAddress(item.blingId);
      if (state) { patches.push({ id: item.localId, state }); out.addressFetched++; }
      consecFails = 0;
    } catch (e) {
      out.errors.push(`${item.blingId}: ${e.message}`);
      consecFails++;
      if (consecFails >= GEO_ABORT_AFTER) {
        out.aborted = `${consecFails} falhas seguidas — abortando o resto da fila`;
        break;
      }
    }
  }

  if (patches.length) {
    const r = patchOrderState(patches);
    out.patched = r.patched;
  }
  setAmazonCursor('bling-geo-br', new Date().toISOString());
  return out;
}

// Execução direta: node src/sync.js
if (import.meta.url === `file://${process.argv[1]}`) {
  runSync().then(r => { console.log('Sync concluído:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
