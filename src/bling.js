// bling.js — integração exploratória com o Bling ERP (API v3)
//
// Diferente das demais integrações deste arquivo, o Bling NÃO é um canal de
// venda — é o ERP que já recebe (via importação própria) os pedidos de todos
// os canais (Shopify, Shopee, Mercado Livre, Amazon). Por isso, por enquanto,
// isso aqui é só uma sonda de leitura (probeOrders) para ver o formato real do
// dado — nunca usado para montar receita/pedido no dashboard, pra não contar
// a mesma venda duas vezes (uma via canal, outra via Bling).
//
// OAuth 2.0 (authorization_code), confirmado via documentação/implementações
// de referência do Bling (developer.bling.com.br não expõe a URL completa em
// texto simples, por isso confirmado contra código de terceiros que já
// funciona em produção):
//  - Autorizar:      GET  https://www.bling.com.br/Api/v3/oauth/authorize
//  - Trocar token:   POST https://www.bling.com.br/Api/v3/oauth/token
//    (Basic auth no header: base64(client_id:client_secret); body
//    application/x-www-form-urlencoded)
//  - Chamadas de recurso: https://api.bling.com.br/Api/v3/...
//
// Passos (uma vez, feito pelo próprio usuário no painel do Bling — precisa
// cadastrar o app lá, isso não dá pra automatizar):
//  1. developer.bling.com.br → cadastrar aplicativo, marcar escopo de
//     leitura de "Pedidos de Venda" (e "Contatos"/"Produtos" se quiser
//     explorar depois), configurar Redirect URI = BLING_REDIRECT_URL.
//  2. Preencher BLING_CLIENT_ID/BLING_CLIENT_SECRET/BLING_REDIRECT_URL no
//     .env (ou nas env vars do Railway em produção).
//  3. Acessar GET /bling/connect → autoriza → troca o code por token
//     automaticamente (salvo no store, mesmo padrão do Mercado Livre).
//  Depois disso, fetchOrdersList/fetchOrderDetail/probeOrders funcionam e o
//  token se renova sozinho (refresh_token, válido por 30 dias segundo a
//  documentação — se ficar 30 dias sem nenhuma chamada, precisa reconectar).
import 'dotenv/config';
import { getBlingTokens, setBlingTokens } from './store.js';

const CLIENT_ID     = process.env.BLING_CLIENT_ID;
const CLIENT_SECRET = process.env.BLING_CLIENT_SECRET;
const REDIRECT      = process.env.BLING_REDIRECT_URL;
const AUTH_URL       = 'https://www.bling.com.br/Api/v3/oauth/authorize';
const TOKEN_URL      = 'https://www.bling.com.br/Api/v3/oauth/token';
const API_BASE       = 'https://api.bling.com.br/Api/v3';

function now() { return Math.floor(Date.now() / 1000); }

export function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT);
}

// URL para o lojista autorizar o app. `state` é usado pela proteção CSRF
// (double-submit cookie, ver server.js) — o Bling ecoa o parâmetro de volta
// no callback (confirmado em implementação de referência), mas o cookie
// sozinho já basta mesmo se não ecoasse.
export function buildAuthUrl(state) {
  if (!isConfigured()) throw new Error('Bling não configurado (.env: BLING_CLIENT_ID / BLING_CLIENT_SECRET / BLING_REDIRECT_URL).');
  const params = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT });
  if (state) params.set('state', state);
  return `${AUTH_URL}?${params}`;
}

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json();
  if (json.error) throw new Error('Bling token: ' + json.error + ' ' + (json.error_description || ''));
  return json;
}

function saveTokens(json) {
  setBlingTokens({
    access_token:  json.access_token,
    refresh_token: json.refresh_token,
    expires_at:    now() + (json.expires_in || 21600) - 120, // margem de 2 min
  });
}

// Troca o "code" (do callback) por access_token + refresh_token.
export async function exchangeCode(code) {
  const json = await tokenRequest({
    grant_type:   'authorization_code',
    code,
    redirect_uri: REDIRECT,
  });
  saveTokens(json);
  return json;
}

// Renova o access_token usando o refresh_token.
async function refreshToken() {
  const tk = getBlingTokens();
  if (!tk) throw new Error('Bling ainda não autorizado (use /bling/connect).');
  const json = await tokenRequest({
    grant_type:    'refresh_token',
    refresh_token: tk.refresh_token,
  });
  saveTokens(json);
  return getBlingTokens();
}

async function validToken() {
  let tk = getBlingTokens();
  if (!tk) throw new Error('Bling ainda não autorizado (use /bling/connect).');
  if (now() >= tk.expires_at) tk = await refreshToken();
  return tk;
}

// Limite real da API (confirmado em developer.bling.com.br/limites): 3 req/s e
// 120 mil/dia. Espaçar as chamadas em ~400ms (margem sobre os 333ms de 3 req/s)
// evita 429 — sonda inicial já bateu no limite disparando 3 chamadas seguidas
// sem pausa (mesma lição da Amazon, ver CLAUDE.md 4.7.2: nunca martelar a API).
const MIN_INTERVAL_MS = 400;
let lastCallAt = 0;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// GET autenticado na API do Bling, com espaçamento entre chamadas e uma
// retentativa (com pausa maior) se ainda assim vier 429.
async function apiGet(path, params = {}, _isRetry = false) {
  const tk = await validToken();
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));

  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${tk.access_token}`, Accept: 'application/json' },
  });
  const json = await res.json();
  if (json.error) {
    const isRateLimit = json.error.type === 'TOO_MANY_REQUESTS' || res.status === 429;
    if (isRateLimit && !_isRetry) {
      await sleep(2000);
      return apiGet(path, params, true);
    }
    throw new Error(`Bling ${path}: ${json.error.type || ''} ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json;
}

// Lista pedidos de venda no intervalo (resumo — sem dado de transporte, que só
// vem no detalhe de cada pedido). GET /pedidos/vendas.
export async function fetchOrdersList(sinceISO, untilISO, { pagina = 1, limite = 100 } = {}) {
  if (!isConfigured() || !getBlingTokens()) return { data: [] };
  return apiGet('/pedidos/vendas', {
    dataInicial: sinceISO,
    dataFinal:   untilISO,
    pagina,
    limite,
  });
}

// Detalhe completo de um pedido (traz o bloco de transporte/transportadora,
// que a listagem não traz). GET /pedidos/vendas/:id.
export async function fetchOrderDetail(idPedidoVenda) {
  return apiGet(`/pedidos/vendas/${idPedidoVenda}`);
}

// Lista os canais de venda cadastrados no Bling (cada integração de
// marketplace/loja virtual vira um canal aqui, com nome/tipo). É o que
// permite traduzir o `loja.unidadeNegocio.id` de cada pedido pro nome real
// do canal (Shopee, Mercado Livre, Shopify, Amazon...). GET /canais-venda.
export async function fetchSalesChannels() {
  if (!isConfigured() || !getBlingTokens()) return { data: [] };
  return apiGet('/canais-venda');
}

// ── Canais de venda conhecidos (BR) ───────────────────────────────────────
// Mapeia loja.id (Bling) → nosso channel/market. Hardcoded de propósito, NÃO
// descoberto em runtime via /canais-venda: a conta Bling tem canais que não
// são pedido Coco and Luna — PETLOVE (205506010, descontinuado), Yucaloo
// (206156145, segunda marca da Vita Pet Life, integração ainda não decidida)
// e TikTok Shop (206171502, em configuração, sem pedidos ainda) — e nenhum
// deles pode entrar na reconciliação de geografia por engano. Confirmado ao
// vivo via GET /canais-venda em 28/07/2026 (ver CLAUDE.md, seção Bling).
export const KNOWN_CHANNELS = {
  205761639: { channel: 'shopify',      market: 'br' }, // Coco and Luna - Brasil
  205370623: { channel: 'shopee',       market: 'br' },
  205355406: { channel: 'mercadolivre', market: 'br' },
  // Amazon Brasil = 205355413, deixado de fora até confirmar que o
  // numeroLoja do Bling preserva o formato do AmazonOrderId (com traço) —
  // sem amostra ainda. Amazon BR já tem `state` funcionando pela própria
  // Orders API, não é o canal que mais precisa disso.
};

// Sonda de exploração: pagina a listagem (barata — sem detalhe por pedido) procurando
// pedidos de um `loja.id` específico, pra confirmar o formato do numeroLoja de um canal
// antes de adicioná-lo a KNOWN_CHANNELS (ex.: Amazon Brasil, ver CLAUDE.md). Para assim
// que achar `limit` pedidos ou esgotar a janela.
export async function probeChannelOrders(sinceISO, untilISO, lojaId, limit = 5) {
  if (!isConfigured()) throw new Error('Bling não configurado.');
  if (!getBlingTokens()) throw new Error('Bling ainda não autorizado (use /bling/connect primeiro).');
  const found = [];
  let pagina = 1;
  for (;;) {
    const page = await fetchOrdersList(sinceISO, untilISO, { pagina, limite: 100 });
    const orders = page.data || [];
    for (const o of orders) {
      if (String(o.loja?.id) === String(lojaId)) {
        found.push({ id: o.id, numero: o.numero, numeroLoja: o.numeroLoja, data: o.data });
        if (found.length >= limit) return { found, paginasVarridas: pagina };
      }
    }
    if (orders.length < 100) return { found, paginasVarridas: pagina };
    pagina++;
  }
}

// UF de entrega de um pedido, extraído do detalhe (transporte.etiqueta —  só
// vem no detalhe, a listagem não traz). Retorna null se o pedido não tiver
// bloco de transporte (retirada em loja, etc.) — o chamador decide o que fazer.
export async function fetchOrderAddress(idPedidoVenda) {
  const d = await fetchOrderDetail(idPedidoVenda);
  const data = d.data || d;
  return data?.transporte?.etiqueta?.uf || null;
}

// Sonda de exploração: pega a 1ª página de pedidos do intervalo + o detalhe
// completo dos primeiros `sampleSize` pedidos, pra inspecionar ao vivo o
// formato real do dado (nomes de campo, se vem transportadora/rastreio, se dá
// pra casar com o pedido do canal original via numeroPedidoCompra/loja etc.)
// antes de decidir o que vale a pena trazer pro dashboard. Nunca chamado pelo
// sync automático — só sob demanda (ver GET /api/bling/probe-orders).
export async function probeOrders(sinceISO, untilISO, sampleSize = 3) {
  if (!isConfigured()) throw new Error('Bling não configurado (.env: BLING_CLIENT_ID / BLING_CLIENT_SECRET / BLING_REDIRECT_URL).');
  if (!getBlingTokens()) throw new Error('Bling ainda não autorizado (use /bling/connect primeiro).');

  const list = await fetchOrdersList(sinceISO, untilISO, { pagina: 1, limite: 100 });
  const orders = list.data || [];

  const details = [];
  for (const o of orders.slice(0, sampleSize)) {
    try {
      const d = await fetchOrderDetail(o.id);
      details.push(d.data || d);
    } catch (e) {
      details.push({ id: o.id, error: e.message });
    }
  }

  return {
    totalNaPagina: orders.length,
    listaResumo:   orders,
    detalhesAmostra: details,
  };
}
