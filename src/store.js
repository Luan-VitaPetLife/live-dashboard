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
  yucalooSessionsDaily: {}, // { [market]: { [date]: {sessions,visitors,cart,checkout,completed} } } — loja Shopify própria da Yucaloo, balde separado do sessionsDaily da Coco and Luna pra não colidir chave de data (ver aggregateSessions em metrics.js)
  metaInsightsDaily: {},
  metaUSInsightsDaily: {},
  shopeeTokens: null,
  mlTokens: null,
  mlAdCosts: null,
  googleAdsTokens: null,
  blingTokens: null,
  yucalooTokens: {}, // { [market]: { shop, accessToken, scope, obtainedAt } } — OAuth via Dev Dashboard, ver shopifyYucaloo.js
  shopifyProductCatalog: {}, // { [channel]: [{title,image,productType,tags}] } — catálogo bruto (vendido ou não), ver Unificador
  productFinance: {},
  productStock: {},
  productStockAgg: {},
  productGroups: {}, // { [market]: { [nomeDoGrupo]: [tituloBruto,...] } } — unificação manual de produtos entre canais, ver tela Unificador (Configurações)
  productGroupsConfig: {}, // { enabled: bool } — liga/desliga global do Unificador, padrão ligado quando ausente
  productTypeGroups: {}, // { [market]: { [nomeDoTipo]: [palavraChave,...] } } — tipos de produto criados pelo usuário em Segmentos (busca por tags/título/productType)
  productHiddenTags: {}, // { [market]: [palavraChave,...] } — Segmentos → "Ocultar produtos": item cuja tag bate sai dos segmentos normais e vai pro card "Ocultos"
  lastSync: null,
  amazonBackoffCount: 0,
  amazonBRBackoffCount: 0,
  amazonCursors: {},
  amazonProductImages: {}, // { asin: url } — cache do Catalog Items API, ver amazon.js fetchProductImages
  amazonImagesJob: null,   // progresso do job em background que preenche o cache acima
  // ── Autenticação (login/usuários) ──
  users: [],          // [{ id, username, name, role, salt, hash, pages:[], createdAt }]
  authConfig: null,   // { enabled: bool } — null = ainda não inicializado (initAuth semeia)
  authSessions: {},   // { token: { userId, createdAt, expiresAt } }
  integrationsConfig: {}, // { [chave]: { enabled: bool } } — liga/desliga por integração, ver tela Integrações
  amazonRetentionConfig: {}, // { br: dias|undefined, us: dias|undefined } — janela de retenção por mercado, ver tela Integrações. Mercado ausente cai no legado AMAZON_RETENTION_DAYS (env var), ver sync.js.
  backupStatus: null, // último resultado do backup pra Backblaze B2 — ver src/backup.js
  channelHealth: {}, // { [canal]: { failingSince, alerted, lastError } } — ver src/alerts.js
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
      if (r.key === 'blingTokens')           cache.blingTokens           = r.value;
      if (r.key === 'yucalooTokens')         cache.yucalooTokens         = r.value;
      if (r.key === 'shopifyProductCatalog') cache.shopifyProductCatalog = r.value;
      if (r.key === 'productFinance')       cache.productFinance       = r.value;
      if (r.key === 'productStock')         cache.productStock         = r.value;
      if (r.key === 'productStockAgg')      cache.productStockAgg      = r.value;
      if (r.key === 'productGroups')        cache.productGroups        = r.value;
      if (r.key === 'productGroupsConfig')  cache.productGroupsConfig  = r.value;
      if (r.key === 'productTypeGroups')    cache.productTypeGroups    = r.value;
      if (r.key === 'productHiddenTags')    cache.productHiddenTags    = r.value;
      if (r.key === 'metaInsightsDaily')    cache.metaInsightsDaily    = r.value;
      if (r.key === 'metaUSInsightsDaily')  cache.metaUSInsightsDaily  = r.value;
      if (r.key === 'yucalooSessionsDaily') cache.yucalooSessionsDaily = r.value;
      if (r.key === 'lastSync')             cache.lastSync             = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
      if (r.key === 'amazonBackoff')         cache.amazonBackoff         = Number(r.value);
      if (r.key === 'amazonBRBackoff')       cache.amazonBRBackoff       = Number(r.value);
      if (r.key === 'amazonBackoffCount')    cache.amazonBackoffCount    = Number(r.value);
      if (r.key === 'amazonBRBackoffCount')  cache.amazonBRBackoffCount  = Number(r.value);
      if (r.key === 'amazonCursors')         cache.amazonCursors         = r.value;
      if (r.key === 'amazonBackfill')        cache.amazonBackfill        = r.value;
      if (r.key === 'amazonProductImages')   cache.amazonProductImages   = r.value;
      if (r.key === 'amazonImagesJob')       cache.amazonImagesJob       = r.value;
      if (r.key === 'users')                 cache.users                 = r.value;
      if (r.key === 'authConfig')            cache.authConfig            = r.value;
      if (r.key === 'authSessions')          cache.authSessions          = r.value;
      if (r.key === 'integrationsConfig')    cache.integrationsConfig    = r.value;
      if (r.key === 'amazonRetentionConfig') cache.amazonRetentionConfig = r.value;
      if (r.key === 'backupStatus')          cache.backupStatus          = r.value;
      if (r.key === 'channelHealth')         cache.channelHealth         = r.value;
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
    // Mesma proteção, agora para `state` e `productSales`: canais cuja própria API não
    // traz o dado (Shopee mascara o endereço, ver CLAUDE.md 4.5; a Amazon Orders API não
    // traz valor de produto separado, ver 4.7.6) são regravados a cada sync com o campo
    // vazio — sem esta guarda, isso apaga o que uma reconciliação (Bling/Reports API)
    // preencheu depois. Só protege contra apagar: valor novo não-vazio sobrescreve normal.
    if (existing && !o.state && existing.state) {
      o.state = existing.state;
    }
    if (existing && o.productSales == null && existing.productSales != null) {
      o.productSales = existing.productSales;
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

// Prévia (sem apagar nada) de quanto uma poda removeria — usado pela tela de Integrações antes
// de aplicar uma janela de retenção nova, pra mostrar "isso vai apagar N pedidos" e pedir
// confirmação explícita em vez de deixar a primeira poda de um valor novo acontecer sozinha
// no próximo sync (ver CLAUDE.md — poda agressiva quase apagou 9 meses em 10/07/2026).
export function countOrdersOlderThan({ channel, olderThanIso }) {
  const db = load();
  let count = 0;
  for (const o of Object.values(db.orders)) {
    if (o.channel === channel && o.createdAt && o.createdAt < olderThanIso) count++;
  }
  return count;
}

// Janela de retenção da Amazon por mercado — ver tela Integrações. Mercado sem chave própria
// aqui cai no legado AMAZON_RETENTION_DAYS (env var), ver sync.js: preserva o comportamento já
// ativo em produção (365 dias, BR+US juntos) até o usuário mudar algo pela tela.
export function getAmazonRetentionConfig() { return load().amazonRetentionConfig || {}; }
export function setAmazonRetentionConfig(cfg) {
  const db = load(); db.amazonRetentionConfig = cfg; saveJson();
  if (USE_PG) pgKv('amazonRetentionConfig', cfg);
}

// Snapshot completo do store pra backup — mesmo formato do data/db.json usado no dev local (JSON
// puro de orders/sessionsDaily/kv), só que serializado sob demanda em produção (onde saveJson()
// não escreve nada em disco, ver USE_PG). Ver src/backup.js.
export function getFullSnapshot() { return load(); }

export function getBackupStatus() { return load().backupStatus; }

// Saúde por canal (alerta de sync travado) — ver src/alerts.js.
export function getChannelHealth() { return load().channelHealth || {}; }
export function setChannelHealth(health) {
  const db = load(); db.channelHealth = health; saveJson();
  if (USE_PG) pgKv('channelHealth', health);
}
export function setBackupStatus(status) {
  const db = load(); db.backupStatus = status; saveJson();
  if (USE_PG) pgKv('backupStatus', status);
}

// Restaura o store inteiro a partir de um snapshot (formato de getFullSnapshot/backup.js) —
// scripts/restore-backup.mjs. Operação rara e deliberada (nunca chamada no fluxo normal do
// servidor): TRUNCATE + reinsert em vez do upsert incremental do dia-a-dia, porque um restore
// precisa realmente voltar pro estado exato do backup, inclusive removendo o que foi criado
// depois dele. authSessions não faz parte do snapshot (ver backup.js) — todo mundo precisa
// logar de novo depois de um restore, o que já é o comportamento esperado.
export async function restoreSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.orders) {
    throw new Error('Snapshot inválido (esperado um objeto com pelo menos a chave "orders").');
  }
  cache = { ...structuredClone(EMPTY), ...structuredClone(snapshot) };
  indexDirty = true;
  saveJson();

  if (!USE_PG) return { mode: 'json', orders: Object.keys(cache.orders).length };

  await pool.query('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data JSONB NOT NULL); CREATE TABLE IF NOT EXISTS sessions_daily (date TEXT PRIMARY KEY, data JSONB NOT NULL); CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB);');
  await pool.query('TRUNCATE orders, sessions_daily, kv');

  const orderRows = Object.entries(cache.orders);
  for (let i = 0; i < orderRows.length; i += PG_BATCH) {
    const batch = orderRows.slice(i, i + PG_BATCH);
    const values = batch.map((_, j) => `($${j * 2 + 1},$${j * 2 + 2})`).join(',');
    const params = [];
    for (const [id, data] of batch) params.push(id, data);
    await pool.query(`INSERT INTO orders(id,data) VALUES ${values}`, params);
  }

  const sessionRows = Object.entries(cache.sessionsDaily || {});
  for (let i = 0; i < sessionRows.length; i += PG_BATCH) {
    const batch = sessionRows.slice(i, i + PG_BATCH);
    const values = batch.map((_, j) => `($${j * 2 + 1},$${j * 2 + 2})`).join(',');
    const params = [];
    for (const [date, data] of batch) params.push(date, data);
    await pool.query(`INSERT INTO sessions_daily(date,data) VALUES ${values}`, params);
  }

  const { orders, sessionsDaily, ...kvFields } = cache;
  for (const [key, value] of Object.entries(kvFields)) {
    if (value === null || value === undefined) continue;
    await pool.query('INSERT INTO kv(key,value) VALUES($1,$2::jsonb)', [key, JSON.stringify(value)]);
  }

  return { mode: 'postgres', orders: orderRows.length, sessions: sessionRows.length, kvKeys: Object.keys(kvFields).length };
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
      let changed = false;
      // Só sobrescreve se o relatório trouxe itens com título (não apagar por engano).
      if (o.items && o.items.length && o.items.some(it => it.title)) {
        existing.items = o.items;
        changed = true;
      }
      // "Ordered Product Sales" (ver amazon.js ordersFromRows) — só o relatório traz esse
      // valor separado; copia pro pedido já existente sem mexer em total/status.
      // ⚠️ Só confia no valor quando o PRÓPRIO relatório não marcou o pedido como
      // cancelado/pendente (`o.cancelled`, calculado a partir do status QUE O PEDIDO TINHA
      // no momento em que o relatório rodou). Em ordersFromRows, `o.cancelled === true` faz
      // TODAS as linhas do pedido serem puladas (`continue`), deixando `productSales` parado
      // em 0 — um "0 falso" (não processado), não "vendas de produto zero". Como o relatório
      // de reconciliação é de janela curta (AMAZON_NAMES_DAYS, padrão 2 dias) e roda a cada
      // poucas horas, um pedido pode estar Pending nesse instante e já ter sido capturado/
      // enviado (total real, não cancelado) quando o dashboard é consultado depois — sem esta
      // guarda, o 0 falso era copiado por cima do pedido já existente, fazendo o modo "Vendas
      // de produto" ficar bem abaixo do real (confirmado em produção: ~41% abaixo do modo
      // "Total" num dia só, muito acima do gap de definição de ~1,5% que o toggle deveria
      // refletir). Não usar `o.items.length` como sinal: um pedido pode ter revenue real de
      // produto mas `items` vazio (todas as linhas com product-name "-", frete/ajuste).
      if (!o.cancelled && o.productSales != null && o.productSales !== existing.productSales) {
        existing.productSales = o.productSales;
        changed = true;
      }
      if (changed) { patched++; toPersist.push(existing); }
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

// Preenche o `state` (UF de entrega) de pedidos que JÁ EXISTEM, usando o endereço mais
// completo do Bling — mesmo cuidado do patchOrderItems: nunca insere pedido novo, nunca
// mexe em total/status/items. Só sobrescreve quando o pedido ainda não tem `state`
// (Shopify/Mercado Livre/Amazon BR já preenchem sozinhos — só sobra a Shopee, que mascara
// o endereço na própria API, ver CLAUDE.md 4.5). `patches`: [{ id, state }].
export function patchOrderState(patches) {
  const db = load();
  let patched = 0, skipped = 0;
  const toPersist = [];
  for (const p of patches) {
    const existing = db.orders[p.id];
    if (!existing || existing.state || !p.state) { skipped++; continue; }
    existing.state = p.state;
    patched++;
    toPersist.push(existing);
  }
  if (!toPersist.length) return { patched, skipped };
  indexDirty = true;
  saveJson();
  if (USE_PG) pgUpsertOrders(toPersist);
  return { patched, skipped };
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

// Correção pontual (28/07/2026): decisão de só contar pedido com pagamento de verdade
// como venda (CLAUDE.md 4.1) — expandiu o que cada canal trata como "não conta" em
// shopify.js/mercadolivre.js/amazon.js. Pedido já gravado com um desses status continua
// com cancelled:false (contando errado) até ser re-sincronizado — o sync incremental só
// busca quem mudou de status recentemente, então o histórico não se autocorrige sozinho.
// Corrige o flag local de quem já está no banco, sem chamar nenhuma API de novo. Só vira
// false→true (nunca desfaz um cancelamento real já marcado). Rodar uma vez após o deploy.
//
// Substitui a correção pontual anterior (fixAmazonPendingAvailability, mesmo dia) — aquela
// tratava 'PendingAvailability' como "não deveria estar cancelado"; a decisão de negócio
// mudou: ele deve ficar de fora mesmo, só que pelo motivo certo (sem pagamento, não
// cancelamento). Já rodou em produção sem nenhum pedido afetado (fixed:0), então não há
// nada pra desfazer.
// Exportada (não só usada aqui) — metrics.js reaproveita pra rotular pedido "não pago"
// diferente de cancelado de verdade na busca (ver statusLabelPt / CLAUDE.md 4.7.10).
export const UNPAID_STATUS_BY_CHANNEL = {
  amazon:        ['Pending', 'PendingAvailability'],
  amazon_us:     ['Pending', 'PendingAvailability'],
  shopify:       ['PENDING', 'AUTHORIZED'],
  shopify_us:    ['PENDING', 'AUTHORIZED'],
  mercadolivre:  ['confirmed', 'payment_required', 'payment_in_process'],
};

export function fixUnpaidOrders() {
  const db = load();
  const toPersist = [];
  for (const o of Object.values(db.orders)) {
    const unpaidStatuses = UNPAID_STATUS_BY_CHANNEL[o.channel];
    if (!unpaidStatuses) continue;
    if (!o.cancelled && unpaidStatuses.includes(o.status)) {
      o.cancelled = true;
      toPersist.push(o);
    }
  }
  if (toPersist.length) {
    indexDirty = true;
    saveJson();
    if (USE_PG) pgUpsertOrders(toPersist);
  }
  return toPersist.length;
}

// Offset UTC do horário do Pacífico (fuso que a Amazon Seller Central usa nos relatórios
// da conta US — confirmado ao vivo: Sales Snapshot mostra "taken at ... PDT") pra uma data
// específica. Diferente do BR (fixo -03:00, sem horário de verão), os EUA trocam de fuso
// 2x por ano (PDT -07:00 no verão, PST -08:00 no resto) — calculado por data em vez de
// fixo. Bug corrigido (28/07/2026): antes usava 'Z' (UTC puro) pra cortar o dia da Amazon
// US — UTC fica até 8h à frente do Pacífico, então "hoje" no nosso sistema pegava um pedaço
// da noite anterior (horário local) e perdia um pedaço do fim do dia atual, fazendo
// receita/pedidos "diários" da Amazon US não baterem com o Seller Central (confirmado
// comparando um dia real: nossa dashboard vinha ~5% acima do Seller Central nesse dia).
// Ref ao meio-dia UTC daquele dia — sempre depois da 1h da manhã (o horário em que a troca
// de horário de verão acontece), então nunca cai do lado errado da transição.
function usOffsetForDate(dateStr) {
  const ref = new Date(dateStr + 'T12:00:00Z');
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' })
    .formatToParts(ref).find(p => p.type === 'timeZoneName')?.value || 'GMT-8';
  const m = part.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  const h = m ? parseInt(m[1], 10) : -8;
  const mm = m && m[2] ? parseInt(m[2], 10) : 0;
  return (h < 0 ? '-' : '+') + String(Math.abs(h)).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

export function getOrders({ channel = 'todos', since = null, until = null, market = null } = {}) {
  load();
  if (indexDirty) rebuildOrdersIndex();

  // Sem market → considera todos (raro; o dashboard sempre passa um mercado).
  // Pedidos sem campo market são legados e são inferidos por inferMarket().
  const markets = market ? [market] : Object.keys(ordersByMarket);
  // Fuso da loja para converter a data (YYYY-MM-DD) da janela em instante absoluto.
  // since/until podem cair em lados opostos de uma troca de horário de verão (raro), por
  // isso o offset é calculado pra cada ponta separadamente, não uma vez só pra janela toda.
  const loTz = market === 'us' ? (since ? usOffsetForDate(since) : '-07:00') : '-03:00';
  const hiTz = market === 'us' ? (until ? usOffsetForDate(until) : '-07:00') : '-03:00';
  const lo = since ? Date.parse(since + 'T00:00:00' + loTz) : -Infinity;
  const hi = until ? Date.parse(until + 'T23:59:59' + hiTz) :  Infinity;
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

// Sessões da loja Shopify da Yucaloo (própria, separada da Coco and Luna) — balde à parte porque
// sessions_daily (Postgres) é uma tabela com `date` como chave primária só do mercado, sem
// dimensão de canal; gravar aqui na mesma tabela sobrescreveria o dia da Coco and Luna. Formato:
// { [market]: { [date]: {sessions,visitors,cart,checkout,completed} } }, mesmo padrão do
// metaInsightsDaily/metaUSInsightsDaily (kv genérico, não tabela dedicada).
export function setYucalooSessionsDaily(data) {
  const db = load(); db.yucalooSessionsDaily = data; saveJson();
  if (USE_PG) pgKv('yucalooSessionsDaily', data);
}
export function getYucalooSessionsDaily() { return load().yucalooSessionsDaily || {}; }

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

// ── Tokens Bling (exploratório, ver src/bling.js) ─────
export function setBlingTokens(tokens) {
  const db = load(); db.blingTokens = tokens; saveJson();
  if (USE_PG) pgKv('blingTokens', tokens);
}
export function getBlingTokens() { return load().blingTokens; }

// ── Tokens Yucaloo (OAuth via Dev Dashboard, um app por mercado — ver shopifyYucaloo.js) ──
export function getYucalooTokens() { return load().yucalooTokens || {}; }
export function setYucalooTokens(tokens) {
  const db = load(); db.yucalooTokens = tokens; saveJson();
  if (USE_PG) pgKv('yucalooTokens', tokens);
}

// ── Catálogo bruto de produtos Shopify (vendido ou não), por canal — ver Unificador ──
export function getShopifyProductCatalog() { return load().shopifyProductCatalog || {}; }
export function setShopifyProductCatalog(channel, items) {
  const db = load();
  if (!db.shopifyProductCatalog) db.shopifyProductCatalog = {};
  db.shopifyProductCatalog[channel] = items;
  saveJson();
  if (USE_PG) pgKv('shopifyProductCatalog', db.shopifyProductCatalog);
}

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

// ── Unificação manual de produtos entre canais ("Unificar" em Segmentos) ──
// Um título pertence a no máximo um grupo por mercado. Ver CLAUDE.md sobre "Unificar".
export function getProductGroups() { return load().productGroups || {}; }
export function upsertProductGroup(market, name, members) {
  const db = load();
  if (!db.productGroups) db.productGroups = {};
  const mkt = db.productGroups[market] || (db.productGroups[market] = {});
  // Une aos membros já existentes no grupo (reusar o mesmo nome = adicionar a ele).
  const merged = Array.from(new Set([...(mkt[name] || []), ...members]));
  // Um título nunca fica em dois grupos: some de qualquer outro grupo do mesmo mercado.
  for (const [gName, gMembers] of Object.entries(mkt)) {
    if (gName === name) continue;
    const kept = gMembers.filter(t => !merged.includes(t));
    if (kept.length) mkt[gName] = kept; else delete mkt[gName];
  }
  if (merged.length) mkt[name] = merged; else delete mkt[name];
  saveJson();
  if (USE_PG) pgKv('productGroups', db.productGroups);
  return mkt;
}
export function deleteProductGroup(market, name) {
  const db = load();
  if (!db.productGroups) db.productGroups = {};
  const mkt = db.productGroups[market] || (db.productGroups[market] = {});
  delete mkt[name];
  saveJson();
  if (USE_PG) pgKv('productGroups', db.productGroups);
  return mkt;
}
// Tira só UM título do grupo (diferente de upsertProductGroup, que só une membros — nunca tira).
export function removeFromProductGroup(market, name, title) {
  const db = load();
  if (!db.productGroups) db.productGroups = {};
  const mkt = db.productGroups[market] || (db.productGroups[market] = {});
  if (mkt[name]) {
    const kept = mkt[name].filter(t => t !== title);
    if (kept.length) mkt[name] = kept; else delete mkt[name];
  }
  saveJson();
  if (USE_PG) pgKv('productGroups', db.productGroups);
  return mkt;
}

// Liga/desliga global do Unificador (tela própria, dentro de Configurações). Sem registro
// salvo, considera ligado — opt-out, mesmo padrão de isIntegrationEnabled acima.
export function getProductGroupsEnabled() {
  const cfg = load().productGroupsConfig || {};
  return cfg.enabled !== false;
}
export function setProductGroupsEnabled(enabled) {
  const db = load();
  db.productGroupsConfig = { enabled: Boolean(enabled) };
  saveJson();
  if (USE_PG) pgKv('productGroupsConfig', db.productGroupsConfig);
  return db.productGroupsConfig;
}

// ── Tipos de produto (Segmentos → "Tipos de produto") ──
// Diferente de productGroups (que une TÍTULOS exatos), aqui o usuário cadastra um nome de tipo +
// palavras-chave — a classificação busca a palavra-chave no título/productType/tags de cada item em
// tempo real (ver classifyTypeGroup em metrics.js), então um produto novo que ainda não existia
// quando a regra foi criada já entra classificado sozinho, sem precisar readicionar título por
// título. Mesmo formato de productGroups (nome → array), mas sem a exclusividade de "um título só
// pode estar num grupo" — não faz sentido pra palavra-chave.
export function getProductTypeGroups() { return load().productTypeGroups || {}; }
export function upsertProductTypeGroup(market, name, keywords) {
  const db = load();
  if (!db.productTypeGroups) db.productTypeGroups = {};
  const mkt = db.productTypeGroups[market] || (db.productTypeGroups[market] = {});
  const clean = keywords.map(k => String(k || '').trim()).filter(Boolean);
  const merged = Array.from(new Set([...(mkt[name] || []), ...clean]));
  if (merged.length) mkt[name] = merged; else delete mkt[name];
  saveJson();
  if (USE_PG) pgKv('productTypeGroups', db.productTypeGroups);
  return mkt;
}
export function removeProductTypeKeyword(market, name, keyword) {
  const db = load();
  if (!db.productTypeGroups) db.productTypeGroups = {};
  const mkt = db.productTypeGroups[market] || (db.productTypeGroups[market] = {});
  if (mkt[name]) {
    const kept = mkt[name].filter(k => k !== keyword);
    if (kept.length) mkt[name] = kept; else delete mkt[name];
  }
  saveJson();
  if (USE_PG) pgKv('productTypeGroups', db.productTypeGroups);
  return mkt;
}
export function deleteProductTypeGroup(market, name) {
  const db = load();
  if (!db.productTypeGroups) db.productTypeGroups = {};
  const mkt = db.productTypeGroups[market] || (db.productTypeGroups[market] = {});
  delete mkt[name];
  saveJson();
  if (USE_PG) pgKv('productTypeGroups', db.productTypeGroups);
  return mkt;
}

// ── Tags ocultas de produto (Segmentos → "Ocultar produtos") ──
// Lista simples por mercado (sem nome de grupo — só existe um destino, o card "Ocultos").
export function getProductHiddenTags() { return load().productHiddenTags || {}; }
export function upsertProductHiddenTags(market, tags) {
  const db = load();
  if (!db.productHiddenTags) db.productHiddenTags = {};
  const clean = (tags || []).map(t => String(t || '').trim()).filter(Boolean);
  const merged = Array.from(new Set([...(db.productHiddenTags[market] || []), ...clean]));
  db.productHiddenTags[market] = merged;
  saveJson();
  if (USE_PG) pgKv('productHiddenTags', db.productHiddenTags);
  return merged;
}
export function removeProductHiddenTag(market, tag) {
  const db = load();
  if (!db.productHiddenTags) db.productHiddenTags = {};
  const kept = (db.productHiddenTags[market] || []).filter(t => t !== tag);
  db.productHiddenTags[market] = kept;
  saveJson();
  if (USE_PG) pgKv('productHiddenTags', db.productHiddenTags);
  return kept;
}

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

// ── Cache de imagem de produto Amazon por ASIN (Catalog Items API) ──
// Preenchido pelo job de POST /api/amazon/images — a Orders API e o relatório de
// backfill não trazem imagem, só o Catalog Items API por ASIN. Ver amazon.js.
export function getAmazonProductImages() { return load().amazonProductImages || {}; }
export function setAmazonProductImages(map) {
  const db = load(); db.amazonProductImages = map; saveJson();
  if (USE_PG) pgKv('amazonProductImages', map);
}

export function setAmazonImagesJob(state) {
  const db = load(); db.amazonImagesJob = state; saveJson();
  if (USE_PG) pgKv('amazonImagesJob', state);
}
export function getAmazonImagesJob() { return load().amazonImagesJob || null; }

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

// Liga/desliga por integração (tela Integrações, dentro de Configurações). Mesmo
// padrão de authConfig acima. Sem registro salvo para uma chave, considera ligada
// (opt-out: a feature nova nunca desativa uma integração já funcionando sozinha).
export function getIntegrationsConfig() { return load().integrationsConfig || {}; }
export function setIntegrationEnabled(key, enabled) {
  const db = load();
  db.integrationsConfig = db.integrationsConfig || {};
  db.integrationsConfig[key] = { enabled: Boolean(enabled) };
  saveJson();
  if (USE_PG) pgKv('integrationsConfig', db.integrationsConfig);
}
export function isIntegrationEnabled(key) {
  const cfg = getIntegrationsConfig()[key];
  return cfg ? cfg.enabled !== false : true;
}
