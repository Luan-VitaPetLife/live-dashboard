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
// O id do TikTok Shop estava anotado aqui como 206171502. Ele EXISTE, mas está desativado
// (situacao 2), junto de outros dois canais TikTok antigos também desativados — a listagem ao vivo
// de 04/09/2026 mostrou os quatro. O ativo é o 206279174, e é o que vale.
//
// As DUAS marcas (Yucaloo e Coco and Luna) vão vender por esse mesmo canal — decisão do Luan. A
// consequência é que o `loja.id` sozinho não separa as marcas nos pedidos do TikTok; quando a
// captura for escrita, a separação vai precisar de outro sinal do próprio pedido.
//
// A mesma listagem revelou DOIS canais Mercado Livre novos e ATIVOS (206278047 "Mercado Livre -
// Paraná NOVO" e 206278064 "Mercado Livre - SP") além do 205355406 já mapeado, que hoje está
// desativado. Pedido vindo dos dois novos não é reconhecido pela reconciliação de geografia. Não
// foram acrescentados aqui de propósito: mexer nisso é mexer numa integração de produção que hoje
// está certa, e a decisão é do Luan.
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
  // typeof null é 'object': sem esta linha, um campo vazio virava "<object>" e parecia um bloco
  // que a sonda não conseguiu ler, quando na verdade não havia nada ali.
  if (valor === null || valor === undefined) return null;
  if (Array.isArray(valor)) return prof > 3 ? '[…]' : valor.slice(0, 1).map(v => esqueletoBling(v, prof + 1));
  if (valor && typeof valor === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(valor)) {
      if (v === null || v === undefined) out[k] = null; // vazio é vazio, e vazio não expõe ninguém
      else if (typeof v === 'object') out[k] = esqueletoBling(v, prof + 1);
      else out[k] = BONI_CAMPOS_SEGUROS.has(k) ? v : `<${typeof v}>`;
    }
    return out;
  }
  return `<${typeof valor}>`;
}


// Quem decide se a nota é doação é a NATUREZA DE OPERAÇÃO, não a loja de onde ela saiu (decisão
// do Luan, 04/09/2026). A loja hoje é "Vita Pet Life - São Paulo", mas isso pode mudar, e no dia
// em que mudar uma regra presa à loja pararia de contar sem nada acusar.
//
// A comparação é pelo NOME, resolvido em tempo de execução via /naturezas-operacoes, e não pelo id
// numérico: id é identificador interno daquela conta, e prendê-lo no código quebraria em silêncio
// se a natureza fosse recriada.
//
// "Saída em", e não só "bonificação": a conta tem AS DUAS, "Saída em bonificação" e "Entrada de
// bonificação". Casar só por "bonifica" contaria mercadoria ENTRANDO como se tivesse sido doada,
// que é o número exatamente ao contrário.
export function ehNaturezaDeBonificacao(nome) {
  const n = String(nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // "Saída" e "Saida" precisam casar igual
    .toLowerCase().trim();
  return /\bsaida\b/.test(n) && /\bbonificac/.test(n);
}

export async function probeBonificacao(sinceISO, untilISO, { paginas = 20, amostras = 5, maxDetalhes = 300 } = {}) {
  if (!isConfigured()) throw new Error('Bling não configurado.');
  if (!getBlingTokens()) throw new Error('Bling ainda não autorizado (use /bling/connect primeiro).');
  const erros = [];

  // 1) Nome de cada natureza de operação. A nota traz só o ID dela ({ id: ... }, sem descrição —
  // confirmado ao vivo em 04/09/2026), então sem esta tabela não dá pra saber qual id é
  // "Saída em bonificação" a não ser conferindo à mão no Bling.
  let naturezas = {};
  for (const path of ['/naturezas-operacoes', '/naturezas-operacao', '/natureza-operacoes']) {
    try {
      const r = await apiGet(path, { limite: 100, pagina: 1 });
      for (const n of (r.data || [])) naturezas[String(n.id)] = n.descricao || n.nome || null;
      if (Object.keys(naturezas).length) { erros.push(`(ok) nomes vieram de ${path}`); break; }
    } catch (e) { erros.push(`${path}: ${e.message}`); }
  }

  // 2) Notas do período, PAGINANDO. Uma página só pareceria completa e responderia a pergunta
  // errada: 100 notas é o tamanho da página, não o tamanho do período.
  const porNatureza = {};
  const daBonificacao = [];
  let lidas = 0, incompleta = false;
  const ehBonificacao = id => ehNaturezaDeBonificacao(naturezas[String(id)]);
  for (let pagina = 1; ; pagina++) {
    if (pagina > paginas) { incompleta = true; break; }
    let lote = [];
    try {
      const r = await apiGet('/nfe', { dataEmissaoInicial: sinceISO, dataEmissaoFinal: untilISO, limite: 100, pagina });
      lote = r.data || [];
    } catch (e) { erros.push(`/nfe pagina ${pagina}: ${e.message}`); break; }
    for (const n of lote) {
      lidas++;
      const id = n.naturezaOperacao?.id ?? n.naturezaOperacao ?? null;
      const chave = `${id ?? 'sem id'} · ${naturezas[String(id)] || '(nome desconhecido)'}`;
      porNatureza[chave] = (porNatureza[chave] || 0) + 1;
      if (ehBonificacao(id)) daBonificacao.push(n);
    }
    if (lote.length < 100) break;
  }

  // 3) O detalhe de CADA nota de bonificação. A listagem não traz os itens (confirmado ao vivo), e
  // é o item que diz qual produto e quantas unidades saíram — o único número que interessa aqui.
  //
  // Todas, e não uma amostra: o objetivo é fechar a conta contra a planilha feita à mão antes de
  // qualquer número entrar na dashboard. Uma amostra responderia "qual é a forma do dado", que já
  // sabemos, e não "quantas unidades saíram", que é a pergunta.
  const detalhes = [];
  const porSituacao = {};
  const porProduto = {};   // { situacao: { codigo: { notas, unidades } } }
  let comValorNaoZero = 0, detalhesIncompleto = false;
  for (const [i, n] of daBonificacao.entries()) {
    if (i >= maxDetalhes) { detalhesIncompleto = true; break; }
    let nota = null;
    try {
      const d = await apiGet(`/nfe/${n.id}`);
      nota = d.data || d;
    } catch (e) { erros.push(`/nfe/${n.id}: ${e.message}`); continue; }

    const sit = String(nota.situacao ?? 'sem situacao');
    porSituacao[sit] = (porSituacao[sit] || 0) + 1;
    // Nota de bonificação com valor: existe (confirmado ao vivo). O valor da nota NÃO pode virar
    // receita, mas precisa ser contado aqui pra ficar claro quantas são assim.
    if (Number(nota.valorNota) > 0) comValorNaoZero++;

    const alvo = porProduto[sit] || (porProduto[sit] = {});
    for (const it of (nota.itens || [])) {
      const cod = it.codigo || '(sem código)';
      const p = alvo[cod] || (alvo[cod] = { notas: 0, unidades: 0 });
      p.notas++;
      p.unidades += Number(it.quantidade) || 0;
    }
    if (detalhes.length < amostras) detalhes.push(esqueletoBling(nota));
  }

  // 4) Os canais cadastrados, pra dar nome aos loja.id que aparecem nos pedidos. A sonda anterior
  // mostrou dois ids que não estão em KNOWN_CHANNELS, e é preciso saber o que são antes de
  // qualquer captura nova encostar neles.
  let canais = null;
  try {
    const r = await fetchSalesChannels();
    canais = (r.data || []).map(c => ({ id: c.id, descricao: c.descricao, tipo: c.tipo, situacao: c.situacao }));
  } catch (e) { erros.push(`/canais-venda: ${e.message}`); }

  // 5) E o lado dos PEDIDOS, também paginando: se a doação já for reconhecível ali, a captura não
  // precisa mexer em nota fiscal nenhuma.
  let pedidos = null;
  try {
    const porLoja = {};
    let totalPedidos = 0, zerados = 0, primeiroZerado = null, pedidosIncompleto = false;
    for (let pagina = 1; ; pagina++) {
      if (pagina > paginas) { pedidosIncompleto = true; break; }
      const r = await fetchOrdersList(sinceISO, untilISO, { pagina, limite: 100 });
      const lote = r.data || [];
      for (const p of lote) {
        totalPedidos++;
        const k = String(p.loja?.id ?? 'sem loja');
        porLoja[k] = (porLoja[k] || 0) + 1;
        if (Number(p.total) === 0) { zerados++; if (!primeiroZerado) primeiroZerado = p; }
      }
      if (lote.length < 100) break;
    }
    pedidos = { total: totalPedidos, incompleta: pedidosIncompleto, comTotalZero: zerados, porLoja,
      esqueletoDoPrimeiroZerado: primeiroZerado ? esqueletoBling(primeiroZerado) : null };
  } catch (e) { erros.push(`pedidos: ${e.message}`); }

  return {
    naturezasConhecidas: naturezas,
    notas: { lidas, incompleta, porNatureza, deBonificacao: daBonificacao.length, detalhes },
    // O que a bonificação tem dentro: por situação da nota (cancelada não pode contar), por
    // produto, e quantas notas vêm com valor apesar de serem doação.
    bonificacao: { porSituacao, porProduto, comValorNaoZero, detalhesIncompleto },
    canais,
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
