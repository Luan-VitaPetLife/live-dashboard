// ─────────────────────────────────────────────
//  shopee.js — integração com a Shopee Open Platform (API v2)
//  Cuida da assinatura HMAC-SHA256, do fluxo OAuth e da
//  renovação automática do access_token (vence ~4h).
//
//  Passos (uma vez):
//   1. Acesse GET /shopee/connect  -> redireciona para a Shopee autorizar.
//   2. Após autorizar, a Shopee chama /shopee/callback?code=...&shop_id=...
//      e o código é trocado por access_token + refresh_token (salvos no store).
//   Depois disso, fetchOrders() funciona e o token se renova sozinho.
// ─────────────────────────────────────────────
import 'dotenv/config';
import crypto from 'crypto';
import { getShopeeTokens, setShopeeTokens } from './store.js';

const PARTNER_ID = process.env.SHOPEE_PARTNER_ID;
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
const SHOP_ID = process.env.SHOPEE_SHOP_ID;
const REDIRECT = process.env.SHOPEE_REDIRECT_URL;
const HOST = process.env.SHOPEE_PRODUCTION === '0'
  ? 'https://partner.test-stable.shopeemobile.com'
  : 'https://partner.shopeemobile.com';

function now() { return Math.floor(Date.now() / 1000); }

// Assinatura base: partner_id + path + timestamp [+ access_token + shop_id]
function sign(path, timestamp, accessToken = '', shopId = '') {
  const base = `${PARTNER_ID}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac('sha256', PARTNER_KEY).update(base).digest('hex');
}

export function isConfigured() {
  return Boolean(PARTNER_ID && PARTNER_KEY);
}

// URL para o lojista autorizar o app.
export function buildAuthUrl() {
  if (!isConfigured()) throw new Error('Shopee não configurada (.env: SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY).');
  const path = '/api/v2/shop/auth_partner';
  const ts = now();
  const s = sign(path, ts);
  const redirect = encodeURIComponent(REDIRECT);
  return `${HOST}${path}?partner_id=${PARTNER_ID}&timestamp=${ts}&sign=${s}&redirect=${redirect}`;
}

// Troca o "code" (do callback) por access_token + refresh_token.
export async function exchangeCode(code, shopId) {
  const path = '/api/v2/auth/token/get';
  const ts = now();
  const s = sign(path, ts);
  const url = `${HOST}${path}?partner_id=${PARTNER_ID}&timestamp=${ts}&sign=${s}`;
  const body = { code, shop_id: Number(shopId || SHOP_ID), partner_id: Number(PARTNER_ID) };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (json.error) throw new Error('Shopee token: ' + json.error + ' ' + (json.message || ''));
  saveTokens(json, shopId || SHOP_ID);
  return json;
}

function saveTokens(json, shopId) {
  const t = now();
  setShopeeTokens({
    shop_id: Number(shopId),
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: t + (json.expire_in || 14400) - 120,        // margem de 2 min
    refresh_expires_at: t + (30 * 24 * 3600),               // refresh_token ~30 dias
  });
}

// Renova o access_token usando o refresh_token.
export async function refresh() {
  const tk = getShopeeTokens();
  if (!tk) throw new Error('Shopee ainda não autorizada (use /shopee/connect).');
  const path = '/api/v2/auth/access_token/get';
  const ts = now();
  const s = sign(path, ts);
  const url = `${HOST}${path}?partner_id=${PARTNER_ID}&timestamp=${ts}&sign=${s}`;
  const body = { refresh_token: tk.refresh_token, shop_id: tk.shop_id, partner_id: Number(PARTNER_ID) };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (json.error) throw new Error('Shopee refresh: ' + json.error + ' ' + (json.message || ''));
  saveTokens(json, tk.shop_id);
  return getShopeeTokens();
}

async function validToken() {
  let tk = getShopeeTokens();
  if (!tk) throw new Error('Shopee ainda não autorizada (use /shopee/connect).');
  if (now() >= tk.expires_at) tk = await refresh();
  return tk;
}

// Chamada autenticada a um endpoint da loja.
async function shopCall(path, extraParams = {}, method = 'GET', body = null) {
  const tk = await validToken();
  const ts = now();
  const s = sign(path, ts, tk.access_token, tk.shop_id);
  const params = new URLSearchParams({
    partner_id: PARTNER_ID, timestamp: String(ts), access_token: tk.access_token,
    shop_id: String(tk.shop_id), sign: s, ...extraParams,
  });
  const url = `${HOST}${path}?${params.toString()}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.error) throw new Error(`Shopee ${path}: ${json.error} ${json.message || ''}`);
  return json;
}

// Lista pedidos no intervalo e devolve normalizados (mesmo formato da Shopify).
// A Shopee limita cada chamada a 15 dias — a janela é fatiada em chunks.
export async function fetchOrders(sinceISO, untilISO) {
  if (!isConfigured() || !getShopeeTokens()) return [];

  const CHUNK_MS = 15 * 24 * 60 * 60 * 1000; // 15 dias em ms
  const sinceMs  = Date.parse(sinceISO + 'T00:00:00-03:00');
  const untilMs  = Date.parse(untilISO + 'T23:59:59-03:00');

  // 1) Coleta order_sn em janelas de ≤15 dias (dedup por Set).
  const snSet  = new Set();
  const snList = [];
  let chunkStart = sinceMs;
  while (chunkStart < untilMs) {
    const chunkEnd = Math.min(chunkStart + CHUNK_MS, untilMs);
    const timeFrom = Math.floor(chunkStart / 1000);
    const timeTo   = Math.floor(chunkEnd   / 1000);
    let cursor = '';
    do {
      const r = await shopCall('/api/v2/order/get_order_list', {
        time_range_field: 'create_time',
        time_from: String(timeFrom),
        time_to:   String(timeTo),
        page_size: '50',
        cursor,
      });
      (r.response?.order_list || []).forEach(o => {
        if (!snSet.has(o.order_sn)) { snSet.add(o.order_sn); snList.push(o.order_sn); }
      });
      cursor = r.response?.next_cursor || '';
      if (!r.response?.more) break;
    } while (cursor);
    chunkStart = chunkEnd + 1;
  }

  // 2) Detalhe dos pedidos (em lotes de até 50 order_sn).
  const out = [];
  for (let i = 0; i < snList.length; i += 50) {
    const batch = snList.slice(i, i + 50);
    if (!batch.length) break;
    const d = await shopCall('/api/v2/order/get_order_detail', {
      order_sn_list: batch.join(','),
      response_optional_fields: 'order_status,total_amount,create_time,buyer_username,item_list',
    });
    for (const o of (d.response?.order_list || [])) {
      const cancelled = ['CANCELLED', 'UNPAID', 'INVOICE_PENDING'].includes(o.order_status);
      out.push({
        id:        'shopee:' + o.order_sn,
        channel:   'shopee',
        market:    'br',
        name:      '#' + o.order_sn,
        createdAt: new Date((o.create_time || 0) * 1000).toISOString(),
        status:    o.order_status,
        cancelled,
        total:     Number(o.total_amount) || 0,
        source:    'Shopee',
        customer:  o.buyer_username || '',
        state:     null,
        items: (o.item_list || []).map(it => ({
          title:  it.item_name,
          qty:    it.model_quantity_purchased || it.quantity || 1,
          amount: (Number(it.model_discounted_price ?? it.model_original_price) || 0) * (it.model_quantity_purchased || 1),
        })),
      });
    }
  }
  return out;
}
