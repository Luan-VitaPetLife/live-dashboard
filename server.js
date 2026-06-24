// ─────────────────────────────────────────────
//  server.js — serve a interface e a API da dashboard.
// ─────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeDashboard } from './src/metrics.js';
import { runSync } from './src/sync.js';
import * as shopee from './src/shopee.js';
import * as ml from './src/mercadolivre.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Dados da dashboard
app.get('/api/dashboard', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { channel = 'todos', metric = 'receita', since = today, until = today } = req.query;
    res.json(computeDashboard({ channel, metric, since, until }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Forçar uma sincronização manual
app.post('/api/sync', async (_req, res) => {
  try { res.json(await runSync()); }
  catch (e) { res.status(500).json({ error: e.message }); }
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

app.listen(PORT, () => {
  console.log(`Dashboard rodando em http://localhost:${PORT}`);
  // Sincroniza ao subir e depois a cada N minutos.
  runSync().then(r => console.log('Sync inicial:', r)).catch(e => console.error('Sync inicial falhou:', e.message));
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES || 15);
  setInterval(() => runSync().then(r => console.log('Sync:', r)).catch(e => console.error('Sync falhou:', e.message)), minutes * 60 * 1000);
});
