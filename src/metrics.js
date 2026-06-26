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
  if (metric === 'sessoes') {
    trendLabels = sess.series.map(p => p.label);
    trendData = sess.series.map(p => p.sessions);
    trendTotal = sess.sessions;
  } else {
    const series = buckets.map(() => 0);
    valid.forEach(o => { const i = idx.get(bucketKey(o.createdAt, grain)); if (i != null) series[i] += metric === 'pedidos' ? 1 : o.total; });
    trendLabels = buckets.map(b => b.label);
    trendData = series;
    trendTotal = metric === 'pedidos' ? count : revenue;
  }

  // split por canal (receita real por canal; canais sem dados ficam 0)
  const byChannel = market === 'us'
    ? { shopify_us: 0, amazon: 0 }
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
  const pmap = {};
  valid.forEach(o => o.items.forEach(it => {
    if (it.title) {
      const key = `${it.title}|||${o.channel}`;
      pmap[key] = (pmap[key] || 0) + it.amount;
    }
  }));
  const topProducts = Object.entries(pmap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, value]) => { const [title, ch] = key.split('|||'); return [title, ch, value]; });

  // por estado (endereço de entrega dos pedidos válidos)
  const byState = {};
  valid.forEach(o => {
    const s = o.state;
    if (s && o.total > 0) {
      if (!byState[s]) byState[s] = { revenue: 0, orders: 0 };
      byState[s].revenue += o.total;
      byState[s].orders += 1;
    }
  });

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
    trend: { labels: trendLabels, data: trendData, total: trendTotal, fmt: trendFmt },
    channelSplit: byChannel,
    marketing: mktEntries.map(([name, value]) => ({ name, value })),
    traffic: { sessions: sess.sessions, visitors: sess.visitors, cart: sess.cart, conversion: sess.conv, series: sess.series },
    funnel: { sessions: sess.sessions, cart: sess.cart, checkout: sess.checkout, completed: sess.completed },
    topProducts,
    byState,
    recentOrders: recent,
    mlBreakdown,
    updatedAt: load().lastSync,
  };
}
