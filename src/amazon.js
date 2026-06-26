// ─────────────────────────────────────────────
//  amazon.js — Amazon Selling Partner API (EUA)
//  Autenticação: LWA (Login with Amazon) + AWS SigV4 via IAM AssumeRole
//  Requer: AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET, AMAZON_REFRESH_TOKEN,
//          AMAZON_ROLE_ARN, AMAZON_AWS_ACCESS_KEY, AMAZON_AWS_SECRET_KEY
// ─────────────────────────────────────────────
import 'dotenv/config';
import crypto from 'crypto';

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

const CLIENT_ID      = process.env.AMAZON_CLIENT_ID;
const CLIENT_SECRET  = process.env.AMAZON_CLIENT_SECRET;
const REFRESH_TOKEN  = process.env.AMAZON_REFRESH_TOKEN;
const ROLE_ARN       = process.env.AMAZON_ROLE_ARN;
const AWS_ACCESS_KEY = process.env.AMAZON_AWS_ACCESS_KEY;
const AWS_SECRET_KEY = process.env.AMAZON_AWS_SECRET_KEY;
const MARKETPLACE_ID = 'ATVPDKIKX0DER'; // Amazon.com (US)
const SP_HOST        = 'sellingpartnerapi-na.amazon.com';

export function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}
function hasAwsCreds() {
  return Boolean(AWS_ACCESS_KEY && AWS_SECRET_KEY);
}

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
const BACKOFF_MS = 25 * 60 * 1000; // 25 min
let backoffUntil = 0;

// ── LWA token ──────────────────────────────────
let lwaCache = null;
async function getLwaToken() {
  if (lwaCache && lwaCache.exp > Date.now()) return lwaCache.token;
  const res = await safeFetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  const json = await safeJson(res);
  if (json.error) throw new Error(`Amazon LWA [HTTP ${res.status}]: ${json.error} — ${json.error_description || ''}`);
  lwaCache = { token: json.access_token, exp: Date.now() + (json.expires_in - 60) * 1000 };
  return json.access_token;
}

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

// ── SP-API GET ──────────────────────────────────
async function spGet(path, params = {}) {
  const url = new URL(`https://${SP_HOST}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const lwa   = await getLwaToken();
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
    if (res.status === 429) {
      backoffUntil = Date.now() + BACKOFF_MS;
      console.warn(`Amazon: rate limit atingido — pausando Amazon por 4h (até ${new Date(backoffUntil).toISOString()})`);
    }
    throw err;
  }
  return json;
}

// ── fetchOrders ─────────────────────────────────
export async function fetchOrders(sinceISO, untilISO) {
  if (!isConfigured()) return [];
  if (!hasAwsCreds()) {
    console.warn('Amazon: AMAZON_AWS_ACCESS_KEY / AMAZON_AWS_SECRET_KEY não configurados — configure no Railway para ativar.');
    return [];
  }
  if (backoffUntil > Date.now()) {
    const mins = Math.ceil((backoffUntil - Date.now()) / 60000);
    console.log(`Amazon: em backoff por mais ${mins} min — pulando este sync.`);
    return [];
  }

  const out = [];
  let nextToken = null;
  // CreatedBefore deve ser pelo menos 2 min antes do momento atual (requisito SP-API)
  const safeUntil = new Date(Math.min(
    new Date(`${untilISO}T23:59:59Z`).getTime(),
    Date.now() - 3 * 60 * 1000
  )).toISOString();
  console.log(`Amazon: buscando pedidos ${sinceISO} → ${safeUntil.slice(0,16)}`);
  do {
    const params = {
      MarketplaceIds:  MARKETPLACE_ID,
      CreatedAfter:    `${sinceISO}T00:00:00Z`,
      CreatedBefore:   safeUntil,
      MaxResultsPerPage: 100,
    };
    if (nextToken) { params.NextToken = nextToken; delete params.CreatedAfter; delete params.CreatedBefore; }

    const data   = await spGet('/orders/v0/orders', params);
    const orders = data.payload?.Orders || [];

    for (const o of orders) {
      const cancelled = ['Canceled', 'PendingAvailability'].includes(o.OrderStatus);
      out.push({
        id:        'amazon:' + o.AmazonOrderId,
        channel:   'amazon',
        market:    'us',
        name:      '#' + o.AmazonOrderId,
        createdAt: o.PurchaseDate,
        status:    o.OrderStatus,
        cancelled,
        total:     Number(o.OrderTotal?.Amount || 0),
        source:    'Amazon',
        customer:  o.BuyerInfo?.BuyerName || '',
        state:     o.ShippingAddress?.StateOrRegion || null,
        items:     [],
      });
    }
    nextToken = data.payload?.NextToken || null;
    if (nextToken) await sleep(2000); // respeita rate limit entre páginas
  } while (nextToken);

  return out;
}
