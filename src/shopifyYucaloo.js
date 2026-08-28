// shopifyYucaloo.js — OAuth para a Yucaloo (2ª marca da Vita Pet Life).
//
// App criado pela Shopify Dev Dashboard (fluxo novo, diferente do app
// customizado clássico usado pela Coco and Luna em shopify.js, que dá um
// token estático direto na hora). Aqui é a própria Shopify que inicia o
// fluxo: sempre que alguém abre/instala o app, ela chama a "URL do app"
// configurada na Dev Dashboard com hmac/host/shop/timestamp assinados — não
// um "code" de OAuth pronto. Cabe a nós validar essa assinatura e
// redirecionar pro /admin/oauth/authorize da loja, pra só então receber o
// "code" no callback e trocar por um access_token permanente (offline, não
// expira — mesmo tipo de token que o app customizado clássico já dava).
// Ver CLAUDE.md.
//
// Um app por mercado (mesmo padrão da Amazon BR/US) — 'br' e (futuramente)
// 'us' têm client_id/secret/redirect próprios.
import 'dotenv/config';
import crypto from 'crypto';
import { getYucalooTokens, setYucalooTokens } from './store.js';
import { fetchOrders as fetchShopifyOrders, fetchProductCatalog as fetchShopifyProductCatalog, fetchSessionsDaily as fetchShopifySessionsDaily } from './shopify.js';

// read_all_orders exige read_orders junto (a Shopify recusa o OAuth com
// "missing_read_orders_scope" se só o primeiro vier) — confirmado ao vivo
// tentando instalar sem ele, 06/08/2026.
const SCOPE = 'read_orders,read_all_orders,read_analytics,read_customers,read_products,read_reports';

function creds(mkt) {
  const p = String(mkt || '').toUpperCase();
  const clientId     = process.env[`YUCALOO_${p}_CLIENT_ID`];
  const clientSecret = process.env[`YUCALOO_${p}_CLIENT_SECRET`];
  const redirectUri  = process.env[`YUCALOO_${p}_REDIRECT_URL`];
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(`Yucaloo ${p} não configurado (.env: YUCALOO_${p}_CLIENT_ID / YUCALOO_${p}_CLIENT_SECRET / YUCALOO_${p}_REDIRECT_URL).`);
  }
  return { clientId, clientSecret, redirectUri };
}

export function isConfigured(mkt) {
  try { creds(mkt); return true; } catch { return false; }
}

// Mesmo algoritmo nos dois casos em que a Shopify assina a URL (bounce da "URL
// do app" e callback do OAuth): concatena os parâmetros (exceto hmac/signature)
// ordenados por chave, "chave=valor" unidos por "&", HMAC-SHA256 hex com o
// client secret do app, comparação em tempo constante.
//
// Recebe a query CRUA (string, não o objeto já processado pelo Express/qs) de
// propósito: o parser padrão do Express trata "+" como espaço, e o parâmetro
// "host" vem em base64 — que usa "+" no próprio alfabeto — então decodificar
// pelo caminho normal quebraria a assinatura sempre que "+" aparecesse.
function verifyHmacRaw(rawQuery, clientSecret) {
  const pairs = String(rawQuery || '').split('&').filter(Boolean).map(p => {
    const i = p.indexOf('=');
    const k = i === -1 ? p : p.slice(0, i);
    const v = i === -1 ? '' : p.slice(i + 1);
    return [decodeURIComponent(k), decodeURIComponent(v)];
  });
  const hmacPair = pairs.find(([k]) => k === 'hmac');
  if (!hmacPair) return false;
  const message = pairs
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const digest = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hmacPair[1], 'hex')); }
  catch { return false; }
}

// `req` é o request do Express inteiro — usamos req.originalUrl pra pegar a
// query string crua (ver nota acima sobre o "+" do base64).
export function verifyRequest(mkt, req) {
  const rawQuery = (req.originalUrl || '').split('?')[1] || '';
  return verifyHmacRaw(rawQuery, creds(mkt).clientSecret);
}

export function buildAuthorizeUrl(mkt, shop, state) {
  const { clientId, redirectUri } = creds(mkt);
  const params = new URLSearchParams({ client_id: clientId, scope: SCOPE, redirect_uri: redirectUri, state });
  return `https://${shop}/admin/oauth/authorize?${params}`;
}

export async function exchangeCode(mkt, shop, code) {
  const { clientId, clientSecret } = creds(mkt);
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Yucaloo ${String(mkt).toUpperCase()} token: ` + JSON.stringify(json));
  const tokens = getYucalooTokens();
  tokens[mkt] = { shop, accessToken: json.access_token, scope: json.scope, obtainedAt: new Date().toISOString() };
  setYucalooTokens(tokens);
  return tokens[mkt];
}

// Pedidos da Yucaloo — reaproveita fetchOrders de shopify.js (já aceita
// store/token por chamada, mesmo mecanismo usado pro Shopify US).
//
// Decisão do Luan (06/08/2026): market = mkt ('br'/'us'), igual à Coco and
// Luna — NÃO um valor à parte. No Brasil a Yucaloo é vendida junto com os
// mesmos marketplaces da Coco and Luna, e ele quer ver tudo junto ao
// escolher só "Brasil"/"EUA", sem precisar escolher marca e depois país
// (isso fica pra quando houver mais marcas — ver CLAUDE.md 4.20). O
// `channel` continua próprio ("yucaloo_br"/"yucaloo_us") — é o que permite
// saber, quando precisar, quais pedidos vieram da loja Shopify da Yucaloo
// (badge, filtro futuro) sem misturar com o canal "shopify" da Coco and
// Luna, mesmo os dois estando agora no mesmo balde de `market`.
export async function fetchOrders(sinceISO, untilISO, mkt) {
  const t = getYucalooTokens()[mkt];
  if (!t?.accessToken) return []; // ainda não conectado — não quebra o sync
  return fetchShopifyOrders(sinceISO, untilISO, {
    store: t.shop,
    token: t.accessToken,
    market: mkt,
    channel: `yucaloo_${mkt}`,
    tz: mkt === 'us' ? 'Z' : '-03:00',
  });
}

// Sessões/funil da loja Shopify da Yucaloo — mesmo mecanismo (ShopifyQL) do shopify.js, só que
// contra a loja/token da Yucaloo. O escopo read_analytics/read_reports já é pedido no SCOPE acima.
export async function fetchSessionsDaily(mkt, days = 90) {
  const t = getYucalooTokens()[mkt];
  if (!t?.accessToken) return []; // ainda não conectado — não quebra o sync
  return fetchShopifySessionsDaily(days, { store: t.shop, token: t.accessToken });
}

// Catálogo bruto de produtos da Yucaloo (vendidos ou não) — ver shopify.js fetchProductCatalog.
export async function fetchProductCatalog(mkt) {
  const t = getYucalooTokens()[mkt];
  if (!t?.accessToken) return [];
  return fetchShopifyProductCatalog({ store: t.shop, token: t.accessToken });
}
