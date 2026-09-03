// metrics.js — calcula o payload da dashboard a
// partir dos pedidos e sessões guardados no store.
// Receita SEMPRE exclui pedidos cancelados.
import { getOrders as lerPedidosBrutos, getSessionsDaily, getYucalooSessionsDaily, getMetaInsightsDaily, getMetaUSInsightsDaily, getMlAdCostsDaily, getProductFinance, getProductStock, getProductStockAgg, getProductGroups, getProductGroupsEnabled, getProductGroupTypes, getProductTypeGroups, getProductHiddenTags, getAmazonProductImages, getShopifyProductCatalog, getOldestOrderDate, load, UNPAID_STATUS_BY_CHANNEL } from './store.js';
import { normalizeUsState, isUsRegionCode, US_STATE_NAMES } from './us-states.js';
import { normalizeBrState, BR_STATE_NAMES } from './br-states.js';
import { buildInsights } from './insights.js';

// ── Devolução vira desconto de verdade ────────────────────────────────────────
// Unidade devolvida não foi vendida, e o dinheiro dela não é receita. Quem já resolve isso na
// origem é a Shopify (`currentQuantity` e `currentTotalPriceSet` da Admin API já vêm líquidos,
// ver src/shopify.js) — nesses pedidos não há nada a fazer aqui. Os outros canais não têm um
// campo equivalente, então a devolução chega depois, por reconciliação, gravada em três campos:
//
//   items[].refundedQty  unidades devolvidas DAQUELA linha (o melhor caso: sabemos o produto)
//   refundedQty          unidades devolvidas no pedido, sem saber de qual linha
//   refundedTotal        dinheiro devolvido, quando o canal informa o valor exato
//
// TODO O CÁLCULO da dashboard passa por aqui porque `getOrders` abaixo é a única porta de
// entrada de pedido neste arquivo: KPI, Top produtos, Segmentos, Produtos, Estoque, Geografia e
// Insights recebem o pedido já líquido, sem que cada um precise lembrar de descontar. Um
// `getOrders` novo importado direto do store furaria isso em silêncio, e é o que o teste
// `devolucoes` impede.
//
// O pedido devolvido CONTINUA sendo um pedido (não vira cancelado): o mesmo tratamento que a
// Shopify já dá a um pedido `REFUNDED`, que segue na contagem com a receita zerada. Cancelado é
// outra coisa — é a venda que nunca aconteceu.
function pedidoLiquido(o) {
  const itens     = o.items || [];
  const porItem   = itens.some(it => Number(it?.refundedQty || 0) > 0);
  const noPedido  = Number(o.refundedQty || 0);
  const emDinheiro = Number(o.refundedTotal || 0);
  if (!porItem && !(noPedido > 0) && !(emDinheiro > 0)) return o;

  // Quantas unidades saem de cada linha. Com `items[].refundedQty` sabemos exatamente; com só o
  // total do pedido, distribuímos linha a linha até acabar. A distribuição pode errar DE QUAL
  // produto a unidade saiu num pedido de vários produtos, mas nunca erra o total de unidades —
  // e ela só entra em ação quando o canal não disse o produto (a Amazon diz, pelo ASIN).
  const baixa = new Array(itens.length).fill(0);
  if (porItem) {
    itens.forEach((it, i) => { baixa[i] = Math.min(Number(it?.qty || 0), Number(it?.refundedQty || 0)); });
  } else if (noPedido > 0) {
    let resta = noPedido;
    itens.forEach((it, i) => {
      if (resta <= 0) return;
      const tira = Math.min(Number(it?.qty || 0), resta);
      baixa[i] = tira;
      resta -= tira;
    });
  }

  let perdido = 0;
  const novos = itens.map((it, i) => {
    const bruto = Number(it?.qty || 0);
    if (!baixa[i] || !(bruto > 0)) return it;
    const qty    = Math.max(0, bruto - baixa[i]);
    const amount = (Number(it?.amount) || 0) * (qty / bruto);
    perdido += (Number(it?.amount) || 0) - amount;
    return { ...it, qty, amount };
  });

  // Quanto tirar do valor do pedido: o valor exato quando o canal informou, senão o que as linhas
  // deixaram de valer. Pedido devolvido sem NENHUMA linha conhecida (a Orders API da Amazon não
  // traz item) zera: se a mercadoria voltou e não sabemos o que era, ela não pode continuar
  // valendo o total cheio.
  let desconto = emDinheiro > 0 ? emDinheiro : perdido;
  if (!desconto && noPedido > 0 && !itens.length) desconto = Number(o.total) || 0;

  const totalBruto = Number(o.total) || 0;
  const total      = Math.max(0, Math.round((totalBruto - desconto) * 100) / 100);
  const liquido    = { ...o, items: novos, total };
  // "Vendas de produto" da Amazon (toggle de receita, ver orderRevenue) acompanha na mesma
  // proporção — deixar esse número bruto faria os dois modos discordarem só no pedido devolvido.
  if (o.productSales != null && totalBruto > 0) {
    liquido.productSales = Math.max(0, Math.round(Number(o.productSales) * (total / totalBruto) * 100) / 100);
  }
  return liquido;
}

// A porta de entrada de pedido deste arquivo. Ver pedidoLiquido acima.
function getOrders(args) {
  return lerPedidosBrutos(args).map(pedidoLiquido);
}

const OFFSET = Number(process.env.STORE_OFFSET_MINUTES || -180);

// ── datas ──
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function isoUTC(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function daySpan(s, u) { return Math.round((parseISO(u) - parseISO(s)) / 86400000) + 1; }

// Offset (minutos) do horário do Pacífico num instante exato — fuso que a Amazon Seller
// Central usa nos relatórios da conta US (confirmado ao vivo: Sales Snapshot mostra "taken
// at ... PDT"). Diferente do BR (OFFSET fixo, -180min, sem horário de verão), os EUA trocam
// de fuso 2x por ano — calculado por instante em vez de fixo.
function usOffsetMinutes(date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' })
    .formatToParts(date).find(p => p.type === 'timeZoneName')?.value || 'GMT-8';
  const m = part.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  const h = m ? parseInt(m[1], 10) : -8;
  const mm = m && m[2] ? parseInt(m[2], 10) : 0;
  return (h < 0 ? -1 : 1) * (Math.abs(h) * 60 + mm);
}
// Bug corrigido: usava sempre OFFSET (o fuso do BR, -180min) pra decidir de qual "dia" um
// pedido é no gráfico de tendência — inclusive pra pedidos da Amazon US, que deviam usar o fuso
// americano. Fazia o "diário" da Amazon US não bater com o Seller Central (confirmado
// comparando um dia real, ver store.js getOrders/usOffsetForDate).
function localParts(iso, market) {
  const instant = Date.parse(iso);
  const offsetMin = market === 'us' ? usOffsetMinutes(new Date(instant)) : OFFSET;
  const l = new Date(instant + offsetMin * 60000);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate(), h: l.getUTCHours() };
}
function bucketKey(iso, grain, market) {
  const p = localParts(iso, market);
  const dk = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return grain === 'hour' ? `${dk} ${String(p.h).padStart(2, '0')}` : dk;
}
function buildBuckets(since, until, grain) {
  const out = []; let d = parseISO(since); const end = parseISO(until);
  while (d <= end) {
    const dk = isoUTC(d);
    if (grain === 'hour') for (let h = 0; h < 24; h++) out.push({ key: `${dk} ${String(h).padStart(2, '0')}`, label: `${String(h).padStart(2, '0')}h` });
    else { const [yy, mm, dd] = dk.split('-'); out.push({ key: dk, label: `${dd}/${mm}` }); }
    d = addDays(d, 1);
  }
  return out;
}

const isCancelled = o => o.cancelled;
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
// "Itens" na tela de Pedidos Recentes pode significar duas coisas diferentes: nº de linhas de
// produto distintas (o.items.length) ou a soma das quantidades (um pedido com 1 linha e qty=70
// mostrava "1 item", o que confundia — ver toggle "Itens/Qtd" no card, CLAUDE.md 4.9b).
const sumItemsQty = o => o.items.reduce((a, it) => a + (it.qty || 0), 0);

// Títulos únicos vendidos num pedido — usado na coluna "Produto" de Pedidos Recentes (card
// principal e busca geral). "-" é o placeholder de frete/serviço da Amazon (ver amazon.js
// ordersFromRows), não é produto de verdade; item sem título (Amazon ainda não reconciliado, ver
// CLAUDE.md 4.7.9) também é descartado, senão a coluna mostraria uma célula vazia sem explicação.
const productTitles = o => [...new Set(o.items.filter(it => it.title && it.title.trim() !== '-').map(it => it.title))];

// Toggle "Receita da Amazon" (ver CLAUDE.md): mode 'product' usa o.productSales (Ordered
// Product Sales — só o valor do produto, sem imposto/frete/embrulho, igual o Seller Central
// mostra) pra pedidos Amazon que já têm esse dado (só chega via relatório — ver amazon.js
// ordersFromRows). Pedido ainda não reconciliado ou qualquer outro canal cai no o.total
// cheio — nunca mostra 0 por falta de dado.
function orderRevenue(o, mode) {
  if (mode === 'product' && o.channel?.startsWith('amazon') && o.productSales != null) return o.productSales;
  return o.total;
}

// Vendas orgânicas x campanha (pagas): campanha = origem Meta (IG/FB) OU listagem ML "Destaque" (premium).
// Canais sem esse tipo de atribuição (Shopee, Amazon) sempre caem em "orgânico" — não é omissão, é porque
// não há como saber se uma venda ali veio de anúncio (sem tracking de origem/listing type nesses canais).
const metaSources = new Set(['Instagram', 'Facebook', 'instagram', 'facebook', 'ig', 'fb']);
const isCampaignOrder = o => metaSources.has(normSource(o.source)) || o.listingType === 'premium';

// ── Classificação de segmento (espécie) ──
const SEG_KW = {
  cat: ['gato','gatos','felino','felinos','cat','cats','feline','kitten','kitty','lisina'],
  dog: ['cachorro','cachorros','cão','cães','cao','caes','canino','caninos','dog','dogs','canine','puppy','pup'],
};
function classifySeg(item) {
  // Tags do Shopify têm prioridade (ex: "For Cats", "For Dogs")
  const tags = (item.tags || []).map(t => t.toLowerCase());
  if (tags.some(t => t.includes('for cat') || t.includes('para gato') || t === 'cat' || t === 'cats')) return 'cat';
  if (tags.some(t => t.includes('for dog') || t.includes('para cão') || t.includes('para cao') || t === 'dog' || t === 'dogs')) return 'dog';
  // Fallback: palavras-chave no título
  const l = (item.title || '').toLowerCase();
  if (SEG_KW.cat.some(k => l.includes(k))) return 'cat';
  if (SEG_KW.dog.some(k => l.includes(k))) return 'dog';
  return 'other';
}

// ── Classificação de tipo de produto ──
const TYPE_KW = {
  'Soft Chews': ['soft chew','soft chews','chew','chews'],
  'Tablets':    ['tablet','tablets'],
  'Powder':     ['powder'],
  'Liquid':     ['liquid'],
};
function classifyType(item) {
  // productType do Shopify é a fonte autoritativa, mas alguns produtos foram cadastrados com
  // grafias diferentes do mesmo tipo ("Tablets", "Tablet 120", "3 Pack - Tablet") — normaliza por
  // palavra-chave em vez de usar o valor cru, senão a mesma categoria fragmenta em várias pills
  // (bug reportado, Segmentos). "Pó" (BR) e "Powder" (US) continuam distintos de propósito
  // (grafias por mercado, nunca aparecem juntas no mesmo cálculo — sempre filtrado por market);
  // productType sem palavra-chave reconhecida mantém o valor cru (ex: "Pó").
  const raw = item.productType || item.title || '';
  const t = raw.toLowerCase();
  for (const [type, kws] of Object.entries(TYPE_KW)) {
    if (kws.some(k => t.includes(k))) return type;
  }
  return item.productType || null;
}

// Macro-categorias de produto usadas em Segmentos pra organizar o "Top produtos" de cada card
// (Gato/Cachorro) por tipo — CRIADAS PELO USUÁRIO pela tela (Segmentos → "Tipos de produto"), nada fixo
// no código (substituiu uma 1ª versão hardcoded, "Areia x Suplementos"). Cada regra é { nome: [palavra-chave,...] }; a palavra-chave é buscada (contains,
// case-insensitive) no título, no productType (Shopify) e em CADA tag do item — "em qualquer lugar",
// como pedido. A primeira regra que bater (na ordem em que foi criada) vence; sem nenhuma regra
// cadastrada, ou nenhuma batendo, cai em 'Outros' (nunca quebra, sempre uma string).
function classifyTypeGroup(it, market) {
  const rules = getProductTypeGroups()[market] || {};
  const haystack = [it.title, it.productType, ...(it.tags || [])].filter(Boolean).join(' ').toLowerCase();
  for (const [name, keywords] of Object.entries(rules)) {
    if ((keywords || []).some(k => k && haystack.includes(String(k).toLowerCase()))) return name;
  }
  return 'Outros';
}

// Produtos ocultados manualmente (Segmentos → "Ocultar produtos") — item cuja tag bate
// (contains, case-insensitive) com alguma palavra-chave cadastrada sai do fluxo normal (segAcc
// cat/dog/other, productGeo) e vai só pro card "Ocultos". Diferente de classifyTypeGroup: busca
// SÓ nas tags do item (o pedido foi "produtos com as tags que o usuário escrever"), não em
// título/productType.
function isHiddenItem(it, market) {
  const hideWords = getProductHiddenTags()[market] || [];
  if (!hideWords.length) return false;
  const tags = (it.tags || []).map(t => String(t || '').toLowerCase());
  return hideWords.some(w => tags.some(t => t.includes(String(w).toLowerCase())));
}

const EMPTY_SESSION_ROW = { sessions: 0, visitors: 0, cart: 0, checkout: 0, completed: 0 };
// channel decide qual loja Shopify entra na soma: 'todos' combina Coco and Luna + Yucaloo (mesmo
// mercado), um canal específico ('shopify'/'shopify_us' ou 'yucaloo_br'/'yucaloo_us') mostra só a
// loja dele. Decisão de produto: Yucaloo também tem card de Tráfego & conversão.
function aggregateSessions(since, until, market = 'br', channel = 'todos') {
  const includeCoco    = channel === 'todos' || channel === 'shopify' || channel === 'shopify_us';
  const includeYucaloo = channel === 'todos' || channel === 'yucaloo_br' || channel === 'yucaloo_us';
  const cocoDaily    = includeCoco    ? getSessionsDaily(market) : {};
  const yucalooDaily = includeYucaloo ? (getYucalooSessionsDaily()[market] || {}) : {};
  let s = 0, v = 0, c = 0, ck = 0, cp = 0;
  let d = parseISO(since); const end = parseISO(until);
  // seriesCoco/seriesYucaloo: mesmo formato de `series`, mas cada marca sozinha — alimenta o
  // toggle "Por canal" do card Tráfego & conversão (index.html), mesmo padrão já usado no card
  // Tendência. Sempre calculado (não só quando channel="todos") — custa quase nada por cima do
  // que já era somado, e evita duplicar a lógica quando o filtro muda; o front decide se usa ou
  // não.
  const series = [], seriesCoco = [], seriesYucaloo = [];
  while (d <= end) {
    const k = isoUTC(d);
    const rCoco = cocoDaily[k] || EMPTY_SESSION_ROW, rYuc = yucalooDaily[k] || EMPTY_SESSION_ROW;
    const sessions = rCoco.sessions + rYuc.sessions, visitors = rCoco.visitors + rYuc.visitors;
    const cart = rCoco.cart + rYuc.cart, checkout = rCoco.checkout + rYuc.checkout, completed = rCoco.completed + rYuc.completed;
    s += sessions; v += visitors; c += cart; ck += checkout; cp += completed;
    const [yy, mm, dd] = k.split('-');
    const label = `${dd}/${mm}`;
    series.push({ label, sessions, conv: sessions ? completed / sessions : 0 });
    seriesCoco.push({ label, sessions: rCoco.sessions, conv: rCoco.sessions ? rCoco.completed / rCoco.sessions : 0 });
    seriesYucaloo.push({ label, sessions: rYuc.sessions, conv: rYuc.sessions ? rYuc.completed / rYuc.sessions : 0 });
    d = addDays(d, 1);
  }
  return { sessions: s, visitors: v, cart: c, checkout: ck, completed: cp, conv: s ? cp / s : 0, series, seriesCoco, seriesYucaloo };
}

function normSource(s) { if (!s || !s.trim()) return 'Direto'; const t = s.trim(); return t[0].toUpperCase() + t.slice(1); }

// Extrai o tamanho do combo do título do lineItemGroup ("Combo de 2 unidades" → 2).
function comboSize(bundle) { return Number((/combo de (\d+)/i.exec(bundle?.title || '') || [])[1]) || null; }

// Remove o sufixo "- Combo de N unidades" de um título, revelando o título do produto-base
// (ex: "Lisina ... - Combo de 3 unidades - Ajuda ..." → "Lisina ... - Ajuda ...").
// Também normaliza o tamanho "Ng" pro pote-base de 120g (ver legacyComboSize) e remove o
// sufixo "- N Pack" (EUA), pra convergir no mesmo título do produto-base.
function stripComboSuffix(title) {
  return (title || '')
    .replace(/\s*-\s*combo de \d+ unidades?/i, '')
    .replace(/\s*-\s*\d+\s*pack\s*$/i, '')
    .replace(/(-\s*)\d+g(\s*-)/i, `$1${POWDER_BASE_GRAMS}g$2`)
    .trim();
}
const hasComboTag = it => (it.tags || []).some(t => (t || '').trim().toLowerCase() === 'combo');

// Tamanho-base dos potes de pó (BR/EUA) — todos os produtos em pó do catálogo usam 120g como
// unidade avulsa (confirmado nas tags "120g" de Lisina, Daily, Hip & Joint, Probiotics no catálogo).
const POWDER_BASE_GRAMS = 120;

// Detecta o tamanho de combos "legados": produtos cadastrados como SKU próprio no Shopify
// (não via Shopify Bundles) que representam N unidades do produto-base. Três formatos observados:
//   1) "Combo de N unidades" no título (BR) — ex: "Lisina ... - Combo de 3 unidades - ..."
//   2) sufixo "- N Pack" no título (EUA) — ex: "SAMe LO 225 - 3 Pack" (sem tag "combo")
//   3) tamanho "Ng" múltiplo do pote-base de 120g, com tag "combo" — ex: "Lisina ... - 360g - ..."
//      = 3 pacotes de 120g. Exige a tag pra não confundir com um produto-base de tamanho real distinto.
function legacyComboSize(it) {
  const title = it.title || '';
  const explicit = comboSize({ title });
  if (explicit) return explicit;
  const pack = /-\s*(\d+)\s*pack\s*$/i.exec(title.trim());
  if (pack) return Number(pack[1]);
  if (hasComboTag(it)) {
    const grams = /-\s*(\d+)g\s*-/i.exec(title);
    if (grams) {
      const n = Number(grams[1]);
      if (n > POWDER_BASE_GRAMS && n % POWDER_BASE_GRAMS === 0) return n / POWDER_BASE_GRAMS;
    }
  }
  return null;
}

// Alias de título pra produto com nome cadastrado incompleto no Shopify (informado pela empresa): o
// avulso "SAMe LO" e o combo "SAMe LO 225 - 3 Pack" são o mesmo produto — o nome completo e correto é
// "SAMe LO 225". Mapeamento pontual (não fundir por aproximação de nome: produtos com o mesmo
// nome-base podem ser tipos diferentes, ex: Hip & Joint em pó/tablet/soft chews).
const TITLE_ALIASES = { 'same lo': 'SAMe LO 225' };
function canonicalTitle(title) {
  const key = (title || '').trim().toLowerCase();
  return TITLE_ALIASES[key] || title;
}

// Alíquota efetiva de Simples Nacional (DAS sobre o faturamento), informada pela empresa. Vale pra
// empresa toda (não varia por produto); editável por linha se um produto tiver regra diferente.
const TAX_PCT_DEFAULT = 2.64;

// COG (custo do produto) de referência por linha de produto — informado pela empresa. Vale para o SKU
// principal citado; variações de tamanho/combo herdam o mesmo valor até serem ajustadas manualmente (o
// custo real por grama pode diferir). Sem correspondência conhecida, fica null (editável). Família do
// produto físico (independe de canal/tamanho/combo) — usada tanto pro COG de referência quanto pro
// panorama agregado de Estoque (ver computeStock/agg).
function classifyFamily(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('daily')) return 'Daily';
  // A fórmula "Daily" é multivitamínico (taurina + espirulina + L-lisina) — no Mercado Livre e na
  // Shopee o título descreve os ingredientes em vez de usar o nome "Daily" (ex: "Suplemento Para
  // Gatos Com Taurina, Espirulina E L-Lisina") e por isso também contém "lisina" — a checagem de
  // taurina/espirulina precisa vir ANTES da de lisina/lysine pura, senão cai errado em "Lysine"
  // (bug real, confirmado: 20 unidades de ML/Shopee ficavam fora do total de "Daily").
  if (t.includes('taurina') || t.includes('espirulina') || t.includes('spirulina')) return 'Daily';
  if (t.includes('lisina') || t.includes('lysine')) return 'Lysine';
  return null;
}
function defaultCog(title) {
  const fam = classifyFamily(title);
  if (fam === 'Daily') return 17.32;
  if (fam === 'Lysine') return 15.21;
  return null;
}

// ── Unificador (Configurações) — agrupamento manual global de produtos ──
// Substitui o antigo "Unificar" que existia separado em Segmentos e Estoque: agora os grupos são
// geridos numa tela própria (public/unificador.html) e aplicados aqui, no backend, pra todas as
// telas que mostram produto (Revenue/Top Produtos, Segmentos, Produtos, Estoque) mostrarem
// exatamente o mesmo agrupamento, sem duplicar a lógica de merge em cada página. Ver CLAUDE.md.
function activeProductGroups(market) {
  if (!getProductGroupsEnabled()) return {};
  return getProductGroups()[market] || {};
}

// Junta os grupos definidos em `groups` dentro de `list` — soma métricas numéricas (sumKeys),
// soma objetos chave→número (objSumKeys, ex: comboBySize), soma arrays de sub-linhas por id
// (arrayKeys, ex: byChannel/byState) e junta valores únicos de um campo num array (collectKeys,
// ex: canais presentes no grupo). `pickFirst` usa o primeiro valor não-nulo entre os membros
// (imagem, tipo, segmento). Produto fora de qualquer grupo passa direto, sem alteração. Função
// pura e genérica — cada chamador descreve seu próprio formato de linha via `opts`.
function applyProductGroups(list, groups, opts = {}) {
  if (!groups || !Object.keys(groups).length || !list.length) return list;
  const {
    titleKey = 'title',
    sumKeys = [],
    objSumKeys = [],
    arrayKeys = [],
    collectKeys = [],
    pickFirst = [],
    preferNonDefault = [], // [{ key, default }] — ver comentário abaixo
  } = opts;
  // Guardamos TODAS as linhas por título (não só a última) — um título de grupo pode existir em
  // mais de uma linha da lista de entrada quando o chamador já quebra por canal (ex: topProducts,
  // que é uma linha por combinação canal×título): sem isso, duas linhas com o mesmo título cru
  // vindas de canais diferentes se sobrescreveriam e uma delas perderia receita/qty silenciosamente.
  const byTitle = new Map();
  list.forEach(p => { const k = p[titleKey]; (byTitle.get(k) || byTitle.set(k, []).get(k)).push(p); });
  const usedTitles = new Set();
  const mergedRows = [];
  for (const [name, members] of Object.entries(groups)) {
    const found = members.flatMap(t => byTitle.get(t) || []);
    if (!found.length) continue;
    found.forEach(p => usedTitles.add(p[titleKey]));
    const row = { [titleKey]: name, _grouped: true, _members: found.map(p => p[titleKey]) };
    for (const k of sumKeys) row[k] = found.reduce((a, p) => a + (p[k] || 0), 0);
    for (const k of objSumKeys) {
      const acc = {};
      found.forEach(p => { for (const [sk, sv] of Object.entries(p[k] || {})) acc[sk] = (acc[sk] || 0) + (sv || 0); });
      row[k] = acc;
    }
    for (const k of pickFirst) row[k] = found.map(p => p[k]).find(v => v != null) ?? null;
    // Diferente de pickFirst ("primeiro valor não-nulo, na ordem em que aparece"): aqui qualquer
    // MEMBRO que tenha um valor diferente do "padrão" vence, mesmo que não seja o primeiro. Feito
    // pra "Tipos de produto" (ver classifyTypeGroup) — um grupo unificado representa UM produto
    // físico; se a listagem de só um canal (ex: Shopify) tiver a palavra-chave nas tags/título e as
    // outras (Mercado Livre, Shopee...) não, o grupo inteiro deve entrar no tipo mesmo assim, em vez
    // de cair em "Outros" só porque o membro processado primeiro não bateu na regra.
    for (const pk of preferNonDefault) {
      const hit = found.map(p => p[pk.key]).find(v => v != null && v !== pk.default);
      row[pk.key] = hit !== undefined ? hit : pk.default;
    }
    for (const ak of arrayKeys) {
      const acc = {};
      found.forEach(p => (p[ak.key] || []).forEach(entry => {
        const id = entry[ak.idKey];
        if (!acc[id]) acc[id] = { [ak.idKey]: id };
        for (const sk of ak.sumKeys) acc[id][sk] = (acc[id][sk] || 0) + (entry[sk] || 0);
      }));
      row[ak.key] = Object.values(acc).sort((a, b) => (b[ak.sumKeys[0]] || 0) - (a[ak.sumKeys[0]] || 0));
    }
    for (const ck of collectKeys) row[ck.to] = [...new Set(found.map(p => p[ck.from]).filter(Boolean))];
    mergedRows.push(row);
  }
  const passthrough = list.filter(p => !usedTitles.has(p[titleKey]));
  return [...mergedRows, ...passthrough];
}

// Canais Shopify com catálogo bruto sincronizado (kv.shopifyProductCatalog, ver sync.js) por
// mercado — únicos com um "produto cadastrado" separado de "produto vendido" hoje; Shopee/ML/
// Amazon continuam só derivados de pedido (sem endpoint de catálogo integrado ainda).
const SHOPIFY_CATALOG_CHANNELS = { br: ['shopify', 'yucaloo_br'], us: ['shopify_us', 'yucaloo_us'] };

// Tipo de cada grupo do Unificador resolvido a partir da DEFINIÇÃO do grupo, nunca das vendas do
// período. Essa distinção é o conserto do bug reportado pelo Luan em 26/08/2026 (ver
// setProductGroupType em store.js): antes o tipo saía de `applyProductGroups`, que só enxerga os
// membros presentes na lista, ou seja, os que venderam na janela escolhida — num dia em que só a
// listagem da Amazon do "Daily" vendeu, o membro Shopify (o único que carrega o campo Type) nem
// entrava na conta e o grupo inteiro caía em "Outros". Aqui varremos TODOS os membros cadastrados,
// tenham vendido ou não, então a resposta é a mesma em qualquer período.
// Precedência, primeiro que resolver vence, por eixo (type e typeGroup são independentes):
//   1. tag mãe definida à mão no Unificador (absoluta, não depende de mais nada);
//   2. Type/tags ATUAIS do catálogo Shopify de qualquer membro do grupo (o catálogo é
//      re-sincronizado a cada ciclo, diferente do productType/tags congelados no pedido);
//   3. palavra-chave de "Tipos de produto" batendo no título de qualquer membro (só pro eixo
//      typeGroup) — é o que salva membro de canal sem catálogo, tipo Amazon/Shopee/ML;
//   4. null, e aí quem chama mantém o valor que já tinha vindo dos itens do período.
// Devolve { [nomeDoGrupo]: { type, typeGroup } }, com null em cada eixo não resolvido.
function resolveGroupTypes(market, groups) {
  const manual = getProductGroupTypes()[market] || {};
  const raw = getShopifyProductCatalog();
  // Título → cadastro atual na Shopify. Diferente de shopifyCatalogTypeByChannel (que precisa ser
  // escopado por canal porque a MESMA linha de pedido pertence a um canal só), aqui o alvo é um
  // grupo unificado, que por definição cruza canais: basta achar o cadastro em qualquer loja
  // Shopify do mercado. Primeiro canal que tiver o título vence.
  const byTitle = {};
  for (const channel of SHOPIFY_CATALOG_CHANNELS[market] || []) {
    for (const p of raw[channel] || []) {
      if (!byTitle[p.title]) byTitle[p.title] = { productType: p.productType || null, tags: p.tags || [] };
    }
  }
  const out = {};
  for (const [name, members] of Object.entries(groups || {})) {
    const m = manual[name] || {};
    let type = m.type || null;
    let typeGroup = m.typeGroup || null;
    for (const title of members) {
      if (type && typeGroup) break;
      const cat = byTitle[title] || {};
      if (!type) type = classifyType({ productType: cat.productType || null, title });
      if (!typeGroup) {
        const g = classifyTypeGroup({ title, productType: cat.productType || null, tags: cat.tags || [] }, market);
        if (g && g !== 'Outros') typeGroup = g;
      }
    }
    out[name] = { type: type || null, typeGroup: typeGroup || null };
  }
  return out;
}

// Aplica o tipo resolvido acima nas linhas JÁ agrupadas por applyProductGroups. Só toca em linha de
// grupo (`_grouped`) e só sobrescreve o eixo que o grupo resolveu — um eixo que ficou null aqui
// preserva o que veio dos itens do período, que continua sendo melhor que nada.
function applyGroupTypes(rows, groupTypeIdx, keys = ['type', 'typeGroup']) {
  if (!groupTypeIdx || !Object.keys(groupTypeIdx).length) return rows;
  return rows.map(p => {
    if (!p._grouped) return p;
    const g = groupTypeIdx[p.title];
    if (!g) return p;
    const patch = {};
    for (const k of keys) if (g[k] != null) patch[k] = g[k];
    return Object.keys(patch).length ? { ...p, ...patch } : p;
  });
}

// Mescla o catálogo bruto da Shopify (kv.shopifyProductCatalog — produto cadastrado, mesmo sem
// venda) em cima de um catalogByChannel derivado só de pedidos (aggregateProductsByChannel).
// Sem isso, um canal Shopify sem NENHUM pedido no histórico inteiro (ex.: Yucaloo recém-conectada)
// nem aparece em catalogByChannel — a chave do canal só nasce a partir de pedido real — e o card
// em Produtos/Estoque fica sem produto nenhum, mesmo com o catálogo real cheio na Shopify.
function mergeShopifyCatalog(catalogByChannel, market) {
  const rawCatalog = getShopifyProductCatalog();
  for (const channel of SHOPIFY_CATALOG_CHANNELS[market] || []) {
    if (!catalogByChannel[channel]) catalogByChannel[channel] = { revenue: 0, orders: 0, products: {} };
    const products = catalogByChannel[channel].products;
    for (const p of rawCatalog[channel] || []) {
      if (products[p.title]) continue;
      products[p.title] = { revenue: 0, avulsoQty: 0, comboQty: 0, comboBySize: {}, type: classifyType(p), image: p.image || null, tags: p.tags || [] };
    }
  }
  return catalogByChannel;
}

// Índice título → tags ATUAIS do catálogo bruto Shopify, por canal (kv.shopifyProductCatalog,
// re-sincronizado a cada ciclo). Existe só pros canais Shopify (ver SHOPIFY_CATALOG_CHANNELS).
function shopifyCatalogTagsByChannel(market) {
  const raw = getShopifyProductCatalog();
  const idx = {};
  for (const channel of SHOPIFY_CATALOG_CHANNELS[market] || []) {
    const map = {};
    for (const p of raw[channel] || []) map[p.title] = p.tags || [];
    idx[channel] = map;
  }
  return idx;
}

// Índice título → productType ATUAL do catálogo bruto Shopify, por canal (kv.shopifyProductCatalog,
// re-sincronizado a cada ciclo) — MESMO PRINCÍPIO E MESMO FORMATO de shopifyCatalogTagsByChannel,
// só que pra "Type" em vez de tag. `it.productType`, capturado no pedido (ver shopify.js), é uma
// FOTO de quando o pedido foi buscado e nunca é re-sincronizado depois — exatamente o mesmo
// problema que já existia com tag (ver isHiddenProduct/catalogTagsIdx): produto com Type certinho
// HOJE na Shopify continuava aparecendo sem tipo em Segmentos por causa de um pedido antigo,
// sincronizado antes do campo "Type" ter sido preenchido no Admin (ou antes da consulta de pedidos
// passar a buscar esse campo). Reportado em produção — "Daily"/Areia caindo em "Outros" mesmo com o
// tipo certo cadastrado na Shopify. Por que POR CANAL, e não um índice único pro mercado inteiro
// (como cheguei a fazer na 1ª versão): o catálogo bruto da Shopify tem título repetido apontando
// pra produtos DIFERENTES — ex. "Urinary Tract" e "Liver & Kidney" (loja EUA) existem como Tablet,
// Soft Chews E Powder for Cats ao mesmo tempo, listagens distintas com o mesmo nome de exibição. Um
// índice único (título → tipo) escolheria um dos três às cegas e classificaria unidade errada. Por
// canal reduz esse risco (mesma ambiguidade que catalogTagsIdx já aceita hoje pra tag, não pior),
// mas não elimina de vez — título duplicado dentro do MESMO canal ainda existe nos dados reais.
function shopifyCatalogTypeByChannel(market) {
  const raw = getShopifyProductCatalog();
  const idx = {};
  for (const channel of SHOPIFY_CATALOG_CHANNELS[market] || []) {
    const map = {};
    for (const p of raw[channel] || []) map[p.title] = p.productType || null;
    idx[channel] = map;
  }
  return idx;
}

// Decide se um produto (canal + título) deve ficar oculto ("Ocultar produtos" no Unificador).
// Prioriza a tag ATUAL do catálogo Shopify sobre a tag presa nos pedidos: `it.tags` de um pedido
// vem do produto NA HORA em que o pedido foi buscado (ver shopify.js, product.tags via GraphQL) e
// nunca é re-sincronizado depois — se uma tag como "Combo"/"Teste" foi removida da Shopify depois,
// pedidos antigos já gravados continuam com ela presa pra sempre, e a união de tags feita em
// aggregateProductsByChannel carregava esse resíduo junto indefinidamente. Resultado: um produto
// com tags limpas HOJE continuava oculto pra sempre por causa de uma tag que nem existe mais
// (reportado em produção: "Lisina para gatos - 120g" sumia de Produtos/Estoque mesmo com tags
// atuais "Suplemento"/"Para gatos", sem nenhuma palavra-chave oculta batendo). Catálogo bruto não
// existe pra Shopee/ML/Amazon (sem endpoint de catálogo, ver SHOPIFY_CATALOG_CHANNELS) — nesses o
// único dado disponível continua sendo a tag do pedido.
function isHiddenProduct(channel, title, orderTags, catalogTagsIdx, market) {
  const catTags = catalogTagsIdx[channel]?.[title];
  return isHiddenItem({ tags: catTags !== undefined ? catTags : (orderTags || []) }, market);
}

// Catálogo completo (todo o histórico, todos os canais) de um mercado, achatado numa lista só —
// usado pela tela Unificador pra listar todo produto disponível pra agrupar manualmente.
export function listProductCatalog({ market = 'br' } = {}) {
  const allOrders = getOrders({ channel: 'todos', market }).filter(o => !isCancelled(o));
  const byChannel = aggregateProductsByChannel(allOrders);
  const catalogTagsIdx = shopifyCatalogTagsByChannel(market);
  const items = [];
  const seen = new Set(); // "canal|||título" já coberto pela agregação de vendas
  for (const [channel, c] of Object.entries(byChannel)) {
    for (const [title, p] of Object.entries(c.products)) {
      items.push({ title, channel, image: p.image, type: p.type, qty: p.avulsoQty + p.comboQty, revenue: p.revenue, hidden: isHiddenProduct(channel, title, p.tags, catalogTagsIdx, market) });
      seen.add(channel + '|||' + title);
    }
  }
  // Produto cadastrado na Shopify mas nunca vendido (0 pedidos) não aparecia — o Unificador precisa
  // organizar o catálogo inteiro, não só o que já vendeu (reportado em produção).
  const rawCatalog = getShopifyProductCatalog();
  for (const channel of SHOPIFY_CATALOG_CHANNELS[market] || []) {
    for (const p of rawCatalog[channel] || []) {
      const key = channel + '|||' + p.title;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ title: p.title, channel, image: p.image, type: classifyType(p), qty: 0, revenue: 0, hidden: isHiddenItem(p, market) });
    }
  }
  items.sort((a, b) => b.revenue - a.revenue);
  return { market, items };
}

// Comissão de referência por canal (marketplace) — editável por produto na tela de Produtos.
// Shopify (BR/US) não é marketplace: comissão de venda é 0% (taxa de gateway é outro assunto).
const DEFAULT_COMMISSION_PCT = {
  shopify: 0, shopify_us: 0,
  shopee: 18,
  mercadolivre: 14,
  amazon: 12, amazon_us: 12,
};

// Teto de segurança do card de Pedidos recentes (paginado no front). Alto o bastante para
// mostrar TODOS os pedidos do período em qualquer canal de volume normal; só limita o caso
// extremo do amazon_us em janelas longas, evitando um payload gigante.
const RECENT_MAX = 5000;

// Lista de produtos (título + receita) de um conjunto de pedidos válidos, já com as regras do
// card Top produtos aplicadas: produto oculto de fora, agrupamento manual do Unificador junto.
// Extraída de dentro do computeDashboard porque o card de Insights precisa rodar exatamente a
// MESMA agregação no período anterior — se as duas pontas divergirem, a comparação mente.
function productRevenueRows(validOrders, market, groups, catalogTagsIdx) {
  const byCh = aggregateProductsByChannel(validOrders);
  let rows = Object.entries(byCh)
    .flatMap(([ch, c]) => Object.entries(c.products)
      .filter(([title, p]) => !isHiddenProduct(ch, title, p.tags, catalogTagsIdx, market))
      .map(([title, p]) => ({
        title, channel: ch, revenue: p.revenue, avulsoQty: p.avulsoQty, comboQty: p.comboQty, comboBySize: p.comboBySize,
      })));
  // Junta linhas de canais diferentes que pertencem ao mesmo grupo manual — sem grupo, cada
  // (canal, título) continua sua própria linha, como sempre foi.
  rows = applyProductGroups(rows, groups, {
    sumKeys: ['revenue', 'avulsoQty', 'comboQty'],
    objSumKeys: ['comboBySize'],
    collectKeys: [{ from: 'channel', to: 'channels' }],
  }).map(p => (p.channels ? p : { ...p, channels: [p.channel] }));
  return rows.filter(p => p.revenue > 0).sort((a, b) => b.revenue - a.revenue);
}

// Receita/pedidos por estado de entrega. Mesma extração e mesmo motivo da função acima. US:
// normaliza a grafia do estado ("California"/"CALIFORNIA"/"CA."/"N.Y." → "CA"/"NY"), senão cada
// variante da Amazon vira uma linha no ranking e o mapa subconta. Ver 4.10/4.7.5. Endereços que
// não são região dos EUA (províncias do Canadá, etc.) são agrupados num único bucket 'INTL' —
// não poluem o ranking com cada país, mas não perdem receita. BR: mesmo princípio (ver
// br-states.js) — nem todo canal grava o estado como código UF; sem normalizar, "SP" e "SÃO
// PAULO" viravam duas linhas separadas pro mesmo estado (reportado em produção, no ranking de
// "Onde os produtos vendem" e na Geografia BR).
function revenueByState(validOrders, market) {
  const byState = {};
  validOrders.forEach(o => {
    let s = o.state;
    if (market === 'us') { s = normalizeUsState(s); if (s && !isUsRegionCode(s)) s = 'INTL'; }
    else if (market === 'br') { s = normalizeBrState(s); }
    if (s && o.total > 0) {
      if (!byState[s]) byState[s] = { revenue: 0, orders: 0, byChannel: {} };
      byState[s].revenue += o.total;
      byState[s].orders += 1;
      byState[s].byChannel[o.channel] = (byState[s].byChannel[o.channel] || 0) + o.total;
    }
  });
  return byState;
}

// Soma um balde diário (metaInsightsDaily / mlAdCostsDaily) dentro de um intervalo de datas.
// Mesmo laço que já existia solto em dois lugares do computeDashboard; virou função porque o
// card de Insights precisa do mesmo número no período ANTERIOR pra comparar eficiência de anúncio.
function sumDailyRange(daily, since, until) {
  const t = { spend: 0, impressions: 0, clicks: 0 };
  let d = parseISO(since); const end = parseISO(until);
  while (d <= end) {
    const m = daily[isoUTC(d)];
    if (m) { t.spend += m.spend || 0; t.impressions += m.impressions || 0; t.clicks += m.clicks || 0; }
    d = addDays(d, 1);
  }
  return t;
}

export function computeDashboard({ channel = 'todos', since, until, metric = 'receita', market = 'br', amazonRevenueMode = 'total' }) {
  const span = daySpan(since, until);
  const grain = span <= 2 ? 'hour' : 'day';

  // período anterior comparável
  const prevUntil = isoUTC(addDays(parseISO(since), -1));
  const prevSince = isoUTC(addDays(parseISO(since), -span));

  const curAll = getOrders({ channel, since, until, market });
  const prevAll = getOrders({ channel, since: prevSince, until: prevUntil, market });
  const valid = curAll.filter(o => !isCancelled(o));
  const prevValid = prevAll.filter(o => !isCancelled(o));

  const revenue = sum(valid, o => orderRevenue(o, amazonRevenueMode)), count = valid.length, aov = count ? revenue / count : 0;
  const pRev = sum(prevValid, o => orderRevenue(o, amazonRevenueMode)), pCount = prevValid.length, pAov = pCount ? pRev / pCount : 0;
  const delta = (cur, prev) => (prev === 0 ? null : ((cur - prev) / prev) * 100);

  // tendência
  const buckets = buildBuckets(since, until, grain);
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  // Sessões via ShopifyQL: BR (channel shopify/yucaloo_br/todos) e US (channel
  // shopify_us/yucaloo_us/todos) — Yucaloo tem loja Shopify própria, ver aggregateSessions.
  const hasSessionData =
    (market === 'br' && (channel === 'todos' || channel === 'shopify' || channel === 'yucaloo_br')) ||
    (market === 'us' && (channel === 'todos' || channel === 'shopify_us' || channel === 'yucaloo_us'));
  const emptySeries = buckets.map(b => ({ label: b.label, sessions: 0, conv: 0 }));
  const emptySess = { sessions: 0, visitors: 0, cart: 0, checkout: 0, completed: 0, conv: 0, series: emptySeries, seriesCoco: emptySeries, seriesYucaloo: emptySeries };
  const sess = hasSessionData ? aggregateSessions(since, until, market, channel) : emptySess;
  let trendLabels, trendData, trendTotal, trendFmt = metric === 'receita' ? 'money' : 'int';
  let trendByChannel = null;
  if (metric === 'sessoes') {
    trendLabels = sess.series.map(p => p.label);
    trendData = sess.series.map(p => p.sessions);
    trendTotal = sess.sessions;
  } else {
    const series = buckets.map(() => 0);
    const byChannelBuckets = buckets.map(() => ({}));
    valid.forEach(o => {
      const i = idx.get(bucketKey(o.createdAt, grain, market));
      if (i != null) {
        const v = metric === 'pedidos' ? 1 : orderRevenue(o, amazonRevenueMode);
        series[i] += v;
        byChannelBuckets[i][o.channel] = (byChannelBuckets[i][o.channel] || 0) + v;
      }
    });
    trendLabels = buckets.map(b => b.label);
    trendData = series;
    trendTotal = metric === 'pedidos' ? count : revenue;
    trendByChannel = byChannelBuckets;
  }

  // split por canal (receita real por canal; canais sem dados ficam 0)
  const byChannel = market === 'us'
    ? { shopify_us: 0, amazon_us: 0 }
    : { shopify: 0, shopee: 0, amazon: 0, mercadolivre: 0 };
  getOrders({ channel: 'todos', since, until, market }).filter(o => !isCancelled(o)).forEach(o => { byChannel[o.channel] = (byChannel[o.channel] || 0) + orderRevenue(o, amazonRevenueMode); });

  // marketing por origem (apenas pedidos válidos do recorte atual)
  const mkt = {};
  if (channel === 'mercadolivre') {
    // Para ML: agrupar por tipo de listagem em vez de source
    valid.forEach(o => {
      const key = o.listingType === 'premium' ? 'Destaque' : 'Clássico';
      mkt[key] = (mkt[key] || 0) + o.total;
    });
  } else {
    valid.forEach(o => { const s = normSource(o.source); mkt[s] = (mkt[s] || 0) + o.total; });
  }
  let mktEntries = Object.entries(mkt).sort((a, b) => b[1] - a[1]);
  if (mktEntries.length > 5) { const top = mktEntries.slice(0, 4); const rest = mktEntries.slice(4).reduce((a, e) => a + e[1], 0); top.push(['Outros', rest]); mktEntries = top; }

  // top produtos (agrupado por título + canal para diferenciar o mesmo produto em marketplaces
  // diferentes) — mesma agregação usada em Produtos/Estoque (aggregateProductsByChannel), incluindo
  // a quebra avulso x combo (Shopify Bundles e combos legados, ver legacyComboSize). Retornamos o
  // top 5 (topProducts) e a lista completa (topProductsAll) pra permitir expandir o card na revenue.
  const productGroupsMkt = activeProductGroups(market); // Unificador (Configurações) — ver acima
  // Produto oculto (Unificador → "Ocultar produtos") não pode aparecer em nenhuma lista de produto fora do
  // card "Ocultos" — antes só computeSegments (Gato/Cachorro/"Onde os produtos vendem") respeitava isso;
  // Top Produtos, Produtos e Estoque continuavam mostrando o produto normalmente (reportado em produção).
  // isHiddenProduct prioriza a tag atual do catálogo Shopify sobre a tag presa no pedido (ver
  // isHiddenProduct).
  const catalogTagsIdx = shopifyCatalogTagsByChannel(market);
  const allProducts = productRevenueRows(valid, market, productGroupsMkt, catalogTagsIdx);
  const topProducts = allProducts.slice(0, 5);

  // por estado (endereço de entrega dos pedidos válidos) US: normaliza a grafia do estado
  // ("California"/"CALIFORNIA"/"CA."/"N.Y." → "CA"/"NY"), senão cada variante da Amazon vira
  // uma linha no ranking e o mapa subconta. Ver 4.10/4.7.5. Endereços que não são região dos
  // EUA (províncias do Canadá, etc.) são agrupados num único bucket 'INTL' — não poluem o
  // ranking com cada país, mas não perdem receita. BR: mesmo princípio (ver br-states.js) — nem
  // todo canal grava o estado como código UF; sem normalizar, "SP" e "SÃO PAULO" viravam duas
  // linhas separadas pro mesmo estado (reportado em produção, no ranking de "Onde os produtos
  // vendem" e na Geografia BR).
  const byState = revenueByState(valid, market);

  // segmentos por espécie (gato vs cão) + tipo de produto
  // productGeoAcc: mesma passada, agrupa por título de produto (não por segmento) para saber
  // ONDE (estado) e por qual CANAL cada produto vendeu — ver card "Onde os produtos vendem" em Segmentos.
  const segAcc = {};
  const productGeoAcc = {};
  const seenBundleIdsSeg = new Set();
  const geoAmazonImages = getAmazonProductImages(); // Shopify/Shopee/ML trazem it.image direto; Amazon só via cache de ASIN (ver 4.13)
  const catalogTypeIdx = shopifyCatalogTypeByChannel(market);
  const groupTypeIdx = resolveGroupTypes(market, productGroupsMkt);
  valid.forEach(o => {
    const rf = itemRevFactor(o); // escala receita ao total capturado; ver 4.7.6 e 4.13
    // mesma normalização de estado usada em byState (ver acima): reduz grafias da Amazon e agrupa
    // endereços fora dos EUA em 'INTL' quando market==='us'.
    let geoState = o.state;
    if (market === 'us') { geoState = normalizeUsState(geoState); if (geoState && !isUsRegionCode(geoState)) geoState = 'INTL'; }
    else if (market === 'br') { geoState = normalizeBrState(geoState); }
    o.items.forEach(it => {
      if (!it.title || it.title.trim() === '-') return; // placeholder de frete/serviço da Amazon, ver amazon.js ordersFromRows
      const hidden = isHiddenItem(it, market);
      const seg  = hidden ? 'hidden' : classifySeg(it);
      // Prioriza o Type ATUAL do catálogo Shopify (catalogTypeIdx, escopado por CANAL — ver
      // shopifyCatalogTypeByChannel) sobre o productType preso no pedido — mesma prioridade já
      // aplicada a tag (ver catalogTagsIdx/isHiddenProduct). Só cai no valor do próprio item
      // quando o canal do pedido nem tem catálogo Shopify (Shopee/ML/Amazon) ou o título não está
      // cadastrado nele (produto vendido só fora da Shopify, sem contrapartida).
      const liveType = catalogTypeIdx[o.channel]?.[it.title];
      const type = classifyType(liveType !== undefined ? { ...it, productType: liveType } : it);
      const amount = (it.amount || 0) * rf;
      // Mesma normalização de combo legado usada em aggregateProductsByChannel (ver 4.13.1): um
      // item "3 Pack"/"Combo de N unidades" vendido como SKU próprio (não Shopify Bundles) conta
      // N unidades do produto-base, não 1 — e a venda entra na linha do produto-base, não numa
      // linha própria minúscula ("3 Pack" reportado — 16 pacotes viravam "16 un" de um
      // tipo/produto separado em vez de 48 un de Tablets).
      const taggedSize = legacyComboSize(it);
      const title = canonicalTitle(taggedSize ? stripComboSuffix(it.title) : it.title);
      const rawQty = it.qty || 1;
      const qty = taggedSize ? rawQty * taggedSize : rawQty;
      if (!segAcc[seg]) segAcc[seg] = { revenue: 0, units: 0, orderIds: new Set(), products: {} };
      segAcc[seg].revenue += amount;
      segAcc[seg].units  += qty;
      segAcc[seg].orderIds.add(o.id);
      // "Por tipo de produto" (byType) NÃO é acumulado aqui item a item — ver por quê logo
      // abaixo, onde é montado a partir de topProducts (já agrupado pelo Unificador).
      const p = segAcc[seg].products;
      if (!p[title]) p[title] = { qty: 0, revenue: 0, avulsoQty: 0, comboQty: 0, comboBySize: {}, type: null, typeGroup: null };
      p[title].qty     += qty;
      p[title].revenue += amount;
      if (!p[title].type) p[title].type = type;
      if (!p[title].typeGroup) p[title].typeGroup = classifyTypeGroup(it, market);
      if (taggedSize) {
        p[title].comboQty += qty; // qty já é pacotes × tamanho aqui
        p[title].comboBySize[taggedSize] = (p[title].comboBySize[taggedSize] || 0) + rawQty;
      } else if (it.bundle) {
        p[title].comboQty += qty;
        const size = comboSize(it.bundle);
        if (size && !seenBundleIdsSeg.has(it.bundle.id)) {
          seenBundleIdsSeg.add(it.bundle.id);
          p[title].comboBySize[size] = (p[title].comboBySize[size] || 0) + (it.bundle.qty || 1);
        }
      } else {
        p[title].avulsoQty += qty;
      }

      // geografia + canal por produto — produto oculto não entra em "Onde os produtos vendem"
      if (!hidden) {
        if (!productGeoAcc[title]) productGeoAcc[title] = { seg, qty: 0, revenue: 0, byChannel: {}, byState: {}, image: null };
        const g = productGeoAcc[title];
        g.qty += qty;
        g.revenue += amount;
        if (!g.image && it.image) g.image = it.image;
        if (!g.image && it.asin && geoAmazonImages[it.asin]) g.image = geoAmazonImages[it.asin];
        if (!g.byChannel[o.channel]) g.byChannel[o.channel] = { qty: 0, revenue: 0 };
        g.byChannel[o.channel].qty += qty;
        g.byChannel[o.channel].revenue += amount;
        if (geoState) {
          if (!g.byState[geoState]) g.byState[geoState] = { qty: 0, revenue: 0, orderIds: new Set() };
          g.byState[geoState].qty += qty;
          g.byState[geoState].revenue += amount;
          g.byState[geoState].orderIds.add(o.id);
        }
      }
    });
  });
  let productGeo = Object.entries(productGeoAcc)
    .map(([title, g]) => ({
      title, seg: g.seg, qty: g.qty, revenue: g.revenue, image: g.image,
      byChannel: Object.entries(g.byChannel).map(([channel, c]) => ({ channel, qty: c.qty, revenue: c.revenue })).sort((a, b) => b.qty - a.qty),
      byState: Object.entries(g.byState).map(([state, s]) => ({ state, qty: s.qty, revenue: s.revenue, orders: s.orderIds.size })).sort((a, b) => b.qty - a.qty),
    }));
  // Unificador (Configurações) — junta produtos do mesmo grupo manual entre canais/segmentos.
  // Mesmo mecanismo que antes vivia só em Segmentos (client-side); agora é global e server-side.
  productGeo = applyProductGroups(productGeo, productGroupsMkt, {
    sumKeys: ['qty', 'revenue'],
    pickFirst: ['image', 'seg'],
    arrayKeys: [
      { key: 'byChannel', idKey: 'channel', sumKeys: ['qty', 'revenue'] },
      { key: 'byState', idKey: 'state', sumKeys: ['qty', 'revenue', 'orders'] },
    ],
  })
    .sort((a, b) => b.qty - a.qty);
  // "hidden" fica fora do denominador — não é uma fatia real da distribuição Gato/Cachorro/Outros,
  // é só onde produtos explicitamente ocultados (ver isHiddenItem) vão parar.
  const totalSegUnits = Object.entries(segAcc).filter(([k]) => k !== 'hidden').reduce((a, [, s]) => a + s.units, 0);
  const segments = {};
  for (const [k, v] of Object.entries(segAcc)) {
    // Unificador (Configurações) — junta produtos do mesmo grupo manual (mesmo mecanismo de
    // topProducts/productGeo acima); estava faltando aqui até então (bug reportado em produção:
    // "ficou sem unificar" em Segmentos — era esta lista, a de "Onde os produtos vendem" já ia).
    let topProducts = Object.entries(v.products)
      .map(([title, d]) => ({ title, qty: d.qty, revenue: d.revenue, avulsoQty: d.avulsoQty, comboQty: d.comboQty, comboBySize: d.comboBySize, type: d.type, typeGroup: d.typeGroup }));
    // typeGroup: macro-categoria criada pelo usuário (Segmentos → "Tipos de produto", ver
    // classifyTypeGroup) usada pra organizar "Top produtos" por tipo em vez de uma lista só. `type`
    // (Pó/Powder/Tablets/...) segue o MESMO princípio, e pelo MESMO motivo: um produto unificado no
    // Unificador é UM produto físico só, vendido por vários canais/títulos — e só o membro Shopify
    // carrega o campo "Type" de verdade (Shopee/ML/Amazon não têm esse conceito, e o próprio Shopify
    // só popula em parte dos cadastros). `preferNonDefault` (não `pickFirst`): qualquer membro do
    // grupo com um tipo real vence, mesmo que não seja o primeiro da lista — "Lysine"/"Daily"/as
    // Areias tinham a maioria das unidades vindas de títulos SEM Type cadastrado (Amazon/Shopee, ou
    // variante Shopify legada) enquanto o título Shopify "de verdade" tinha "Pó" certinho; com
    // pickFirst, se esse título Shopify não fosse o primeiro do grupo, TODO o grupo perdia o tipo.
    // Reportado em produção, com prints mostrando "Lysine"/"Daily"/a Areia caindo quase inteiros em
    // "Outros" apesar de serem produtos de Pó conhecidos e já unificados. applyGroupTypes vem DEPOIS
    // e tem a palavra final: `preferNonDefault` resolve o tipo a partir dos membros que venderam no
    // período (bom como último recurso, instável como fonte principal), e resolveGroupTypes resolve
    // a partir da definição do grupo, que não muda com a data escolhida.
    topProducts = applyGroupTypes(applyProductGroups(topProducts, productGroupsMkt, {
      sumKeys: ['qty', 'revenue', 'avulsoQty', 'comboQty'],
      objSumKeys: ['comboBySize'],
      preferNonDefault: [{ key: 'type', default: null }, { key: 'typeGroup', default: 'Outros' }],
    }), groupTypeIdx).sort((a, b) => b.qty - a.qty);
    // byType SEMPRE sai de topProducts (já agrupado acima), nunca de uma soma feita item a item
    // durante a varredura de pedidos lá em cima — um produto unificado só tem UM tipo depois do
    // agrupamento, e derivar daqui garante que a soma dos pills bate exatamente com `units` do
    // card (mesmo produto, mesma fonte, sem outro caminho pra divergir). Item sem tipo
    // classificável (nenhum membro do grupo tem Type cadastrado, e o título não bate nenhuma
    // palavra-chave em inglês) cai em "Outros" em vez de sumir da lista.
    const byType = {};
    for (const p of topProducts) {
      const t = p.type || 'Outros';
      byType[t] = (byType[t] || 0) + p.qty;
    }
    segments[k] = {
      revenue: v.revenue,
      units:   v.units,
      orders:  v.orderIds.size,
      pct:     totalSegUnits > 0 ? v.units / totalSegUnits : 0,
      byType,
      // Lista completa ordenada por unidades — a tela mostra 5 e expande com "ver mais".
      topProducts,
    };
  }

  // pedidos recentes — respeita o PERÍODO e o CANAL selecionados (antes ignorava a janela
  // e mostrava os últimos 100 de qualquer data, então "Hoje" trazia pedido de meses atrás).
  // O card pagina no front (10 por página), então devolvemos todos os do período; o teto
  // RECENT_MAX é só uma trava de segurança de payload para o amazon_us (~1000 pedidos/dia).
  const recent = getOrders({ channel, since, until, market })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, RECENT_MAX)
    .map(o => ({ name: o.name, channel: o.channel, customer: o.customer, items: o.items.length, itemsQty: sumItemsQty(o), products: productTitles(o), createdAt: o.createdAt, total: o.total, status: o.status, cancelled: o.cancelled, refunded: o.refunded || null }));

  // conversão anterior
  const prevSess = hasSessionData ? aggregateSessions(prevSince, prevUntil, market, channel) : emptySess;

  // Meta Ads — gasto e ROAS no período (separado por mercado)
  const metaDaily = market === 'us' ? getMetaUSInsightsDaily() : getMetaInsightsDaily();
  const metaCur = sumDailyRange(metaDaily, since, until);
  const adCost = metaCur.spend, adImpressions = metaCur.impressions, adClicks = metaCur.clicks;
  const metaRevenue = valid.filter(o => metaSources.has(normSource(o.source))).reduce((a, o) => a + o.total, 0);
  const roas = adCost > 0 ? metaRevenue / adCost : 0;
  // Mesmos números no período anterior, só para o card de Insights comparar eficiência de anúncio.
  const prevAdCost = sumDailyRange(metaDaily, prevSince, prevUntil).spend;
  const prevMetaRevenue = prevValid.filter(o => metaSources.has(normSource(o.source))).reduce((a, o) => a + o.total, 0);
  const prevRoas = prevAdCost > 0 ? prevMetaRevenue / prevAdCost : 0;

  // Série diária de gasto do Meta alinhada aos buckets da tendência (para a tela de Campanhas).
  const metaSpendDaily = buckets.map(b => {
    const m = metaDaily[b.key.slice(0, 10)];
    return m ? m.spend : 0;
  });

  // Vendas orgânicas x campanha (pagas): campanha = origem Meta (IG/FB) OU listagem ML "Destaque" (premium).
  const campaignOrdersList = valid.filter(isCampaignOrder);
  const campaignSales = sum(campaignOrdersList, o => o.total);
  const salesSplit = {
    campaign:       campaignSales,
    organic:        revenue - campaignSales,
    campaignOrders: campaignOrdersList.length,
    organicOrders:  count - campaignOrdersList.length,
  };

  // Orgânico x Campanha POR CANAL (para os gráficos de pizza individuais da tela Revenue) —
  // sempre todos os canais do mercado, independente do filtro de canal selecionado na tela.
  const salesSplitByChannel = {};
  getOrders({ channel: 'todos', since, until, market }).filter(o => !isCancelled(o)).forEach(o => {
    if (!salesSplitByChannel[o.channel]) salesSplitByChannel[o.channel] = { campaign: 0, organic: 0, campaignOrders: 0, organicOrders: 0 };
    const s = salesSplitByChannel[o.channel];
    if (isCampaignOrder(o)) { s.campaign += o.total; s.campaignOrders++; }
    else { s.organic += o.total; s.organicOrders++; }
  });

  // ML breakdown: orgânico vs premium + custo de anúncios (apenas mercado BR)
  const mlOrders = valid.filter(o => o.channel === 'mercadolivre');
  const mlBreakdown = {
    organic: mlOrders.filter(o => o.listingType === 'organic' || !o.listingType).reduce((a, o) => a + o.total, 0),
    premium: mlOrders.filter(o => o.listingType === 'premium').reduce((a, o) => a + o.total, 0),
    adCost: 0,
    adClicks: 0,
    roas: 0,
  };
  if (market === 'br') {
    // Soma dia a dia dentro do período selecionado (kv.mlAdCostsDaily) — mesmo padrão já usado
    // pro gasto do Meta Ads logo acima (metaDaily). Antes usava um valor único preso na janela
    // fixa de 60 dias do sync automático (kv.mlAdCosts, removido): o ROAS/ACOS ficava sempre com
    // o mesmo gasto não importa o período escolhido na tela. Ver CLAUDE.md backlog "Mercado Ads".
    const mlRange = sumDailyRange(getMlAdCostsDaily(), since, until);
    mlBreakdown.adCost = mlRange.spend;
    mlBreakdown.adClicks = mlRange.clicks;
    mlBreakdown.roas = mlBreakdown.adCost > 0
      ? (mlBreakdown.organic + mlBreakdown.premium) / mlBreakdown.adCost
      : 0;
  }

  // ── Insights (card da Visão geral) ──
  // Dois retratos do MESMO formato, período atual e anterior, montados com as mesmas funções
  // (productRevenueRows/revenueByState) pra comparação não mentir. As regras em si moram em
  // insights.js, que é puro e não sabe nada de store — ver o cabeçalho de lá.
  // Custo: uma agregação extra de produto/estado sobre pedidos que já estavam em memória
  // (prevValid já era buscado pros deltas dos indicadores). Nenhuma chamada de API externa —
  // o /api/dashboard continua sem falar com Shopify/Meta/Amazon na hora de responder.
  const retrato = (orders, states, prods, sessions, conv, ad, r) => ({
    revenue: sum(orders, o => orderRevenue(o, amazonRevenueMode)),
    orders: orders.length,
    aov: orders.length ? sum(orders, o => orderRevenue(o, amazonRevenueMode)) / orders.length : 0,
    byChannel: orders.reduce((acc, o) => { acc[o.channel] = (acc[o.channel] || 0) + orderRevenue(o, amazonRevenueMode); return acc; }, {}),
    byState: states,
    products: prods,
    sessions, conversion: conv, adCost: ad, roas: r,
  });
  const insights = buildInsights({
    cur: {
      ...retrato(valid, byState, allProducts, sess.sessions, sess.conv, adCost, roas),
      funnel: { sessions: sess.sessions, cart: sess.cart, checkout: sess.checkout, completed: sess.completed },
    },
    prev: retrato(
      prevValid,
      revenueByState(prevValid, market),
      productRevenueRows(prevValid, market, productGroupsMkt, catalogTagsIdx),
      prevSess.sessions, prevSess.conv, prevAdCost, prevRoas,
    ),
    market,
    channel,
    channelLabels: CH_LABEL,
    stateNames: market === 'us' ? US_STATE_NAMES : BR_STATE_NAMES,
  });

  return {
    period: { since, until, span, grain },
    // Onde o histórico deste mercado começa. O sync guarda uma janela móvel, não a loja
    // inteira, então um período anterior a isso vem legitimamente zerado — e a tela precisa
    // desse dado pra explicar o zero em vez de deixar parecendo defeito.
    historyStart: getOldestOrderDate(market),
    channel, metric, market,
    insights,
    kpis: {
      revenue, revenueDelta: delta(revenue, pRev),
      orders: count, ordersDelta: delta(count, pCount),
      aov, aovDelta: delta(aov, pAov),
      adCost, adImpressions, adClicks, roas, metaRevenue,
      conversion: sess.conv, conversionDeltaPP: (sess.conv - prevSess.conv) * 100,
    },
    trend: { labels: trendLabels, data: trendData, total: trendTotal, fmt: trendFmt, byChannel: trendByChannel, metaSpendDaily },
    channelSplit: byChannel,
    salesSplit,
    salesSplitByChannel,
    marketing: mktEntries.map(([name, value]) => ({ name, value })),
    traffic: { sessions: sess.sessions, visitors: sess.visitors, cart: sess.cart, conversion: sess.conv, series: sess.series, seriesCoco: sess.seriesCoco, seriesYucaloo: sess.seriesYucaloo },
    funnel: { sessions: sess.sessions, cart: sess.cart, checkout: sess.checkout, completed: sess.completed },
    topProducts,
    topProductsAll: allProducts,
    segments,
    productGeo,
    byState,
    recentOrders: recent,
    mlBreakdown,
    updatedAt: load().lastSync,
  };
}

// ── Busca geral de pedidos (histórico inteiro do mercado, todo o período) ──
// Usada pelo campo de busca do card "Pedidos Recentes" (index.html) quando há termo digitado.
// Diferente do `recentOrders` do dashboard, que só traz os mais recentes do período/canal: aqui
// varremos TODOS os pedidos do mercado (todos os canais, sem janela de data). Escopo por mercado
// para não misturar BRL/USD. Devolve o mesmo formato normalizado do `recentOrders`.
const CH_LABEL = {
  shopify: 'Shopify - Coco and Luna BR', shopify_us: 'Shopify - Coco and Luna EUA',
  shopee: 'Shopee', mercadolivre: 'Mercado Livre',
  amazon: 'Amazon BR', amazon_us: 'Amazon EUA',
  yucaloo_br: 'Shopify - Yucaloo BR', yucaloo_us: 'Shopify - Yucaloo EUA',
};
// Mesmo vocabulário Bling (Autorizado/Em aberto/Cancelado) do statusTag() em index.html — mantido
// em sincronia pra buscar "em aberto" ou "autorizado" no campo de busca encontrar os pedidos certos.
function statusLabelPt(o) {
  if (o.cancelled) {
    // "Em aberto" (Pending/PendingAvailability etc, ver UNPAID_STATUS_BY_CHANNEL em store.js)
    // não é cancelamento de verdade pela Amazon/canal — só ainda não conta como venda. Rótulo
    // diferente pra não alarmar à toa (mesma distinção do statusTag() no front). Ver 4.7.10.
    const unpaid = UNPAID_STATUS_BY_CHANNEL[o.channel];
    if (unpaid && unpaid.includes(o.status)) return 'Em aberto';
    return 'Cancelado';
  }
  // A Amazon não diz em pedido nenhum que houve devolução: quem marca é o relatório de
  // devoluções da FBA, gravado no campo `refunded` pelo reconcileAmazonReturns (src/sync.js).
  // A Shopify não precisa disso, ela manda o status devolvido no próprio pedido (logo abaixo).
  if (o.refunded === 'total')   return 'Reembolsado';
  if (o.refunded === 'parcial') return 'Reembolso parcial';
  const s = (o.status || '').toUpperCase();
  // Devolvido é um estado próprio: houve pagamento de verdade e ele voltou. Sem isso, um pedido
  // REFUNDED caía no "Em aberto" do fim da função e a tela dizia que o cliente ainda não tinha
  // pagado — o oposto do que aconteceu.
  if (s === 'REFUNDED') return 'Reembolsado';
  if (s === 'PARTIALLY_REFUNDED') return 'Reembolso parcial';
  if (['PAID', 'COMPLETED', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'READY_TO_SHIP'].includes(s)) return 'Autorizado';
  return 'Em aberto';
}
export function searchOrders({ market = 'br', q = '', limit = 200 } = {}) {
  const terms = String(q).trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { market, q, total: 0, results: [], limited: false };
  const all = getOrders({ channel: 'todos', market });
  const matched = [];
  for (const o of all) {
    // Mesmos campos pesquisáveis do front: nº, cliente, status (cru + rótulo pt-BR), canal (id + rótulo), valor.
    const text = [o.name, o.customer, o.status, statusLabelPt(o), o.channel, CH_LABEL[o.channel], o.total]
      .filter(v => v != null && v !== '').join(' ').toLowerCase();
    if (terms.every(t => text.includes(t))) matched.push(o);
  }
  matched.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const total = matched.length;
  const results = matched.slice(0, limit).map(o => ({
    name: o.name, channel: o.channel, customer: o.customer, items: o.items.length, itemsQty: sumItemsQty(o),
    products: productTitles(o), createdAt: o.createdAt, total: o.total, status: o.status, cancelled: o.cancelled,
    refunded: o.refunded || null,
  }));
  return { market, q, total, results, limited: total > limit };
}

// ── Exportação CSV de pedidos: TODOS os pedidos do período/canal/mercado escolhidos, com filtro
// opcional de status (Autorizado/Em aberto/Cancelado). Diferente do `recent` do dashboard (capado
// em RECENT_MAX por segurança de payload do carregamento normal da tela), aqui não há teto — é
// sob demanda, só quando o usuário clica em "Exportar". Usado por GET /api/orders/export.
// Cada botão da fileira de status (index.html, no card de recentes e no modal de exportar) vale
// pelos rótulos listados aqui. "Reembolsado" leva o parcial junto de propósito: na tela os dois
// dividem a mesma classe de tag (`ref` em statusTag), então um botão só filtra os dois. Aceitar
// aqui só o rótulo exato faria o CSV vir MENOR que a tela, sem erro nenhum e sem ninguém ver —
// que é a divergência que scripts/test/status-pedido.test.mjs existe pra impedir.
const EXPORT_STATUS_LABELS = {
  autorizado:  ['Autorizado'],
  em_aberto:   ['Em aberto'],
  cancelado:   ['Cancelado'],
  reembolsado: ['Reembolsado', 'Reembolso parcial'],
};
export function exportOrdersList({ market = 'br', channel = 'todos', since, until, status = 'todos' } = {}) {
  let orders = getOrders({ channel, since, until, market })
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const querido = status && status !== 'todos' ? EXPORT_STATUS_LABELS[status] : null;
  if (querido) orders = orders.filter(o => querido.includes(statusLabelPt(o)));
  return orders.map(o => ({
    name: o.name, channel: o.channel, customer: o.customer,
    itemsCount: o.items.length, itemsQty: sumItemsQty(o),
    createdAt: o.createdAt, total: o.total,
    status: o.status, statusLabel: statusLabelPt(o), cancelled: o.cancelled,
    products: productTitles(o),
  }));
}

// Agrupa itens de uma lista de pedidos por canal → por título de produto (com quebra avulso x
// combo, Shopify Bundles, tipo e imagem). Compartilhado por computeProducts e computeStock —
// mesma regra de agrupamento usada em Top Produtos/Segmentos. Escala a receita dos ITENS ao
// total CAPTURADO do pedido. Os itens da Amazon vêm do relatório com preço BRUTO, e pedidos
// Pending têm total 0 até a captura no envio — sem escalar, a receita por produto soma pedidos
// não capturados a preço cheio e estoura (num dia de US$ 5k capturado, Segmentos/Produtos
// mostravam US$ 17k). O total do pedido (`o.total`) é a fonte de verdade da receita em todo o
// app; na Amazon distribuímos ele entre os itens na proporção do preço deles. Ver CLAUDE.md
// 4.7.6. Outros canais normalmente devolvem fator 1 (item.amount já é a receita líquida do
// produto) — EXCETO quando o pedido não gerou receita nenhuma (`o.total === 0`) mas os itens
// carregam preço de catálogo mesmo assim. Achado testando a exportação de Produtos (Shopify US):
// pedidos com `customer: "Walmart DFW6s"` (fulfillment por atacado — o Shopify só despacha, quem
// cobra é o Walmart) chegam com `status: PAID`/`cancelled: false` e `total: 0`, mas item com
// `qty`/`amount` de catálogo cheio (ex: 72 un. a preço unitário normal). Sem essa guarda, cada
// pedido assim inflava a receita por produto em Top Produtos/Segmentos/Produtos/Estoque sem
// nenhuma venda de fato ter acontecido — mesmo `o.total` (a fonte de verdade em todo o resto do
// app) mostrando 0. Unidades continuam contando todas (mesmo princípio da Amazon acima) — só a
// receita respeita o total realmente cobrado.
function itemRevFactor(o) {
  if (o.channel === 'amazon' || o.channel === 'amazon_us') {
    let itemsSum = 0;
    for (const it of o.items) if (it.title) itemsSum += it.amount || 0;
    return itemsSum > 0 ? (o.total || 0) / itemsSum : 0;
  }
  if ((o.total || 0) === 0 && o.items.some(it => it.title && (it.amount || 0) > 0)) return 0;
  return 1;
}

function aggregateProductsByChannel(orders) {
  const seenBundleIds = new Set();
  const byChannel = {};
  // Amazon não traz imagem nem na Orders API nem no relatório de backfill — só o
  // Catalog Items API por ASIN (job separado, POST /api/amazon/images). `it.asin` só
  // existe em itens Amazon vindos do backfill; nos demais canais fica undefined e o
  // lookup abaixo simplesmente não bate em nada.
  const amazonImages = getAmazonProductImages();
  orders.forEach(o => {
    if (!byChannel[o.channel]) byChannel[o.channel] = { revenue: 0, orders: 0, products: {} };
    const c = byChannel[o.channel];
    c.revenue += o.total;
    c.orders += 1;
    const rf = itemRevFactor(o);
    o.items.forEach(it => {
      // "-" é o placeholder que o relatório da Amazon usa em linhas de frete/serviço/ajuste
      // sem produto de verdade — tratado como ausente, igual título vazio (ver amazon.js
      // ordersFromRows). Pedidos já gravados antes dessa correção ainda têm isso persistido.
      if (!it.title || it.title.trim() === '-') return;
      // Produtos legados (combo de N unidades, "- N Pack" ou "Ng" múltiplo de 120g) vendidos
      // como SKU próprio (não via Shopify Bundles) somem da listagem — a venda é atribuída ao
      // produto-base (título normalizado, ver stripComboSuffix), contando como pacotes de combo
      // do mesmo tamanho (mesma lógica do combo via Bundles). Ver legacyComboSize.
      const taggedSize = legacyComboSize(it);
      const title = canonicalTitle(taggedSize ? stripComboSuffix(it.title) : it.title);

      if (!c.products[title]) c.products[title] = { revenue: 0, avulsoQty: 0, comboQty: 0, comboBySize: {}, type: null, image: null, tags: [] };
      const p = c.products[title], qty = it.qty || 0;
      p.revenue += (it.amount || 0) * rf;
      if (!p.type) p.type = classifyType(it);
      if (!p.image && it.image) p.image = it.image;
      if (!p.image && it.asin && amazonImages[it.asin]) p.image = amazonImages[it.asin];
      // Tags do item — usadas pelo Unificador ("Ocultar produtos", ver isHiddenItem) pra saber se
      // esse produto (mesmo já vendido) deve sumir do catálogo normal. União entre pedidos (mesmo
      // título pode aparecer com tags levemente diferentes entre canais/tempos).
      if (it.tags && it.tags.length) p.tags = Array.from(new Set([...(p.tags || []), ...it.tags]));

      if (taggedSize) {
        const packages = qty; // aqui o item É o produto-combo: qty = nº de pacotes comprados
        p.comboQty += packages * taggedSize;
        p.comboBySize[taggedSize] = (p.comboBySize[taggedSize] || 0) + packages;
      } else if (it.bundle) {
        p.comboQty += qty; // aqui qty = unidades de componente (Shopify já quebrou o combo)
        const size = comboSize(it.bundle);
        if (size && !seenBundleIds.has(it.bundle.id)) {
          seenBundleIds.add(it.bundle.id);
          p.comboBySize[size] = (p.comboBySize[size] || 0) + (it.bundle.qty || 1);
        }
      } else {
        p.avulsoQty += qty;
      }
    });
  });
  return byChannel;
}

// Junta linhas de produto (já com custo/lucro calculados) do mesmo grupo manual, DENTRO do mesmo
// canal — a tela de Produtos é um card por canal, então o merge aqui é intra-canal (títulos
// diferentes do mesmo canal que descrevem o mesmo produto físico). qty/receita/lucro são somados
// (lucro só quando pelo menos um membro tem COG preenchido, mesmo critério do total do canal);
// COG/frete/%impostos/%comissão viram null na linha unificada — são valores POR PRODUTO, não faz
// sentido somar/mostrar um só quando os membros podem ter overrides diferentes; a tela desabilita
// a edição inline nessas linhas (ver public/produtos.html), edição continua por produto individual.
function mergeProductRows(products, groups, groupTypeIdx = {}) {
  if (!groups || !Object.keys(groups).length) return products;
  const byTitle = new Map(products.map(p => [p.title, p]));
  const used = new Set();
  const merged = [];
  for (const [name, members] of Object.entries(groups)) {
    const found = members.map(t => byTitle.get(t)).filter(Boolean);
    if (!found.length) continue;
    found.forEach(p => used.add(p.title));
    const qty = found.reduce((a, p) => a + p.qty, 0);
    const revenue = found.reduce((a, p) => a + p.revenue, 0);
    const avulsoQty = found.reduce((a, p) => a + p.avulsoQty, 0);
    const comboQty = found.reduce((a, p) => a + p.comboQty, 0);
    const comboBySize = {};
    found.forEach(p => { for (const [s, n] of Object.entries(p.comboBySize || {})) comboBySize[s] = (comboBySize[s] || 0) + n; });
    const image = found.map(p => p.image).find(Boolean) || null;
    // Tag mãe do grupo primeiro (ver resolveGroupTypes); só cai no tipo dos membros do período
    // quando o grupo não resolveu nada — mesma precedência usada em Segmentos.
    const type = groupTypeIdx[name]?.type || found.map(p => p.type).find(Boolean) || null;
    const withProfit = found.filter(p => p.profit != null);
    const profit = withProfit.length ? withProfit.reduce((a, p) => a + p.profit, 0) : null;
    const taxAmount = found.reduce((a, p) => a + (p.taxAmount || 0), 0);
    const commissionAmount = found.reduce((a, p) => a + (p.commissionAmount || 0), 0);
    merged.push({
      title: name, qty, revenue, avgTicket: qty > 0 ? revenue / qty : 0,
      avulsoQty, comboQty, comboBySize, type, image,
      cog: null, shipping: null, taxPct: null, commissionPct: null,
      taxAmount, commissionAmount, cogTotal: null, shippingTotal: null,
      profit, profitPct: (profit != null && revenue > 0) ? profit / revenue : null,
      _grouped: true, _members: found.map(p => p.title),
    });
  }
  const passthrough = products.filter(p => !used.has(p.title));
  return [...merged, ...passthrough].sort((a, b) => b.revenue - a.revenue);
}

// Catálogo completo de produtos por canal (para a tela de Produtos) — sem limite de top-N,
// com a mesma quebra avulso x combo (Shopify Bundles) usada no Top Produtos/Segmentos.
export function computeProducts({ market = 'br', since, until } = {}) {
  const orders = getOrders({ channel: 'todos', since, until, market }).filter(o => !isCancelled(o));
  const byChannel = aggregateProductsByChannel(orders);

  // Catálogo (todos os pedidos, sem filtro de período) — é uma tela de catálogo, então um produto
  // do marketplace continua listado mesmo sem venda no período escolhido (qty/receita ficam 0).
  const allOrders = getOrders({ channel: 'todos', market }).filter(o => !isCancelled(o));
  const catalogByChannel = mergeShopifyCatalog(aggregateProductsByChannel(allOrders), market);

  const finance = getProductFinance();
  const productGroupsMkt = activeProductGroups(market); // Unificador (Configurações)
  const groupTypeIdx = resolveGroupTypes(market, productGroupsMkt);
  const catalogTagsIdx = shopifyCatalogTagsByChannel(market);
  const channels = {};
  const chKeys = new Set([...Object.keys(byChannel), ...Object.keys(catalogByChannel)]);
  for (const ch of chKeys) {
    const c = byChannel[ch] || { revenue: 0, orders: 0, products: {} };
    const catalogProducts = catalogByChannel[ch]?.products || {};
    // produto oculto (Unificador) some do catálogo completo, não só do período — ver nota em
    // allProducts acima. isHiddenProduct prioriza a tag atual do catálogo Shopify.
    const titles = [...new Set([...Object.keys(c.products), ...Object.keys(catalogProducts)])]
      .filter(title => !isHiddenProduct(ch, title, c.products[title]?.tags, catalogTagsIdx, market));
    const empty = { revenue: 0, avulsoQty: 0, comboQty: 0, comboBySize: {}, type: null, image: null };
    let products = [...titles]
      .map(title => {
        const cat = catalogProducts[title];
        const p = c.products[title] || { ...empty, type: cat?.type ?? null, image: cat?.image ?? null };
        if (!p.type && cat?.type) p.type = cat.type;
        if (!p.image && cat?.image) p.image = cat.image;
        const qty = p.avulsoQty + p.comboQty;
        const revenue = p.revenue;
        const ov = finance[`${ch}|||${title}`] || {};
        const cog           = ov.cog != null ? Number(ov.cog) : defaultCog(title);
        const shipping      = ov.shipping != null ? Number(ov.shipping) : 0;
        const taxPct        = ov.taxPct != null ? Number(ov.taxPct) : TAX_PCT_DEFAULT;
        const commissionPct = ov.commissionPct != null ? Number(ov.commissionPct) : (DEFAULT_COMMISSION_PCT[ch] ?? 0);
        const taxAmount        = taxPct != null ? revenue * taxPct / 100 : 0;
        const commissionAmount = commissionPct != null ? revenue * commissionPct / 100 : 0;
        const cogTotal      = cog != null ? cog * qty : null;
        const shippingTotal = shipping * qty;
        const profit   = cog != null ? revenue - cogTotal - taxAmount - commissionAmount - shippingTotal : null;
        return {
          title, qty, revenue,
          avgTicket: qty > 0 ? revenue / qty : 0,
          avulsoQty: p.avulsoQty, comboQty: p.comboQty, comboBySize: p.comboBySize,
          type: p.type, image: p.image,
          cog, shipping, taxPct, commissionPct,
          taxAmount, commissionAmount, cogTotal, shippingTotal, profit,
          profitPct: (profit != null && revenue > 0) ? profit / revenue : null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
    products = mergeProductRows(products, productGroupsMkt, groupTypeIdx);

    const withProfit = products.filter(p => p.profit != null);
    const totalProfit = withProfit.reduce((a, p) => a + p.profit, 0);
    const totalProfitRevenue = withProfit.reduce((a, p) => a + p.revenue, 0);
    channels[ch] = {
      revenue: c.revenue, orders: c.orders, products,
      totalProfit: withProfit.length ? totalProfit : null,
      profitPct: (withProfit.length && totalProfitRevenue > 0) ? totalProfit / totalProfitRevenue : null,
      profitProductsCount: withProfit.length,
    };
  }
  return { market, since, until, channels, updatedAt: load().lastSync };
}

// Estoque + produção por canal (para a tela de Estoque) — período escolhido na tela (seletor igual
// ao de Produtos, ver public/estoque.html); sem since/until explícitos, cai nos últimos 30 dias
// corridos (mesmo padrão de sempre). Combina dado real (venda) com dado manual (estoque físico, a
// caminho, pedido ao laboratório). windowDays vem do período de verdade (daySpan), não mais fixo
// em 30 — usado pra converter vendas do período em vendas/dia (salesDaily).
const STOCK_WINDOW_DAYS = 30;

// Sugestão de reposição a partir do Tempo de Estoque com Produção (totalMonthsOfStock). Limites
// definidos pela empresa: <3 meses = urgente, 3–7 = atenção, >=7 = aguardar.
function stockSuggestion(months) {
  if (months == null) return null;
  if (months < 3) return 'urgente';
  if (months < 7) return 'atencao';
  return 'aguardar';
}

export function computeStock({ market = 'br', since, until } = {}) {
  if (!until) until = isoUTC(new Date());
  if (!since) since = isoUTC(addDays(parseISO(until), -(STOCK_WINDOW_DAYS - 1)));
  const windowDays = daySpan(since, until);
  const orders = getOrders({ channel: 'todos', since, until, market }).filter(o => !isCancelled(o));
  const byChannel = aggregateProductsByChannel(orders);

  // Catálogo completo (todo o histórico do canal, sem filtro de data) — mesmo critério de
  // computeProducts (ver 4.13): um produto que não vendeu nos últimos 30 dias continua listado,
  // só com vendas zeradas, em vez de sumir da tela. Sem isso, um produto que para de vender por
  // mais de 30 dias sumia do Estoque e o estoque/recebendo cadastrado manualmente pra ele ficava
  // inacessível pela UI (o dado continuava salvo em kv.productStock, só não tinha como editar).
  const allOrders = getOrders({ channel: 'todos', market }).filter(o => !isCancelled(o));
  const catalogByChannel = mergeShopifyCatalog(aggregateProductsByChannel(allOrders), market);

  // Amazon (BR/US) não traz título de item nos pedidos hoje (ver backlog item 6 do CLAUDE.md) —
  // sem isso a tabela ficaria vazia, então entra um produto placeholder editável manualmente
  // até a busca de itens da Amazon ser resolvida à parte (evitar mexer nisso agora por causa do
  // histórico de 429 da SP-API). Checado contra o CATÁLOGO completo, não só a janela de 30 dias —
  // senão o placeholder reapareceria toda vez que o canal não vende nada num mês.
  const amazonCh = market === 'us' ? 'amazon_us' : 'amazon';
  if (!catalogByChannel[amazonCh]) catalogByChannel[amazonCh] = { revenue: 0, orders: 0, products: {} };
  if (Object.keys(catalogByChannel[amazonCh].products).length === 0) {
    catalogByChannel[amazonCh].products['Produto TESTE'] = { revenue: 0, avulsoQty: 0, comboQty: 0, comboBySize: {}, type: null, image: null };
  }

  const stockData = getProductStock();
  const channels = {};
  const empty = { revenue: 0, avulsoQty: 0, comboQty: 0, comboBySize: {}, type: null, image: null };
  const chKeys = new Set([...Object.keys(byChannel), ...Object.keys(catalogByChannel)]);
  const aggMap = {};

  // Unificador (Configurações) — grupo manual tem prioridade sobre a família automática
  // (Lysine/Daily por palavra-chave, ver classifyFamily); título fora de qualquer grupo continua
  // caindo na família automática ou, sem uma reconhecida, na própria linha (mesmo comportamento
  // de sempre). titleToGroup é o inverso de productGroupsMkt: título → nome do grupo.
  const productGroupsMkt = activeProductGroups(market);
  const groupTypeIdx = resolveGroupTypes(market, productGroupsMkt);
  const titleToGroup = {};
  for (const [name, members] of Object.entries(productGroupsMkt)) for (const m of members) titleToGroup[m] = name;
  const catalogTagsIdx = shopifyCatalogTagsByChannel(market);

  for (const ch of chKeys) {
    const c = byChannel[ch] || { revenue: 0, orders: 0, products: {} };
    const catalogProducts = catalogByChannel[ch]?.products || {};
    // produto oculto (Unificador) some do Estoque também — mesmo critério de computeProducts.
    // isHiddenProduct prioriza a tag atual do catálogo Shopify.
    const titles = [...new Set([...Object.keys(c.products), ...Object.keys(catalogProducts)])]
      .filter(title => !isHiddenProduct(ch, title, c.products[title]?.tags, catalogTagsIdx, market));
    let products = [...titles]
      .map(title => {
        const cat = catalogProducts[title];
        const p = c.products[title] || { ...empty, type: cat?.type ?? null, image: cat?.image ?? null };
        if (!p.type && cat?.type) p.type = cat.type;
        if (!p.image && cat?.image) p.image = cat.image;
        const salesMonth = p.avulsoQty + p.comboQty;
        const salesDaily = salesMonth / windowDays;
        const ov = stockData[`${ch}|||${title}`] || {};
        const stock    = ov.stock != null ? Number(ov.stock) : 0;
        const incoming = ov.incoming != null ? Number(ov.incoming) : 0;
        return {
          title, type: p.type, image: p.image,
          avulsoQty: p.avulsoQty, comboQty: p.comboQty, comboBySize: p.comboBySize,
          salesDaily, salesMonth, stock, incoming,
        };
      });
    // Grupo manual do Unificador (Configurações) DENTRO do canal — mesmo mecanismo já usado em
    // Produtos (mergeProductRows), que faltava aqui: cada card de canal em Estoque mostrava um
    // título por SKU/listagem, mesmo quando o Unificador já tinha um grupo juntando duplicatas do
    // mesmo produto físico (comum em Amazon/Shopee, onde o mesmo produto aparece com título
    // ligeiramente diferente por listagem). Só o "Panorama geral" (cross-canal) respeitava o grupo;
    // o card por canal, não (reportado em produção). monthsOfStock é recalculado depois do merge
    // porque é uma razão, não soma diretamente.
    products = applyGroupTypes(applyProductGroups(products, productGroupsMkt, {
      sumKeys: ['avulsoQty', 'comboQty', 'salesDaily', 'salesMonth', 'stock', 'incoming'],
      objSumKeys: ['comboBySize'],
      pickFirst: ['type', 'image'],
    }), groupTypeIdx, ['type'])
      .map(p => ({ ...p, monthsOfStock: p.salesMonth > 0 ? (p.stock + p.incoming) / p.salesMonth : null }))
      .sort((a, b) => b.salesMonth - a.salesMonth);

    const totals = products.reduce((a, p) => ({
      salesDaily: a.salesDaily + p.salesDaily,
      salesMonth: a.salesMonth + p.salesMonth,
      stock: a.stock + p.stock,
      incoming: a.incoming + p.incoming,
    }), { salesDaily: 0, salesMonth: 0, stock: 0, incoming: 0 });
    totals.monthsOfStock = totals.salesMonth > 0 ? (totals.stock + totals.incoming) / totals.salesMonth : null;

    channels[ch] = { products, totals };

    // Panorama geral do produto (soma de todos os canais do mercado) — agrupado por família física
    // do produto (ex: BR = Lysine/Daily), já que o pedido de reposição ao laboratório não é por
    // canal (o mesmo lote de produção abastece todos eles). Reaproveita a mesma lista `products`
    // já mesclada com o catálogo acima, pra não duplicar a lógica de merge catálogo x período.
    for (const p of products) {
      if (p.title === 'Produto TESTE') continue; // placeholder sintético da Amazon, não é produto real
      const family = titleToGroup[p.title] || classifyFamily(p.title) || p.title;
      if (!aggMap[family]) aggMap[family] = { avulsoQty: 0, comboQty: 0, comboBySize: {}, type: null, image: null, stock: 0, incoming: 0 };
      const a = aggMap[family];
      a.avulsoQty += p.avulsoQty;
      a.comboQty += p.comboQty;
      for (const [size, n] of Object.entries(p.comboBySize || {})) a.comboBySize[size] = (a.comboBySize[size] || 0) + n;
      if (!a.type) a.type = p.type;
      if (!a.image && p.image) a.image = p.image;
      a.stock += p.stock;
      a.incoming += p.incoming;
    }
  }

  const stockAggData = getProductStockAgg();
  const aggProducts = Object.entries(aggMap).map(([family, a]) => {
    const salesMonth = a.avulsoQty + a.comboQty;
    const salesDaily = salesMonth / windowDays;
    const ov = stockAggData[`${market}|||${family}`] || {};
    const orderInProgress = ov.orderInProgress != null ? Number(ov.orderInProgress) : 0;
    const orderNew        = ov.orderNew != null ? Number(ov.orderNew) : 0;
    const projected       = ov.projected != null ? Number(ov.projected) : 0;
    const monthsOfStock = salesMonth > 0 ? (a.stock + a.incoming) / salesMonth : null;
    const totalMonthsOfStock = salesMonth > 0 ? (a.stock + projected + orderNew + orderInProgress) / salesMonth : null;
    // `family` só é um grupo manual (badge 🔗 na tela) quando bate com um nome real do Unificador —
    // a família automática (Lysine/Daily por palavra-chave) nunca foi marcada como "agrupada".
    const isManualGroup = Object.prototype.hasOwnProperty.call(productGroupsMkt, family);
    return {
      title: family, type: a.type, image: a.image,
      avulsoQty: a.avulsoQty, comboQty: a.comboQty, comboBySize: a.comboBySize,
      salesDaily, salesMonth, stock: a.stock, incoming: a.incoming,
      orderInProgress, orderNew, projected,
      monthsOfStock, totalMonthsOfStock, suggestion: stockSuggestion(totalMonthsOfStock),
      ...(isManualGroup ? { _grouped: true, _members: productGroupsMkt[family] } : {}),
    };
  }).sort((a, b) => b.salesMonth - a.salesMonth);

  const aggTotals = aggProducts.reduce((acc, p) => ({
    salesDaily: acc.salesDaily + p.salesDaily,
    salesMonth: acc.salesMonth + p.salesMonth,
    stock: acc.stock + p.stock,
    incoming: acc.incoming + p.incoming,
    orderInProgress: acc.orderInProgress + p.orderInProgress,
    orderNew: acc.orderNew + p.orderNew,
    projected: acc.projected + p.projected,
  }), { salesDaily: 0, salesMonth: 0, stock: 0, incoming: 0, orderInProgress: 0, orderNew: 0, projected: 0 });
  aggTotals.monthsOfStock = aggTotals.salesMonth > 0 ? (aggTotals.stock + aggTotals.incoming) / aggTotals.salesMonth : null;
  aggTotals.totalMonthsOfStock = aggTotals.salesMonth > 0
    ? (aggTotals.stock + aggTotals.projected + aggTotals.orderNew + aggTotals.orderInProgress) / aggTotals.salesMonth
    : null;
  aggTotals.suggestion = stockSuggestion(aggTotals.totalMonthsOfStock);

  // Ordem Projetada/Nova/Andamento de cada grupo "Unificar" (agrupamento manual entre famílias,
  // ver public/estoque.html) — o nome do grupo funciona como uma família própria pra esses 3 campos,
  // igual Lysine/Daily; NÃO é a soma dos membros (editar a soma seria ambíguo, cada membro é um
  // produto real diferente). Assim a linha unificada fica editável direto, com round-trip estável:
  // o cliente grava em `market|||NomeDoGrupo` (mesmo POST /api/stock/agg-finance de sempre) e lê
  // esses valores de volta daqui, independente do nome do grupo bater ou não com uma família real.
  const groupNames = Object.keys(productGroupsMkt);
  const groupOrders = {};
  for (const name of groupNames) {
    const ov = stockAggData[`${market}|||${name}`] || {};
    groupOrders[name] = {
      orderInProgress: ov.orderInProgress != null ? Number(ov.orderInProgress) : 0,
      orderNew:        ov.orderNew != null ? Number(ov.orderNew) : 0,
      projected:       ov.projected != null ? Number(ov.projected) : 0,
    };
  }

  return { market, windowDays, since, until, channels, agg: { products: aggProducts, totals: aggTotals, groupOrders }, updatedAt: load().lastSync };
}
