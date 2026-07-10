// ─────────────────────────────────────────────
//  amazon.js — Amazon Selling Partner API (EUA + BR)
//  Autenticação: LWA (Login with Amazon) + AWS SigV4 via IAM AssumeRole
//
//  US:  AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET, AMAZON_REFRESH_TOKEN
//       → autorizar em sellercentral.amazon.com (North America Seller Central)
//  BR:  AMAZON_BR_REFRESH_TOKEN (mesmo CLIENT_ID/SECRET)
//       → autorizar em sellercentral.amazon.com.br (Brazil Seller Central)
//  Compartilhado: AMAZON_ROLE_ARN, AMAZON_AWS_ACCESS_KEY, AMAZON_AWS_SECRET_KEY
//
//  Estado atual (ver CLAUDE.md 4.7): a US ainda NÃO foi autorizada com token próprio —
//  AMAZON_REFRESH_TOKEN e AMAZON_BR_REFRESH_TOKEN são o MESMO token (mesma conta/mesma
//  cota real). Enquanto isso for verdade, fetchOrders() faz UMA chamada combinada
//  (metade das requisições reais) em vez de duas contra o mesmo balde de rate limit.
//  Quando a US virar um token de verdade diferente do BR, o código detecta sozinho
//  (SAME_TOKEN vira false) e volta a fazer duas chamadas com backoff independente.
// ─────────────────────────────────────────────
import 'dotenv/config';
import crypto from 'crypto';
import zlib from 'zlib';
import { normalizeUsState } from './us-states.js';
import {
  getAmazonBackoff,      setAmazonBackoff,
  getAmazonBackoffCount, setAmazonBackoffCount,
  getAmazonBRBackoff,      setAmazonBRBackoff,
  getAmazonBRBackoffCount, setAmazonBRBackoffCount,
  getAmazonCursor,         setAmazonCursor,
} from './store.js';

const FETCH_TIMEOUT_MS = 20000;

async function safeFetch(url, opts = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Amazon: timeout após ${FETCH_TIMEOUT_MS / 1000}s em ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch {
    throw new Error(`Amazon: resposta não-JSON [HTTP ${res.status}]: ${text.slice(0, 200)}`);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Configuração ──────────────────────────────────────────────────────────────

const CLIENT_ID     = process.env.AMAZON_CLIENT_ID;
const CLIENT_SECRET = process.env.AMAZON_CLIENT_SECRET;

// US: token gerado autorizando o app em sellercentral.amazon.com (NA)
const REFRESH_TOKEN    = process.env.AMAZON_REFRESH_TOKEN;
const MARKETPLACE_ID   = 'ATVPDKIKX0DER';   // Amazon.com US

// BR: token gerado autorizando o app em sellercentral.amazon.com.br (BR)
// CRÍTICO: os dois são Seller Centrals SEPARADOS — tokens DIFERENTES.
// Se BR não estiver configurado, pedidos BR ficam 0 (nada quebra).
const REFRESH_TOKEN_BR  = process.env.AMAZON_BR_REFRESH_TOKEN;
const MARKETPLACE_ID_BR = 'A2Q3Y263D00KWC'; // Amazon.com.br

const SP_HOST = 'sellingpartnerapi-na.amazon.com'; // região NA cobre US e BR

// Canal/mercado por marketplace (para normalizar o pedido)
const MARKET_BY_MP = {
  [MARKETPLACE_ID]:    { market: 'us', channel: 'amazon_us' },
  [MARKETPLACE_ID_BR]: { market: 'br', channel: 'amazon' },
};

// IAM compartilhado entre US e BR
const ROLE_ARN       = process.env.AMAZON_ROLE_ARN;
const AWS_ACCESS_KEY = process.env.AMAZON_AWS_ACCESS_KEY;
const AWS_SECRET_KEY = process.env.AMAZON_AWS_SECRET_KEY;

export function isConfigured()   { return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN); }
export function isConfiguredBR() { return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN_BR); }
export function hasAwsCreds()    { return Boolean(AWS_ACCESS_KEY && AWS_SECRET_KEY); }

// ── Backoff exponencial ────────────────────────────────────────────────────────
const BACKOFF_STEPS_MS = [15, 30, 60, 120].map(m => m * 60 * 1000);
function backoffDelayMs(count) {
  return BACKOFF_STEPS_MS[Math.min(count, BACKOFF_STEPS_MS.length - 1)];
}

// ── SigV4 ─────────────────────────────────────────────────────────────────────
function hmac(key, data, enc = 'buffer') {
  const h = crypto.createHmac('sha256', key).update(data);
  return enc === 'hex' ? h.digest('hex') : h.digest();
}
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

function sigV4Headers({ method, url, body = '', accessKey, secretKey, sessionToken, region, service, extraHeaders = {} }) {
  const now     = new Date();
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}Z/, 'Z');
  const dateStr = amzDate.slice(0, 8);
  const parsed  = new URL(url);
  const host    = parsed.host;
  const uri     = parsed.pathname;
  const qs      = parsed.searchParams.toString();

  const allHdrs = { host, 'x-amz-date': amzDate, ...extraHeaders };
  if (sessionToken) allHdrs['x-amz-security-token'] = sessionToken;

  const keys       = Object.keys(allHdrs).map(k => k.toLowerCase()).sort();
  const canonHdrs  = keys.map(k => `${k}:${String(allHdrs[k]).trim()}`).join('\n') + '\n';
  const signedHdrs = keys.join(';');
  const canonReq   = [method, uri, qs, canonHdrs, signedHdrs, sha256(body)].join('\n');
  const credScope  = `${dateStr}/${region}/${service}/aws4_request`;
  const strToSign  = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256(canonReq)].join('\n');
  const sigKey     = hmac(hmac(hmac(hmac('AWS4' + secretKey, dateStr), region), service), 'aws4_request');
  const signature  = hmac(sigKey, strToSign, 'hex');

  return {
    ...allHdrs,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${signature}`,
  };
}

// ── LWA token — factory para US e BR (caches independentes) ──────────────────
function makeLwaGetter(clientId, secret, refreshToken, label) {
  let cache = null;
  return async function () {
    if (cache && cache.exp > Date.now()) return cache.token;
    const res  = await safeFetch('https://api.amazon.com/auth/o2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: refreshToken,
        client_id: clientId, client_secret: secret,
      }),
    });
    const json = await safeJson(res);
    if (json.error) throw new Error(`Amazon LWA ${label} [HTTP ${res.status}]: ${json.error} — ${json.error_description || ''}`);
    cache = { token: json.access_token, exp: Date.now() + (json.expires_in - 60) * 1000 };
    return cache.token;
  };
}

// Getters separados por mercado — cada um usa seu próprio refresh token
const getLwaTokenUS = makeLwaGetter(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN,    'US');
const getLwaTokenBR = makeLwaGetter(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN_BR, 'BR');

// ── STS AssumeRole (IAM compartilhado entre US e BR) ──────────────────────────
let roleCache = null;
async function assumeRole() {
  if (roleCache && roleCache.exp > Date.now()) return roleCache;
  const url  = 'https://sts.amazonaws.com/';
  const body = new URLSearchParams({
    Action: 'AssumeRole', RoleArn: ROLE_ARN, RoleSessionName: 'dashboard-sp-api',
    Version: '2011-06-15', DurationSeconds: 3600,
  }).toString();
  const hdrs = sigV4Headers({
    method: 'POST', url, body, accessKey: AWS_ACCESS_KEY, secretKey: AWS_SECRET_KEY,
    region: 'us-east-1', service: 'sts',
    extraHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const res  = await safeFetch(url, { method: 'POST', headers: hdrs, body });
  const text = await res.text();
  if (!res.ok && !text.includes('<AssumeRoleResult>')) {
    throw new Error(`Amazon STS [HTTP ${res.status}]: ${text.slice(0, 300)}`);
  }
  const ak  = text.match(/<AccessKeyId>(.*?)<\/AccessKeyId>/)?.[1];
  const sk  = text.match(/<SecretAccessKey>(.*?)<\/SecretAccessKey>/)?.[1];
  const tok = text.match(/<SessionToken>(.*?)<\/SessionToken>/)?.[1];
  const exp = text.match(/<Expiration>(.*?)<\/Expiration>/)?.[1];
  if (!ak || !sk) throw new Error('Amazon STS AssumeRole falhou: ' + text.slice(0, 300));
  roleCache = { accessKey: ak, secretKey: sk, sessionToken: tok, exp: new Date(exp).getTime() - 60000 };
  return roleCache;
}

// A cota de /orders/v0/orders é 0.0167 req/s (uma requisição por minuto) com burst de 20.
// Não vale esperar 61s entre TODAS as páginas: as ~20 primeiras cabem no burst e saem
// na hora. Só quando o balde esvazia (429) é que esperamos a reposição e tentamos de novo.
const RATE_WAIT_MS   = 61 * 1000;
const PAGE_MAX_TRIES = 3;

// Sobreposição ao retomar do cursor: um pedido atualizado nos segundos finais do último
// sync pode não ter aparecido naquela consulta. Reler 10 min é barato (upsert por id).
const CURSOR_OVERLAP_MS = 10 * 60 * 1000;

class RateLimitError extends Error {
  constructor(message) { super(message); this.isRateLimit = true; }
}

// ── SP-API GET ─────────────────────────────────────────────────────────────────
async function spGet(getLwa, path, params = {}, lwaOverride = null) {
  const url = new URL(`https://${SP_HOST}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.sort();
  const lwa   = lwaOverride || await getLwa();
  const creds = await assumeRole();
  const hdrs  = sigV4Headers({
    method: 'GET', url: url.toString(),
    accessKey: creds.accessKey, secretKey: creds.secretKey, sessionToken: creds.sessionToken,
    region: 'us-east-1', service: 'execute-api',
    extraHeaders: { 'x-amz-access-token': lwa },
  });
  const res = await safeFetch(url.toString(), { headers: hdrs });

  if (res.status === 429) {
    const errBody = await res.text().catch(() => '');
    throw new RateLimitError(`SP-API ${path} [HTTP 429 QuotaExceeded]: ${errBody.slice(0, 200)}`);
  }

  const json = await safeJson(res);
  if (json.errors) {
    const codes = json.errors.map(e => e.code || '').filter(Boolean).join(',');
    throw new Error(`SP-API ${path} [HTTP ${res.status}${codes ? ' ' + codes : ''}]: ${json.errors.map(e => e.message).join('; ')}`);
  }
  return json;
}

// ── SP-API POST ────────────────────────────────────────────────────────────────
async function spPost(getLwa, path, body) {
  const url     = `https://${SP_HOST}${path}`;
  const payload = JSON.stringify(body);
  const lwa     = await getLwa();
  const creds   = await assumeRole();
  const hdrs    = sigV4Headers({
    method: 'POST', url, body: payload,
    accessKey: creds.accessKey, secretKey: creds.secretKey, sessionToken: creds.sessionToken,
    region: 'us-east-1', service: 'execute-api',
    extraHeaders: { 'x-amz-access-token': lwa, 'content-type': 'application/json' },
  });
  const res = await safeFetch(url, { method: 'POST', headers: hdrs, body: payload });

  if (res.status === 429) {
    const errBody = await res.text().catch(() => '');
    throw new RateLimitError(`SP-API ${path} [HTTP 429 QuotaExceeded]: ${errBody.slice(0, 200)}`);
  }

  const json = await safeJson(res);
  if (json.errors) {
    throw new Error(`SP-API ${path} [HTTP ${res.status}]: ${json.errors.map(e => e.message).join('; ')}`);
  }
  return json;
}

// ── fetchMarketplaceOrders — busca pedidos de um ou mais marketplaces com UM token ──
// marketplaceId aceita um ID único ("US") ou vários separados por vírgula (chamada
// combinada). Cada pedido retornado traz seu próprio MarketplaceId — usado para
// separar US/BR no resultado, independente de quantos IDs foram pedidos de uma vez.
async function fetchMarketplaceOrders({ getLwa, marketplaceId, sinceISO, untilISO,
    getBackoff, setBackoff, getBackoffCount, setBackoffCount, label, cursorKey }) {

  const backoffUntil = getBackoff();
  if (backoffUntil > Date.now()) {
    const mins = Math.ceil((backoffUntil - Date.now()) / 60000);
    console.log(`Amazon ${label}: backoff ativo por mais ${mins} min — pulando.`);
    return [];
  }

  const safeUntil = new Date(Math.min(
    new Date(`${untilISO}T23:59:59Z`).getTime(),
    Date.now() - 3 * 60 * 1000,
  )).toISOString();

  // Sync incremental: com cursor, pede só o que mudou desde o último sync completo
  // (LastUpdatedAfter também traz mudança de status, não só pedido novo). Sem cursor
  // — primeira execução — cai na janela por data de criação.
  const cursor = cursorKey ? getAmazonCursor(cursorKey) : null;
  const window = cursor
    ? { LastUpdatedAfter: new Date(Date.parse(cursor) - CURSOR_OVERLAP_MS).toISOString(), LastUpdatedBefore: safeUntil }
    : { CreatedAfter: `${sinceISO}T00:00:00Z`, CreatedBefore: safeUntil };

  console.log(`Amazon ${label}: ${cursor ? `incremental desde ${window.LastUpdatedAfter.slice(0, 16)}` : `janela completa ${sinceISO}`} → ${safeUntil.slice(0, 16)}`);

  const onRateLimit = () => {
    const count = getBackoffCount();
    const delay = backoffDelayMs(count);
    const until = Date.now() + delay;
    setBackoffCount(count + 1);
    setBackoff(until);
    console.warn(`Amazon ${label}: 429 (tentativa ${count + 1}) — backoff ${delay / 60000} min`);
  };

  const rdt = process.env.AMAZON_FETCH_PII === '1'
    ? await (async () => {
        try {
          const url  = `https://${SP_HOST}/tokens/2021-03-01/restrictedDataTokens`;
          const lwa  = await getLwa();
          const creds = await assumeRole();
          const body  = JSON.stringify({ restrictedResources: [{ method: 'GET', path: '/orders/v0/orders', dataElements: ['buyerInfo'] }] });
          const hdrs  = sigV4Headers({ method: 'POST', url, body, accessKey: creds.accessKey, secretKey: creds.secretKey, sessionToken: creds.sessionToken, region: 'us-east-1', service: 'execute-api', extraHeaders: { 'x-amz-access-token': lwa, 'content-type': 'application/json' } });
          const res   = await safeFetch(url, { method: 'POST', headers: hdrs, body });
          const json  = await safeJson(res);
          return json.restrictedDataToken || null;
        } catch { return null; }
      })()
    : null;

  // Um 429 numa página não pode derrubar a busca inteira: espera o balde repor e tenta
  // de novo. Só desiste depois de PAGE_MAX_TRIES.
  const getPage = async params => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await spGet(getLwa, '/orders/v0/orders', params, rdt);
      } catch (e) {
        if (!e.isRateLimit || attempt >= PAGE_MAX_TRIES) throw e;
        console.warn(`Amazon ${label}: 429 na página — aguardando ${RATE_WAIT_MS / 1000}s (tentativa ${attempt}/${PAGE_MAX_TRIES})`);
        await sleep(RATE_WAIT_MS);
      }
    }
  };

  const out = [];
  let nextToken = null;

  try {
    do {
      const params = nextToken
        ? { MarketplaceIds: marketplaceId, MaxResultsPerPage: 100, NextToken: nextToken }
        : { MarketplaceIds: marketplaceId, MaxResultsPerPage: 100, ...window };

      const data   = await getPage(params);
      const orders = data.payload?.Orders || [];

      for (const o of orders) {
        const { market, channel } = MARKET_BY_MP[o.MarketplaceId] || MARKET_BY_MP[MARKETPLACE_ID];
        out.push({
          id:        `amazon-${market}:` + o.AmazonOrderId,
          channel,
          market,
          name:      '#' + o.AmazonOrderId,
          createdAt: o.PurchaseDate,
          status:    o.OrderStatus,
          cancelled: ['Canceled', 'PendingAvailability'].includes(o.OrderStatus),
          total:     Number(o.OrderTotal?.Amount || 0),
          source:    'Amazon',
          customer:  o.BuyerInfo?.BuyerName || '',
          // A Amazon não normaliza a grafia: vem "UT"/"Ut"/"Utah"/"CA."/"N.Y." para o
          // mesmo estado. Nos EUA, reduz ao código de 2 letras (ver us-states.js / 4.7.5).
          state:     market === 'us'
                       ? (normalizeUsState(o.ShippingAddress?.StateOrRegion) || null)
                       : ((o.ShippingAddress?.StateOrRegion || '').trim().toUpperCase() || null),
          items:     Array.from(
            { length: Number(o.NumberOfItemsShipped || 0) + Number(o.NumberOfItemsUnshipped || 0) },
            () => ({ title: '', qty: 1, amount: 0 })
          ),
        });
      }

      nextToken = data.payload?.NextToken || null;
    } while (nextToken);
  } catch (e) {
    if (e.isRateLimit) onRateLimit();
    // Páginas já lidas são pedidos reais — gravar o parcial vale mais que perder tudo.
    // O upsert é por id, então o próximo sync completa o resto sem duplicar. O cursor
    // NÃO avança: a busca ficou incompleta e precisa ser refeita do mesmo ponto.
    if (!out.length) throw e;
    console.error(`Amazon ${label}: parcial (${out.length} pedidos) — ${e.message}`);
    return out;
  }

  setBackoffCount(0);                              // reset após sucesso
  if (cursorKey) setAmazonCursor(cursorKey, safeUntil); // só avança em sync completo
  console.log(`Amazon ${label}: ${out.length} pedidos`);
  return out;
}

// AMAZON_REFRESH_TOKEN e AMAZON_BR_REFRESH_TOKEN, quando IDÊNTICOS, são a mesma conta/
// autorização na Amazon (o app só foi autorizado num Seller Central) — logo, o MESMO
// balde de cota real, mesmo que o código trate US/BR como buckets separados. Nesse
// caso, uma única chamada combinada usa metade das requisições reais sem nenhuma perda
// (o token continua só enxergando o marketplace pra que foi autorizado). Quando a US for
// autorizada com um token PRÓPRIO e diferente (ver CLAUDE.md 4.7), viram duas contas
// reais com cotas reais independentes — aí sim compensa manter as duas chamadas.
const SAME_TOKEN = Boolean(REFRESH_TOKEN) && REFRESH_TOKEN === REFRESH_TOKEN_BR;
const ALL_MARKETPLACE_IDS = `${MARKETPLACE_ID},${MARKETPLACE_ID_BR}`;

export async function fetchOrders(sinceISO, untilISO) {
  if (!hasAwsCreds()) {
    console.warn('Amazon: AWS creds ausentes — configure AMAZON_AWS_ACCESS_KEY / SECRET_KEY.');
    return [];
  }
  if (!isConfigured() && !isConfiguredBR()) {
    console.warn('Amazon: nenhum refresh token configurado.');
    return [];
  }

  if (SAME_TOKEN) {
    console.warn('Amazon: AMAZON_REFRESH_TOKEN === AMAZON_BR_REFRESH_TOKEN — mesma conta/mesma cota. Chamada combinada (não reautorizado para US ainda; ver CLAUDE.md 4.7).');
    return fetchMarketplaceOrders({
      getLwa: getLwaTokenUS, marketplaceId: ALL_MARKETPLACE_IDS, sinceISO, untilISO,
      getBackoff: getAmazonBackoff, setBackoff: setAmazonBackoff,
      getBackoffCount: getAmazonBackoffCount, setBackoffCount: setAmazonBackoffCount,
      label: '(combinado US+BR)', cursorKey: 'combined',
    });
  }

  const results = [];
  const failures = [];

  if (isConfigured()) {
    const us = await fetchMarketplaceOrders({
      getLwa: getLwaTokenUS, marketplaceId: MARKETPLACE_ID, sinceISO, untilISO,
      getBackoff: getAmazonBackoff, setBackoff: setAmazonBackoff,
      getBackoffCount: getAmazonBackoffCount, setBackoffCount: setAmazonBackoffCount,
      label: 'US', cursorKey: 'us',
    }).catch(e => { failures.push('US: ' + e.message); return []; });
    results.push(...us);
  } else {
    failures.push('US: AMAZON_REFRESH_TOKEN não configurado');
  }

  // Pausa entre chamadas: tokens diferentes = contas realmente separadas, cada uma
  // com sua própria cota — a pausa só evita rajada, não é disputa pelo mesmo balde.
  if (isConfigured() && isConfiguredBR()) await sleep(3000);

  if (isConfiguredBR()) {
    const br = await fetchMarketplaceOrders({
      getLwa: getLwaTokenBR, marketplaceId: MARKETPLACE_ID_BR, sinceISO, untilISO,
      getBackoff: getAmazonBRBackoff, setBackoff: setAmazonBRBackoff,
      getBackoffCount: getAmazonBRBackoffCount, setBackoffCount: setAmazonBRBackoffCount,
      label: 'BR', cursorKey: 'br',
    }).catch(e => { failures.push('BR: ' + e.message); return []; });
    results.push(...br);
  } else {
    failures.push('BR: AMAZON_BR_REFRESH_TOKEN não configurado');
  }

  // Um mercado que falha não pode apagar o outro que deu certo, mas a falha
  // precisa chegar ao relatório de sync em vez de virar uma lista vazia silenciosa.
  if (failures.length && !results.length) throw new Error(failures.join(' | '));
  if (failures.length) console.error('Amazon (parcial):', failures.join(' | '));

  return results;
}

export async function fetchOrdersBR() {
  return []; // BR já vem incluído em fetchOrders
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Reports API — backfill histórico
//
//  Paginar /orders/v0/orders para trás é inviável: 100 pedidos por página a 1 req/min.
//  A Reports API monta um arquivo com TUDO de uma vez — 3 ou 4 requisições cobrem meses.
//  Bônus: o relatório traz uma linha POR ITEM, com o nome do produto, que a API de
//  pedidos não devolve (ver backlog "itens do pedido não são buscados").
//
//  Fluxo: createReport → poll até DONE → getReportDocument → baixa (gzip) → parse TSV.
// ═══════════════════════════════════════════════════════════════════════════════

const REPORT_TYPE      = 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL';
const REPORT_CHUNK_DAYS = 30;        // a Amazon limita o intervalo por relatório
const REPORT_POLL_MS    = 30 * 1000; // getReport permite 2 req/s; 30s é folgado
const REPORT_MAX_POLLS  = 40;        // até ~20 min por relatório

// Uma linha do relatório é um ITEM. O valor do pedido é a soma dos itens + frete +
// impostos − descontos, replicando o que `OrderTotal` traria na API de pedidos.
function rowAmount(r) {
  const n = k => Number(r[k] || 0);
  return n('item-price') + n('item-tax') + n('shipping-price') + n('shipping-tax')
       + n('gift-wrap-price') + n('gift-wrap-tax')
       - n('item-promotion-discount') - n('ship-promotion-discount');
}

function parseTsv(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const cols = lines[0].split('\t').map(c => c.trim());
  return lines.slice(1).map(line => {
    const cells = line.split('\t');
    return Object.fromEntries(cols.map((c, i) => [c, (cells[i] ?? '').trim()]));
  });
}

// Agrupa as linhas-item em pedidos, no mesmo formato normalizado de fetchOrders().
function ordersFromRows(rows, marketplaceId) {
  const { market, channel } = MARKET_BY_MP[marketplaceId];
  const byOrder = new Map();

  for (const r of rows) {
    const orderId = r['amazon-order-id'];
    if (!orderId) continue;

    if (!byOrder.has(orderId)) {
      const status = r['order-status'] || '';
      byOrder.set(orderId, {
        id:        `amazon-${market}:` + orderId,
        channel,
        market,
        name:      '#' + orderId,
        createdAt: new Date(r['purchase-date']).toISOString(),
        status,
        cancelled: ['Cancelled', 'Canceled'].includes(status),
        total:     0,
        source:    'Amazon',
        customer:  '',
        // A Amazon não normaliza a grafia: vem "UT"/"Ut"/"Utah"/"CA."/"N.Y." para o
        // mesmo estado. Nos EUA, reduz ao código de 2 letras (ver us-states.js / 4.7.5).
        state:     market === 'us'
                     ? (normalizeUsState(r['ship-state']) || null)
                     : ((r['ship-state'] || '').trim().toUpperCase() || null),
        items:     [],
      });
    }

    const o   = byOrder.get(orderId);
    const qty = Number(r['quantity'] || 0);
    const amt = rowAmount(r);

    // Item cancelado não soma receita nem unidade — mesma regra do resto do projeto.
    if (r['item-status'] === 'Cancelled' || o.cancelled) continue;

    o.total += amt;
    if (r['product-name']) o.items.push({ title: r['product-name'], qty, amount: amt });
  }

  for (const o of byOrder.values()) o.total = Math.round(o.total * 100) / 100;
  return [...byOrder.values()];
}

async function runOneReport({ getLwa, marketplaceId, startISO, endISO, label, onProgress }) {
  onProgress?.(`${label}: criando relatório ${startISO.slice(0, 10)} → ${endISO.slice(0, 10)}`);

  const created = await spPost(getLwa, '/reports/2021-06-30/reports', {
    reportType:    REPORT_TYPE,
    marketplaceIds: [marketplaceId],
    dataStartTime: startISO,
    dataEndTime:   endISO,
  });
  const reportId = created.reportId;
  if (!reportId) throw new Error(`${label}: createReport não devolveu reportId`);

  let documentId = null;
  for (let i = 0; i < REPORT_MAX_POLLS; i++) {
    await sleep(REPORT_POLL_MS);
    const rep = await spGet(getLwa, `/reports/2021-06-30/reports/${reportId}`);
    const st  = rep.processingStatus;
    if (st === 'DONE')   { documentId = rep.reportDocumentId; break; }
    if (st === 'FATAL' || st === 'CANCELLED') throw new Error(`${label}: relatório ${st}`);
    onProgress?.(`${label}: ${st} (${i + 1}/${REPORT_MAX_POLLS})`);
  }
  if (!documentId) throw new Error(`${label}: relatório não ficou pronto a tempo`);

  const doc = await spGet(getLwa, `/reports/2021-06-30/documents/${documentId}`);
  const res = await safeFetch(doc.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = doc.compressionAlgorithm === 'GZIP'
    ? zlib.gunzipSync(buf).toString('utf8')
    : buf.toString('utf8');

  const rows   = parseTsv(text);
  const orders = ordersFromRows(rows, marketplaceId);
  onProgress?.(`${label}: ${rows.length} linhas → ${orders.length} pedidos`);
  return orders;
}

// Backfill histórico de um mercado. Quebra o período em janelas de REPORT_CHUNK_DAYS
// e entrega cada lote via onChunk() — o chamador grava de imediato, então uma falha
// no meio do caminho não desfaz o que já veio.
export async function backfillOrders({ market = 'us', days = 90, onProgress, onChunk } = {}) {
  if (!hasAwsCreds()) throw new Error('Amazon: credenciais AWS ausentes.');

  const isUs = market === 'us';
  const getLwa        = isUs ? getLwaTokenUS : getLwaTokenBR;
  const marketplaceId = isUs ? MARKETPLACE_ID : MARKETPLACE_ID_BR;
  const label         = isUs ? 'Backfill US' : 'Backfill BR';
  if (isUs ? !isConfigured() : !isConfiguredBR()) throw new Error(`${label}: refresh token não configurado.`);

  const end   = new Date(Date.now() - 3 * 60 * 1000); // margem de 2 min exigida pela SP-API
  const start = new Date(end.getTime() - days * 864e5);

  let total  = 0;
  let cursor = start;

  while (cursor < end) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + REPORT_CHUNK_DAYS * 864e5, end.getTime()));
    const orders   = await runOneReport({
      getLwa, marketplaceId, label,
      startISO: cursor.toISOString(), endISO: chunkEnd.toISOString(),
      onProgress,
    });
    total += orders.length;
    await onChunk?.(orders);
    cursor = chunkEnd;
  }

  onProgress?.(`${label}: concluído — ${total} pedidos`);
  return total;
}

// Reconciliação de nomes de produto (ver CLAUDE.md 4.7.6 / backlog item 8).
// O sync contínuo (Orders API, fetchOrders) nunca traz o título do item — pedidos
// novos entram com items[].title vazio e Produtos/Estoque vão desatualizando. Aqui
// buscamos um relatório curto dos últimos `days` dias (uma única janela, days ≤ 30) —
// a Reports API tem balde de cota próprio, então isso não concorre com o sync de
// pedidos nem provoca 429. Devolve pedidos já no formato normalizado, com items[] +
// title preenchido; quem chama casa por id e preenche os títulos (patchOrderItems).
export async function fetchRecentNamedOrders({ market = 'us', days = 2, onProgress } = {}) {
  if (!hasAwsCreds()) throw new Error('Amazon: credenciais AWS ausentes.');

  const isUs          = market === 'us';
  const getLwa        = isUs ? getLwaTokenUS : getLwaTokenBR;
  const marketplaceId = isUs ? MARKETPLACE_ID : MARKETPLACE_ID_BR;
  const label         = isUs ? 'Nomes US' : 'Nomes BR';
  if (isUs ? !isConfigured() : !isConfiguredBR()) throw new Error(`${label}: refresh token não configurado.`);

  const end   = new Date(Date.now() - 3 * 60 * 1000); // margem exigida pela SP-API
  const start = new Date(end.getTime() - days * 864e5);

  return runOneReport({
    getLwa, marketplaceId, label,
    startISO: start.toISOString(), endISO: end.toISOString(),
    onProgress,
  });
}
