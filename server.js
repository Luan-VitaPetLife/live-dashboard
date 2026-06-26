// ─────────────────────────────────────────────
//  server.js — serve a interface e a API da dashboard.
// ─────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeDashboard } from './src/metrics.js';
import { runSync } from './src/sync.js';
import { initStore, getAmazonBackoff, load } from './src/store.js';
import * as shopee from './src/shopee.js';
import * as ml from './src/mercadolivre.js';
import * as amazon from './src/amazon.js';
import * as meta from './src/meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/health', (_req, res) => res.json({ ok: true }));

// Diagnóstico de integrações — mostra o que está configurado e o estado do Amazon
app.get('/api/status', (_req, res) => {
  const backoffUntil = getAmazonBackoff();
  const backoffActive = backoffUntil > Date.now();
  const db = load();

  const has = key => Boolean(process.env[key]);

  res.json({
    amazon: {
      configured: amazon.isConfigured(),
      hasLwa:     has('AMAZON_CLIENT_ID') && has('AMAZON_CLIENT_SECRET') && has('AMAZON_REFRESH_TOKEN'),
      hasAwsCreds: has('AMAZON_AWS_ACCESS_KEY') && has('AMAZON_AWS_SECRET_KEY'),
      hasRoleArn:  has('AMAZON_ROLE_ARN'),
      backoffActive,
      backoffUntil: backoffActive ? new Date(backoffUntil).toISOString() : null,
      nextSyncIn:   backoffActive ? `${Math.ceil((backoffUntil - Date.now()) / 60000)} min` : 'agora',
    },
    meta: {
      br: { configured: meta.isConfigured(), hasToken: has('META_ACCESS_TOKEN'), hasAccount: has('META_AD_ACCOUNT_ID') },
      us: { configured: meta.isConfigured(process.env.META_US_AD_ACCOUNT_ID), hasToken: has('META_ACCESS_TOKEN'), hasAccount: has('META_US_AD_ACCOUNT_ID') },
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
