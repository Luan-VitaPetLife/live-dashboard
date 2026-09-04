// shopee.js — integração com a Shopee Open Platform (API v2)
// Cuida da assinatura HMAC-SHA256, do fluxo OAuth e da
// renovação automática do access_token (vence ~4h).
//
// Passos (uma vez):
//  1. Acesse GET /shopee/connect  -> redireciona para a Shopee autorizar.
//  2. Após autorizar, a Shopee chama /shopee/callback?code=...&shop_id=...
//     e o código é trocado por access_token + refresh_token (salvos no store).
//  Depois disso, fetchOrders() funciona e o token se renova sozinho.
import 'dotenv/config';
import crypto from 'crypto';
import { getShopeeTokens, setShopeeTokens } from './store.js';

const BR_STATE = {
  'acre':'AC','alagoas':'AL','amapá':'AP','amapa':'AP','amazonas':'AM',
  'bahia':'BA','ceará':'CE','ceara':'CE','distrito federal':'DF',
  'espírito santo':'ES','espirito santo':'ES','goiás':'GO','goias':'GO',
  'maranhão':'MA','maranhao':'MA','mato grosso do sul':'MS','mato grosso':'MT',
  'minas gerais':'MG','pará':'PA','para':'PA','paraíba':'PB','paraiba':'PB',
  'paraná':'PR','parana':'PR','pernambuco':'PE','piauí':'PI','piaui':'PI',
  'rio de janeiro':'RJ','rio grande do norte':'RN','rio grande do sul':'RS',
  'rondônia':'RO','rondonia':'RO','roraima':'RR','santa catarina':'SC',
  'são paulo':'SP','sao paulo':'SP','sergipe':'SE','tocantins':'TO',
};
function toUF(s) {
  if (!s) return null;
  const t = s.trim();
  if (t.length === 2) return t.toUpperCase();
  return BR_STATE[t.toLowerCase()] || null;
}

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
// `state` (opcional) é usado só pela proteção CSRF (double-submit cookie, ver server.js) — a
// assinatura HMAC (`sign`) é calculada só sobre partner_id+path+timestamp, então acrescentar esse
// parâmetro extra não invalida o "sign" nem precisa ser levado em conta por ele.
export function buildAuthUrl(state) {
  if (!isConfigured()) throw new Error('Shopee não configurada (.env: SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY).');
  const path = '/api/v2/shop/auth_partner';
  const ts = now();
  const s = sign(path, ts);
  const redirect = encodeURIComponent(REDIRECT);
  let url = `${HOST}${path}?partner_id=${PARTNER_ID}&timestamp=${ts}&sign=${s}&redirect=${redirect}`;
  if (state) url += `&state=${encodeURIComponent(state)}`;
  return url;
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


// Diagnóstico: devolve o `recipient_address` cru de um pedido recente, sem normalizar nada —
// pra confirmar se a Shopee está de fato mascarando/omitindo o estado (LGPD) ou se o dado vem
// normal e o problema é nosso. Usado por GET /api/shopee/probe-order. Ver CLAUDE.md 4.5.
export async function probeOrder() {
  if (!isConfigured() || !getShopeeTokens()) return { error: 'Shopee não configurada/autorizada.' };
  const untilMs = Date.now();
  const sinceMs = untilMs - 15 * 24 * 60 * 60 * 1000;
  const r = await shopCall('/api/v2/order/get_order_list', {
    time_range_field: 'create_time',
    time_from: String(Math.floor(sinceMs / 1000)),
    time_to:   String(Math.floor(untilMs / 1000)),
    page_size: '5',
  });
  const orderList = r.response?.order_list || [];
  if (!orderList.length) return { error: 'Nenhum pedido nos últimos 15 dias pra testar.' };
  const sns = orderList.map(o => o.order_sn);
  const d = await shopCall('/api/v2/order/get_order_detail', {
    order_sn_list: sns.join(','),
    response_optional_fields: 'order_status,recipient_address',
  });
  return {
    orders: (d.response?.order_list || []).map(o => ({
      order_sn: o.order_sn,
      order_status: o.order_status,
      recipient_address: o.recipient_address || null,
    })),
  };
}

// Diagnóstico das DEVOLUÇÕES da Shopee. A Shopee tem uma API de devolução separada
// (/api/v2/returns/get_return_list), mas a documentação pública dela não expõe os nomes de campo
// da resposta, e escrever o mapeamento por adivinhação é como um número errado entra em produção
// sem ninguém ver. Esta sonda existe pra ler a FORMA real da resposta uma vez, com token de
// verdade, e só então escrever o mapeamento — mesmo caminho que deu certo na Amazon.
//
// Devolve só o ESQUELETO (nomes de campo) e valores que não identificam ninguém. Nada de nome,
// endereço ou comentário de comprador. Usado por GET /api/shopee/probe-returns.
const CAMPOS_SEGUROS = new Set([
  // 'text_reason' fica FORA de propósito: é o texto livre que o comprador escreveu, e a sonda
  // promete não trazer comentário de comprador. 'reason' entra porque é código fixo (NOT_RECEIPT).
  'return_sn', 'order_sn', 'status', 'reason', 'negotiation_status',
  'refund_amount', 'amount', 'currency', 'create_time', 'update_time', 'return_solution',
  'item_id', 'model_id', 'quantity', 'item_sku', 'name', 'seller_proof_status',
]);

function esqueleto(valor, prof = 0) {
  if (Array.isArray(valor)) return prof > 3 ? '[…]' : valor.slice(0, 1).map(v => esqueleto(v, prof + 1));
  if (valor && typeof valor === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(valor)) {
      if (v && typeof v === 'object') out[k] = esqueleto(v, prof + 1);
      else out[k] = CAMPOS_SEGUROS.has(k) ? v : `<${typeof v}>`;
    }
    return out;
  }
  return `<${typeof valor}>`;
}

export async function probeReturns({ days = 60 } = {}) {
  if (!isConfigured() || !getShopeeTokens()) return { error: 'Shopee não configurada/autorizada.' };

  const ate   = Math.floor(Date.now() / 1000);
  const desde = ate - days * 24 * 60 * 60;
  const tentativas = [
    { rotulo: 'com janela de tempo', params: { page_no: '0', page_size: '20', create_time_from: String(desde), create_time_to: String(ate) } },
    { rotulo: 'sem janela de tempo', params: { page_no: '0', page_size: '20' } },
  ];

  const erros = [];
  for (const t of tentativas) {
    try {
      const r = await shopCall('/api/v2/returns/get_return_list', t.params);
      return {
        chamada:  t.rotulo,
        chaves:   Object.keys(r.response || {}),
        // A resposta inteira em forma de esqueleto: é isso que diz como escrever o mapeamento.
        formato:  esqueleto(r.response || {}),
        quantas:  Array.isArray(r.response?.return) ? r.response.return.length : null,
      };
    } catch (e) {
      erros.push(`${t.rotulo}: ${e.message}`);
    }
  }
  return { error: 'nenhuma variação da chamada funcionou', tentativas: erros };
}

// ── Devoluções (reembolso) ───────────────────────────────────────────────────────────────────
// Escrito em cima da resposta REAL da API (a sonda acima, rodada em produção em 04/09/2026), e
// não da documentação — os nomes de campo daqui enganam:
//   `item[].amount`  é QUANTIDADE de unidades, não dinheiro (o dinheiro do item é `refund_amount`);
//   `refund_amount`  existe nos dois níveis, no pedido de devolução e dentro de cada item;
//   `order_sn`       é o que liga a devolução ao nosso pedido ('shopee:' + order_sn).
//
// A variação da chamada COM janela de tempo falhou na sonda e a sem janela funcionou, então não
// dá pra filtrar por data no servidor deles. Lemos a lista inteira e deixamos o cruzamento por
// pedido decidir o que interessa: devolução de pedido que não temos cai fora sozinha.
const RETURNS_MAX_PAGES = 40;
const RETURNS_PAGE_SIZE = 50;

// Agrupa a resposta crua por PEDIDO. Separada da chamada de rede de propósito: é aqui que mora
// a decisão de quanto foi devolvido, e ela precisa ser executável num teste sem token.
export function reembolsosDaLista(brutos) {
  // ALLOWLIST POSITIVA: só entra o status que significa dinheiro devolvido de verdade. Um pedido
  // de devolução que o comprador abriu e ainda está em análise (ou que foi recusado) não pode
  // tirar a unidade da venda. Lista negativa erraria no sentido pior: qualquer status novo que a
  // Shopee criasse passaria a descontar venda sozinho, sem ninguém decidir isso.
  //
  // O que fica de fora NÃO some calado — volta contado em `porStatus`, pra um status novo
  // aparecer no relatório do sync em vez de virar número errado em silêncio.
  const STATUS_REEMBOLSADO = new Set(['ACCEPTED']);

  const porStatus = {};
  const porPedido = new Map();
  const vistos = new Set();

  for (const d of brutos) {
    // A mesma devolução pode voltar em mais de uma página; contá-la duas vezes dobraria a baixa.
    if (!d?.return_sn || vistos.has(d.return_sn)) continue;
    vistos.add(d.return_sn);

    const status = String(d.status || '').toUpperCase();
    porStatus[status] = (porStatus[status] || 0) + 1;
    if (!STATUS_REEMBOLSADO.has(status) || !d.order_sn) continue;

    const id = 'shopee:' + d.order_sn;
    // Um pedido pode ter mais de uma devolução: as unidades e o dinheiro somam.
    const alvo = porPedido.get(id) || { id, qty: 0, refundedTotal: 0, returnedAt: null, porProduto: [] };
    for (const it of (d.item || [])) {
      const qty = Number(it?.amount) || 0; // `amount` é quantidade, não dinheiro
      if (!(qty > 0)) continue;
      alvo.qty += qty;
      alvo.porProduto.push({ sku: it.item_sku || null, title: it.name || null, qty });
    }
    alvo.refundedTotal += Number(d.refund_amount) || 0;
    const quando = Number(d.update_time || d.create_time) || 0;
    if (quando) {
      const iso = new Date(quando * 1000).toISOString();
      if (!alvo.returnedAt || iso > alvo.returnedAt) alvo.returnedAt = iso;
    }
    porPedido.set(id, alvo);
  }

  return { reembolsos: [...porPedido.values()], porStatus };
}

export async function fetchReturns() {
  if (!isConfigured() || !getShopeeTokens()) return { reembolsos: [], porStatus: {}, incompleta: false };

  const brutos = [];
  let incompleta = false;
  for (let pagina = 0; ; pagina++) {
    // Sem filtro de data, a lista só cresce. O teto existe pra uma conta com muita devolução não
    // prender o sync — e quando ele é atingido a leitura se declara INCOMPLETA em vez de passar
    // por completa. Lista curta que parece inteira é o erro que já custou caro na Amazon.
    if (pagina >= RETURNS_MAX_PAGES) { incompleta = true; break; }
    const r = await shopCall('/api/v2/returns/get_return_list', {
      page_no: String(pagina), page_size: String(RETURNS_PAGE_SIZE),
    });
    brutos.push(...(r.response?.return || []));
    if (!r.response?.more) break;
  }

  return { ...reembolsosDaLista(brutos), incompleta };
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
      response_optional_fields: 'order_status,total_amount,create_time,buyer_username,item_list,recipient_address',
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
        state:     toUF(o.recipient_address?.state),
        items: (o.item_list || []).map(it => ({
          title:  it.item_name,
          // O SKU é o que liga a devolução à LINHA certa do pedido (ver fetchReturns e
          // patchOrderRefunds). Sem ele a baixa cairia no produto errado num pedido de vários.
          sku:    it.item_sku || it.model_sku || null,
          qty:    it.model_quantity_purchased || it.quantity || 1,
          amount: (Number(it.model_discounted_price ?? it.model_original_price) || 0) * (it.model_quantity_purchased || 1),
          image:  it.image_info?.image_url || null,
        })),
      });
    }
  }
  return out;
}
