// ─────────────────────────────────────────────
//  googleads.js — Google Ads API (campanhas de busca/display)
//  Usa OAuth 2.0 (authorization_code) e renova o access_token
//  automaticamente via refresh_token (não expira).
//
//  Escopo atual: só conta EUA ("Coco and Luna", Customer ID 134-411-4329)
//  roda campanhas nos EUA — ver CLAUDE.md.
//
//  Passos (uma vez):
//   1. Acesse GET /googleads/connect → redireciona para o Google autorizar.
//   2. Após autorizar, o Google chama /googleads/callback?code=...
//      e o código é trocado por access_token + refresh_token (salvos no store).
//   Depois disso, fetchCampaigns() funciona e o token se renova sozinho.
// ─────────────────────────────────────────────
import 'dotenv/config';
import { getGoogleAdsTokens, setGoogleAdsTokens } from './store.js';

const CLIENT_ID          = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET      = process.env.GOOGLE_ADS_CLIENT_SECRET;
const DEVELOPER_TOKEN    = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const REDIRECT           = process.env.GOOGLE_ADS_REDIRECT_URL;
const CUSTOMER_ID        = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
const LOGIN_CUSTOMER_ID  = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');
const API_VERSION        = 'v18';
const API_BASE           = `https://googleads.googleapis.com/${API_VERSION}`;
const AUTH_URL           = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL          = 'https://oauth2.googleapis.com/token';
const SCOPE              = 'https://www.googleapis.com/auth/adwords';

function now() { return Math.floor(Date.now() / 1000); }

export function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && DEVELOPER_TOKEN && CUSTOMER_ID);
}

// URL para o Luan autorizar o app (só precisa ser feito uma vez).
export function buildAuthUrl() {
  if (!CLIENT_ID || !REDIRECT) throw new Error('Google Ads não configurado (.env: GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_REDIRECT_URL).');
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT,
    response_type: 'code',
    scope:         SCOPE,
    access_type:   'offline', // necessário para receber refresh_token
    prompt:        'consent', // força novo refresh_token mesmo se já autorizado antes
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json();
  if (json.error) throw new Error('Google Ads token: ' + json.error + ' ' + (json.error_description || ''));
  return json;
}

function saveTokens(json) {
  const existing = getGoogleAdsTokens() || {};
  setGoogleAdsTokens({
    access_token:  json.access_token,
    refresh_token: json.refresh_token || existing.refresh_token, // só vem na 1ª autorização
    expires_at:    now() + (json.expires_in || 3600) - 120, // margem de 2 min
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
async function refreshAccessToken() {
  const tk = getGoogleAdsTokens();
  if (!tk?.refresh_token) throw new Error('Google Ads ainda não autorizado (use /googleads/connect).');
  const json = await tokenRequest({
    grant_type:    'refresh_token',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: tk.refresh_token,
  });
  saveTokens(json);
  return getGoogleAdsTokens();
}

async function validToken() {
  let tk = getGoogleAdsTokens();
  if (!tk?.refresh_token) throw new Error('Google Ads ainda não autorizado (use /googleads/connect).');
  if (now() >= tk.expires_at) tk = await refreshAccessToken();
  return tk;
}

// Executa uma query GAQL (Google Ads Query Language) via googleAds:search, paginando.
async function gaqlSearch(query) {
  const tk = await validToken();
  const headers = {
    'Content-Type':    'application/json',
    Authorization:     `Bearer ${tk.access_token}`,
    'developer-token': DEVELOPER_TOKEN,
  };
  if (LOGIN_CUSTOMER_ID) headers['login-customer-id'] = LOGIN_CUSTOMER_ID;

  const out = [];
  let pageToken = null;
  do {
    const body = { query };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch(`${API_BASE}/customers/${CUSTOMER_ID}/googleAds:search`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = json.error?.message || `HTTP ${res.status}`;
      throw new Error(`Google Ads API: ${msg}`);
    }
    out.push(...(json.results || []));
    pageToken = json.nextPageToken || null;
  } while (pageToken);

  return out;
}

// Busca métricas por CAMPANHA no intervalo (agregado, sem segmentação por dia).
// Retorna zeros/vazio graciosamente se não configurado/autorizado — nada quebra.
// Retorna array: { name, status, spend, revenue, orders, clicks, impressions, ctr, roas }
export async function fetchCampaigns(sinceISO, untilISO) {
  if (!isConfigured() || !getGoogleAdsTokens()) return [];
  try {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${sinceISO}' AND '${untilISO}'
      ORDER BY metrics.cost_micros DESC
    `;
    const rows = await gaqlSearch(query);

    const byId = {};
    for (const r of rows) {
      const id = r.campaign.id;
      if (!byId[id]) {
        byId[id] = { name: r.campaign.name, status: r.campaign.status, spend: 0, revenue: 0, orders: 0, clicks: 0, impressions: 0 };
      }
      const c = byId[id];
      c.spend       += Number(r.metrics?.costMicros ?? 0) / 1e6;
      c.revenue     += Number(r.metrics?.conversionsValue ?? 0);
      c.orders      += Number(r.metrics?.conversions ?? 0);
      c.clicks      += Number(r.metrics?.clicks ?? 0);
      c.impressions += Number(r.metrics?.impressions ?? 0);
    }

    return Object.values(byId).map(c => ({
      ...c,
      ctr:  c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
      roas: c.spend > 0 ? c.revenue / c.spend : 0,
    })).sort((a, b) => b.spend - a.spend);
  } catch (e) {
    console.warn('Google Ads campaigns indisponível:', e.message);
    return [];
  }
}
