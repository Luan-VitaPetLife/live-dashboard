// ─────────────────────────────────────────────
//  metrics.js — calcula o payload da dashboard a
//  partir dos pedidos e sessões guardados no store.
//  Receita SEMPRE exclui pedidos cancelados.
// ─────────────────────────────────────────────
import { getOrders, getSessionsDaily, getMetaInsightsDaily, getMetaUSInsightsDaily, getMlAdCosts, getProductFinance, getProductStock, getProductStockAgg, getAmazonProductImages, load } from './store.js';
import { normalizeUsState, isUsRegionCode } from './us-states.js';

const OFFSET = Number(process.env.STORE_OFFSET_MINUTES || -180);

// ── datas ──
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function isoUTC(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function daySpan(s, u) { return Math.round((parseISO(u) - parseISO(s)) / 86400000) + 1; }

function localParts(iso) {
  const l = new Date(Date.parse(iso) + OFFSET * 60000);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate(), h: l.getUTCHours() };
}
function bucketKey(iso, grain) {
  const p = localParts(iso);
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
  // (bug reportado 16/07/2026, Segmentos). "Pó" (BR) e "Powder" (US) continuam distintos de
  // propósito (grafias por mercado, nunca aparecem juntas no mesmo cálculo — sempre filtrado por
  // market); productType sem palavra-chave reconhecida mantém o valor cru (ex: "Pó").
  const raw = item.productType || item.title || '';
  const t = raw.toLowerCase();
  for (const [type, kws] of Object.entries(TYPE_KW)) {
    if (kws.some(k => t.includes(k))) return type;
  }
  return item.productType || null;
}

function aggregateSessions(since, until, market = 'br') {
  const daily = getSessionsDaily(market);
  let s = 0, v = 0, c = 0, ck = 0, cp = 0;
  let d = parseISO(since); const end = parseISO(until);
  const series = [];
  while (d <= end) {
    const k = isoUTC(d); const r = daily[k];
    const row = r || { sessions: 0, visitors: 0, cart: 0, checkout: 0, completed: 0 };
    s += row.sessions; v += row.visitors; c += row.cart; ck += row.checkout; cp += row.completed;
    const [yy, mm, dd] = k.split('-');
    series.push({ label: `${dd}/${mm}`, sessions: row.sessions, conv: row.sessions ? row.completed / row.sessions : 0 });
    d = addDays(d, 1);
  }
  return { sessions: s, visitors: v, cart: c, checkout: ck, completed: cp, conv: s ? cp / s : 0, series };
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

// Alias de título pra produto com nome cadastrado incompleto no Shopify (confirmado por Luan em
// 08/07/2026): o avulso "SAMe LO" e o combo "SAMe LO 225 - 3 Pack" são o mesmo produto — o nome
// completo e correto é "SAMe LO 225". Mapeamento pontual (não fundir por aproximação de nome:
// produtos com o mesmo nome-base podem ser tipos diferentes, ex: Hip & Joint em pó/tablet/soft chews).
const TITLE_ALIASES = { 'same lo': 'SAMe LO 225' };
function canonicalTitle(title) {
  const key = (title || '').trim().toLowerCase();
  return TITLE_ALIASES[key] || title;
}

// Alíquota efetiva de Simples Nacional (DAS sobre o faturamento) — informada pelo Luan em 02/07/2026.
// É um valor único da empresa (não varia por produto); editável por linha se um produto tiver regra diferente.
const TAX_PCT_DEFAULT = 2.64;

// COG (custo do produto) de referência por linha de produto — informado pelo Luan em 02/07/2026.
// Vale para o SKU principal citado; variações de tamanho/combo herdam o mesmo valor até serem ajustadas
// manualmente (o custo real por grama pode diferir). Sem correspondência conhecida, fica null (editável).
// Família do produto físico (independe de canal/tamanho/combo) — usada tanto pro COG de
// referência quanto pro panorama agregado de Estoque (ver computeStock/agg).
function classifyFamily(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('daily')) return 'Daily';
  // A fórmula "Daily" é multivitamínico (taurina + espirulina + L-lisina) — no Mercado Livre e na
  // Shopee o título descreve os ingredientes em vez de usar o nome "Daily" (ex: "Suplemento Para
  // Gatos Com Taurina, Espirulina E L-Lisina") e por isso também contém "lisina" — a checagem de
  // taurina/espirulina precisa vir ANTES da de lisina/lysine pura, senão cai errado em "Lysine"
  // (bug real, confirmado 07/07/2026: 20 unidades de ML/Shopee ficavam fora do total de "Daily").
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

export function computeDashboard({ channel = 'todos', since, until, metric = 'receita', market = 'br' }) {
  const span = daySpan(since, until);
  const grain = span <= 2 ? 'hour' : 'day';

  // período anterior comparável
  const prevUntil = isoUTC(addDays(parseISO(since), -1));
  const prevSince = isoUTC(addDays(parseISO(since), -span));

  const curAll = getOrders({ channel, since, until, market });
  const prevAll = getOrders({ channel, since: prevSince, until: prevUntil, market });
  const valid = curAll.filter(o => !isCancelled(o));
  const prevValid = prevAll.filter(o => !isCancelled(o));

  const revenue = sum(valid, o => o.total), count = valid.length, aov = count ? revenue / count : 0;
  const pRev = sum(prevValid, o => o.total), pCount = prevValid.length, pAov = pCount ? pRev / pCount : 0;
  const delta = (cur, prev) => (prev === 0 ? null : ((cur - prev) / prev) * 100);

  // tendência
  const buckets = buildBuckets(since, until, grain);
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  // Sessões via ShopifyQL: BR (channel shopify/todos) e US (channel shopify_us/todos).
  const hasSessionData =
    (market === 'br' && (channel === 'todos' || channel === 'shopify')) ||
    (market === 'us' && (channel === 'todos' || channel === 'shopify_us'));
  const emptySess = { sessions: 0, visitors: 0, cart: 0, checkout: 0, completed: 0, conv: 0, series: buckets.map(b => ({ label: b.label, sessions: 0, conv: 0 })) };
  const sess = hasSessionData ? aggregateSessions(since, until, market) : emptySess;
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
      const i = idx.get(bucketKey(o.createdAt, grain));
      if (i != null) {
        const v = metric === 'pedidos' ? 1 : o.total;
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
  getOrders({ channel: 'todos', since, until, market }).filter(o => !isCancelled(o)).forEach(o => { byChannel[o.channel] = (byChannel[o.channel] || 0) + o.total; });

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
  const productsByChannel = aggregateProductsByChannel(valid);
  const allProducts = Object.entries(productsByChannel)
    .flatMap(([ch, c]) => Object.entries(c.products).map(([title, p]) => ({
      title, channel: ch, revenue: p.revenue, avulsoQty: p.avulsoQty, comboQty: p.comboQty, comboBySize: p.comboBySize,
    })))
    .filter(p => p.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);
  const topProducts = allProducts.slice(0, 5);

  // por estado (endereço de entrega dos pedidos válidos)
  // US: normaliza a grafia do estado ("California"/"CALIFORNIA"/"CA."/"N.Y." → "CA"/"NY"),
  // senão cada variante da Amazon vira uma linha no ranking e o mapa subconta. Ver 4.10/4.7.5.
  // Endereços que não são região dos EUA (províncias do Canadá, etc.) são agrupados num
  // único bucket 'INTL' — não poluem o ranking com cada país, mas não perdem receita.
  const byState = {};
  valid.forEach(o => {
    let s = o.state;
    if (market === 'us') { s = normalizeUsState(s); if (s && !isUsRegionCode(s)) s = 'INTL'; }
    if (s && o.total > 0) {
      if (!byState[s]) byState[s] = { revenue: 0, orders: 0, byChannel: {} };
      byState[s].revenue += o.total;
      byState[s].orders += 1;
      byState[s].byChannel[o.channel] = (byState[s].byChannel[o.channel] || 0) + o.total;
    }
  });

  // segmentos por espécie (gato vs cão) + tipo de produto
  // productGeoAcc: mesma passada, agrupa por título de produto (não por segmento) para saber
  // ONDE (estado) e por qual CANAL cada produto vendeu — ver card "Onde os produtos vendem" em Segmentos.
  const segAcc = {};
  const productGeoAcc = {};
  const seenBundleIdsSeg = new Set();
  const geoAmazonImages = getAmazonProductImages(); // Shopify/Shopee/ML trazem it.image direto; Amazon só via cache de ASIN (ver 4.13)
  valid.forEach(o => {
    const rf = amazonRevFactor(o); // escala receita ao total capturado (Amazon); ver 4.7.6
    // mesma normalização de estado usada em byState (ver acima): reduz grafias da Amazon e agrupa
    // endereços fora dos EUA em 'INTL' quando market==='us'.
    let geoState = o.state;
    if (market === 'us') { geoState = normalizeUsState(geoState); if (geoState && !isUsRegionCode(geoState)) geoState = 'INTL'; }
    o.items.forEach(it => {
      if (!it.title || it.title.trim() === '-') return; // placeholder de frete/serviço da Amazon, ver amazon.js ordersFromRows
      const seg  = classifySeg(it);
      const type = classifyType(it);
      const amount = (it.amount || 0) * rf;
      // Mesma normalização de combo legado usada em aggregateProductsByChannel (ver 4.13.1): um
      // item "3 Pack"/"Combo de N unidades" vendido como SKU próprio (não Shopify Bundles) conta
      // N unidades do produto-base, não 1 — e a venda entra na linha do produto-base, não numa
      // linha própria minúscula ("3 Pack" reportado 16/07/2026 — 16 pacotes viravam "16 un" de um
      // tipo/produto separado em vez de 48 un de Tablets).
      const taggedSize = legacyComboSize(it);
      const title = canonicalTitle(taggedSize ? stripComboSuffix(it.title) : it.title);
      const rawQty = it.qty || 1;
      const qty = taggedSize ? rawQty * taggedSize : rawQty;
      if (!segAcc[seg]) segAcc[seg] = { revenue: 0, units: 0, orderIds: new Set(), products: {}, byType: {} };
      segAcc[seg].revenue += amount;
      segAcc[seg].units  += qty;
      segAcc[seg].orderIds.add(o.id);
      if (type) segAcc[seg].byType[type] = (segAcc[seg].byType[type] || 0) + qty;
      const p = segAcc[seg].products;
      if (!p[title]) p[title] = { qty: 0, revenue: 0, avulsoQty: 0, comboQty: 0, comboBySize: {} };
      p[title].qty     += qty;
      p[title].revenue += amount;
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

      // geografia + canal por produto
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
    });
  });
  const productGeo = Object.entries(productGeoAcc)
    .map(([title, g]) => ({
      title, seg: g.seg, qty: g.qty, revenue: g.revenue, image: g.image,
      byChannel: Object.entries(g.byChannel).map(([channel, c]) => ({ channel, qty: c.qty, revenue: c.revenue })).sort((a, b) => b.qty - a.qty),
      byState: Object.entries(g.byState).map(([state, s]) => ({ state, qty: s.qty, revenue: s.revenue, orders: s.orderIds.size })).sort((a, b) => b.qty - a.qty),
    }))
    .sort((a, b) => b.qty - a.qty);
  const totalSegUnits = Object.values(segAcc).reduce((a, s) => a + s.units, 0);
  const segments = {};
  for (const [k, v] of Object.entries(segAcc)) {
    segments[k] = {
      revenue: v.revenue,
      units:   v.units,
      orders:  v.orderIds.size,
      pct:     totalSegUnits > 0 ? v.units / totalSegUnits : 0,
      byType:  v.byType,
      // Lista completa ordenada por unidades — a tela mostra 5 e expande com "ver mais".
      topProducts: Object.entries(v.products)
        .sort((a, b) => b[1].qty - a[1].qty)
        .map(([title, d]) => ({ title, qty: d.qty, revenue: d.revenue, avulsoQty: d.avulsoQty, comboQty: d.comboQty, comboBySize: d.comboBySize })),
    };
  }

  // pedidos recentes — respeita o PERÍODO e o CANAL selecionados (antes ignorava a janela
  // e mostrava os últimos 100 de qualquer data, então "Hoje" trazia pedido de meses atrás).
  // O card pagina no front (10 por página), então devolvemos todos os do período; o teto
  // RECENT_MAX é só uma trava de segurança de payload para o amazon_us (~1000 pedidos/dia).
  const recent = getOrders({ channel, since, until, market })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, RECENT_MAX)
    .map(o => ({ name: o.name, channel: o.channel, customer: o.customer, items: o.items.length, createdAt: o.createdAt, total: o.total, status: o.status, cancelled: o.cancelled }));

  // conversão anterior
  const prevSess = hasSessionData ? aggregateSessions(prevSince, prevUntil, market) : emptySess;

  // Meta Ads — gasto e ROAS no período (separado por mercado)
  const metaDaily = market === 'us' ? getMetaUSInsightsDaily() : getMetaInsightsDaily();
  let adCost = 0, adImpressions = 0, adClicks = 0;
  { let d = parseISO(since); const end = parseISO(until);
    while (d <= end) { const k = isoUTC(d); const m = metaDaily[k]; if (m) { adCost += m.spend; adImpressions += m.impressions; adClicks += m.clicks; } d = addDays(d, 1); }
  }
  const metaRevenue = valid.filter(o => metaSources.has(normSource(o.source))).reduce((a, o) => a + o.total, 0);
  const roas = adCost > 0 ? metaRevenue / adCost : 0;

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
    const mlAds = getMlAdCosts();
    if (mlAds && mlAds.spend) {
      mlBreakdown.adCost = mlAds.spend;
      mlBreakdown.adClicks = mlAds.clicks || 0;
    }
    mlBreakdown.roas = mlBreakdown.adCost > 0
      ? (mlBreakdown.organic + mlBreakdown.premium) / mlBreakdown.adCost
      : 0;
  }

  return {
    period: { since, until, span, grain },
    channel, metric, market,
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
    traffic: { sessions: sess.sessions, visitors: sess.visitors, cart: sess.cart, conversion: sess.conv, series: sess.series },
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
const CH_LABEL = { shopify: 'Shopify', shopify_us: 'Shopify US', shopee: 'Shopee', mercadolivre: 'Mercado Livre', amazon: 'Amazon BR', amazon_us: 'Amazon US' };
function statusLabelPt(o) {
  if (o.cancelled) return 'Cancelado';
  const s = (o.status || '').toUpperCase();
  if (['PAID', 'COMPLETED', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'READY_TO_SHIP'].includes(s)) return 'OK';
  return 'Pendente';
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
    name: o.name, channel: o.channel, customer: o.customer, items: o.items.length,
    createdAt: o.createdAt, total: o.total, status: o.status, cancelled: o.cancelled,
  }));
  return { market, q, total, results, limited: total > limit };
}

// Agrupa itens de uma lista de pedidos por canal → por título de produto (com quebra avulso x
// combo, Shopify Bundles, tipo e imagem). Compartilhado por computeProducts e computeStock —
// mesma regra de agrupamento usada em Top Produtos/Segmentos.
// Escala a receita dos ITENS ao total CAPTURADO do pedido, só para a Amazon. Os itens da
// Amazon vêm do relatório com preço BRUTO, e pedidos Pending têm total 0 até a captura no
// envio — sem escalar, a receita por produto soma pedidos não capturados a preço cheio e
// estoura (num dia de US$ 5k capturado, Segmentos/Produtos mostravam US$ 17k). O total do
// pedido (`o.total`) é a fonte de verdade da receita em todo o app; aqui distribuímos ele
// entre os itens na proporção do preço deles. Pending (total 0) → fator 0. Outros canais
// retornam 1 (item.amount já é a receita líquida do produto). Ver CLAUDE.md 4.7.6.
function amazonRevFactor(o) {
  if (o.channel !== 'amazon' && o.channel !== 'amazon_us') return 1;
  let itemsSum = 0;
  for (const it of o.items) if (it.title) itemsSum += it.amount || 0;
  return itemsSum > 0 ? (o.total || 0) / itemsSum : 0;
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
    const rf = amazonRevFactor(o);
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

      if (!c.products[title]) c.products[title] = { revenue: 0, avulsoQty: 0, comboQty: 0, comboBySize: {}, type: null, image: null };
      const p = c.products[title], qty = it.qty || 0;
      p.revenue += (it.amount || 0) * rf;
      if (!p.type) p.type = classifyType(it);
      if (!p.image && it.image) p.image = it.image;
      if (!p.image && it.asin && amazonImages[it.asin]) p.image = amazonImages[it.asin];

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

// Catálogo completo de produtos por canal (para a tela de Produtos) — sem limite de top-N,
// com a mesma quebra avulso x combo (Shopify Bundles) usada no Top Produtos/Segmentos.
export function computeProducts({ market = 'br', since, until } = {}) {
  const orders = getOrders({ channel: 'todos', since, until, market }).filter(o => !isCancelled(o));
  const byChannel = aggregateProductsByChannel(orders);

  // Catálogo (todos os pedidos, sem filtro de período) — é uma tela de catálogo, então um produto
  // do marketplace continua listado mesmo sem venda no período escolhido (qty/receita ficam 0).
  const allOrders = getOrders({ channel: 'todos', market }).filter(o => !isCancelled(o));
  const catalogByChannel = aggregateProductsByChannel(allOrders);

  const finance = getProductFinance();
  const channels = {};
  const chKeys = new Set([...Object.keys(byChannel), ...Object.keys(catalogByChannel)]);
  for (const ch of chKeys) {
    const c = byChannel[ch] || { revenue: 0, orders: 0, products: {} };
    const catalogProducts = catalogByChannel[ch]?.products || {};
    const titles = new Set([...Object.keys(c.products), ...Object.keys(catalogProducts)]);
    const empty = { revenue: 0, avulsoQty: 0, comboQty: 0, comboBySize: {}, type: null, image: null };
    const products = [...titles]
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

// Estoque + produção por canal (para a tela de Estoque) — janela FIXA de 30 dias corridos pra
// velocidade de venda (não depende de seletor de período na tela, ao contrário de Produtos).
// Combina dado real (venda) com dado manual (estoque físico, a caminho, pedido ao laboratório).
const STOCK_WINDOW_DAYS = 30;

// Sugestão de reposição a partir do Tempo de Estoque com Produção (totalMonthsOfStock).
// Limites definidos pelo Luan em 06/07/2026: <3 meses = urgente, 3–7 = atenção, >=7 = aguardar.
function stockSuggestion(months) {
  if (months == null) return null;
  if (months < 3) return 'urgente';
  if (months < 7) return 'atencao';
  return 'aguardar';
}

export function computeStock({ market = 'br' } = {}) {
  const until = isoUTC(new Date());
  const since = isoUTC(addDays(parseISO(until), -(STOCK_WINDOW_DAYS - 1)));
  const orders = getOrders({ channel: 'todos', since, until, market }).filter(o => !isCancelled(o));
  const byChannel = aggregateProductsByChannel(orders);

  // Catálogo completo (todo o histórico do canal, sem filtro de data) — mesmo critério de
  // computeProducts (ver 4.13): um produto que não vendeu nos últimos 30 dias continua listado,
  // só com vendas zeradas, em vez de sumir da tela. Sem isso, um produto que para de vender por
  // mais de 30 dias sumia do Estoque e o estoque/recebendo cadastrado manualmente pra ele ficava
  // inacessível pela UI (o dado continuava salvo em kv.productStock, só não tinha como editar).
  const allOrders = getOrders({ channel: 'todos', market }).filter(o => !isCancelled(o));
  const catalogByChannel = aggregateProductsByChannel(allOrders);

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

  for (const ch of chKeys) {
    const c = byChannel[ch] || { revenue: 0, orders: 0, products: {} };
    const catalogProducts = catalogByChannel[ch]?.products || {};
    const titles = new Set([...Object.keys(c.products), ...Object.keys(catalogProducts)]);
    const products = [...titles]
      .map(title => {
        const cat = catalogProducts[title];
        const p = c.products[title] || { ...empty, type: cat?.type ?? null, image: cat?.image ?? null };
        if (!p.type && cat?.type) p.type = cat.type;
        if (!p.image && cat?.image) p.image = cat.image;
        const salesMonth = p.avulsoQty + p.comboQty;
        const salesDaily = salesMonth / STOCK_WINDOW_DAYS;
        const ov = stockData[`${ch}|||${title}`] || {};
        const stock    = ov.stock != null ? Number(ov.stock) : 0;
        const incoming = ov.incoming != null ? Number(ov.incoming) : 0;
        const monthsOfStock = salesMonth > 0 ? (stock + incoming) / salesMonth : null;
        return {
          title, type: p.type, image: p.image,
          avulsoQty: p.avulsoQty, comboQty: p.comboQty, comboBySize: p.comboBySize,
          salesDaily, salesMonth, stock, incoming, monthsOfStock,
        };
      })
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
      const family = classifyFamily(p.title) || p.title;
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
    const salesDaily = salesMonth / STOCK_WINDOW_DAYS;
    const ov = stockAggData[`${market}|||${family}`] || {};
    const orderInProgress = ov.orderInProgress != null ? Number(ov.orderInProgress) : 0;
    const orderNew        = ov.orderNew != null ? Number(ov.orderNew) : 0;
    const projected       = ov.projected != null ? Number(ov.projected) : 0;
    const monthsOfStock = salesMonth > 0 ? (a.stock + a.incoming) / salesMonth : null;
    const totalMonthsOfStock = salesMonth > 0 ? (a.stock + projected + orderNew + orderInProgress) / salesMonth : null;
    return {
      title: family, type: a.type, image: a.image,
      avulsoQty: a.avulsoQty, comboQty: a.comboQty, comboBySize: a.comboBySize,
      salesDaily, salesMonth, stock: a.stock, incoming: a.incoming,
      orderInProgress, orderNew, projected,
      monthsOfStock, totalMonthsOfStock, suggestion: stockSuggestion(totalMonthsOfStock),
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

  return { market, windowDays: STOCK_WINDOW_DAYS, since, until, channels, agg: { products: aggProducts, totals: aggTotals }, updatedAt: load().lastSync };
}
