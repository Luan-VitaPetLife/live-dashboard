// ─────────────────────────────────────────────
//  store.js — persistência híbrida
//  Com DATABASE_URL → Postgres (Railway/produção).
//  Sem DATABASE_URL → JSON local (desenvolvimento).
//
//  Interface pública permanece síncrona: cache em memória
//  é carregado no startup via initStore(), e escritas
//  disparam upserts async no Postgres em background.
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const USE_PG = Boolean(process.env.DATABASE_URL);

const pool = USE_PG
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

const EMPTY = {
  orders: {},
  sessionsDaily: {},
  metaInsightsDaily: {},
  metaUSInsightsDaily: {},
  shopeeTokens: null,
  mlTokens: null,
  mlAdCosts: null,
  lastSync: null,
  amazonBackoffCount: 0,
  amazonBRBackoffCount: 0,
};

let cache = null;

// ── Inicialização (chamar uma vez no startup) ──
export async function initStore() {
  if (USE_PG) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions_daily (date TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB);
    `);
    cache = structuredClone(EMPTY);
    const [ord, sess, kv] = await Promise.all([
      pool.query('SELECT id, data FROM orders'),
      pool.query('SELECT date, data FROM sessions_daily'),
      pool.query('SELECT key, value FROM kv'),
    ]);
    for (const r of ord.rows)  cache.orders[r.id] = r.data;
    for (const r of sess.rows) cache.sessionsDaily[r.date] = r.data;
    for (const r of kv.rows) {
      if (r.key === 'shopeeTokens')         cache.shopeeTokens         = r.value;
      if (r.key === 'mlTokens')             cache.mlTokens             = r.value;
      if (r.key === 'mlAdCosts')            cache.mlAdCosts            = r.value;
      if (r.key === 'metaInsightsDaily')    cache.metaInsightsDaily    = r.value;
      if (r.key === 'metaUSInsightsDaily')  cache.metaUSInsightsDaily  = r.value;
      if (r.key === 'lastSync')             cache.lastSync             = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
      if (r.key === 'amazonBackoff')         cache.amazonBackoff         = Number(r.value);
      if (r.key === 'amazonBRBackoff')       cache.amazonBRBackoff       = Number(r.value);
      if (r.key === 'amazonBackoffCount')    cache.amazonBackoffCount    = Number(r.value);
      if (r.key === 'amazonBRBackoffCount')  cache.amazonBRBackoffCount  = Number(r.value);
    }
    console.log(`Store: Postgres (${ord.rows.length} pedidos, ${sess.rows.length} sessões)`);
  } else {
    load();
    console.log('Store: JSON local');
  }
}

// ── Fallback JSON (dev local sem DATABASE_URL) ──
export function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    for (const k of Object.keys(EMPTY)) if (!(k in cache)) cache[k] = EMPTY[k];
  } catch {
    cache = structuredClone(EMPTY);
  }
  return cache;
}

function saveJson() {
  if (USE_PG || !cache) return;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(cache, null, 2));
}

function pgKv(key, value) {
  pool.query(
    'INSERT INTO kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=$2::jsonb',
    [key, JSON.stringify(value)]
  ).catch(e => console.error('PG kv error:', e.message));
}

// ── Pedidos ──────────────────────────────────
export function upsertOrders(orders) {
  const db = load();
  for (const o of orders) db.orders[o.id] = o;
  saveJson();
  if (USE_PG) {
    for (const o of orders) {
      pool.query(
        'INSERT INTO orders(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2',
        [o.id, o]
      ).catch(e => console.error('PG orders error:', e.message));
    }
  }
}

export function getOrders({ channel = 'todos', since = null, until = null, market = null } = {}) {
  const db = load();
  let arr = Object.values(db.orders);
  // Market filter: pedidos sem campo market são legados e pertencem ao BR.
  // No src/store.js, altere a linha do filtro para:
if (market) {
  arr = arr.filter(o => {
    // Fallback: se o canal for 'amazon' e o ID do pedido começar com 'amazon-us:', força 'us'
    const inferredMarket = o.market || 
                           (o.channel === 'shopify_us' ? 'us' : 
                           (o.channel === 'amazon' && o.id.startsWith('amazon-us:') ? 'us' : 'br'));
    return inferredMarket === market;
  });
}
  if (channel && channel !== 'todos') arr = arr.filter(o => o.channel === channel);
  const tz = market === 'us' ? 'Z' : '-03:00';
  if (since) { const t = Date.parse(since + 'T00:00:00' + tz); arr = arr.filter(o => Date.parse(o.createdAt) >= t); }
  if (until) { const t = Date.parse(until + 'T23:59:59' + tz); arr = arr.filter(o => Date.parse(o.createdAt) <= t); }
  return arr;
}

// ── Sessões diárias ───────────────────────────
export function upsertSessionsDaily(rows, market = 'br') {
  const db = load();
  for (const r of rows) {
    const key = market === 'br' ? r.date : `${market}:${r.date}`;
    db.sessionsDaily[key] = r;
  }
  saveJson();
  if (USE_PG) {
    for (const r of rows) {
      const key = market === 'br' ? r.date : `${market}:${r.date}`;
      pool.query(
        'INSERT INTO sessions_daily(date,data) VALUES($1,$2) ON CONFLICT(date) DO UPDATE SET data=$2',
        [key, r]
      ).catch(e => console.error('PG sessions error:', e.message));
    }
  }
}

export function getSessionsDaily(market = 'br') {
  const all = load().sessionsDaily;
  if (market === 'br') {
    // Chaves sem prefixo são BR (legado e novos)
    return Object.fromEntries(Object.entries(all).filter(([k]) => !k.includes(':')));
  }
  const prefix = `${market}:`;
  return Object.fromEntries(
    Object.entries(all)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => [k.slice(prefix.length), v])
  );
}

// ── Tokens Shopee ─────────────────────────────
export function setShopeeTokens(tokens) {
  const db = load(); db.shopeeTokens = tokens; saveJson();
  if (USE_PG) pgKv('shopeeTokens', tokens);
}
export function getShopeeTokens() { return load().shopeeTokens; }

// ── Tokens Mercado Livre ──────────────────────
export function setMlTokens(tokens) {
  const db = load(); db.mlTokens = tokens; saveJson();
  if (USE_PG) pgKv('mlTokens', tokens);
}
export function getMlTokens() { return load().mlTokens; }

// ── ML Ads Costs ─────────────────────────────
export function setMlAdCosts(data) {
  const db = load(); db.mlAdCosts = data; saveJson();
  if (USE_PG) pgKv('mlAdCosts', data);
}
export function getMlAdCosts() { return load().mlAdCosts || null; }

// ── Meta Insights ─────────────────────────────
export function setMetaInsightsDaily(data) {
  const db = load(); db.metaInsightsDaily = data; saveJson();
  if (USE_PG) pgKv('metaInsightsDaily', data);
}
export function getMetaInsightsDaily() { return load().metaInsightsDaily || {}; }

export function setMetaUSInsightsDaily(data) {
  const db = load(); db.metaUSInsightsDaily = data; saveJson();
  if (USE_PG) pgKv('metaUSInsightsDaily', data);
}
export function getMetaUSInsightsDaily() { return load().metaUSInsightsDaily || {}; }

// ── Último sync ───────────────────────────────
export function setLastSync(ts) {
  const db = load(); db.lastSync = ts; saveJson();
  if (USE_PG) pgKv('lastSync', ts);
}

// ── Amazon backoff (persiste entre deploys) ───
export function setAmazonBackoff(until) {
  const db = load(); db.amazonBackoff = until; saveJson();
  if (USE_PG) pgKv('amazonBackoff', until);
}
export function getAmazonBackoff() { return load().amazonBackoff || 0; }

export function setAmazonBRBackoff(until) {
  const db = load(); db.amazonBRBackoff = until; saveJson();
  if (USE_PG) pgKv('amazonBRBackoff', until);
}
export function getAmazonBRBackoff() { return load().amazonBRBackoff || 0; }

export function setAmazonBackoffCount(count) {
  const db = load(); db.amazonBackoffCount = count; saveJson();
  if (USE_PG) pgKv('amazonBackoffCount', count);
}
export function getAmazonBackoffCount() { return load().amazonBackoffCount || 0; }

export function setAmazonBRBackoffCount(count) {
  const db = load(); db.amazonBRBackoffCount = count; saveJson();
  if (USE_PG) pgKv('amazonBRBackoffCount', count);
}
export function getAmazonBRBackoffCount() { return load().amazonBRBackoffCount || 0; }
