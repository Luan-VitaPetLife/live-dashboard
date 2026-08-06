// ─────────────────────────────────────────────
//  server.js — serve a interface e a API da dashboard.
// ─────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { computeDashboard, computeProducts, computeStock, searchOrders, exportOrdersList, listProductCatalog } from './src/metrics.js';
import { runSync, reconcileAmazonNames, enrichAmazonItems, reconcileGeoFromBling } from './src/sync.js';
import { initStore, getAmazonBackoff, setAmazonBackoff, getAmazonBRBackoff, setAmazonBRBackoff, setAmazonBackoffCount, setAmazonBRBackoffCount, setProductFinance, setProductStock, setProductStockAgg, setAmazonBackfill, getAmazonBackfill, getAmazonProductImages, setAmazonProductImages, getAmazonImagesJob, setAmazonImagesJob, getOrders, upsertOrders, load, removeAmazonMarketLeak, getProductGroups, upsertProductGroup, deleteProductGroup, removeFromProductGroup, getProductGroupsEnabled, setProductGroupsEnabled, getProductTypeGroups, upsertProductTypeGroup, removeProductTypeKeyword, deleteProductTypeGroup, getAmazonCursor, fixUnpaidOrders, getShopeeTokens, getMlTokens, getIntegrationsConfig, setIntegrationEnabled, isIntegrationEnabled, getYucalooTokens, getProductHiddenTags, upsertProductHiddenTags, removeProductHiddenTag } from './src/store.js';
import * as shopee from './src/shopee.js';
import * as ml from './src/mercadolivre.js';
import * as amazon from './src/amazon.js';
import * as meta from './src/meta.js';
import * as googleads from './src/googleads.js';
import * as bling from './src/bling.js';
import * as shopifyYucaloo from './src/shopifyYucaloo.js';
import * as auth from './src/auth.js';
import rateLimit from 'express-rate-limit';

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
  // Imagem de produto (Shopify BR/US, Shopee, Mercado Livre, e futuramente Amazon) vem de
  // URL dinâmica de CDN de cada marketplace — nunca é um domínio fixo no código, é campo de
  // resposta de API (cdn.shopify.com, http2.mlstatic.com, subdomínios de img.susercontent.com
  // da Shopee que variam...). Travar por domínio aqui viraria uma lista sempre desatualizada
  // e quebrando imagem sem aviso; liberar https: geral pra img-src é o padrão pragmático (o
  // vetor de ataque de <img src> é bem mais fraco que script-src/connect-src, que continuam travados).
  "img-src 'self' data: https:",
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

// ── Rate limiting geral (24/07/2026, a pedido do Luan: nenhuma rota pode ser inundada de
// requisições) — via express-rate-limit, camada separada do limitador de login logo abaixo
// (esse é hand-rolled de propósito, específico pra tentativa de senha; este aqui é genérico
// pra qualquer flood, incluindo em cima de rotas que já têm outra proteção). Duas camadas:
// 1. Rede de segurança geral (todo o servidor, inclusive estáticos) — limite bem alto, nunca
//    deveria ser atingido em uso normal, só existe pra barrar um flood de verdade.
// 2. Limite apertado (compartilhado) nas rotas que disparam chamada real a uma API externa
//    com cota compartilhada e frágil (Amazon SP-API — ver CLAUDE.md 4.7, um 429 real que já
//    perdeu pedidos por martelar essa API). Aplicado direto em cada rota mais abaixo.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.path === '/health',
  message: { error: 'Muitas requisições. Aguarde um momento.' },
});
app.use(globalLimiter);

const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de sincronização em pouco tempo. Aguarde um minuto.' },
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
  integracoes: 'integracoes.html',
  unificador: 'unificador.html',
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
    p.startsWith('/shopee/') || p.startsWith('/mercadolivre/') || p.startsWith('/googleads/') || p.startsWith('/bling/') || p.startsWith('/shopify-yucaloo/')
  ) return next();

  const user = req.authUser;
  if (!user) {
    if (p.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado.' });
    return res.redirect('/login');
  }

  // Controle de acesso por página (só quando a URL resolve pra uma página conhecida).
  const file = resolvePageFile(p);
  if (file) {
    if ((file === 'configuracoes.html' || file === 'integracoes.html' || file === 'unificador.html') && user.role !== 'admin') return res.redirect('/');
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

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições à API em pouco tempo. Aguarde alguns minutos.' },
});
app.use('/api', apiLimiter);

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
    const { channel = 'todos', metric = 'receita', since = today, until = today, market = 'br', amazonRevenueMode = 'total' } = req.query;
    res.json(computeDashboard({ channel, metric, since, until, market, amazonRevenueMode }));
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

// ── Exportação para planilha (CSV, abre direto no Excel) ──
// Ponto-e-vírgula como separador (não vírgula) + BOM UTF-8: é o que o Excel em pt-BR reconhece
// automaticamente sem passar pelo assistente de importação (a vírgula já é usada como separador
// decimal na configuração regional brasileira).
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function sendCsv(res, filename, header, rows) {
  const lines = [header.map(csvEscape).join(';'), ...rows.map(r => r.map(csvEscape).join(';'))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const BOM = '﻿';
  res.send(BOM + lines.join('\r\n'));
}

// Exporta TODOS os pedidos do período/canal/mercado (não só os "recentes" que a tela mostra),
// com filtro opcional de status. `itemsMode` decide se a coluna "Itens" mostra o nº de produtos
// distintos do pedido ou a soma das quantidades (mesmo toggle do card "Pedidos Recentes").
app.get('/api/orders/export', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { market = 'br', channel = 'todos', since = today, until = today, status = 'todos', itemsMode = 'count' } = req.query;
    const orders = exportOrdersList({ market, channel, since, until, status });
    const tz = market === 'us' ? 'America/Los_Angeles' : 'America/Sao_Paulo';
    const itemsHeader = itemsMode === 'qty' ? 'Qtd. de itens' : 'Nº de produtos';
    const rows = orders.map(o => [
      o.name,
      o.customer || '',
      o.statusLabel,
      itemsMode === 'qty' ? o.itemsQty : o.itemsCount,
      new Date(o.createdAt).toLocaleString('pt-BR', { timeZone: tz }),
      o.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ]);
    sendCsv(res, `pedidos_${market}_${since}_a_${until}.csv`,
      ['Código do pedido', 'Cliente', 'Status', itemsHeader, 'Data', 'Valor'], rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Exporta a quantidade vendida de cada produto para planilha. Por enquanto só Shopify US —
// reaproveita computeProducts() (mesma agregação da tela de Produtos: exclui pedido cancelado,
// já desconta devolução via LineItem.currentQuantity, ver CLAUDE.md 4.15) em vez de duplicar a
// lógica de contagem, então a exportação sempre bate com o que a tela mostra.
const EXPORTABLE_PRODUCT_CHANNELS = new Set(['shopify_us']);
app.get('/api/products/export', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { market = 'us', channel = 'shopify_us', since = today, until = today } = req.query;
    if (!EXPORTABLE_PRODUCT_CHANNELS.has(channel)) {
      return res.status(400).json({ error: 'Exportação de produtos disponível apenas para Shopify US por enquanto.' });
    }
    const data = computeProducts({ market, since, until });
    const products = data.channels[channel]?.products || [];
    const rows = products.map(p => [
      p.title,
      Math.round(p.qty),
      p.revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      p.avgTicket.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ]);
    sendCsv(res, `produtos_${channel}_${since}_a_${until}.csv`,
      ['Produto', 'Quantidade vendida', 'Receita (US$)', 'Ticket médio (US$)'], rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Unificador (dentro de Configurações, somente admin) — agrupamento manual global de produtos,
// aplicado no backend (ver metrics.js applyProductGroups) em Revenue/Top Produtos, Segmentos,
// Produtos e Estoque. Grupos por mercado, um título pertence a no máximo um grupo. Ver CLAUDE.md.
app.get('/api/product-groups', requireAdmin, (req, res) => {
  try {
    const { market = 'br' } = req.query;
    res.json({ groups: getProductGroups()[market] || {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/product-groups', requireAdmin, (req, res) => {
  const { market, name, members } = req.body || {};
  if (!market || !name || !Array.isArray(members) || !members.length) {
    return res.status(400).json({ error: 'market, name e members (array não vazio) são obrigatórios.' });
  }
  const groups = upsertProductGroup(market, name, members);
  res.json({ groups });
});
app.post('/api/product-groups/remove-member', requireAdmin, (req, res) => {
  const { market, name, title } = req.body || {};
  if (!market || !name || !title) return res.status(400).json({ error: 'market, name e title são obrigatórios.' });
  const groups = removeFromProductGroup(market, name, title);
  res.json({ groups });
});
app.delete('/api/product-groups', requireAdmin, (req, res) => {
  const { market, name } = req.query;
  if (!market || !name) return res.status(400).json({ error: 'market e name são obrigatórios.' });
  const groups = deleteProductGroup(market, name);
  res.json({ groups });
});
// Liga/desliga global do Unificador — padrão ligado quando ausente (opt-out).
app.get('/api/product-groups/config', requireAdmin, (_req, res) => {
  res.json({ enabled: getProductGroupsEnabled() });
});
app.post('/api/product-groups/config', requireAdmin, (req, res) => {
  const enabled = Boolean((req.body || {}).enabled);
  setProductGroupsEnabled(enabled);
  res.json({ ok: true, enabled });
});
// Catálogo completo (todo o histórico, todos os canais) do mercado — lista de produtos pra
// escolher na tela Unificador. Sem filtro de período, de propósito (é uma tela de catálogo).
app.get('/api/product-groups/catalog', requireAdmin, (req, res) => {
  try {
    const { market = 'br' } = req.query;
    res.json(listProductCatalog({ market }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tipos de produto (Segmentos → "Tipos de produto") — nome + palavras-chave criados pelo usuário,
// buscadas em título/productType/tags de cada item (ver metrics.js classifyTypeGroup). Diferente do
// Unificador, não é admin-only: qualquer usuário com acesso a Segmentos usa essa tela. Ver CLAUDE.md.
app.get('/api/product-types', (req, res) => {
  try {
    const { market = 'br' } = req.query;
    res.json({ types: getProductTypeGroups()[market] || {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/product-types', (req, res) => {
  const { market, name, keywords } = req.body || {};
  if (!market || !name || !Array.isArray(keywords) || !keywords.length) {
    return res.status(400).json({ error: 'market, name e keywords (array não vazio) são obrigatórios.' });
  }
  const types = upsertProductTypeGroup(market, name, keywords);
  res.json({ types });
});
app.post('/api/product-types/remove-keyword', (req, res) => {
  const { market, name, keyword } = req.body || {};
  if (!market || !name || !keyword) return res.status(400).json({ error: 'market, name e keyword são obrigatórios.' });
  const types = removeProductTypeKeyword(market, name, keyword);
  res.json({ types });
});
app.delete('/api/product-types', (req, res) => {
  const { market, name } = req.query;
  if (!market || !name) return res.status(400).json({ error: 'market e name são obrigatórios.' });
  const types = deleteProductTypeGroup(market, name);
  res.json({ types });
});

// Produtos ocultos (controlado no Unificador — "essa função deve estar no unificador, que é onde
// iremos controlar tudo", pedido do Luan 06/08/2026) — palavras-chave buscadas só nas tags de cada
// item (ver metrics.js isHiddenItem); produto que bater sai dos cards normais (Gato/Cão/Outros) de
// Segmentos e vai pro card "Ocultos" lá. Admin-only, mesmo padrão de /api/product-groups (única tela
// que chama esses endpoints é unificador.html — segmentos.html só exibe o resultado já calculado).
app.get('/api/product-hidden-tags', requireAdmin, (req, res) => {
  try {
    const { market = 'br' } = req.query;
    res.json({ tags: getProductHiddenTags()[market] || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/product-hidden-tags', requireAdmin, (req, res) => {
  const { market, tags } = req.body || {};
  if (!market || !Array.isArray(tags) || !tags.length) {
    return res.status(400).json({ error: 'market e tags (array não vazio) são obrigatórios.' });
  }
  res.json({ tags: upsertProductHiddenTags(market, tags) });
});
app.post('/api/product-hidden-tags/remove', requireAdmin, (req, res) => {
  const { market, tag } = req.body || {};
  if (!market || !tag) return res.status(400).json({ error: 'market e tag são obrigatórios.' });
  res.json({ tags: removeProductHiddenTag(market, tag) });
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
      const mlOn = isIntegrationEnabled('mercadolivre_ads');
      const metaOn = isIntegrationEnabled('meta_br');
      const [mlC, metaC] = await Promise.all([
        mlOn ? ml.fetchCampaigns(since, until).catch(() => []) : Promise.resolve([]),
        metaOn ? meta.fetchCampaigns(since, until).catch(() => []) : Promise.resolve([]),
      ]);
      channels.mercadolivre = { available: mlOn && ml.isConfigured(), campaigns: mlC };
      channels.meta = { available: metaOn && meta.isConfigured(), campaigns: metaC };
    } else {
      const usAcc = process.env.META_US_AD_ACCOUNT_ID;
      const metaOn = isIntegrationEnabled('meta_us');
      const googleOn = isIntegrationEnabled('google_ads');
      const [metaC, googleC] = await Promise.all([
        metaOn ? meta.fetchCampaigns(since, until, usAcc).catch(() => []) : Promise.resolve([]),
        googleOn ? googleads.fetchCampaigns(since, until).catch(() => []) : Promise.resolve([]),
      ]);
      channels.meta = { available: metaOn && meta.isConfigured(usAcc), campaigns: metaC };
      channels.google = { available: googleOn && googleads.isConfigured(), campaigns: googleC };
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const data = { market, since, until, channels };
  campaignCache.set(key, { ts: Date.now(), data });
  res.json(data);
});

// Todas as rotas /api/amazon* e /api/amazon-br* (força-sync, backfill, imagens, os vários
// diagnósticos probe-*) disparam chamada real à Amazon SP-API, cota compartilhada e frágil
// entre elas — nunca deixar alguém disparar isso em loop (ver syncLimiter, definido no topo
// do arquivo junto com o rate limit geral).
app.use(['/api/amazon', '/api/amazon-br'], syncLimiter);

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

// Correção pontual (28/07/2026): só pedido com pagamento de verdade conta como venda
// (CLAUDE.md 4.1) — pedido já gravado com status "sem pagamento" (Pending/
// PendingAvailability na Amazon, PENDING/AUTHORIZED no Shopify, confirmed/
// payment_required/payment_in_process no ML) ficou marcado cancelled:false por engano.
// Corrige o flag local de quem já está no banco, sem chamar nenhuma API de novo — ver
// UNPAID_STATUS_BY_CHANNEL em store.js.
app.post('/api/orders/fix-unpaid', (req, res) => {
  try {
    const fixed = fixUnpaidOrders();
    res.json({ ok: true, fixed, message: `${fixed} pedidos sem pagamento confirmado corrigidos (não contam mais como venda).` });
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

let geoRunning = false;
let geoStatus  = null; // último resultado de reconcileGeoFromBling, ver GET /api/status → bling.geo
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
app.post('/api/sync', syncLimiter, async (req, res) => {
  const secret = process.env.SYNC_SECRET;
  if (secret && req.headers['x-sync-token'] !== secret) return res.status(401).json({ error: 'Não autorizado.' });
  try { res.json(await runSync()); }
  catch (e) { res.status(500).json({ error: 'Sync falhou.' }); }
});

// ── Proteção CSRF do OAuth (double-submit cookie) ──
// Nenhuma das 3 integrações validava que o /callback realmente veio de um /connect disparado
// pelo mesmo visitante — sem isso, qualquer pessoa que soubesse a URL de /connect podia
// autorizar o app com a PRÓPRIA conta Shopee/ML/Google Ads dela, e o servidor gravaria esse
// token como se fosse da empresa (sequestro da integração). /connect gera um `state`
// aleatório, grava num cookie httpOnly de curta duração (10min) e manda como parâmetro pro
// provedor; /callback exige o cookie de volta antes de trocar o code por token, e confere
// contra o `state` devolvido pelo provedor quando ele devolve (Mercado Livre e Google Ads
// devolvem; a Shopee pode não devolver, por isso o cookie sozinho já basta nos 3 casos, não
// depende do provedor ecoar o parâmetro). Sem cookie-parser (dependências mínimas do
// projeto) — lê o header Cookie manualmente.
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}
function requireOauthState(req, res, cookieName) {
  const cookieState = readCookie(req, cookieName);
  res.clearCookie(cookieName);
  if (!cookieState) {
    res.status(400).send('Sessão de autorização expirada ou inválida. Volte à dashboard e tente conectar de novo.');
    return null;
  }
  if (req.query.state && req.query.state !== cookieState) {
    res.status(400).send('Parâmetro state inválido. Volte à dashboard e tente conectar de novo.');
    return null;
  }
  return cookieState;
}

// ── Shopee OAuth ──
app.get('/shopee/connect', (req, res) => {
  try {
    const state = crypto.randomBytes(24).toString('hex');
    const url = shopee.buildAuthUrl(state); // pode lançar (não configurada) — não seta cookie nesse caso
    res.cookie('oauth_state_shopee', state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, secure: isHttps(req) });
    res.redirect(url);
  } catch (e) { res.status(400).send(e.message); }
});

app.get('/shopee/callback', async (req, res) => {
  if (!requireOauthState(req, res, 'oauth_state_shopee')) return;
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
  try {
    const state = crypto.randomBytes(24).toString('hex');
    const url = ml.buildAuthUrl(state); // pode lançar (não configurado) — não seta cookie nesse caso
    res.cookie('oauth_state_ml', state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, secure: isHttps(req) });
    res.redirect(url);
  } catch (e) { res.status(400).send(e.message); }
});

app.get('/mercadolivre/callback', async (req, res) => {
  if (!requireOauthState(req, res, 'oauth_state_ml')) return;
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
  try {
    const state = crypto.randomBytes(24).toString('hex');
    const url = googleads.buildAuthUrl(state); // pode lançar (não configurado) — não seta cookie nesse caso
    res.cookie('oauth_state_google', state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, secure: isHttps(req) });
    res.redirect(url);
  } catch (e) { res.status(400).send(e.message); }
});

app.get('/googleads/callback', async (req, res) => {
  if (!requireOauthState(req, res, 'oauth_state_google')) return;
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Faltou o parâmetro "code" do Google Ads.');
    await googleads.exchangeCode(code);
    res.send('<h2>Google Ads conectado com sucesso!</h2><p>Pode fechar esta aba e voltar à dashboard.</p>');
  } catch (e) {
    res.status(500).send('Erro ao conectar o Google Ads: ' + e.message);
  }
});

// ── Shopify Yucaloo OAuth (app novo via Dev Dashboard — ver CLAUDE.md) ──
// Diferente dos /connect acima (o usuário clica num link nosso), aqui é a
// própria Shopify que chama essa URL — é a "URL do app" configurada na Dev
// Dashboard, disparada sempre que o app é aberto/instalado, com
// hmac/host/shop/timestamp assinados em vez de um "code" pronto.
app.get('/shopify-yucaloo/:mkt(br|us)/connect', (req, res) => {
  const mkt = req.params.mkt;
  try {
    if (!shopifyYucaloo.verifyRequest(mkt, req)) return res.status(400).send('Assinatura inválida.');
    const { shop } = req.query;
    if (!shop) return res.status(400).send('Faltou o parâmetro "shop".');
    const state = crypto.randomBytes(24).toString('hex');
    const url = shopifyYucaloo.buildAuthorizeUrl(mkt, shop, state);
    res.cookie(`oauth_state_yucaloo_${mkt}`, state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, secure: isHttps(req) });
    res.redirect(url);
  } catch (e) { res.status(400).send(e.message); }
});

app.get('/shopify-yucaloo/:mkt(br|us)/callback', async (req, res) => {
  const mkt = req.params.mkt;
  if (!requireOauthState(req, res, `oauth_state_yucaloo_${mkt}`)) return;
  try {
    if (!shopifyYucaloo.verifyRequest(mkt, req)) return res.status(400).send('Assinatura inválida.');
    const { code, shop } = req.query;
    if (!code || !shop) return res.status(400).send('Faltou "code"/"shop" no retorno da Shopify.');
    await shopifyYucaloo.exchangeCode(mkt, shop, code);
    res.send('<h2>Yucaloo conectada com sucesso!</h2><p>Pode fechar esta aba e voltar à dashboard.</p>');
  } catch (e) {
    res.status(500).send('Erro ao conectar a Yucaloo: ' + e.message);
  }
});

// ── Bling OAuth (exploratório — ver src/bling.js) ──
app.get('/bling/connect', (req, res) => {
  try {
    const state = crypto.randomBytes(24).toString('hex');
    const url = bling.buildAuthUrl(state); // pode lançar (não configurado) — não seta cookie nesse caso
    res.cookie('oauth_state_bling', state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, secure: isHttps(req) });
    res.redirect(url);
  } catch (e) { res.status(400).send(e.message); }
});

app.get('/bling/callback', async (req, res) => {
  if (!requireOauthState(req, res, 'oauth_state_bling')) return;
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Faltou o parâmetro "code" do Bling.');
    await bling.exchangeCode(code);
    res.send('<h2>Bling conectado com sucesso!</h2><p>Pode fechar esta aba e voltar à dashboard.</p>');
  } catch (e) {
    res.status(500).send('Erro ao conectar o Bling: ' + e.message);
  }
});

// Sonda de exploração (não é usada em nenhum cálculo do dashboard ainda — ver src/bling.js):
// mostra o formato real de pedidos de venda do Bling num intervalo, incluindo o detalhe
// completo (com bloco de transporte/transportadora) dos primeiros pedidos da página.
// Sob o mesmo syncLimiter das rotas Amazon: dispara chamada real à API do Bling, que também
// tem cota própria e apertada (3 req/s, 120k/dia, confirmado na documentação) — nunca martelar.
app.get('/api/bling/probe-orders', syncLimiter, async (req, res) => {
  try {
    const { since, until } = req.query;
    if (!since || !until) return res.status(400).json({ error: 'Parâmetros since/until obrigatórios (YYYY-MM-DD).' });
    res.json(await bling.probeOrders(since, until));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sonda de exploração: lista os canais de venda cadastrados no Bling (nome/tipo de
// cada integração de marketplace), pra traduzir o `loja.unidadeNegocio.id` dos
// pedidos pro canal real (Shopee, Mercado Livre, Shopify, Amazon...). Mesmo cuidado
// de cota do probe-orders acima (syncLimiter).
app.get('/api/bling/canais-venda', syncLimiter, async (req, res) => {
  try {
    res.json(await bling.fetchSalesChannels());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sonda: procura pedidos de um loja.id específico numa janela (barato, só lista, sem
// detalhe por pedido) — usado pra confirmar o formato do numeroLoja de um canal antes de
// habilitá-lo em bling.KNOWN_CHANNELS (ex.: Amazon Brasil).
app.get('/api/bling/probe-channel', syncLimiter, async (req, res) => {
  try {
    const { since, until, lojaId } = req.query;
    if (!since || !until || !lojaId) return res.status(400).json({ error: 'Parâmetros since/until/lojaId obrigatórios.' });
    res.json(await bling.probeChannelOrders(since, until, lojaId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Diagnóstico pontual: confirma se um número que o Bling reporta como "numeroLoja" de um
// pedido Mercado Livre é o order.id de verdade ou o pack_id de um envio agrupado (ver
// ml.probeOrderOrPack) — usado pra investigar por que alguns pedidos ML não casam na
// reconciliação de geografia do Bling. Não é chamado por nenhum sync automático.
app.get('/api/ml/probe-order', syncLimiter, async (req, res) => {
  try {
    const { numero } = req.query;
    if (!numero) return res.status(400).json({ error: 'Parâmetro numero obrigatório.' });
    res.json(await ml.probeOrderOrPack(numero));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Dispara a reconciliação de geografia (preenche `state` de pedidos existentes com o
// endereço do Bling) manualmente, ignorando o throttle — mesmo padrão de
// /api/amazon/sync-names. Progresso em GET /api/status → bling.geo. Nunca cria pedido,
// só enriquece state vazio (ver src/sync.js reconcileGeoFromBling).
app.post('/api/bling/sync-geo', syncLimiter, async (req, res) => {
  if (geoRunning) return res.status(409).json({ error: 'Reconciliação de geografia já em andamento.' });
  geoRunning = true;
  geoStatus = { status: 'running', startedAt: new Date().toISOString() };
  const days = req.query.days ? Number(req.query.days) : undefined;
  reconcileGeoFromBling({ market: req.query.market || 'br', force: true, ...(days ? { days } : {}) })
    .then(r => { geoStatus = { status: 'done', result: r, finishedAt: new Date().toISOString() }; })
    .catch(e => { geoStatus = { status: 'error', message: e.message, finishedAt: new Date().toISOString() }; })
    .finally(() => { geoRunning = false; });
  res.json({ started: true });
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
      // Se true, US e BR estão usando o MESMO token/conta (chamada combinada, cursor
      // 'combined') — se false, são duas contas de verdade com cursores 'us'/'br'
      // independentes. Ver CLAUDE.md 4.7.1 — eram pra ser diferentes desde 09/07/2026;
      // exposto aqui pra confirmar de fora sem adivinhar.
      sameToken:   amazon.isSameToken(),
      cursors: {
        us:       getAmazonCursor('us'),
        br:       getAmazonCursor('br'),
        combined: getAmazonCursor('combined'),
      },
      backoffActive,
      backoffUntil:  backoffActive ? new Date(backoffUntil).toISOString() : null,
      nextSyncIn:    backoffActive ? `${Math.ceil((backoffUntil - Date.now()) / 60000)} min` : 'agora',
      backfill:      getAmazonBackfill(),
      images:        getAmazonImagesJob(),
      items:         itemsStatus,
    },
    amazon_br: {
      configured:  amazon.isConfiguredBR(),
      hasLwa:      has('AMAZON_BR_REFRESH_TOKEN') || (has('AMAZON_REFRESH_TOKEN') && amazon.isSameToken()),
      hasAwsCreds: has('AMAZON_AWS_ACCESS_KEY') && has('AMAZON_AWS_SECRET_KEY'),
      sharedWithUs:  amazon.isSameToken(),
      // Bug corrigido (28/07/2026): mostrava o backoff da US (backoffActive/backoffUntil)
      // em vez do da BR — backoffBRActive/backoffBRUntil já eram calculados acima mas
      // nunca usados aqui.
      backoffActive: backoffBRActive,
      backoffUntil:  backoffBRActive ? new Date(backoffBRUntil).toISOString() : null,
      nextSyncIn:    backoffBRActive ? `${Math.ceil((backoffBRUntil - Date.now()) / 60000)} min` : 'agora',
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
    bling: {
      // Exploratório (ver src/bling.js) — nunca usado em cálculo de receita ainda.
      configured: bling.isConfigured(),
      hasCreds:   has('BLING_CLIENT_ID') && has('BLING_CLIENT_SECRET') && has('BLING_REDIRECT_URL'),
      authorized: Boolean(db.blingTokens),
      geo: geoStatus, // última rodada de reconcileGeoFromBling (preenche state via Bling)
    },
    lastSync: db.lastSync || null,
  });
});

// ── Tela Integrações (dentro de Configurações, somente admin) ──────────────────
// Monta a lista de integrações com status ao vivo, reaproveitando os mesmos checks
// já usados em /api/status acima, mais o liga/desliga persistido (integrationsConfig).
// TOGGLEABLE_KEYS: as únicas chaves que POST /api/integrations/:key/toggle aceita.
const TOGGLEABLE_KEYS = new Set([
  'shopify_br', 'shopify_us', 'shopee', 'mercadolivre', 'mercadolivre_ads',
  'amazon_br', 'amazon_us', 'meta_br', 'meta_us', 'google_ads', 'bling',
  'yucaloo_br', 'yucaloo_us',
]);

function integrationStatus({ key, configured, authorized = true, paused = false, pausedNote = '' }) {
  if (!isIntegrationEnabled(key)) return { state: 'disabled', note: 'Desativada pelo administrador.' };
  if (!configured) return { state: 'not_configured', note: 'Sem credenciais configuradas ainda.' };
  if (!authorized) return { state: 'pending_auth', note: 'Aguardando autorização (fluxo de conexão pendente).' };
  if (paused) return { state: 'paused', note: pausedNote || 'Pausada temporariamente.' };
  return { state: 'connected', note: '' };
}

function computeIntegrationsList() {
  const db = load();
  const has = key => Boolean(process.env[key]);
  const backoffUntil = getAmazonBackoff();
  const backoffActive = backoffUntil > Date.now();
  const backoffBRUntil = getAmazonBRBackoff();
  const backoffBRActive = backoffBRUntil > Date.now();
  const amazonPauseNote = min => `Pausada por ${min} min (cota da Amazon atingida). Volta sozinha.`;

  const items = [
    // ── Brasil · Geral ──
    { key: 'shopify_br', label: 'Shopify', country: 'br', category: 'geral', logo: 'Shopify_logo.png', detail: has('SHOPIFY_STORE') ? process.env.SHOPIFY_STORE : '',
      ...integrationStatus({ key: 'shopify_br', configured: has('SHOPIFY_STORE') && has('SHOPIFY_ADMIN_TOKEN') }) },
    { key: 'yucaloo_br', label: 'Yucaloo', country: 'br', category: 'geral', logo: 'Yucaloo2.webp', detail: getYucalooTokens().br?.shop || '',
      ...integrationStatus({ key: 'yucaloo_br', configured: shopifyYucaloo.isConfigured('br'), authorized: Boolean(getYucalooTokens().br) }) },
    { key: 'shopee', label: 'Shopee', country: 'br', category: 'geral', logo: 'logo-shopee.png', detail: db.shopeeTokens ? 'Loja autorizada' : '',
      ...integrationStatus({ key: 'shopee', configured: shopee.isConfigured(), authorized: Boolean(getShopeeTokens()) }) },
    { key: 'mercadolivre', label: 'Mercado Livre', country: 'br', category: 'geral', logo: 'Logotipo_MercadoLivre.png', detail: db.mlTokens ? 'Conta autorizada' : '',
      ...integrationStatus({ key: 'mercadolivre', configured: ml.isConfigured(), authorized: Boolean(getMlTokens()) }) },
    { key: 'amazon_br', label: 'Amazon', country: 'br', category: 'geral', logo: 'Amazon_logo.png', detail: 'Conta CocoandLuna',
      ...integrationStatus({ key: 'amazon_br', configured: amazon.isConfiguredBR(), paused: backoffBRActive, pausedNote: backoffBRActive ? amazonPauseNote(Math.ceil((backoffBRUntil - Date.now()) / 60000)) : '' }) },
    { key: 'bling', label: 'Bling', country: 'br', category: 'geral', logo: 'logo-bling1.png', detail: 'Informações de ERP para complementar dados dos outros canais',
      ...integrationStatus({ key: 'bling', configured: bling.isConfigured(), authorized: Boolean(db.blingTokens) }) },

    // ── Brasil · Marketing ──
    { key: 'meta_br', label: 'Meta Ads', country: 'br', category: 'marketing', logo: 'logo-meta.png', detail: 'Conta Coco and Luna',
      ...integrationStatus({ key: 'meta_br', configured: meta.isConfigured() }) },
    { key: 'mercadolivre_ads', label: 'Mercado Ads', country: 'br', category: 'marketing', logo: 'Mercado-ADS.png', detail: 'Product Ads do Mercado Livre',
      ...integrationStatus({ key: 'mercadolivre_ads', configured: ml.isConfigured(), authorized: Boolean(getMlTokens()) }) },

    // ── Brasil · Planejadas ──
    { key: null, label: 'Amazon Ads', country: 'br', category: 'planned', logo: 'Amazon_Ads_Horizontal_SquidInk.png', detail: 'Ainda não conectada', state: 'planned', note: '' },
    { key: null, label: 'TikTok Shop', country: 'br', category: 'planned', logo: 'logo-tiktok-shop.png', detail: 'Loja em configuração, sem pedidos ainda', state: 'planned', note: '' },

    // ── Estados Unidos · Geral ──
    { key: 'shopify_us', label: 'Shopify', country: 'us', category: 'geral', logo: 'Shopify_logo.png', detail: has('SHOPIFY_US_STORE') ? process.env.SHOPIFY_US_STORE : '',
      ...integrationStatus({ key: 'shopify_us', configured: has('SHOPIFY_US_STORE') && has('SHOPIFY_US_ADMIN_TOKEN') }) },
    { key: 'yucaloo_us', label: 'Yucaloo', country: 'us', category: 'geral', logo: 'Yucaloo2.webp', detail: getYucalooTokens().us?.shop || '',
      ...integrationStatus({ key: 'yucaloo_us', configured: shopifyYucaloo.isConfigured('us'), authorized: Boolean(getYucalooTokens().us) }) },
    { key: 'amazon_us', label: 'Amazon', country: 'us', category: 'geral', logo: 'Amazon_logo.png', detail: 'Conta VITA PET LIFE',
      ...integrationStatus({ key: 'amazon_us', configured: amazon.isConfigured(), paused: backoffActive, pausedNote: backoffActive ? amazonPauseNote(Math.ceil((backoffUntil - Date.now()) / 60000)) : '' }) },

    // ── Estados Unidos · Marketing ──
    { key: 'meta_us', label: 'Meta Ads', country: 'us', category: 'marketing', logo: 'logo-meta.png', detail: 'Conta Vita Pet Life',
      ...integrationStatus({ key: 'meta_us', configured: meta.isConfigured(process.env.META_US_AD_ACCOUNT_ID) }) },
    { key: 'google_ads', label: 'Google Ads', country: 'us', category: 'marketing', logo: 'google_ads_logo_icon.png', detail: has('GOOGLE_ADS_CUSTOMER_ID') ? 'Conta Coco and Luna' : '',
      ...integrationStatus({ key: 'google_ads', configured: googleads.isConfigured(), authorized: Boolean(db.googleAdsTokens) }) },

    // ── Estados Unidos · Planejadas ──
    { key: null, label: 'Amazon Ads', country: 'us', category: 'planned', logo: 'Amazon_Ads_Horizontal_SquidInk.png', detail: 'Ainda não conectada', state: 'planned', note: '' },
  ];

  // Achata { state, note } no objeto (integrationStatus devolve isso via spread acima).
  return items;
}

app.get('/api/integrations', requireAdmin, (_req, res) => {
  res.json({ integrations: computeIntegrationsList() });
});

app.post('/api/integrations/:key/toggle', requireAdmin, (req, res) => {
  const { key } = req.params;
  if (!TOGGLEABLE_KEYS.has(key)) return res.status(400).json({ error: 'Integração desconhecida.' });
  const enabled = Boolean((req.body || {}).enabled);
  setIntegrationEnabled(key, enabled);
  res.json({ ok: true, key, enabled });
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

  // Geografia via Bling (preenche state vazio — hoje só afeta Shopee, ver src/sync.js).
  // Job próprio, fora do runSync — não disputa a cota do sync principal. A própria função
  // só roda de fato se já passou BLING_GEO_EVERY_HOURS desde a última vez (throttle interno).
  const runBlingGeo = () => {
    if (geoRunning) return;
    geoRunning = true;
    geoStatus = { status: 'running', startedAt: new Date().toISOString(), auto: true };
    reconcileGeoFromBling({ market: 'br' })
      .then(r => { geoStatus = { status: 'done', result: r, finishedAt: new Date().toISOString(), auto: true }; if (r.patched || r.errors.length) console.log('Bling geo:', r); })
      .catch(e => { geoStatus = { status: 'error', message: e.message, finishedAt: new Date().toISOString(), auto: true }; console.error('Bling geo falhou:', e.message); })
      .finally(() => { geoRunning = false; });
  };
  setTimeout(runBlingGeo, 4 * 60 * 1000);       // 4 min após subir (depois do job de nomes)
  setInterval(runBlingGeo, 6 * 60 * 60 * 1000); // a cada 6h (throttle interno também limita)
});
