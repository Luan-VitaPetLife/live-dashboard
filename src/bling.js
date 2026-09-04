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
// Mapeia loja.id (Bling) → nosso channel/market. Hardcoded de propósito, NÃO descoberto em
// runtime via /canais-venda: a conta Bling tem canais que não são pedido Coco and Luna —
// PETLOVE (205506010, descontinuado), Yucaloo (206156145, segunda marca da Vita Pet Life,
// integração ainda não decidida) e TikTok Shop (206279174, "TikTok Shop - Vita Pet Life",
// sem pedidos ainda) — e nenhum deles pode entrar na reconciliação de geografia por engano.
// Confirmado ao vivo via GET /canais-venda (ver CLAUDE.md, seção Bling).
//
// O id do TikTok Shop estava anotado aqui como 206171502, que não aparece mais na listagem ao
// vivo; o id acima é o que a conta devolveu em 04/09/2026 e é o único canal TikTok que existe
// nela. As DUAS marcas (Yucaloo e Coco and Luna) vão vender por esse mesmo canal — decisão do
// Luan. A consequência é que o `loja.id` sozinho não separa as marcas nos pedidos do TikTok;
// quando a captura for escrita, a separação vai precisar de outro sinal do próprio pedido.
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

// ── Sonda das saídas em bonificação (doação para UGC) ────────────────────────
// A dashboard precisa contar as unidades enviadas como doação sem que elas virem receita. No
// Bling essas saídas aparecem com "Natureza de operação: Saída em bonificação" — mas isso é
// campo de NOTA FISCAL, e o que a dashboard lê hoje é PEDIDO DE VENDA. Enquanto não se souber
// onde a marca vive de verdade, escrever a captura é adivinhar, e adivinhação aqui vira
// quantidade errada em produção (mesmo caminho já usado na Amazon e na Shopee: sondar, depois
// mapear).
//
// Esta sonda tenta as variações plausíveis da chamada e devolve:
//   - qual variação funcionou (nome do caminho e dos parâmetros de data);
//   - o ESQUELETO da resposta, pra escrever o mapeamento em cima de campo real;
//   - as naturezas de operação encontradas, contadas, pra saber o texto exato da que interessa;
//   - o mesmo para os pedidos de venda do período, pra ver se dá pra reconhecer a doação por lá.
//
// NUNCA devolve dado de quem recebeu. A nota fiscal carrega nome, CPF, endereço, e-mail e
// telefone do destinatário, e este retorno é feito pra ser lido e colado numa conversa.
const BONI_CAMPOS_SEGUROS = new Set([
  'id', 'numero', 'serie', 'tipo', 'situacao', 'dataEmissao', 'dataOperacao', 'dataSaida',
  'naturezaOperacao', 'descricao', 'valorNota', 'total', 'totalProdutos',
  'codigo', 'quantidade', 'valor', 'unidade', 'sku',
  'numeroPedidoCompra', 'numeroLoja',
]);

// Tudo que não estiver na allowlist vira o TIPO do valor, não o valor. Allowlist positiva e não
// lista de proibidos: um campo novo que o Bling passe a mandar nasce mascarado, em vez de nascer
// exposto até alguém reparar.
export function esqueletoBling(valor, prof = 0) {
  if (Array.isArray(valor)) return prof > 3 ? '[…]' : valor.slice(0, 1).map(v => esqueletoBling(v, prof + 1));
  if (valor && typeof valor === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(valor)) {
      if (v && typeof v === 'object') out[k] = esqueletoBling(v, prof + 1);
      else out[k] = BONI_CAMPOS_SEGUROS.has(k) ? v : `<${typeof v}>`;
    }
    return out;
  }
  return `<${typeof valor}>`;
}

// O texto da natureza pode vir solto ou dentro de um objeto ({ id, descricao }) — a sonda existe
// justamente porque não se sabe qual. Esta leitura cobre as duas formas sem decidir nada.
function naturezaDe(n) {
  const v = n?.naturezaOperacao ?? n?.natureza ?? null;
  if (!v) return null;
  return typeof v === 'string' ? v : (v.descricao || v.nome || null);
}

export async function probeBonificacao(sinceISO, untilISO) {
  if (!isConfigured()) throw new Error('Bling não configurado.');
  if (!getBlingTokens()) throw new Error('Bling ainda não autorizado (use /bling/connect primeiro).');

  const tentativas = [
    { rotulo: '/nfe com dataEmissao',  path: '/nfe',            params: { dataEmissaoInicial: sinceISO, dataEmissaoFinal: untilISO, limite: 100, pagina: 1 } },
    { rotulo: '/nfe com dataInicial',  path: '/nfe',            params: { dataInicial: sinceISO, dataFinal: untilISO, limite: 100, pagina: 1 } },
    { rotulo: '/nfe sem janela',       path: '/nfe',            params: { limite: 100, pagina: 1 } },
    { rotulo: '/notas-fiscais',        path: '/notas-fiscais',  params: { limite: 100, pagina: 1 } },
  ];

  const erros = [];
  let notas = null;
  for (const t of tentativas) {
    try {
      const r = await apiGet(t.path, t.params);
      notas = { chamada: t.rotulo, lista: r.data || [] };
      break;
    } catch (e) { erros.push(`${t.rotulo}: ${e.message}`); }
  }

  // Naturezas encontradas, contadas. É o que diz o TEXTO exato da que interessa ("Saída em
  // bonificação") e se existem outras parecidas que não podem ser confundidas com ela.
  const porNatureza = {};
  for (const n of (notas?.lista || [])) {
    const nat = naturezaDe(n) || '(sem natureza)';
    porNatureza[nat] = (porNatureza[nat] || 0) + 1;
  }

  // E o mesmo período pelo lado dos PEDIDOS: se a doação for reconhecível já ali, a captura não
  // precisa de um endpoint novo. Total 0 é o sinal mais óbvio, e por isso mesmo é o que precisa
  // ser conferido contra a contagem de notas antes de virar regra.
  let pedidos = null;
  try {
    const lista = await fetchOrdersList(sinceISO, untilISO, { pagina: 1, limite: 100 });
    const data = lista.data || [];
    pedidos = {
      total: data.length,
      comTotalZero: data.filter(p => Number(p.total) === 0).length,
      porLoja: data.reduce((acc, p) => {
        const k = String(p.loja?.id ?? 'sem loja');
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
      esqueletoDoPrimeiroZerado: esqueletoBling(data.find(p => Number(p.total) === 0) || null),
    };
  } catch (e) { erros.push(`pedidos: ${e.message}`); }

  return {
    notas: notas
      ? { chamada: notas.chamada, quantas: notas.lista.length, porNatureza, formato: esqueletoBling(notas.lista[0] || null) }
      : null,
    pedidos,
    erros,
  };
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
