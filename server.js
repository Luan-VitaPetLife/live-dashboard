// ─────────────────────────────────────────────
//  server.js — serve a interface e a API da dashboard.
// ─────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeDashboard, computeProducts, computeStock } from './src/metrics.js';
import { runSync } from './src/sync.js';
import { initStore, getAmazonBackoff, setAmazonBackoff, getAmazonBRBackoff, setAmazonBRBackoff, setAmazonBackoffCount, setAmazonBRBackoffCount, setProductFinance, setProductStock, setProductStockAgg, load } from './src/store.js';
import * as shopee from './src/shopee.js';
import * as ml from './src/mercadolivre.js';
import * as amazon from './src/amazon.js';
import * as meta from './src/meta.js';
import * as googleads from './src/googleads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Dados da dashboard
app.get('/api/dashboard', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { channel = 'todos', metric = 'receita', since = today, until = today, market = 'br' } = req.query;
    res.json(computeDashboard({ channel, metric, since, until, market }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Catálogo completo de produtos por canal (para a tela de Produtos) — vem direto do store, sem cache.
app.get('/api/products', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { since = today, until = today, market = 'br' } = req.query;
    res.json(computeProducts({ market, since, until }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Salva/edita dados financeiros de um produto (COG, frete, % imposto, % comissão) — usado pela tela de Produtos.
app.post('/api/products/finance', (req, res) => {
  const { channel, title, cog, shipping, taxPct, commissionPct } = req.body || {};
  if (!channel || !title) return res.status(400).json({ error: 'channel e title são obrigatórios.' });
  const patch = {};
  if (cog !== undefined)           patch.cog = cog === null || cog === '' ? null : Number(cog);
  if (shipping !== undefined)      patch.shipping = shipping === null || shipping === '' ? null : Number(shipping);
  if (taxPct !== undefined)        patch.taxPct = taxPct === null || taxPct === '' ? null : Number(taxPct);
  if (commissionPct !== undefined) patch.commissionPct = commissionPct === null || commissionPct === '' ? null : Number(commissionPct);
  setProductFinance(`${channel}|||${title}`, patch);
  res.json({ ok: true });
});

// Estoque + produção por canal (para a tela de Estoque) — janela fixa de 30 dias, sem cache.
app.get('/api/stock', (req, res) => {
  try {
    const { market = 'br' } = req.query;
    res.json(computeStock({ market }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Salva/edita dados de estoque físico/recebendo de um produto POR CANAL — usado pela tela de Estoque.
// Ordem Projetada/Nova/Em Andamento não são mais por canal, ver /api/stock/agg-finance abaixo.
app.post('/api/stock/finance', (req, res) => {
  const { channel, title, stock, incoming } = req.body || {};
  if (!channel || !title) return res.status(400).json({ error: 'channel e title são obrigatórios.' });
  const patch = {};
  if (stock !== undefined)    patch.stock = stock === null || stock === '' ? null : Number(stock);
  if (incoming !== undefined) patch.incoming = incoming === null || incoming === '' ? null : Number(incoming);
  setProductStock(`${channel}|||${title}`, patch);
  res.json({ ok: true });
});

// Salva/edita ordem projetada/nova/em andamento de uma FAMÍLIA de produto (soma de todos os
// canais) — usado pelo card "Estoque" (panorama geral) da tela de Estoque.
app.post('/api/stock/agg-finance', (req, res) => {
  const { market, title, orderInProgress, orderNew, projected } = req.body || {};
  if (!market || !title) return res.status(400).json({ error: 'market e title são obrigatórios.' });
  const patch = {};
  if (orderInProgress !== undefined) patch.orderInProgress = orderInProgress === null || orderInProgress === '' ? null : Number(orderInProgress);
  if (orderNew !== undefined)        patch.orderNew = orderNew === null || orderNew === '' ? null : Number(orderNew);
  if (projected !== undefined)       patch.projected = projected === null || projected === '' ? null : Number(projected);
  setProductStockAgg(`${market}|||${title}`, patch);
  res.json({ ok: true });
});

// Campanhas por canal (ao vivo, com cache de 5 min). Usado pelo detalhamento da tela de Campanhas.
// Meta (BR/US) e Mercado Ads retornam campanha a campanha; Shopee/Amazon não têm API de gasto.
const campaignCache = new Map();
app.get('/api/campaigns', async (req, res) => {
  const market = req.query.market === 'us' ? 'us' : 'br';
  const { since, until } = req.query;
  if (!since || !until) return res.status(400).json({ error: 'Parâmetros since/until obrigatórios.' });

  const key = `${market}|${since}|${until}`;
  const cached = campaignCache.get(key);
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return res.json(cached.data);

  const channels = {};
  try {
    if (market === 'br') {
      const [mlC, metaC] = await Promise.all([
        ml.fetchCampaigns(since, until).catch(() => []),
        meta.fetchCampaigns(since, until).catch(() => []),
      ]);
      channels.mercadolivre = { available: ml.isConfigured(), campaigns: mlC };
      channels.meta = { available: meta.isConfigured(), campaigns: metaC };
    } else {
      const usAcc = process.env.META_US_AD_ACCOUNT_ID;
      const [metaC, googleC] = await Promise.all([
        meta.fetchCampaigns(since, until, usAcc).catch(() => []),
        googleads.fetchCampaigns(since, until).catch(() => []),
      ]);
      channels.meta = { available: meta.isConfigured(usAcc), campaigns: metaC };
      channels.google = { available: googleads.isConfigured(), campaigns: googleC };
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const data = { market, since, until, channels };
  campaignCache.set(key, { ts: Date.now(), data });
  res.json(data);
});

// Reset do backoff da Amazon. ?delay=N define um novo backoff de N minutos a partir de agora.
app.post('/api/amazon/reset-backoff', (req, res) => {
  const delay = Number(req.query.delay || 0);
  const until = delay > 0 ? Date.now() + delay * 60 * 1000 : 0;
  setAmazonBackoff(until);
  const msg = until ? `Backoff Amazon definido para ${new Date(until).toISOString()}` : 'Backoff Amazon zerado.';
  res.json({ ok: true, message: msg });
});

// Force-sync da Amazon: zera backoff + contador exponencial e sincroniza imediatamente (sem race com o timer)
app.post('/api/amazon/force-sync', async (_req, res) => {
  setAmazonBackoff(0);
  setAmazonBackoffCount(0);
  const report = await runSync();
  res.json(report);
});


// Reset do backoff da Amazon BR. (US e BR compartilham o mesmo balde de cota desde
// a chamada combinada — então reseta os dois para destravar de fato.)
app.post('/api/amazon-br/reset-backoff', (req, res) => {
  const delay = Number(req.query.delay || 0);
  const until = delay > 0 ? Date.now() + delay * 60 * 1000 : 0;
  setAmazonBRBackoff(until);
  setAmazonBackoff(until);
  const msg = until ? `Backoff Amazon definido para ${new Date(until).toISOString()}` : 'Backoff Amazon zerado.';
  res.json({ ok: true, message: msg });
});

// Force-sync da Amazon BR: zera backoff + contador exponencial e sincroniza imediatamente.
app.post('/api/amazon-br/force-sync', async (_req, res) => {
  setAmazonBRBackoff(0);
  setAmazonBRBackoffCount(0);
  setAmazonBackoff(0);
  setAmazonBackoffCount(0);
  const report = await runSync();
  res.json(report);
});

// Forçar uma sincronização manual (protegido por token)
app.post('/api/sync', async (req, res) => {
  const secret = process.env.SYNC_SECRET;
  if (secret && req.headers['x-sync-token'] !== secret) return res.status(401).json({ error: 'Não autorizado.' });
  try { res.json(await runSync()); }
  catch (e) { res.status(500).json({ error: 'Sync falhou.' }); }
});

// ── Shopee OAuth ──
app.get('/shopee/connect', (req, res) => {
  try { res.redirect(shopee.buildAuthUrl()); }
  catch (e) { res.status(400).send(e.message); }
});

app.get('/shopee/callback', async (req, res) => {
  try {
    const { code, shop_id } = req.query;
    if (!code) return res.status(400).send('Faltou o parâmetro "code" da Shopee.');
    await shopee.exchangeCode(code, shop_id);
    await runSync();
    res.send('<h2>Shopee conectada com sucesso!</h2><p>Pode fechar esta aba e voltar à dashboard.</p>');
  } catch (e) {
    res.status(500).send('Erro ao conectar a Shopee: ' + e.message);
  }
});

// ── Mercado Livre OAuth ──
app.get('/mercadolivre/connect', (req, res) => {
  try { res.redirect(ml.buildAuthUrl()); }
  catch (e) { res.status(400).send(e.message); }
});

app.get('/mercadolivre/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Faltou o parâmetro "code" do Mercado Livre.');
    await ml.exchangeCode(code);
    await runSync();
    res.send('<h2>Mercado Livre conectado com sucesso!</h2><p>Pode fechar esta aba e voltar à dashboard.</p>');
  } catch (e) {
    res.status(500).send('Erro ao conectar o Mercado Livre: ' + e.message);
  }
});

// ── Google Ads OAuth ──
app.get('/googleads/connect', (req, res) => {
  try { res.redirect(googleads.buildAuthUrl()); }
  catch (e) { res.status(400).send(e.message); }
});

app.get('/googleads/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Faltou o parâmetro "code" do Google Ads.');
    await googleads.exchangeCode(code);
    res.send('<h2>Google Ads conectado com sucesso!</h2><p>Pode fechar esta aba e voltar à dashboard.</p>');
  } catch (e) {
    res.status(500).send('Erro ao conectar o Google Ads: ' + e.message);
  }
});



app.get('/health', (_req, res) => res.json({ ok: true }));

// Diagnóstico de integrações — mostra o que está configurado e o estado do Amazon
app.get('/api/status', (_req, res) => {
  const backoffUntil   = getAmazonBackoff();
  const backoffActive  = backoffUntil > Date.now();
  const backoffBRUntil  = getAmazonBRBackoff();
  const backoffBRActive = backoffBRUntil > Date.now();
  const db = load();

  const has = key => Boolean(process.env[key]);

  res.json({
    amazon: {
      configured:  amazon.isConfigured(),
      hasLwa:      has('AMAZON_CLIENT_ID') && has('AMAZON_CLIENT_SECRET') && has('AMAZON_REFRESH_TOKEN'),
      hasAwsCreds: has('AMAZON_AWS_ACCESS_KEY') && has('AMAZON_AWS_SECRET_KEY'),
      hasRoleArn:  has('AMAZON_ROLE_ARN'),
      backoffActive,
      backoffUntil:  backoffActive ? new Date(backoffUntil).toISOString() : null,
      nextSyncIn:    backoffActive ? `${Math.ceil((backoffUntil - Date.now()) / 60000)} min` : 'agora',
    },
    amazon_br: {
      // US e BR usam o mesmo app/token e o mesmo balde de cota (chamada combinada).
      configured:  amazon.isConfiguredBR(),
      hasLwa:      has('AMAZON_CLIENT_ID') && has('AMAZON_CLIENT_SECRET') && has('AMAZON_REFRESH_TOKEN'),
      hasAwsCreds: has('AMAZON_AWS_ACCESS_KEY') && has('AMAZON_AWS_SECRET_KEY'),
      sharedWithUs:  true,
      backoffActive, // mesmo backoff da US
      backoffUntil:  backoffActive ? new Date(backoffUntil).toISOString() : null,
      nextSyncIn:    backoffActive ? `${Math.ceil((backoffUntil - Date.now()) / 60000)} min` : 'agora',
    },
    meta: {
      br: { configured: meta.isConfigured(), hasToken: has('META_ACCESS_TOKEN'), hasAccount: has('META_AD_ACCOUNT_ID') },
      us: { configured: meta.isConfigured(process.env.META_US_AD_ACCOUNT_ID), hasToken: has('META_ACCESS_TOKEN'), hasAccount: has('META_US_AD_ACCOUNT_ID') },
    },
    google_ads: {
      configured:   googleads.isConfigured(),
      hasCreds:     has('GOOGLE_ADS_CLIENT_ID') && has('GOOGLE_ADS_CLIENT_SECRET') && has('GOOGLE_ADS_DEVELOPER_TOKEN'),
      hasCustomerId: has('GOOGLE_ADS_CUSTOMER_ID'),
      authorized:   Boolean(db.googleAdsTokens),
    },
    shopify: {
      br: { configured: has('SHOPIFY_STORE') && has('SHOPIFY_ADMIN_TOKEN') },
      us: { configured: has('SHOPIFY_US_STORE') && has('SHOPIFY_US_ADMIN_TOKEN') },
    },
    lastSync: db.lastSync || null,
  });
});

await initStore();

app.listen(PORT, () => {
  console.log(`Dashboard rodando em http://localhost:${PORT}`);
  runSync().then(r => console.log('Sync inicial:', r)).catch(e => console.error('Sync inicial falhou:', e.message));
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES || 15);
  setInterval(() => runSync().then(r => console.log('Sync:', r)).catch(e => console.error('Sync falhou:', e.message)), minutes * 60 * 1000);
});
