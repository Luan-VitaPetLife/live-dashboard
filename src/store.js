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
  googleAdsTokens: null,
  productFinance: {},
  productStock: {},
  productStockAgg: {},
  lastSync: null,
  amazonBackoffCount: 0,
  amazonBRBackoffCount: 0,
  amazonCursors: {},
  // ── Autenticação (login/usuários) ──
  users: [],          // [{ id, username, name, role, salt, hash, pages:[], createdAt }]
  authConfig: null,   // { enabled: bool } — null = ainda não inicializado (initAuth semeia)
  authSessions: {},   // { token: { userId, createdAt, expiresAt } }
};

let cache = null;

// ── Índice em memória para getOrders() ────────
// Com ~85 mil+ pedidos (e potencialmente centenas de milhares após backfills
// grandes), o padrão antigo — Object.values(db.orders) + várias passadas de
// .filter() reparsando Date.parse() a cada request, ~6× por /api/dashboard —
// ficava lento (item 9 do backlog). Aqui mantemos, por mercado, um array de
// pedidos ordenado por timestamp (asc) + um array paralelo dos timestamps já
// parseados, permitindo recortar a janela de datas por busca binária em vez de
// varrer tudo. O índice é reconstruído preguiçosamente (só na próxima leitura
// após uma escrita), então backfills que fazem muitos upserts em lote só pagam
// uma reconstrução. Ver CLAUDE.md 4.8 / seção 9.
let ordersByMarket = {};   // { br: [pedido,...], us: [...] } ordenado por _ts asc
let tsByMarket     = {};   // { br: [ts,...],    us: [...] } alinhado a ordersByMarket
let indexDirty     = true;

// Mesma inferência de mercado do getOrders antigo: campo market, senão
// shopify_us → us, senão amazon com id 'amazon-us:' → us, senão br (legado).
function inferMarket(o) {
  return o.market ||
    (o.channel === 'shopify_us' || o.channel === 'amazon_us' ? 'us'
      : (o.channel === 'amazon' && o.id.startsWith('amazon-us:') ? 'us' : 'br'));
}

function rebuildOrdersIndex() {
  const byM = {}; // mercado → [[ts, pedido], ...]
  for (const o of Object.values(cache.orders)) {
    const m = inferMarket(o);
    (byM[m] || (byM[m] = [])).push([Date.parse(o.createdAt), o]);
  }
  ordersByMarket = {};
  tsByMarket = {};
  for (const m of Object.keys(byM)) {
    const pairs = byM[m];
    pairs.sort((a, b) => a[0] - b[0]);
    ordersByMarket[m] = pairs.map(p => p[1]);
    tsByMarket[m]     = pairs.map(p => p[0]);
  }
  indexDirty = false;
}

// Primeiro índice i em ts[] tal que ts[i] >= alvo (início da janela).
function lowerBound(ts, target) {
  let lo = 0, hi = ts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ts[mid] < target) lo = mid + 1; else hi = mid; }
  return lo;
}
// Primeiro índice i em ts[] tal que ts[i] > alvo (fim exclusivo da janela).
function upperBound(ts, target) {
  let lo = 0, hi = ts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ts[mid] <= target) lo = mid + 1; else hi = mid; }
  return lo;
}

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
      if (r.key === 'googleAdsTokens')      cache.googleAdsTokens      = r.value;
      if (r.key === 'productFinance')       cache.productFinance       = r.value;
      if (r.key === 'productStock')         cache.productStock         = r.value;
      if (r.key === 'productStockAgg')      cache.productStockAgg      = r.value;
      if (r.key === 'metaInsightsDaily')    cache.metaInsightsDaily    = r.value;
      if (r.key === 'metaUSInsightsDaily')  cache.metaUSInsightsDaily  = r.value;
      if (r.key === 'lastSync')             cache.lastSync             = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
      if (r.key === 'amazonBackoff')         cache.amazonBackoff         = Number(r.value);
      if (r.key === 'amazonBRBackoff')       cache.amazonBRBackoff       = Number(r.value);
      if (r.key === 'amazonBackoffCount')    cache.amazonBackoffCount    = Number(r.value);
      if (r.key === 'amazonBRBackoffCount')  cache.amazonBRBackoffCount  = Number(r.value);
      if (r.key === 'amazonCursors')         cache.amazonCursors         = r.value;
      if (r.key === 'amazonBackfill')        cache.amazonBackfill        = r.value;
      if (r.key === 'users')                 cache.users                 = r.value;
      if (r.key === 'authConfig')            cache.authConfig            = r.value;
      if (r.key === 'authSessions')          cache.authSessions          = r.value;
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
// Grava em LOTE (INSERT multi-linha), não uma query por pedido. Um backfill que
// despejava ~30 mil INSERTs autocommit por chunk gerava um pico de WAL que encheu
// o disco do Postgres e derrubou o banco (incidente 10/07/2026 — Hobby, sem como
// aumentar o volume). Em lotes de PG_BATCH linhas, são ~60 statements em vez de
// 30 mil, com uma fração do WAL. Limite de params do pg é 65535 (2 por linha).
const PG_BATCH = 500;

function pgUpsertOrders(orders) {
  for (let i = 0; i < orders.length; i += PG_BATCH) {
    const batch  = orders.slice(i, i + PG_BATCH);
    const values = batch.map((_, j) => `($${j * 2 + 1},$${j * 2 + 2})`).join(',');
    const params = [];
    for (const o of batch) params.push(o.id, o);
    pool.query(
      `INSERT INTO orders(id,data) VALUES ${values} ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data`,
      params
    ).catch(e => console.error('PG orders batch error:', e.message));
  }
}

export function upsertOrders(orders) {
  const db = load();
  for (const o of orders) {
    const existing = db.orders[o.id];
    // Preserva os títulos de item já preenchidos (backfill / Reports API) quando o
    // pedido chega SEM título. A Orders API da Amazon nunca traz o nome do item, e o
    // sync roda a cada 15 min re-baixando pedidos recém-atualizados — sem esta guarda,
    // ele apagava a cada ciclo os nomes que a Reports API preencheu, deixando
    // Segmentos/Produtos/Estoque vazios para a Amazon apesar da receita certa. O
    // total/status continuam vindo do pedido novo (Orders API é a fonte deles).
    // Ver CLAUDE.md 4.7.6. Para outros canais o item sempre tem título → não dispara.
    if (existing && Array.isArray(o.items) && o.items.length
        && o.items.every(it => !it.title)
        && Array.isArray(existing.items) && existing.items.some(it => it.title)) {
      o.items = existing.items;
    }
    db.orders[o.id] = o;
  }
  indexDirty = true;
  saveJson();
  if (USE_PG) pgUpsertOrders(orders);
}

// Poda de retenção: remove pedidos dos canais informados mais antigos que olderThanIso.
// Usada só para a Amazon (canal de maior volume, ~1000 pedidos/dia US) — sem isso o
// banco cresce ~30 mil/mês e volta a encher o disco do Hobby. Os outros canais são de
// baixo volume e ficam completos. Autovacuum reaproveita o espaço liberado, então o
// tamanho da tabela estabiliza na janela de retenção. Ver CLAUDE.md 4.7.7.
export function pruneOrders({ channels, olderThanIso }) {
  const db = load();
  const chSet = new Set(channels);
  let removed = 0;
  for (const [id, o] of Object.entries(db.orders)) {
    if (chSet.has(o.channel) && o.createdAt && o.createdAt < olderThanIso) {
      delete db.orders[id];
      removed++;
    }
  }
  if (removed) {
    indexDirty = true;
    saveJson();
    if (USE_PG) {
      pool.query(
        `DELETE FROM orders WHERE data->>'channel' = ANY($1) AND data->>'createdAt' < $2`,
        [channels, olderThanIso]
      ).catch(e => console.error('PG prune error:', e.message));
    }
  }
  return removed;
}

// Preenche items[] (títulos de produto) em pedidos JÁ existentes, sem tocar em
// total/status — usado pela reconciliação de nomes da Amazon (Reports API), já que
// o sync de pedidos (Orders API) não traz o título do item. Ver CLAUDE.md 4.7.6 /
// backlog item 8.
//
// **NÃO insere pedido novo (allowInsert padrão false).** Antes inseria o pedido inteiro
// quando o id não existia — mas isso abriu um vazamento de mercado: o relatório "BR"
// (fetchRecentNamedOrders market='br') vinha contaminado com pedidos US (tokens iguais /
// conta US enxergando o relatório), e como esses ids `amazon-br:<idUS>` não existiam no
// store, eram INSERIDOS como pedidos Amazon BR com títulos em inglês — inflando a receita
// do Brasil (incidente 13/07/2026). A reconciliação só deve CORRIGIR TÍTULO de pedido que
// o sync de pedidos (Orders API, a fonte de verdade do pedido e do seu mercado) já gravou;
// o sync roda a cada 15 min e sempre insere o pedido antes da reconciliação (a cada 12h),
// então o insert aqui nunca era necessário de verdade. Ver CLAUDE.md 4.7.8.
export function patchOrderItems(orders, { allowInsert = false } = {}) {
  const db = load();
  let patched = 0, inserted = 0;
  const toPersist = [];
  for (const o of orders) {
    const existing = db.orders[o.id];
    if (existing) {
      // Só sobrescreve se o relatório trouxe itens com título (não apagar por engano).
      if (o.items && o.items.length && o.items.some(it => it.title)) {
        existing.items = o.items;
        patched++;
        toPersist.push(existing);
      }
    } else if (allowInsert) {
      db.orders[o.id] = o;
      inserted++;
      toPersist.push(o);
    }
  }
  if (!toPersist.length) return { patched, inserted };
  indexDirty = true;
  saveJson();
  if (USE_PG) pgUpsertOrders(toPersist);
  return { patched, inserted };
}

// Limpeza pontual do vazamento de mercado da Amazon (ver patchOrderItems / CLAUDE.md
// 4.7.8): remove pedidos US que um relatório cego-tagueado gravou como Amazon BR.
// Dois sinais, ambos seguros porque o canal Amazon BR nunca passou pela Reports API
// (nenhum backfill BR foi rodado — CLAUDE.md backlog item 11):
//   1) item TITULADO — só a Reports API traz título; pedido US enviado/pendente vazado.
//   2) status === 'Cancelled' (com DOIS L) + R$ 0 + sem item — é a grafia que SÓ o
//      relatório grava (a Orders API grava 'Canceled', com um L). Pega o pedido US
//      cancelado, que no relatório não gera linha de item (fica sem título e R$ 0) e por
//      isso escaparia do sinal 1. Casar 'Canceled' (um L) apagaria cancelamento BR REAL,
//      então casamos exatamente 'Cancelled'.
// Nenhum pedido BR real (sempre via Orders API, sem título, status 'Canceled'/'Shipped'/
// 'Pending') casa qualquer um dos dois. Idempotente. Retorna quantos removeu.
export function removeAmazonMarketLeak() {
  const db = load();
  const ids = [];
  for (const [id, o] of Object.entries(db.orders)) {
    if (o.channel !== 'amazon' || o.market !== 'br') continue;
    const titled = Array.isArray(o.items) && o.items.some(it => it && it.title);
    const reportCancelled = o.status === 'Cancelled' && !Number(o.total) && !titled;
    if (titled || reportCancelled) ids.push(id);
  }
  for (const id of ids) delete db.orders[id];
  if (ids.length) {
    indexDirty = true;
    saveJson();
    if (USE_PG) {
      pool.query(`DELETE FROM orders WHERE id = ANY($1)`, [ids])
        .catch(e => console.error('PG leak-cleanup error:', e.message));
    }
  }
  return ids.length;
}

export function getOrders({ channel = 'todos', since = null, until = null, market = null } = {}) {
  load();
  if (indexDirty) rebuildOrdersIndex();

  // Sem market → considera todos (raro; o dashboard sempre passa um mercado).
  // Pedidos sem campo market são legados e são inferidos por inferMarket().
  const markets = market ? [market] : Object.keys(ordersByMarket);
  // Fuso da loja para converter a data (YYYY-MM-DD) da janela em instante absoluto.
  const tz = market === 'us' ? 'Z' : '-03:00';
  const lo = since ? Date.parse(since + 'T00:00:00' + tz) : -Infinity;
  const hi = until ? Date.parse(until + 'T23:59:59' + tz) :  Infinity;
  const byChannel = channel && channel !== 'todos';

  const out = [];
  for (const m of markets) {
    const list = ordersByMarket[m];
    if (!list || !list.length) continue;
    const ts = tsByMarket[m];
    // Recorta a janela por busca binária (arrays ordenados por _ts asc).
    const start = since ? lowerBound(ts, lo) : 0;
    const end   = until ? upperBound(ts, hi) : list.length;
    for (let i = start; i < end; i++) {
      const o = list[i];
      if (byChannel && o.channel !== channel) continue;
      out.push(o);
    }
  }
  return out;
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

// ── Tokens Google Ads ─────────────────────────
export function setGoogleAdsTokens(tokens) {
  const db = load(); db.googleAdsTokens = tokens; saveJson();
  if (USE_PG) pgKv('googleAdsTokens', tokens);
}
export function getGoogleAdsTokens() { return load().googleAdsTokens; }

// ── Dados financeiros editáveis por produto (COG, impostos, comissão) ──
// Chave: "canal|||título do produto" (mesma chave usada no agrupamento de Top Produtos/Produtos).
export function setProductFinance(key, patch) {
  const db = load();
  if (!db.productFinance) db.productFinance = {};
  db.productFinance[key] = { ...(db.productFinance[key] || {}), ...patch };
  saveJson();
  if (USE_PG) pgKv('productFinance', db.productFinance);
}
export function getProductFinance() { return load().productFinance || {}; }

// ── Dados de estoque/produção editáveis por produto (estoque, a caminho, pedido ao laboratório) ──
// Mesma chave "canal|||título" da tela de Produtos/Top Produtos. Ver tela de Estoque.
export function setProductStock(key, patch) {
  const db = load();
  if (!db.productStock) db.productStock = {};
  db.productStock[key] = { ...(db.productStock[key] || {}), ...patch };
  saveJson();
  if (USE_PG) pgKv('productStock', db.productStock);
}
export function getProductStock() { return load().productStock || {}; }

// ── Dados de estoque/produção agregados por família de produto (todos os canais) ──
// Chave: "market|||família" (ex: "br|||Lysine"). Usado pelo card "Estoque" (panorama geral) da
// tela de Estoque — Ordem Projetada/Nova/Em Andamento não são mais por canal (o pedido ao
// laboratório abastece todos os canais de uma vez). Ver metrics.js computeStock / CLAUDE.md 4.14.
export function setProductStockAgg(key, patch) {
  const db = load();
  if (!db.productStockAgg) db.productStockAgg = {};
  db.productStockAgg[key] = { ...(db.productStockAgg[key] || {}), ...patch };
  saveJson();
  if (USE_PG) pgKv('productStockAgg', db.productStockAgg);
}
export function getProductStockAgg() { return load().productStockAgg || {}; }

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

// ── Cursor de sync incremental da Amazon ──────
// Guarda o instante (ISO) do último sync completo por balde ('us', 'br', 'combined').
// A partir dele o sync busca só pedidos atualizados desde então (LastUpdatedAfter),
// em vez de rebaixar a janela inteira toda vez. Ver amazon.js / CLAUDE.md 4.7.
export function setAmazonCursor(key, iso) {
  const db = load();
  if (!db.amazonCursors) db.amazonCursors = {};
  db.amazonCursors[key] = iso;
  saveJson();
  if (USE_PG) pgKv('amazonCursors', db.amazonCursors);
}
export function getAmazonCursor(key) { return (load().amazonCursors || {})[key] || null; }

// ── Estado do backfill histórico da Amazon (Reports API) ──
// Roda em background no servidor; o progresso é consultável via GET /api/status.
export function setAmazonBackfill(state) {
  const db = load(); db.amazonBackfill = state; saveJson();
  if (USE_PG) pgKv('amazonBackfill', state);
}
export function getAmazonBackfill() { return load().amazonBackfill || null; }

// ── Autenticação (login/usuários/sessões) ─────
// Toda a lógica (hash, sessão, permissão) vive em src/auth.js; aqui só a persistência,
// no mesmo padrão kv dos demais dados. Ver CLAUDE.md (tela de Configurações / login).
export function getUsers() { return load().users || []; }
export function setUsers(users) {
  const db = load(); db.users = users; saveJson();
  if (USE_PG) pgKv('users', users);
}

export function getAuthConfig() { return load().authConfig || null; }
export function setAuthConfig(cfg) {
  const db = load(); db.authConfig = cfg; saveJson();
  if (USE_PG) pgKv('authConfig', cfg);
}

export function getAuthSessions() { return load().authSessions || {}; }
export function setAuthSessions(sessions) {
  const db = load(); db.authSessions = sessions; saveJson();
  if (USE_PG) pgKv('authSessions', sessions);
}
