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
import * as bling from './bling.js';
import * as shopifyYucaloo from './shopifyYucaloo.js';
import { upsertOrders, upsertSessionsDaily, setLastSync, getMetaInsightsDaily, setMetaInsightsDaily, getMetaUSInsightsDaily, setMetaUSInsightsDaily, setMlAdCosts, patchOrderItems, patchOrderState, getAmazonCursor, setAmazonCursor, pruneOrders, getOrders, isIntegrationEnabled, setShopifyProductCatalog } from './store.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

  // Mercado Livre — custo de anúncios (Product Ads API; retorna zeros se sem acesso)
  if (isIntegrationEnabled('mercadolivre_ads')) {
    try {
      const adCosts = await ml.fetchAdCosts(since, until);
      setMlAdCosts({ since, until, ...adCosts });
      report.ml_ads_spend = adCosts.spend;
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

  // Poda de retenção da Amazon: mantém só os últimos AMAZON_RETENTION_DAYS dias do
  // canal de maior volume (~1000 pedidos/dia US), para o banco não crescer sem limite.
  // **Opt-in: padrão 0 (DESLIGADA)** — de propósito, para um deploy nunca apagar dados
  // sozinho (a poda com padrão agressivo quase apagou 9 meses recém-recuperados em
  // 10/07/2026). Defina AMAZON_RETENTION_DAYS no Railway para ativar (ex.: 365 = janela
  // móvel de 1 ano). Só Amazon; Shopify/Shopee/ML ficam completos. Ver CLAUDE.md 4.7.7.
  try {
    const retentionDays = Number(process.env.AMAZON_RETENTION_DAYS || 0);
    if (retentionDays > 0) {
      const cutoff = new Date(Date.now() - retentionDays * 864e5).toISOString();
      const pruned = pruneOrders({ channels: ['amazon', 'amazon_us'], olderThanIso: cutoff });
      if (pruned) report.amazonPruned = pruned;
    }
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
