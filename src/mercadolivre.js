// ─────────────────────────────────────────────
//  mercadolivre.js — integração com a API do Mercado Livre
//  Usa OAuth 2.0 (authorization_code) e renova o access_token
//  automaticamente (vence a cada 6h).
//
//  Passos (uma vez):
//   1. Acesse GET /mercadolivre/connect  → redireciona para o ML autorizar.
//   2. Após autorizar, o ML chama /mercadolivre/callback?code=...
//      e o código é trocado por access_token + refresh_token (salvos no store).
//   Depois disso, fetchOrders() funciona e o token se renova sozinho.
// ─────────────────────────────────────────────
import 'dotenv/config';
import { getMlTokens, setMlTokens } from './store.js';

const CLIENT_ID     = process.env.ML_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const REDIRECT      = process.env.ML_REDIRECT_URL;
const API_BASE      = 'https://api.mercadolibre.com';
const AUTH_URL      = 'https://auth.mercadolivre.com.br/authorization';

function now() { return Math.floor(Date.now() / 1000); }

export function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

// URL para o lojista autorizar o app.
export function buildAuthUrl() {
  if (!isConfigured()) throw new Error('Mercado Livre não configurado (.env: ML_CLIENT_ID / ML_CLIENT_SECRET).');
  const params = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json();
  if (json.error) throw new Error('ML token: ' + json.error + ' ' + (json.error_description || ''));
  return json;
}

function saveTokens(json) {
  setMlTokens({
    user_id:       json.user_id,
    access_token:  json.access_token,
    refresh_token: json.refresh_token,
    expires_at:    now() + (json.expires_in || 21600) - 120,  // margem de 2 min
  });
}

// Troca o "code" (do callback) por access_token + refresh_token.
export async function exchangeCode(code) {
  const json = await tokenRequest({
    grant_type:    'authorization_code',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri:  REDIRECT,
  });
  saveTokens(json);
  return json;
}

// Renova o access_token usando o refresh_token.
async function refreshToken() {
  const tk = getMlTokens();
  if (!tk) throw new Error('Mercado Livre ainda não autorizado (use /mercadolivre/connect).');
  const json = await tokenRequest({
    grant_type:    'refresh_token',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: tk.refresh_token,
  });
  saveTokens(json);
  return getMlTokens();
}

async function validToken() {
  let tk = getMlTokens();
  if (!tk) throw new Error('Mercado Livre ainda não autorizado (use /mercadolivre/connect).');
  if (now() >= tk.expires_at) tk = await refreshToken();
  return tk;
}

// GET autenticado na API do ML.
async function apiGet(path, params = {}) {
  const tk = await validToken();
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tk.access_token}` } });
  const json = await res.json();
  if (json.error) throw new Error(`ML ${path}: ${json.error} ${json.message || ''}`);
  return json;
}

// Busca pedidos no intervalo e devolve normalizados (mesmo formato da Shopify/Shopee).
export async function fetchOrders(sinceISO, untilISO) {
  if (!isConfigured() || !getMlTokens()) return [];  // ainda não conectado → canal fica 0
  const tk = getMlTokens();

  const out = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const data = await apiGet('/orders/search', {
      seller:                         tk.user_id,
      'order.date_created.from':      sinceISO  + 'T00:00:00.000-03:00',
      'order.date_created.to':        untilISO  + 'T23:59:59.999-03:00',
      limit,
      offset,
    });

    const results = data.results || [];
    for (const o of results) {
      const cancelled = ['cancelled', 'invalid'].includes(o.status);
      out.push({
        id:        'mercadolivre:' + o.id,
        channel:   'mercadolivre',
        name:      '#' + o.id,
        createdAt: o.date_created,
        status:    o.status,
        cancelled,
        total:     Number(o.total_amount) || 0,
        source:    'Mercado Livre',
        customer:  o.buyer?.nickname || '',
        items: (o.order_items || []).map(it => ({
          title:  it.item?.title || '',
          qty:    it.quantity || 1,
          amount: Number(it.unit_price || 0) * (it.quantity || 1),
        })),
      });
    }

    if (results.length < limit) break;
    offset += limit;
  }

  return out;
}
