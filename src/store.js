// ─────────────────────────────────────────────
//  server.js — serve a interface e a API da dashboard.
// ─────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeDashboard } from './src/metrics.js';
import { runSync } from './src/sync.js';
import { initStore, getAmazonBackoff, setAmazonBackoff, getAmazonBRBackoff, setAmazonBRBackoff, setAmazonBackoffCount, setAmazonBRBackoffCount, load } from './src/store.js';
import * as shopee from './src/shopee.js';
import * as ml from './src/mercadolivre.js';
import * as amazon from './src/amazon.js';
import * as meta from './src/meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ── Controle de Concorrência (Lock Global) ──
// Evita que múltiplas sincronizações rodem ao mesmo tempo (ex: F5 repetidos ou Cron atropelando processo longo)
let isSyncing = false;

async function safeRunSync(triggerName) {
  if (isSyncing) {
    console.warn(`[Sync] Atropelamento evitado. Gatilho '${triggerName}' ignorado pois já existe uma sincronização em andamento.`);
    return { status: 'skipped', message: 'Sincronização já em andamento.' };
  }
  
  isSyncing = true;
  console.log(`[Sync] Iniciando sincronização via gatilho: ${triggerName}...`);
  
  try {
    const report = await runSync();
    console.log(`[Sync] Finalizado com sucesso (${triggerName}):`, report);
    return report;
  } catch (error) {
    console.error(`[Sync] Erro fatal durante '${triggerName}':`, error.message);
    throw error;
  } finally {
    isSyncing = false;
  }
}

// ── Rotas da API ──

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
  const report = await safeRunSync('API_Amazon_Force');
  res.json(report);
});


// Reset do backoff da Amazon BR.
app.post('/api/amazon-br/reset-backoff', (req, res) => {
  const delay = Number(req.query.delay || 0);
  const until = delay > 0 ? Date.now() + delay * 60 * 1000 : 0;
  setAmazonBRBackoff(until);
  const msg = until ? `Backoff Amazon BR definido para ${new Date(until).toISOString()}` : 'Backoff Amazon BR zerado.';
  res.json({ ok: true, message: msg });
});

// Force-sync da Amazon BR: zera backoff + contador exponencial e sincroniza imediatamente.
app.post('/api/amazon-br/force-sync', async (_req, res) => {
  setAmazonBRBackoff(0);
  setAmazonBRBackoffCount(0);
  const report = await safeRunSync('API_AmazonBR_Force');
  res.json(report);
});

// Forçar uma sincronização manual (protegido por token)
app.post('/api/sync', async (req, res) => {
  const secret = process.env.SYNC_SECRET;
  if (secret && req.headers['x-sync-token'] !== secret) return res.status(401).json({ error: 'Não autorizado.' });
  try { 
    const report = await safeRunSync('API_Manual_Token');
    res.json(report); 
  }
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
    await safeRunSync('Shopee_Callback');
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
    await safeRunSync('MercadoLivre_Callback');
    res.send('<h2>Mercado Livre conectado com sucesso!</h2><p>Pode fechar esta aba e voltar à dashboard.</p>');
  } catch (e) {
    res.status(500).send('Erro ao conectar o Mercado Livre: ' + e.message);
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
    isSyncing, // Exporta o status atual do lock para monitoramento
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
      configured:  amazon.isConfiguredBR(),
      hasLwa:      has('AMAZON_BR_CLIENT_ID') && has('AMAZON_BR_CLIENT_SECRET') && has('AMAZON_BR_REFRESH_TOKEN'),
      hasAwsCreds: has('AMAZON_AWS_ACCESS_KEY') && has('AMAZON_AWS_SECRET_KEY'),
      backoffActive: backoffBRActive,
      backoffUntil:  backoffBRActive ? new Date(backoffBRUntil).toISOString() : null,
      nextSyncIn:    backoffBRActive ? `${Math.ceil((backoffBRUntil - Date.now()) / 60000)} min` : 'agora',
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
  
  // Sync inicial no boot
  safeRunSync('Boot_Inicial');
  
  // Scheduler periódico
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES || 15);
  setInterval(() => safeRunSync('Cron_Automatico'), minutes * 60 * 1000);
});