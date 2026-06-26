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
      // listing_type_id: 'free' → orgânico; qualquer outro (bronze/silver/gold_*) → premium
      const ltid = (o.order_items || [])[0]?.item?.listing_type_id || null;
      const listingType = ltid ? (ltid === 'free' ? 'organic' : 'premium') : null;
      out.push({
        id:          'mercadolivre:' + o.id,
        channel:     'mercadolivre',
        market:      'br',
        name:        '#' + o.id,
        createdAt:   o.date_created,
        status:      o.status,
        cancelled,
        total:       Number(o.total_amount) || 0,
        source:      'Mercado Livre',
        customer:    o.buyer?.nickname || '',
        state:       null,              // preenchido abaixo via /shipments
        listingType,
        _sid:        o.shipping?.id || null,
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

  // Resolve endereço de entrega em lotes para popular o campo state
  const shipIds = [...new Set(out.filter(o => o._sid).map(o => o._sid))];
  if (shipIds.length > 0) {
    const stateMap = {};
    const BATCH = 15;
    for (let i = 0; i < shipIds.length; i += BATCH) {
      const batch = shipIds.slice(i, i + BATCH);
      await Promise.all(batch.map(async sid => {
        try {
          const sh = await apiGet(`/shipments/${sid}`);
          const stId = sh.receiver_address?.state?.id; // ex: "BR-SP"
          if (stId) stateMap[sid] = stId.includes('-') ? stId.split('-').pop() : stId;
        } catch { /* sem endereço — state fica null */ }
      }));
    }
    out.forEach(o => { o.state = stateMap[o._sid] || null; delete o._sid; });
  } else {
    out.forEach(o => { delete o._sid; });
  }

  return out;
}

// Busca custo de anúncios do ML Product Ads no intervalo.
// Retorna zeros graciosamente se o token não tiver acesso ao escopo de advertising.
export async function fetchAdCosts(sinceISO, untilISO) {
  const EMPTY_COSTS = { spend: 0, clicks: 0, impressions: 0 };
  if (!isConfigured() || !getMlTokens()) return EMPTY_COSTS;
  try {
    const tk = getMlTokens();
    const sellerId = tk.user_id;
    if (!sellerId) return EMPTY_COSTS;

    // Endpoint de clicks/spend por período (Product Ads API)
    const data = await apiGet(
      `/advertising/product_ads/advertisers/${sellerId}/clicks`,
      { date_from: sinceISO, date_to: untilISO }
    );

    return {
      spend:       Number(data.total_cost       ?? data.spend       ?? 0),
      clicks:      Number(data.total_clicks     ?? data.clicks      ?? 0),
      impressions: Number(data.total_impressions ?? data.impressions ?? 0),
    };
  } catch (e) {
    console.warn('ML Ads API indisponível (pode requerer escopo adicional):', e.message);
    return EMPTY_COSTS;
  }
}
