// ─────────────────────────────────────────────
//  metrics.js — calcula o payload da dashboard a
//  partir dos pedidos e sessões guardados no store.
//  Receita SEMPRE exclui pedidos cancelados.
// ─────────────────────────────────────────────
import { getOrders, getSessionsDaily, getMetaInsightsDaily, getMetaUSInsightsDaily, getMlAdCosts, load } from './store.js';

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
  // productType do Shopify é a fonte autoritativa ("Pó", "Powder", "Soft Chews"…)
  if (item.productType) return item.productType;
  // Fallback por palavras-chave no título (Amazon e outros sem productType)
  const t = (item.title || '').toLowerCase();
  for (const [type, kws] of Object.entries(TYPE_KW)) {
    if (kws.some(k => t.includes(k))) return type;
  }
  return null;
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

  // top produtos (agrupado por título + canal para diferenciar o mesmo produto em marketplaces diferentes)
  // Combos Shopify (Bundles) vendem o produto como item individual, com qty/preço do combo —
  // por isso a receita/qty são sempre corretos, mas separamos avulso x combo (por tamanho) para visibilidade.
  // it.bundle.id é único por combo comprado; um mesmo combo pode aparecer partido em 2+ itens de linha
  // (mesmo id repetido) — por isso deduplicamos por id antes de contar "pacotes" de cada tamanho.
  const pmap = {};
  const seenBundleIds = new Set();
  valid.forEach(o => o.items.forEach(it => {
    if (!it.title) return;
    const key = `${it.title}|||${o.channel}`;
    if (!pmap[key]) pmap[key] = { revenue: 0, avulsoQty: 0, avulsoRevenue: 0, comboQty: 0, comboRevenue: 0, comboBySize: {} };
    const p = pmap[key], qty = it.qty || 0;
    p.revenue += it.amount;
    if (it.bundle) {
      p.comboQty += qty;
      p.comboRevenue += it.amount;
      const size = comboSize(it.bundle);
      if (size && !seenBundleIds.has(it.bundle.id)) {
        seenBundleIds.add(it.bundle.id);
        p.comboBySize[size] = (p.comboBySize[size] || 0) + (it.bundle.qty || 1);
      }
    } else {
      p.avulsoQty += qty;
      p.avulsoRevenue += it.amount;
    }
  }));
  const topProducts = Object.entries(pmap)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5)
    .map(([key, p]) => {
      const [title, ch] = key.split('|||');
      return { title, channel: ch, revenue: p.revenue, avulsoQty: p.avulsoQty, comboQty: p.comboQty, comboBySize: p.comboBySize };
    });

  // por estado (endereço de entrega dos pedidos válidos)
  const byState = {};
  valid.forEach(o => {
    const s = o.state;
    if (s && o.total > 0) {
      if (!byState[s]) byState[s] = { revenue: 0, orders: 0, byChannel: {} };
      byState[s].revenue += o.total;
      byState[s].orders += 1;
      byState[s].byChannel[o.channel] = (byState[s].byChannel[o.channel] || 0) + o.total;
    }
  });

  // segmentos por espécie (gato vs cão) + tipo de produto
  const segAcc = {};
  const seenBundleIdsSeg = new Set();
  valid.forEach(o => {
    o.items.forEach(it => {
      if (!it.title) return;
      const seg  = classifySeg(it);
      const type = classifyType(it);
      const qty  = it.qty || 1;
      if (!segAcc[seg]) segAcc[seg] = { revenue: 0, units: 0, orderIds: new Set(), products: {}, byType: {} };
      segAcc[seg].revenue += it.amount || 0;
      segAcc[seg].units  += qty;
      segAcc[seg].orderIds.add(o.id);
      if (type) segAcc[seg].byType[type] = (segAcc[seg].byType[type] || 0) + qty;
      const p = segAcc[seg].products;
      if (!p[it.title]) p[it.title] = { qty: 0, revenue: 0, avulsoQty: 0, comboQty: 0, comboBySize: {} };
      p[it.title].qty     += qty;
      p[it.title].revenue += it.amount || 0;
      if (it.bundle) {
        p[it.title].comboQty += qty;
        const size = comboSize(it.bundle);
        if (size && !seenBundleIdsSeg.has(it.bundle.id)) {
          seenBundleIdsSeg.add(it.bundle.id);
          p[it.title].comboBySize[size] = (p[it.title].comboBySize[size] || 0) + (it.bundle.qty || 1);
        }
      } else {
        p[it.title].avulsoQty += qty;
      }
    });
  });
  const totalSegUnits = Object.values(segAcc).reduce((a, s) => a + s.units, 0);
  const segments = {};
  for (const [k, v] of Object.entries(segAcc)) {
    segments[k] = {
      revenue: v.revenue,
      units:   v.units,
      orders:  v.orderIds.size,
      pct:     totalSegUnits > 0 ? v.units / totalSegUnits : 0,
      byType:  v.byType,
      topProducts: Object.entries(v.products)
        .sort((a, b) => b[1].qty - a[1].qty)
        .slice(0, 5)
        .map(([title, d]) => ({ title, qty: d.qty, revenue: d.revenue, avulsoQty: d.avulsoQty, comboQty: d.comboQty, comboBySize: d.comboBySize })),
    };
  }

  // pedidos recentes (todos os canais do mercado, mais novos primeiro)
  const recent = getOrders({ channel, since: null, until: null, market })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 10)
    .map(o => ({ name: o.name, channel: o.channel, customer: o.customer, items: o.items.length, createdAt: o.createdAt, total: o.total, status: o.status, cancelled: o.cancelled }));

  // conversão anterior
  const prevSess = hasSessionData ? aggregateSessions(prevSince, prevUntil, market) : emptySess;

  // Meta Ads — gasto e ROAS no período (separado por mercado)
  const metaDaily = market === 'us' ? getMetaUSInsightsDaily() : getMetaInsightsDaily();
  let adCost = 0, adImpressions = 0, adClicks = 0;
  { let d = parseISO(since); const end = parseISO(until);
    while (d <= end) { const k = isoUTC(d); const m = metaDaily[k]; if (m) { adCost += m.spend; adImpressions += m.impressions; adClicks += m.clicks; } d = addDays(d, 1); }
  }
  const metaSources = new Set(['Instagram', 'Facebook', 'instagram', 'facebook', 'ig', 'fb']);
  const metaRevenue = valid.filter(o => metaSources.has(normSource(o.source))).reduce((a, o) => a + o.total, 0);
  const roas = adCost > 0 ? metaRevenue / adCost : 0;

  // Série diária de gasto do Meta alinhada aos buckets da tendência (para a tela de Campanhas).
  const metaSpendDaily = buckets.map(b => {
    const m = metaDaily[b.key.slice(0, 10)];
    return m ? m.spend : 0;
  });

  // Vendas orgânicas x campanha (pagas): campanha = origem Meta (IG/FB) OU listagem ML "Destaque" (premium).
  const isCampaignOrder = o => metaSources.has(normSource(o.source)) || o.listingType === 'premium';
  const campaignOrdersList = valid.filter(isCampaignOrder);
  const campaignSales = sum(campaignOrdersList, o => o.total);
  const salesSplit = {
    campaign:       campaignSales,
    organic:        revenue - campaignSales,
    campaignOrders: campaignOrdersList.length,
    organicOrders:  count - campaignOrdersList.length,
  };

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
    marketing: mktEntries.map(([name, value]) => ({ name, value })),
    traffic: { sessions: sess.sessions, visitors: sess.visitors, cart: sess.cart, conversion: sess.conv, series: sess.series },
    funnel: { sessions: sess.sessions, cart: sess.cart, checkout: sess.checkout, completed: sess.completed },
    topProducts,
    segments,
    byState,
    recentOrders: recent,
    mlBreakdown,
    updatedAt: load().lastSync,
  };
}
