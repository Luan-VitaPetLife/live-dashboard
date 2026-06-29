// ─────────────────────────────────────────────
//  amazon.js — Amazon Selling Partner API (EUA + BR)
//  Autenticação: LWA (Login with Amazon) + AWS SigV4 via IAM AssumeRole
//  EUA: AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET, AMAZON_REFRESH_TOKEN
//  BR:  AMAZON_BR_CLIENT_ID, AMAZON_BR_CLIENT_SECRET, AMAZON_BR_REFRESH_TOKEN
//  Compartilhado: AMAZON_ROLE_ARN, AMAZON_AWS_ACCESS_KEY, AMAZON_AWS_SECRET_KEY
// ─────────────────────────────────────────────
import 'dotenv/config';
import crypto from 'crypto';
import { getAmazonBackoff, setAmazonBackoff, getAmazonBRBackoff, setAmazonBRBackoff } from './store.js';

const FETCH_TIMEOUT_MS = 20000; // 20s — evita travamento indefinido
async function safeFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Amazon: timeout após ${FETCH_TIMEOUT_MS / 1000}s em ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`Amazon: resposta não-JSON [HTTP ${res.status}]: ${text.slice(0, 200)}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// EUA
const CLIENT_ID      = process.env.AMAZON_CLIENT_ID;
const CLIENT_SECRET  = process.env.AMAZON_CLIENT_SECRET;
const REFRESH_TOKEN  = process.env.AMAZON_REFRESH_TOKEN;
const MARKETPLACE_ID = 'ATVPDKIKX0DER';              // Amazon.com (US)
const SP_HOST        = 'sellingpartnerapi-na.amazon.com';

// Brasil — Client ID e Secret fazem fallback para US se não definidos separadamente
const CLIENT_ID_BR     = process.env.AMAZON_BR_CLIENT_ID     || process.env.AMAZON_CLIENT_ID;
const CLIENT_SECRET_BR = process.env.AMAZON_BR_CLIENT_SECRET  || process.env.AMAZON_CLIENT_SECRET;
const REFRESH_TOKEN_BR = process.env.AMAZON_BR_REFRESH_TOKEN;
const MARKETPLACE_ID_BR = 'A2Q3Y263D00KWC';           // Amazon.com.br (região NA)
const SP_HOST_BR        = 'sellingpartnerapi-na.amazon.com'; // BR está na região North America

// Compartilhado (mesmo IAM user/role para US e BR)
const ROLE_ARN       = process.env.AMAZON_ROLE_ARN;
const AWS_ACCESS_KEY = process.env.AMAZON_AWS_ACCESS_KEY;
const AWS_SECRET_KEY = process.env.AMAZON_AWS_SECRET_KEY;

export function isConfigured()   { return Boolean(CLIENT_ID    && CLIENT_SECRET    && REFRESH_TOKEN); }
export function isConfiguredBR() { return Boolean(CLIENT_ID_BR && CLIENT_SECRET_BR && REFRESH_TOKEN_BR); }
export function hasAwsCreds()    { return Boolean(AWS_ACCESS_KEY && AWS_SECRET_KEY); }

// ── SigV4 ──────────────────────────────────────
function hmac(key, data, enc = 'buffer') {
  const h = crypto.createHmac('sha256', key).update(data);
  return enc === 'hex' ? h.digest('hex') : h.digest();
}
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
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

  const keys         = Object.keys(allHdrs).map(k => k.toLowerCase()).sort();
  const canonHdrs    = keys.map(k => `${k}:${String(allHdrs[k]).trim()}`).join('\n') + '\n';
  const signedHdrs   = keys.join(';');
  const canonReq     = [method, uri, qs, canonHdrs, signedHdrs, sha256(body)].join('\n');
  const credScope    = `${dateStr}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256(canonReq)].join('\n');
  const sigKey       = hmac(hmac(hmac(hmac('AWS4' + secretKey, dateStr), region), service), 'aws4_request');
  const signature    = hmac(sigKey, stringToSign, 'hex');

  return {
    ...allHdrs,
    'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${signature}`,
  };
}

// ── Backoff após rate limit ─────────────────────
// Quando SP-API retorna 429, recuamos por BACKOFF_MS para não renovar o throttle.
// backoffUntil é persistido no store (sobrevive a deploys/restarts do Railway).
const BACKOFF_MS = 60 * 60 * 1000; // 1h — também usado como intervalo mínimo entre syncs

// ── LWA token (factory para US e BR) ───────────
function makeLwaGetter(clientId, secret, refreshToken, label) {
  let cache = null;
  return async function () {
    if (cache && cache.exp > Date.now()) return cache.token;
    const res = await safeFetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: secret }),
    });
    const json = await safeJson(res);
    if (json.error) throw new Error(`Amazon LWA ${label} [HTTP ${res.status}]: ${json.error} — ${json.error_description || ''}`);
    cache = { token: json.access_token, exp: Date.now() + (json.expires_in - 60) * 1000 };
    return cache.token;
  };
}
const getLwaToken   = makeLwaGetter(CLIENT_ID,    CLIENT_SECRET,    REFRESH_TOKEN,    '(US)');
const getLwaTokenBR = makeLwaGetter(CLIENT_ID_BR, CLIENT_SECRET_BR, REFRESH_TOKEN_BR, '(BR)');

// ── STS AssumeRole ──────────────────────────────
let roleCache = null;
async function assumeRole() {
  if (roleCache && roleCache.exp > Date.now()) return roleCache;
  const url  = 'https://sts.amazonaws.com/';
  const body = new URLSearchParams({ Action: 'AssumeRole', RoleArn: ROLE_ARN, RoleSessionName: 'dashboard-sp-api', Version: '2011-06-15', DurationSeconds: 3600 }).toString();
  const hdrs = sigV4Headers({
    method: 'POST', url, body,
    accessKey: AWS_ACCESS_KEY, secretKey: AWS_SECRET_KEY,
    region: 'us-east-1', service: 'sts',
    extraHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const res  = await safeFetch(url, { method: 'POST', headers: hdrs, body });
  const text = await res.text();
  if (!res.ok && !text.includes('<AssumeRoleResult>')) throw new Error(`Amazon STS [HTTP ${res.status}]: ${text.slice(0, 300)}`);
  const ak   = text.match(/<AccessKeyId>(.*?)<\/AccessKeyId>/)?.[1];
  const sk   = text.match(/<SecretAccessKey>(.*?)<\/SecretAccessKey>/)?.[1];
  const tok  = text.match(/<SessionToken>(.*?)<\/SessionToken>/)?.[1];
  const exp  = text.match(/<Expiration>(.*?)<\/Expiration>/)?.[1];
  if (!ak || !sk) throw new Error('Amazon STS AssumeRole falhou: ' + text.slice(0, 300));
  roleCache = { accessKey: ak, secretKey: sk, sessionToken: tok, exp: new Date(exp).getTime() - 60000 };
  return roleCache;
}

// ── SP-API GET (host e lwa configuráveis para US/BR) ──
async function spGet(host, getLwa, path, params = {}, onRateLimit) {
  const url = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.sort();
  const lwa   = await getLwa();
  const creds = await assumeRole();
  const hdrs  = sigV4Headers({
    method: 'GET', url: url.toString(),
    accessKey: creds.accessKey, secretKey: creds.secretKey, sessionToken: creds.sessionToken,
    region: 'us-east-1', service: 'execute-api',
    extraHeaders: { 'x-amz-access-token': lwa },
  });
  const res  = await safeFetch(url.toString(), { headers: hdrs });
  const json = await safeJson(res);
  if (json.errors) {
    const codes = json.errors.map(e => e.code || '').filter(Boolean).join(',');
    const err   = new Error(`SP-API ${path} [HTTP ${res.status}${codes ? ' ' + codes : ''}]: ${json.errors.map(e => e.message).join('; ')}`);
    if (res.status === 429 && onRateLimit) onRateLimit();
    throw err;
  }
  return json;
}

// ── fetchOrders genérico ─────────────────────────
async function _fetchOrders({ sinceISO, untilISO, host, marketplaceId, getLwa, market, getBackoff, setBackoff, label }) {
  if (!hasAwsCreds()) {
    console.warn(`Amazon ${label}: AWS creds ausentes — configure AMAZON_AWS_ACCESS_KEY / SECRET_KEY.`);
    return [];
  }
  const backoffUntil = getBackoff();
  if (backoffUntil > Date.now()) {
    const mins = Math.ceil((backoffUntil - Date.now()) / 60000);
    console.log(`Amazon ${label}: em backoff por mais ${mins} min — pulando este sync.`);
    return [];
  }

  const safeUntil = new Date(Math.min(
    new Date(`${untilISO}T23:59:59Z`).getTime(),
    Date.now() - 3 * 60 * 1000
  )).toISOString();
  console.log(`Amazon ${label}: buscando pedidos ${sinceISO} → ${safeUntil.slice(0, 16)}`);

  const out = [];
  let nextToken = null;
  const onRateLimit = () => {
    const until = Date.now() + BACKOFF_MS;
    setBackoff(until);
    console.warn(`Amazon ${label}: rate limit — backoff até ${new Date(until).toISOString()}`);
  };

  do {
    const params = { MarketplaceIds: marketplaceId, CreatedAfter: `${sinceISO}T00:00:00Z`, CreatedBefore: safeUntil, MaxResultsPerPage: 100 };
    if (nextToken) { params.NextToken = nextToken; delete params.CreatedAfter; delete params.CreatedBefore; }

    const data   = await spGet(host, getLwa, '/orders/v0/orders', params, onRateLimit);
    const orders = data.payload?.Orders || [];

    for (const o of orders) {
      out.push({
        id:        `amazon-${market}:` + o.AmazonOrderId,
        channel:   'amazon',
        market,
        name:      '#' + o.AmazonOrderId,
        createdAt: o.PurchaseDate,
        status:    o.OrderStatus,
        cancelled: ['Canceled', 'PendingAvailability'].includes(o.OrderStatus),
        total:     Number(o.OrderTotal?.Amount || 0),
        source:    'Amazon',
        customer:  o.BuyerInfo?.BuyerName || '',
        state:     o.ShippingAddress?.StateOrRegion || null,
        items:     [],
      });
    }
    nextToken = data.payload?.NextToken || null;
    if (nextToken) await sleep(2000);
  } while (nextToken);

  return out;
}

export async function fetchOrders(sinceISO, untilISO) {
  if (!isConfigured()) return [];
  return _fetchOrders({ sinceISO, untilISO, host: SP_HOST, marketplaceId: MARKETPLACE_ID, getLwa: getLwaToken, market: 'us', getBackoff: getAmazonBackoff, setBackoff: setAmazonBackoff, label: '(US)' });
}

export async function fetchOrdersBR(sinceISO, untilISO) {
  if (!isConfiguredBR()) return [];
  return _fetchOrders({ sinceISO, untilISO, host: SP_HOST_BR, marketplaceId: MARKETPLACE_ID_BR, getLwa: getLwaTokenBR, market: 'br', getBackoff: getAmazonBRBackoff, setBackoff: setAmazonBRBackoff, label: '(BR)' });
}

// ── Diagnóstico passo a passo ───────────────────
export async function diagAmazonUS() {
  const result = { lwa: null, sts: null, participations: null, orders7d: null };

  // 1. LWA token
  try {
    const res  = await safeFetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    });
    const text = await res.text();
    const json = JSON.parse(text);
    result.lwa = json.error
      ? { ok: false, status: res.status, error: json.error, desc: json.error_description }
      : { ok: true, status: res.status, expires_in: json.expires_in, token_prefix: json.access_token?.slice(0, 20) };
  } catch (e) { result.lwa = { ok: false, error: e.message }; }

  if (!result.lwa?.ok) return result;

  // 2. STS AssumeRole
  try {
    const url  = 'https://sts.amazonaws.com/';
    const body = new URLSearchParams({ Action: 'AssumeRole', RoleArn: ROLE_ARN, RoleSessionName: 'diag-session', Version: '2011-06-15', DurationSeconds: 900 }).toString();
    const hdrs = sigV4Headers({ method: 'POST', url, body, accessKey: AWS_ACCESS_KEY, secretKey: AWS_SECRET_KEY, region: 'us-east-1', service: 'sts', extraHeaders: { 'content-type': 'application/x-www-form-urlencoded' } });
    const res  = await safeFetch(url, { method: 'POST', headers: hdrs, body });
    const text = await res.text();
    const hasRole = text.includes('<AssumeRoleResult>');
    result.sts = { ok: res.ok && hasRole, status: res.status, hasCredentials: hasRole, snippet: text.slice(0, 200) };
  } catch (e) { result.sts = { ok: false, error: e.message }; }

  if (!result.sts?.ok) return result;

  // 3. /sellers/v1/marketplaceParticipations (cota diferente da Orders API)
  try {
    const url  = new URL(`https://${SP_HOST}/sellers/v1/marketplaceParticipations`);
    const lwa  = await getLwaToken();
    const creds = await assumeRole();
    const hdrs = sigV4Headers({ method: 'GET', url: url.toString(), accessKey: creds.accessKey, secretKey: creds.secretKey, sessionToken: creds.sessionToken, region: 'us-east-1', service: 'execute-api', extraHeaders: { 'x-amz-access-token': lwa } });
    const res  = await safeFetch(url.toString(), { headers: hdrs });
    const text = await res.text();
    const respHeaders = Object.fromEntries([...res.headers.entries()].filter(([k]) => k.startsWith('x-amzn') || k === 'content-type'));
    result.participations = { ok: res.ok, status: res.status, headers: respHeaders, body: text.slice(0, 400) };
  } catch (e) { result.participations = { ok: false, error: e.message }; }

  // 4. Orders API — últimos 7 dias, 1 resultado apenas
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const safeUntil = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const url  = new URL(`https://${SP_HOST}/orders/v0/orders`);
    url.searchParams.set('MarketplaceIds', MARKETPLACE_ID);
    url.searchParams.set('CreatedAfter', `${since}T00:00:00Z`);
    url.searchParams.set('CreatedBefore', safeUntil);
    url.searchParams.set('MaxResultsPerPage', '1');
    url.searchParams.sort();
    const lwa  = await getLwaToken();
    const creds = await assumeRole();
    const hdrs = sigV4Headers({ method: 'GET', url: url.toString(), accessKey: creds.accessKey, secretKey: creds.secretKey, sessionToken: creds.sessionToken, region: 'us-east-1', service: 'execute-api', extraHeaders: { 'x-amz-access-token': lwa } });
    const res  = await safeFetch(url.toString(), { headers: hdrs });
    const text = await res.text();
    const respHeaders = Object.fromEntries([...res.headers.entries()].filter(([k]) => k.startsWith('x-amzn') || k === 'retry-after' || k === 'content-type'));
    result.orders7d = { ok: res.ok, status: res.status, headers: respHeaders, body: text.slice(0, 600) };
  } catch (e) { result.orders7d = { ok: false, error: e.message }; }

  return result;
}
