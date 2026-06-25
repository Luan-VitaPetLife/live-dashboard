// ─────────────────────────────────────────────
//  meta.js — Meta Marketing API (Facebook/Instagram Ads)
//  Busca gasto, impressões e cliques por dia da conta de anúncios.
//  Usa um System User Token permanente (não expira).
// ─────────────────────────────────────────────
import 'dotenv/config';

const ACCESS_TOKEN  = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;
const API_VERSION   = 'v20.0';
const BASE          = `https://graph.facebook.com/${API_VERSION}`;

export function isConfigured() {
  return Boolean(ACCESS_TOKEN && AD_ACCOUNT_ID);
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

// Busca insights diários da conta de anúncios no intervalo.
// Retorna { [YYYY-MM-DD]: { spend, impressions, clicks, reach, cpm, cpc, ctr } }
export async function fetchInsights(sinceISO, untilISO) {
  if (!isConfigured()) return {};

  const accountId = AD_ACCOUNT_ID.startsWith('act_') ? AD_ACCOUNT_ID : `act_${AD_ACCOUNT_ID}`;
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

    const json = await graphGet(`/${accountId}/insights`, params);

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
