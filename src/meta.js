// ─────────────────────────────────────────────
//  meta.js — Meta Marketing API (Facebook/Instagram Ads)
//  Busca gasto, impressões e cliques por dia da conta de anúncios.
//  Usa um System User Token permanente (não expira).
// ─────────────────────────────────────────────
import 'dotenv/config';

const ACCESS_TOKEN     = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT_ID    = process.env.META_AD_ACCOUNT_ID;
const AD_ACCOUNT_ID_US = process.env.META_US_AD_ACCOUNT_ID;
const API_VERSION      = 'v20.0';
const BASE             = `https://graph.facebook.com/${API_VERSION}`;

export function isConfigured(accountId = AD_ACCOUNT_ID) {
  return Boolean(ACCESS_TOKEN && accountId);
}

async function graphGet(path, params = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set('access_token', ACCESS_TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString());
  const json = await res.json();
  if (json.error) throw new Error(`Meta API ${path}: ${json.error.message} (code ${json.error.code})`);
  return json;
}

// Busca insights diários de uma conta de anúncios no intervalo.
// Retorna { [YYYY-MM-DD]: { spend, impressions, clicks, reach, cpm, cpc, ctr } }
export async function fetchInsights(sinceISO, untilISO, accountId = AD_ACCOUNT_ID) {
  if (!isConfigured(accountId)) return {};

  const actId = String(accountId).startsWith('act_') ? accountId : `act_${accountId}`;
  const fields = 'spend,impressions,clicks,reach,cpm,cpc,ctr';
  const daily = {};

  let after = null;
  do {
    const params = {
      fields,
      time_range: JSON.stringify({ since: sinceISO, until: untilISO }),
      time_increment: 1,
      level: 'account',
      limit: 100,
    };
    if (after) params.after = after;

    const json = await graphGet(`/${actId}/insights`, params);

    for (const row of (json.data || [])) {
      daily[row.date_start] = {
        spend:       Number(row.spend       || 0),
        impressions: Number(row.impressions || 0),
        clicks:      Number(row.clicks      || 0),
        reach:       Number(row.reach       || 0),
        cpm:         Number(row.cpm         || 0),
        cpc:         Number(row.cpc         || 0),
        ctr:         Number(row.ctr         || 0),
      };
    }

    after = json.paging?.cursors?.after && json.paging?.next ? json.paging.cursors.after : null;
  } while (after);

  return daily;
}

// Soma o valor de uma ação do Meta (actions/action_values) pelo primeiro tipo que existir.
function pickAction(arr, types) {
  if (!Array.isArray(arr)) return 0;
  for (const t of types) {
    const hit = arr.find(a => a.action_type === t);
    if (hit) return Number(hit.value || 0);
  }
  return 0;
}

// Busca métricas por CAMPANHA no intervalo (agregado, sem time_increment).
// Retorna array: { name, spend, revenue, orders, clicks, impressions, reach, ctr, cpc, roas }
export async function fetchCampaigns(sinceISO, untilISO, accountId = AD_ACCOUNT_ID) {
  if (!isConfigured(accountId)) return [];
  const actId = String(accountId).startsWith('act_') ? accountId : `act_${accountId}`;
  const fields = 'campaign_name,spend,impressions,clicks,reach,ctr,cpc,actions,action_values';
  const PURCHASE = ['purchase', 'omni_purchase', 'onsite_web_purchase', 'offsite_conversion.fb_pixel_purchase'];
  const out = [];

  let after = null;
  do {
    const params = {
      fields,
      time_range: JSON.stringify({ since: sinceISO, until: untilISO }),
      level: 'campaign',
      limit: 100,
    };
    if (after) params.after = after;

    const json = await graphGet(`/${actId}/insights`, params);
    for (const row of (json.data || [])) {
      const spend   = Number(row.spend || 0);
      const revenue = pickAction(row.action_values, PURCHASE);
      out.push({
        name:        row.campaign_name || 'Campanha',
        spend,
        revenue,
        orders:      pickAction(row.actions, PURCHASE),
        clicks:      Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        reach:       Number(row.reach || 0),
        ctr:         Number(row.ctr || 0),
        cpc:         Number(row.cpc || 0),
        roas:        spend > 0 ? revenue / spend : 0,
      });
    }
    after = json.paging?.cursors?.after && json.paging?.next ? json.paging.cursors.after : null;
  } while (after);

  return out.sort((a, b) => b.spend - a.spend);
}

export { AD_ACCOUNT_ID_US };
