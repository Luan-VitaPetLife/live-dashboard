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
  shopeeTokens: null,
  mlTokens: null,
  lastSync: null,
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
      if (r.key === 'shopeeTokens') cache.shopeeTokens = r.value;
      if (r.key === 'mlTokens')     cache.mlTokens     = r.value;
      if (r.key === 'lastSync')     cache.lastSync      = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
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
    'INSERT INTO kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',
    [key, value]
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

export function getOrders({ channel = 'todos', since = null, until = null } = {}) {
  const db = load();
  let arr = Object.values(db.orders);
  if (channel && channel !== 'todos') arr = arr.filter(o => o.channel === channel);
  if (since) { const t = Date.parse(since + 'T00:00:00-03:00'); arr = arr.filter(o => Date.parse(o.createdAt) >= t); }
  if (until) { const t = Date.parse(until + 'T23:59:59-03:00'); arr = arr.filter(o => Date.parse(o.createdAt) <= t); }
  return arr;
}

// ── Sessões diárias ───────────────────────────
export function upsertSessionsDaily(rows) {
  const db = load();
  for (const r of rows) db.sessionsDaily[r.date] = r;
  saveJson();
  if (USE_PG) {
    for (const r of rows) {
      pool.query(
        'INSERT INTO sessions_daily(date,data) VALUES($1,$2) ON CONFLICT(date) DO UPDATE SET data=$2',
        [r.date, r]
      ).catch(e => console.error('PG sessions error:', e.message));
    }
  }
}

export function getSessionsDaily() {
  return load().sessionsDaily;
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

// ── Meta ──────────────────────────────────────
export function setLastSync(ts) {
  const db = load(); db.lastSync = ts; saveJson();
  if (USE_PG) pgKv('lastSync', ts);
}
