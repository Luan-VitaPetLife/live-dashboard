// ─────────────────────────────────────────────
//  server.js — serve a interface e a API da dashboard.
// ─────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeDashboard, computeProducts, computeStock, searchOrders } from './src/metrics.js';
import { runSync, reconcileAmazonNames, enrichAmazonItems } from './src/sync.js';
import { initStore, getAmazonBackoff, setAmazonBackoff, getAmazonBRBackoff, setAmazonBRBackoff, setAmazonBackoffCount, setAmazonBRBackoffCount, setProductFinance, setProductStock, setProductStockAgg, setAmazonBackfill, getAmazonBackfill, getAmazonProductImages, setAmazonProductImages, getAmazonImagesJob, setAmazonImagesJob, getOrders, upsertOrders, load, removeAmazonMarketLeak, getProductGroups, upsertProductGroup, deleteProductGroup, removeFromProductGroup } from './src/store.js';
import * as shopee from './src/shopee.js';
import * as ml from './src/mercadolivre.js';
import * as amazon from './src/amazon.js';
import * as meta from './src/meta.js';
import * as googleads from './src/googleads.js';
import * as auth from './src/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // Railway fica atrás de um proxy TLS — necessário para req.secure
const PORT = process.env.PORT || 3000;

// Detecta se a conexão original (antes do proxy) é HTTPS — usado para o atributo Secure do cookie.
const isHttps = req => req.secure || req.headers['x-forwarded-proto'] === 'https';

// ── Segurança: cabeçalhos defensivos (sem libs externas) ──
// CSP construída a partir dos domínios que a interface realmente carrega (CDN do
// Chart.js/Bootstrap Icons/Leaflet, tile server do mapa, API de GeoJSON do IBGE) —
// confirmado varrendo todo public/ por "https://", não uma lista genérica.
// script-src/style-src precisam de 'unsafe-inline' porque toda a lógica das páginas
// vive em <script>/<style> inline no próprio HTML (arquitetura atual, sem bundler
// nem build step) — isso ainda bloqueia injeção de script/domínio externo (o vetor
// mais comum de exfiltração de cookie/dado via XSS refletido), mas não elimina XSS
// via inline. Migrar pra nonce por requisição é o próximo passo se isso virar
// prioridade — exigiria trocar o public/*.html de "arquivo estático" pra "renderizado
// por request", mudança maior, fora do escopo desta rodada.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
  "img-src 'self' data: https://*.basemaps.cartocdn.com",
  "font-src 'self' https://cdn.jsdelivr.net data:",
  "connect-src 'self' https://servicodados.ibge.gov.br https://unpkg.com https://cdn.jsdelivr.net",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

app.disable('x-powered-by'); // não anunciar "Express" pra quem for procurar CVE de framework
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');       // trava MIME-sniffing (ex: um upload disfarçado de imagem virando script)
  res.setHeader('X-Frame-Options', 'DENY');                  // clickjacking — reforça o frame-ancestors acima em navegadores antigos
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

// ── Rate limit de login: contra força bruta / credential stuffing em /api/login ──
// Em memória (processo único no Railway) — chave por IP, sem libs externas, mesmo
// espírito "dependências mínimas" do resto do projeto (ver CLAUDE.md seção 10). Não
// precisa sobreviver a restart nem ser distribuído: o objetivo é atrapalhar um script
// varrendo senhas, não ser à prova de um atacante com múltiplos IPs.
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginAttempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginAttempts) {
    if ((rec.lockedUntil || 0) < now && now - rec.firstAt > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000);
function loginLockedUntil(ip) {
  const rec = loginAttempts.get(ip);
  return rec && rec.lockedUntil > Date.now() ? rec.lockedUntil : 0;
}
function registerLoginFailure(ip) {
  const now = Date.now();
  let rec = loginAttempts.get(ip);
  if (!rec || now - rec.firstAt > LOGIN_WINDOW_MS) rec = { count: 0, firstAt: now };
  rec.count++;
  if (rec.count >= LOGIN_MAX_ATTEMPTS) rec.lockedUntil = now + LOGIN_LOCK_MS;
  loginAttempts.set(ip, rec);
}
function registerLoginSuccess(ip) { loginAttempts.delete(ip); }

// ── Pipeline base (ordem importa) ──
app.use(express.json());

// Resolve o usuário do cookie de sessão em TODA requisição.
app.use((req, _res, next) => {
  const t = auth.parseCookies(req)[auth.SESSION_COOKIE_NAME];
  req.authToken = t || null;
  req.authUser = t ? auth.userFromToken(t) : null;
  next();
});

// ── Rotas públicas de autenticação (antes do portão) ──
app.post('/api/login', (req, res) => {
  const locked = loginLockedUntil(req.ip);
  if (locked) {
    const minutes = Math.ceil((locked - Date.now()) / 60000);
    return res.status(429).json({ error: `Muitas tentativas de login. Tente de novo em ${minutes} min.` });
  }
  const { username, password } = req.body || {};
  const result = auth.login(username, password);
  if (!result) { registerLoginFailure(req.ip); return res.status(401).json({ error: 'Usuário ou senha inválidos.' }); }
  registerLoginSuccess(req.ip);
  res.setHeader('Set-Cookie', auth.buildSessionCookie(result.token, { secure: isHttps(req) }));
  res.json({ ok: true, user: result.user });
});

app.post('/api/logout', (req, res) => {
  auth.logout(req.authToken);
  res.setHeader('Set-Cookie', auth.buildClearCookie({ secure: isHttps(req) }));
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({
    enabled: auth.isEnabled(),
    user: req.authUser ? auth.publicUser(req.authUser) : null,
    pages: auth.PAGES,
  });
});

// ── URLs limpas: mapa slug <-> arquivo. O identificador interno de página CONTINUA
// sendo o nome do arquivo (compat com kv.users.pages já gravado no banco em produção)
// — só a URL que o usuário vê e navega perde o ".html". Ver CLAUDE.md.
const SLUG_TO_FILE = {
  '': 'index.html',
  segmentos: 'segmentos.html',
  geografia: 'geografia.html',
  'geografia-us': 'geografia-us.html',
  produtos: 'produtos.html',
  estoque: 'estoque.html',
  campanhas: 'campanhas.html',
  configuracoes: 'configuracoes.html',
  login: 'login.html',
};
const FILE_TO_SLUG = Object.fromEntries(
  Object.entries(SLUG_TO_FILE).map(([slug, file]) => [file, slug ? '/' + slug : '/'])
);
function resolvePageFile(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/') return SLUG_TO_FILE[''];
  const seg = clean.slice(1).toLowerCase();
  return SLUG_TO_FILE[seg.endsWith('.html') ? seg.slice(0, -5) : seg] || null;
}

// Redireciona (301, permanente) qualquer .html antigo pra URL limpa — bookmarks e
// links salvos continuam funcionando, mas a URL canônica nunca mais mostra .html.
app.use((req, res, next) => {
  if (!/\.html$/i.test(req.path)) return next();
  const file = req.path.slice(1).toLowerCase();
  const slug = FILE_TO_SLUG[file];
  if (slug === undefined) return next(); // .html que não é uma página gerenciada — deixa passar (ex: asset)
  const qs = req.url.slice(req.path.length);
  res.redirect(301, slug + qs);
});

// ── Portão de acesso (antes do static): controla páginas e APIs quando o login está ligado ──
const STATIC_ASSET_RE = /\.(css|js|png|jpe?g|svg|webp|gif|ico|woff2?|ttf|map|json)$/i;
app.use((req, res, next) => {
  if (!auth.isEnabled()) return next(); // login desligado: tudo aberto (comportamento atual)

  const p = req.path;

  // Sempre liberados: health, tela de login, rotas de auth, sync (tem token próprio), assets estáticos e OAuth.
  if (
    p === '/health' || p === '/login' ||
    p === '/api/login' || p === '/api/logout' || p === '/api/me' || p === '/api/sync' ||
    STATIC_ASSET_RE.test(p) ||
    p.startsWith('/shopee/') || p.startsWith('/mercadolivre/') || p.startsWith('/googleads/')
  ) return next();

  const user = req.authUser;
  if (!user) {
    if (p.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado.' });
    return res.redirect('/login');
  }

  // Controle de acesso por página (só quando a URL resolve pra uma página conhecida).
  const file = resolvePageFile(p);
  if (file) {
    if (file === 'configuracoes.html' && user.role !== 'admin') return res.redirect('/');
    if (auth.isManagedPage(file) && !auth.canAccessPage(user, file)) {
      const fp = auth.firstAllowedPage(user);
      if (fp) return res.redirect(FILE_TO_SLUG[fp] || '/');
      return res.status(403).send('<h2>Sem permissão</h2><p>Seu usuário não tem acesso a nenhuma página. Fale com um administrador.</p>');
    }
  }

  next();
});

// Serve cada página pela URL limpa (o arquivo real continua em public/*.html — só
// não é mais assim que o navegador chega até ele). '/' fica de fora: já é servido
// como índice padrão pelo express.static logo abaixo.
app.get(Object.keys(SLUG_TO_FILE).filter(Boolean).map(s => '/' + s), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', resolvePageFile(req.path)));
});

app.use(express.static(path.join(__dirname, 'public')));

// Exige admin em rotas de gestão. Modo aberto quando o login está desligado (permite configuração inicial).
function requireAdmin(req, res, next) {
  if (!auth.isEnabled()) return next();
  if (req.authUser && req.authUser.role === 'admin') return next();
  return res.status(403).json({ error: 'Apenas administradores.' });
}

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

// Busca geral de pedidos (histórico inteiro do mercado) — usado pelo campo de busca do card "Pedidos Recentes".
app.get('/api/orders/search', (req, res) => {
  try {
    const { q = '', market = 'br' } = req.query;
    const limit = Math.min(Number(req.query.limit || 200), 500);
    res.json(searchOrders({ market, q, limit }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Unificação manual de produtos entre canais ("Unificar" em Segmentos) — grupos por mercado,
// um título pertence a no máximo um grupo. Ver CLAUDE.md.
app.get('/api/product-groups', (req, res) => {
  try {
    const { market = 'br' } = req.query;
    res.json({ groups: getProductGroups()[market] || {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/product-groups', (req, res) => {
  const { market, name, members } = req.body || {};
  if (!market || !name || !Array.isArray(members) || !members.length) {
    return res.status(400).json({ error: 'market, name e members (array não vazio) são obrigatórios.' });
  }
  const groups = upsertProductGroup(market, name, members);
  res.json({ groups });
});
app.post('/api/product-groups/remove-member', (req, res) => {
  const { market, name, title } = req.body || {};
  if (!market || !name || !title) return res.status(400).json({ error: 'market, name e title são obrigatórios.' });
  const groups = removeFromProductGroup(market, name, title);
  res.json({ groups });
});
app.delete('/api/product-groups', (req, res) => {
  const { market, name } = req.query;
  if (!market || !name) return res.status(400).json({ error: 'market e name são obrigatórios.' });
  const groups = deleteProductGroup(market, name);
  res.json({ groups });
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

// Backfill histórico da Amazon via Reports API. Roda em background (leva minutos:
// cada janela de 30 dias é um relatório que a Amazon monta e nós baixamos) e responde
// na hora. Progresso em GET /api/status → amazon.backfill. Ver CLAUDE.md 4.7.3.
let backfillRunning = false;
app.post('/api/amazon/backfill', (req, res) => {
  if (backfillRunning) return res.status(409).json({ error: 'Backfill já em andamento.' });

  const days   = Math.min(Number(req.query.days || 90), 730);
  const market = req.query.market === 'br' ? 'br' : 'us';

  backfillRunning = true;
  setAmazonBackfill({ status: 'running', market, days, orders: 0, message: 'iniciando', startedAt: new Date().toISOString() });

  (async () => {
    let orders = 0;
    try {
      await amazon.backfillOrders({
        market, days,
        onProgress: message => setAmazonBackfill({ status: 'running', market, days, orders, message, startedAt: new Date().toISOString() }),
        onChunk: chunk => {
          upsertOrders(chunk);           // grava lote a lote: uma falha adiante não perde o que já veio
          orders += chunk.length;
          setAmazonBackfill({ status: 'running', market, days, orders, message: `${orders} pedidos gravados`, startedAt: new Date().toISOString() });
        },
      });
      setAmazonBackfill({ status: 'done', market, days, orders, message: `concluído — ${orders} pedidos`, finishedAt: new Date().toISOString() });
    } catch (e) {
      setAmazonBackfill({ status: 'error', market, days, orders, message: e.message, finishedAt: new Date().toISOString() });
      console.error('Backfill Amazon falhou:', e.message);
    } finally {
      backfillRunning = false;
    }
  })();

  res.json({ ok: true, message: `Backfill de ${days} dias (${market.toUpperCase()}) iniciado. Acompanhe em GET /api/status.` });
});

// Preenche o cache de imagem de produto Amazon (Catalog Items API por ASIN — nem a
// Orders API nem o relatório de backfill trazem imagem). Roda em background (um ASIN
// por vez, throttled) e responde na hora. Progresso em GET /api/status → amazon.images.
// Só encontra ASIN em pedidos que já passaram pelo backfill (ver CLAUDE.md 4.7.5/4.7.6);
// pedidos só do sync contínuo não têm asin/título e continuam sem imagem até serem
// reconciliados por um novo backfill.
let imagesJobRunning = false;
app.post('/api/amazon/images', (req, res) => {
  if (imagesJobRunning) return res.status(409).json({ error: 'Busca de imagens já em andamento.' });

  const market = req.query.market === 'br' ? 'br' : 'us';
  const channel = market === 'br' ? 'amazon' : 'amazon_us';
  const cached = getAmazonProductImages();
  const asins = [...new Set(
    getOrders({ channel, market })
      .filter(o => !o.cancelled)
      .flatMap(o => o.items)
      .map(it => it.asin)
      .filter(asin => asin && !cached[asin])
  )];

  if (!asins.length) {
    return res.json({ ok: true, message: 'Nenhum ASIN novo para buscar (já cacheado, ou pedidos ainda sem ASIN — rode o backfill primeiro).' });
  }

  imagesJobRunning = true;
  setAmazonImagesJob({ status: 'running', market, total: asins.length, found: 0, message: 'iniciando', startedAt: new Date().toISOString() });

  (async () => {
    try {
      const found = await amazon.fetchProductImages(asins, market, message =>
        setAmazonImagesJob({ status: 'running', market, total: asins.length, found: 0, message, startedAt: new Date().toISOString() })
      );
      setAmazonProductImages({ ...getAmazonProductImages(), ...Object.fromEntries(found) });
      setAmazonImagesJob({ status: 'done', market, total: asins.length, found: found.size, message: `concluído — ${found.size}/${asins.length} imagens encontradas`, finishedAt: new Date().toISOString() });
    } catch (e) {
      setAmazonImagesJob({ status: 'error', market, total: asins.length, found: 0, message: e.message, finishedAt: new Date().toISOString() });
      console.error('Busca de imagens Amazon falhou:', e.message);
    } finally {
      imagesJobRunning = false;
    }
  })();

  res.json({ ok: true, message: `Buscando imagem de ${asins.length} ASINs (${market.toUpperCase()}). Acompanhe em GET /api/status.` });
});

// Forçar a reconciliação de nomes de produto da Amazon (Reports API). Ignora o
// throttle (force) e roda em background — o relatório leva ~1-2 min. Resultado no
// log do servidor; confirme na tela de Produtos. Ver CLAUDE.md 4.7.6 / backlog item 8.
app.post('/api/amazon/sync-names', (req, res) => {
  if (backfillRunning) return res.status(409).json({ error: 'Backfill em andamento — tente depois que terminar.' });
  const markets = req.query.market === 'br' ? ['br'] : req.query.market === 'us' ? ['us'] : ['us', 'br'];
  reconcileAmazonNames({ markets, force: true })
    .then(r => console.log('Amazon nomes (manual):', r))
    .catch(e => console.error('Amazon nomes (manual) falhou:', e.message));
  res.json({ ok: true, message: `Reconciliação de nomes (${markets.join(', ')}) iniciada. Acompanhe no log; confirme em Produtos.` });
});

// Limpeza pontual do vazamento de mercado da Amazon: remove pedidos US que foram gravados
// como Amazon BR por um relatório cego-tagueado (ver CLAUDE.md 4.7.8). Rodar UMA vez após o
// deploy da correção. Idempotente — pode rodar de novo sem efeito se já estiver limpo.
app.post('/api/amazon/cleanup-market-leak', (req, res) => {
  try {
    const removed = removeAmazonMarketLeak();
    res.json({ ok: true, removed, message: `${removed} pedidos US vazados no mercado BR removidos.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Busca nomes de produto da Amazon via getOrderItems (Orders API, por-pedido) — o caminho
// que funciona pro BR, cujo relatório não traz pedidos BR reais (contas vinculadas, ver
// 4.7.8). Roda em background (BR ~120 pedidos × 0,5 req/s ≈ 5 min). Progresso no log e em
// GET /api/status → amazon.items. Padrão market=br (o US usa a Reports API, seria inviável aqui).
let itemsRunning = false;
let itemsStatus  = null;
app.post('/api/amazon/fetch-items', (req, res) => {
  if (itemsRunning) return res.status(409).json({ error: 'Busca de itens já em andamento.' });
  const market = req.query.market === 'us' ? 'us' : 'br';
  const limit  = Math.min(Number(req.query.limit || 1000), 5000);
  itemsRunning = true;
  itemsStatus  = { status: 'running', market, message: 'iniciando', startedAt: new Date().toISOString() };
  enrichAmazonItems({ market, limit, onProgress: m => { itemsStatus = { status: 'running', market, message: m, startedAt: itemsStatus.startedAt }; } })
    .then(r => { itemsStatus = { status: 'done', market, result: r, finishedAt: new Date().toISOString() }; console.log('Amazon itens:', r); })
    .catch(e => { itemsStatus = { status: 'error', market, message: e.message, finishedAt: new Date().toISOString() }; console.error('Amazon itens falhou:', e.message); })
    .finally(() => { itemsRunning = false; });
  res.json({ ok: true, message: `Busca de itens (${market.toUpperCase()}, até ${limit}) iniciada. Acompanhe em GET /api/status → amazon.items.` });
});

// Diagnóstico: quais marketplaces cada token da Amazon enxerga (getMarketplaceParticipations).
// Prova definitiva de qual conta de vendedor cada refresh token autoriza. Ver 4.7.9.
app.get('/api/amazon/whoami', async (_req, res) => {
  try {
    const [us, br] = await Promise.allSettled([amazon.whoAmI('us'), amazon.whoAmI('br')]);
    res.json({
      us: us.status === 'fulfilled' ? us.value : { error: us.reason?.message },
      br: br.status === 'fulfilled' ? br.value : { error: br.reason?.message },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Diagnóstico: lista crua de pedidos da Amazon (MarketplaceId + SalesChannel reais). Ver 4.7.9.
app.get('/api/amazon/list-orders', async (req, res) => {
  const market = req.query.market === 'us' ? 'us' : 'br';
  const days   = Math.min(Number(req.query.days || 14), 60);
  try { res.json(await amazon.listOrdersDiag({ market, days })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnóstico: inspeciona UM pedido (getOrder + getOrderItems) para entender o 400. Ver 4.7.9.
app.get('/api/amazon/probe-order', async (req, res) => {
  const id = req.query.id;
  const market = req.query.market === 'us' ? 'us' : 'br';
  if (!id) return res.status(400).json({ error: 'passe ?id=<AmazonOrderId>' });
  try { res.json(await amazon.probeOrder(id, market)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnóstico: resposta CRUA do Catalog Items API pra um ASIN (por que a imagem volta vazia).
app.get('/api/amazon/probe-image', async (req, res) => {
  const market = req.query.market === 'us' ? 'us' : 'br';
  try { res.json(await amazon.probeImage(req.query.asin || null, market)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnóstico: colunas reais do relatório da Amazon + amostra dos campos que decidem o
// mercado (order-status/currency/sales-channel/ship-country/ship-state) e a proporção de
// contaminação. Usado para confirmar o discriminador correto do rowMarket. Ver 4.7.8.
app.get('/api/amazon/report-columns', async (req, res) => {
  const market = req.query.market === 'us' ? 'us' : 'br';
  const days   = Math.min(Number(req.query.days || 1), 7);
  try {
    res.json(await amazon.inspectReport({ market, days }));
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

// Diagnóstico: mostra o recipient_address cru de pedidos recentes da Shopee (sem normalizar),
// pra confirmar se a API está mandando o estado ou mascarando por privacidade. Ver CLAUDE.md 4.5.
app.get('/api/shopee/probe-order', async (req, res) => {
  try { res.json(await shopee.probeOrder()); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
      backfill:      getAmazonBackfill(),
      images:        getAmazonImagesJob(),
      items:         itemsStatus,
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

// ── Gestão de usuários e configuração de login (somente admin) ──
app.get('/api/users', requireAdmin, (_req, res) => {
  res.json({ users: auth.listUsers() });
});

app.post('/api/users', requireAdmin, (req, res) => {
  try { res.json({ user: auth.createUser(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  try { res.json({ user: auth.updateUser(req.params.id, req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  try { auth.deleteUser(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/auth/config', requireAdmin, (req, res) => {
  const enabled = Boolean((req.body || {}).enabled);
  auth.setEnabled(enabled);
  res.json({ ok: true, enabled });
});

// Troca da própria senha (qualquer usuário logado). Invalida todas as sessões desse
// usuário (derruba qualquer sessão roubada/esquecida em outro dispositivo) e emite
// um cookie novo pra aba atual continuar logada sem pedir senha de novo.
app.post('/api/me/password', (req, res) => {
  if (!req.authUser) return res.status(401).json({ error: 'Não autenticado.' });
  const { current, next: novo } = req.body || {};
  if (!auth.verifyCredentials(req.authUser.username, current)) return res.status(400).json({ error: 'Senha atual incorreta.' });
  if (!novo || String(novo).length < 8) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 8 caracteres.' });
  auth.changePassword(req.authUser.id, novo);
  auth.invalidateUserSessions(req.authUser.id);
  const token = auth.createSession(req.authUser.id);
  res.setHeader('Set-Cookie', auth.buildSessionCookie(token, { secure: isHttps(req) }));
  res.json({ ok: true });
});

await initStore();
auth.initAuth();

app.listen(PORT, () => {
  console.log(`Dashboard rodando em http://localhost:${PORT}`);
  runSync().then(r => console.log('Sync inicial:', r)).catch(e => console.error('Sync inicial falhou:', e.message));
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES || 15);
  setInterval(() => runSync().then(r => console.log('Sync:', r)).catch(e => console.error('Sync falhou:', e.message)), minutes * 60 * 1000);

  // Reconciliação de nomes de produto da Amazon (Reports API, balde de cota próprio —
  // ver CLAUDE.md 4.7.6 / backlog item 8). Job separado do sync de pedidos para não
  // travar o "Sincronizar agora". A própria função só dispara um relatório se já
  // passou AMAZON_NAMES_EVERY_HOURS desde o último, por mercado. Pulamos enquanto um
  // backfill roda, para não disputar a cota da Reports API.
  const runAmazonNames = () => {
    if (backfillRunning) return;
    // US: nomes via Reports API — volume alto (~1000/dia), o relatório é o único caminho viável.
    reconcileAmazonNames({ markets: ['us'] })
      .then(r => { if (r.patched || r.inserted || r.errors.length) console.log('Amazon nomes US:', r); })
      .catch(e => console.error('Amazon nomes US falhou:', e.message));
    // BR: nomes via getOrderItems (por-pedido). O relatório do marketplace BR NÃO traz os
    // pedidos BR reais (contas vinculadas devolvem só US — ver 4.7.8), então a Reports API
    // não serve pro BR. Volume baixo (~120), então buscar item por item é viável. Só processa
    // pedidos sem título, então após limpar o backlog custa quase nada (só os poucos novos).
    if (!itemsRunning) {
      itemsRunning = true;
      itemsStatus = { status: 'running', market: 'br', message: 'auto', startedAt: new Date().toISOString() };
      enrichAmazonItems({ market: 'br', onProgress: m => { itemsStatus = { status: 'running', market: 'br', message: m, startedAt: itemsStatus.startedAt }; } })
        .then(r => { itemsStatus = { status: 'done', market: 'br', result: r, finishedAt: new Date().toISOString() }; if (r.patched || r.errors.length) console.log('Amazon itens BR:', r); })
        .catch(e => { itemsStatus = { status: 'error', market: 'br', message: e.message, finishedAt: new Date().toISOString() }; console.error('Amazon itens BR falhou:', e.message); })
        .finally(() => { itemsRunning = false; });
    }
  };
  setTimeout(runAmazonNames, 3 * 60 * 1000);        // 3 min após subir
  setInterval(runAmazonNames, 6 * 60 * 60 * 1000);  // a cada 6h (throttle interno limita a 12h)
});
