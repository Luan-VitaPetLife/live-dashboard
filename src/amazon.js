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
//  Cada marketplace tem seu próprio LWA token e backoff independente.
//  Dois chamadas separadas por sync (US → pausa 3s → BR).
// ─────────────────────────────────────────────
import 'dotenv/config';
import crypto from 'crypto';
import {
  getAmazonBackoff,      setAmazonBackoff,
  getAmazonBackoffCount, setAmazonBackoffCount,
  getAmazonBRBackoff,      setAmazonBRBackoff,
  getAmazonBRBackoffCount, setAmazonBRBackoffCount,
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

// ── SP-API GET ─────────────────────────────────────────────────────────────────
async function spGet(getLwa, path, params = {}, onRateLimit, lwaOverride = null) {
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
    if (onRateLimit) onRateLimit();
    const errBody = await res.text().catch(() => '');
    throw new Error(`SP-API ${path} [HTTP 429 QuotaExceeded]: ${errBody.slice(0, 200)}`);
  }

  const json = await safeJson(res);
  if (json.errors) {
    const codes = json.errors.map(e => e.code || '').filter(Boolean).join(',');
    throw new Error(`SP-API ${path} [HTTP ${res.status}${codes ? ' ' + codes : ''}]: ${json.errors.map(e => e.message).join('; ')}`);
  }
  return json;
}

// ── fetchMarketplaceOrders — busca pedidos de UM marketplace com seu próprio token ──
async function fetchMarketplaceOrders({ getLwa, marketplaceId, sinceISO, untilISO,
    getBackoff, setBackoff, getBackoffCount, setBackoffCount }) {

  const backoffUntil = getBackoff();
  if (backoffUntil > Date.now()) {
    const mins = Math.ceil((backoffUntil - Date.now()) / 60000);
    const { market } = MARKET_BY_MP[marketplaceId] || {};
    console.log(`Amazon ${(market || '?').toUpperCase()}: backoff ativo por mais ${mins} min — pulando.`);
    return [];
  }

  const safeUntil = new Date(Math.min(
    new Date(`${untilISO}T23:59:59Z`).getTime(),
    Date.now() - 3 * 60 * 1000,
  )).toISOString();

  const { market, channel } = MARKET_BY_MP[marketplaceId] || {};
  console.log(`Amazon ${(market || '?').toUpperCase()}: buscando ${sinceISO} → ${safeUntil.slice(0, 16)}`);

  const onRateLimit = () => {
    const count = getBackoffCount();
    const delay = backoffDelayMs(count);
    const until = Date.now() + delay;
    setBackoffCount(count + 1);
    setBackoff(until);
    console.warn(`Amazon ${(market || '?').toUpperCase()}: 429 (tentativa ${count + 1}) — backoff ${delay / 60000} min`);
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

  const out = [];
  let nextToken = null;

  do {
    const params = {
      MarketplaceIds:    marketplaceId,
      CreatedAfter:      `${sinceISO}T00:00:00Z`,
      CreatedBefore:     safeUntil,
      MaxResultsPerPage: 100,
    };
    if (nextToken) {
      params.NextToken = nextToken;
      delete params.CreatedAfter;
      delete params.CreatedBefore;
    }

    const data   = await spGet(getLwa, '/orders/v0/orders', params, onRateLimit, rdt);
    const orders = data.payload?.Orders || [];

    for (const o of orders) {
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
        state:     o.ShippingAddress?.StateOrRegion || null,
        items:     Array.from(
          { length: Number(o.NumberOfItemsShipped || 0) + Number(o.NumberOfItemsUnshipped || 0) },
          () => ({ title: '', qty: 1, amount: 0 })
        ),
      });
    }

    nextToken = data.payload?.NextToken || null;
    if (nextToken) await sleep(2000);
  } while (nextToken);

  setBackoffCount(0); // reset após sucesso
  return out;
}

// ── Exports públicos ───────────────────────────────────────────────────────────
// fetchOrders faz TWO chamadas independentes: US com AMAZON_REFRESH_TOKEN,
// BR com AMAZON_BR_REFRESH_TOKEN. Backoffs separados — 429 de um não bloqueia o outro.
export async function fetchOrders(sinceISO, untilISO) {
  if (!hasAwsCreds()) {
    console.warn('Amazon: AWS creds ausentes — configure AMAZON_AWS_ACCESS_KEY / SECRET_KEY.');
    return [];
  }

  const results = [];

  if (isConfigured()) {
    const us = await fetchMarketplaceOrders({
      getLwa: getLwaTokenUS, marketplaceId: MARKETPLACE_ID, sinceISO, untilISO,
      getBackoff: getAmazonBackoff, setBackoff: setAmazonBackoff,
      getBackoffCount: getAmazonBackoffCount, setBackoffCount: setAmazonBackoffCount,
    }).catch(e => { console.error('Amazon US:', e.message); return []; });
    results.push(...us);
  } else {
    console.warn('Amazon US: AMAZON_REFRESH_TOKEN não configurado — autorize o app no NA Seller Central.');
  }

  // Pausa entre chamadas para respeitar a cota (US e BR são contas separadas mas
  // compartilham o mesmo IAM; a SP-API trata as cotas por seller account individualmente)
  if (isConfigured() && isConfiguredBR()) await sleep(3000);

  if (isConfiguredBR()) {
    const br = await fetchMarketplaceOrders({
      getLwa: getLwaTokenBR, marketplaceId: MARKETPLACE_ID_BR, sinceISO, untilISO,
      getBackoff: getAmazonBRBackoff, setBackoff: setAmazonBRBackoff,
      getBackoffCount: getAmazonBRBackoffCount, setBackoffCount: setAmazonBRBackoffCount,
    }).catch(e => { console.error('Amazon BR:', e.message); return []; });
    results.push(...br);
  } else {
    console.warn('Amazon BR: AMAZON_BR_REFRESH_TOKEN não configurado — autorize o app no BR Seller Central.');
  }

  return results;
}

export async function fetchOrdersBR() {
  return []; // BR já vem incluído em fetchOrders
}
