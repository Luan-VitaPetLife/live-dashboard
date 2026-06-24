// ─────────────────────────────────────────────
//  store.js — persistência simples em JSON
//  Suficiente para o volume atual. Para escalar,
//  troque por Postgres mantendo as mesmas funções.
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const EMPTY = {
  orders: {},          // { [orderId]: orderObj }  (orderObj.channel = 'shopify' | 'shopee' | ...)
  sessionsDaily: {},   // { 'YYYY-MM-DD': { sessions, visitors, cart, checkout, completed } }
  shopeeTokens: null,  // { access_token, refresh_token, expires_at, refresh_expires_at }
  mlTokens: null,      // { user_id, access_token, refresh_token, expires_at }
  lastSync: null,
};

let cache = null;

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

export function save() {
  if (!cache) return;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(cache, null, 2));
}

// Insere/atualiza pedidos normalizados (upsert por id).
export function upsertOrders(orders) {
  const db = load();
  for (const o of orders) db.orders[o.id] = o;
  save();
}

// Salva linhas diárias de sessões (Shopify).
export function upsertSessionsDaily(rows) {
  const db = load();
  for (const r of rows) db.sessionsDaily[r.date] = r;
  save();
}

export function setShopeeTokens(tokens) {
  const db = load();
  db.shopeeTokens = tokens;
  save();
}
export function getShopeeTokens() {
  return load().shopeeTokens;
}

export function setMlTokens(tokens) {
  const db = load();
  db.mlTokens = tokens;
  save();
}
export function getMlTokens() {
  return load().mlTokens;
}

export function setLastSync(ts) {
  const db = load();
  db.lastSync = ts;
  save();
}

// Pedidos como array, opcionalmente filtrados por canal e intervalo [since, until] (ISO date).
export function getOrders({ channel = 'todos', since = null, until = null } = {}) {
  const db = load();
  let arr = Object.values(db.orders);
  if (channel && channel !== 'todos') arr = arr.filter(o => o.channel === channel);
  if (since) { const t = Date.parse(since + 'T00:00:00-03:00'); arr = arr.filter(o => Date.parse(o.createdAt) >= t); }
  if (until) { const t = Date.parse(until + 'T23:59:59-03:00'); arr = arr.filter(o => Date.parse(o.createdAt) <= t); }
  return arr;
}

export function getSessionsDaily() {
  return load().sessionsDaily;
}
