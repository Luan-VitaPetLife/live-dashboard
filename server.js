// server.js — serve a interface e a API da dashboard.
import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { computeDashboard, computeProducts, computeStock, searchOrders, exportOrdersList, listProductCatalog } from './src/metrics.js';
import { runSync, reconcileAmazonNames, reconcileAmazonReturns, reconcileShopeeReturns, enrichAmazonItems, reconcileGeoFromBling } from './src/sync.js';
import { initStore, getAmazonBackoff, setAmazonBackoff, getAmazonBRBackoff, setAmazonBRBackoff, setAmazonBackoffCount, setAmazonBRBackoffCount, setProductFinance, setProductStock, setProductStockAgg, setAmazonBackfill, getAmazonBackfill, getAmazonProductImages, setAmazonProductImages, getAmazonImagesJob, setAmazonImagesJob, getOrders, upsertOrders, load, removeAmazonMarketLeak, getProductGroups, upsertProductGroup, deleteProductGroup, removeFromProductGroup, getProductGroupsEnabled, setProductGroupsEnabled, getProductGroupTypes, setProductGroupType, getProductTypeGroups, upsertProductTypeGroup, removeProductTypeKeyword, deleteProductTypeGroup, getAmazonCursor, fixUnpaidOrders, getShopeeTokens, getMlTokens, getIntegrationsConfig, setIntegrationEnabled, isIntegrationEnabled, getYucalooTokens, getProductHiddenTags, upsertProductHiddenTags, removeProductHiddenTag, getAmazonRetentionConfig, setAmazonRetentionConfig, countOrdersOlderThan, pruneOrders, getBackupStatus, setShopifyBackfill, getShopifyBackfill, lerHistorico } from './src/store.js';
import * as shopee from './src/shopee.js';
import { comAutor } from './src/autor.js';
import { PAGINAS as PAGINAS_HISTORICO, montar as montarHistorico } from './src/historico.js';
import * as ml from './src/mercadolivre.js';
import * as amazon from './src/amazon.js';
import * as meta from './src/meta.js';
import * as googleads from './src/googleads.js';
import * as bling from './src/bling.js';
import * as shopifyYucaloo from './src/shopifyYucaloo.js';
import * as auth from './src/auth.js';
import { runBackup, runBackupIfDue, isConfigured as isBackupConfigured, listBackups } from './src/backup.js';
import { checkSyncHealth, isConfigured as isAlertsConfigured, sendTelegramMessage } from './src/alerts.js';
import { backfillShopify, lojasDoMercado } from './src/backfill.js';
import rateLimit from 'express-rate-limit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // Railway fica atrás de um proxy TLS — necessário para req.secure
const PORT = process.env.PORT || 3000;

// Detecta se a conexão original (antes do proxy) é HTTPS — usado para o atributo Secure do cookie.
const isHttps = req => req.secure || req.headers['x-forwarded-proto'] === 'https';

// ── Segurança: cabeçalhos defensivos (sem libs externas) ──
// A lista de domínios sai de varrer public/ por "https://", não de um exemplo genérico:
// ECharts e Bootstrap Icons (cdn.jsdelivr.net), Leaflet (unpkg.com), a fonte Inter
// (fonts.googleapis.com serve o CSS, fonts.gstatic.com serve os arquivos .woff2), o tile
// server do mapa e a malha do IBGE.
// ATENÇÃO ao mexer: um domínio que falta aqui é bloqueado SEM erro visível na tela — as
// páginas continuam abrindo, só que sem o recurso. Foi o que aconteceu com a Inter: o <link>
// do HTML estava certo, faltava liberar o domínio aqui, e a dashboard inteira rodou na fonte
// do sistema sem ninguém entender por quê. Uma folha do Google Fonts precisa de DOIS
// domínios: googleapis em style-src e gstatic em font-src.
// 'unsafe-inline' em script-src/style-src continua exigido, e não é mais pelo motivo antigo:
// a lógica e o estilo das páginas já saíram do HTML (public/js/paginas/, public/css/paginas/).
// O que ainda o exige são os ATRIBUTOS: onclick= e afins no markup (inclusive no markup que os
// próprios scripts geram em tempo de execução) e style= direto na tag. Enquanto existir um só
// deles, tirar 'unsafe-inline' quebra a página em silêncio. A regra atual ainda barra script de
// domínio externo, que é o vetor mais comum de roubo de cookie via XSS refletido; o que ela não
// barra é XSS inline. Fechar de vez depende de trocar cada atributo por addEventListener e por
// classe de CSS — não de ajustar esta regra.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com",
  // Imagem de produto (Shopify BR/US, Shopee, Mercado Livre, e futuramente Amazon) vem de
  // URL dinâmica de CDN de cada marketplace — nunca é um domínio fixo no código, é campo de
  // resposta de API (cdn.shopify.com, http2.mlstatic.com, subdomínios de img.susercontent.com
  // da Shopee que variam...). Travar por domínio aqui viraria uma lista sempre desatualizada
  // e quebrando imagem sem aviso; liberar https: geral pra img-src é o padrão pragmático (o
  // vetor de ataque de <img src> é bem mais fraco que script-src/connect-src, que continuam travados).
  "img-src 'self' data: https:",
  "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:",
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

// Resolve o usuário do cookie de sessão em TODA requisição, e deixa o nome dele disponível pra
// qualquer gravação que aconteça durante o atendimento dela — é assim que o "Histórico" sabe
// quem editou sem que cada rota precise passar o autor adiante (ver src/autor.js).
app.use((req, _res, next) => {
  const t = auth.parseCookies(req)[auth.SESSION_COOKIE_NAME];
  req.authToken = t || null;
  req.authUser = t ? auth.userFromToken(t) : null;
  comAutor(req.authUser?.name || null, next);
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
  produtos: 'produtos.html',
  estoque: 'estoque.html',
  campanhas: 'campanhas.html',
  configuracoes: 'configuracoes.html',
  integracoes: 'integracoes.html',
  unificador: 'unificador.html',
  historico: 'historico.html',
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

// Geografia BR/EUA virou uma página só com seletor de país embutido (ver CLAUDE.md) —
// bookmarks antigos pro slug separado continuam funcionando, só passam a abrir a
// página unificada já no mercado EUA.
app.get(['/geografia-us', '/geografia-us.html'], (req, res) => res.redirect(301, '/geografia?market=us'));

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
    if ((file === 'configuracoes.html' || file === 'integracoes.html' || file === 'unificador.html' || file === 'historico.html') && user.role !== 'admin') return res.redirect('/');
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
    // Período de comparação escolhido à mão (botão "Trocar" no card de Insights). Data fora do
    // formato é ignorada em vez de virar erro: a comparação volta a ser a automática, que é o
    // comportamento de sempre, em vez de a tela inteira falhar por causa de um parâmetro.
    const dataOk = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    let compSince = dataOk(req.query.prevSince) ? req.query.prevSince : null;
    let compUntil = dataOk(req.query.prevUntil) ? req.query.prevUntil : null;
    if (compSince && compUntil && compSince > compUntil) [compSince, compUntil] = [compUntil, compSince];
    res.json(computeDashboard({ channel, metric, since, until, market, amazonRevenueMode, compSince, compUntil }));
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

// Mesmo texto dos badges de canal do cliente (CocoColors.ch, ver public/colors.js DEFAULT_CH) —
// duplicado de propósito aqui (server-side, só pra exportação), mesmo padrão de outras tabelas
// estáticas já duplicadas no projeto (ver CLAUDE.md, "Onde os produtos vendem").
const CHANNEL_LABEL_PT = {
  shopify: 'Shopify - Coco and Luna BR', shopify_us: 'Shopify - Coco and Luna EUA',
  shopee: 'Shopee', mercadolivre: 'Mercado Livre',
  amazon: 'Amazon BR', amazon_us: 'Amazon EUA',
  yucaloo_br: 'Shopify - Yucaloo BR', yucaloo_us: 'Shopify - Yucaloo EUA',
};

// Colunas disponíveis pro export dinâmico de "Pedidos Recentes" (popup de reorganizar/adicionar/
// tirar colunas, ver public/index.html). `cols` na query string é uma lista ordenada de chaves
// separada por vírgula — controla tanto QUAIS colunas saem quanto EM QUE ORDEM.
const EXPORT_COLUMNS = {
  name:        { header: 'Pedido',              get: o => o.name },
  createdAt:   { header: 'Data/Hora da compra',  get: (o, tz) => new Date(o.createdAt).toLocaleString('pt-BR', { timeZone: tz }) },
  customer:    { header: 'Cliente',              get: o => o.customer || '' },
  statusLabel: { header: 'Situação',             get: o => o.statusLabel },
  total:       { header: 'Valor',                get: o => o.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
  channel:     { header: 'Canal',                get: o => CHANNEL_LABEL_PT[o.channel] || o.channel },
  products:    { header: 'Produto(s)',           get: o => (o.products || []).join(', ') },
  itemsCount:  { header: 'Nº de produtos',       get: o => o.itemsCount },
  itemsQty:    { header: 'Qtd. de itens',        get: o => o.itemsQty },
};
const DEFAULT_EXPORT_COLS = ['name', 'createdAt', 'customer', 'statusLabel', 'total', 'channel'];

// Exporta TODOS os pedidos do período/canal/mercado (não só os "recentes" que a tela mostra),
// com filtro opcional de status e colunas dinâmicas (`cols`, ver EXPORT_COLUMNS acima).
app.get('/api/orders/export', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { market = 'br', channel = 'todos', since = today, until = today, status = 'todos', cols } = req.query;
    const orders = exportOrdersList({ market, channel, since, until, status });
    const tz = market === 'us' ? 'America/Los_Angeles' : 'America/Sao_Paulo';
    const requested = cols ? String(cols).split(',').filter(k => EXPORT_COLUMNS[k]) : [];
    const useCols = requested.length ? requested : DEFAULT_EXPORT_COLS;
    const header = useCols.map(k => EXPORT_COLUMNS[k].header);
    const rows = orders.map(o => useCols.map(k => EXPORT_COLUMNS[k].get(o, tz)));
    sendCsv(res, `pedidos_${market}_${since}_a_${until}.csv`, header, rows);
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
      return res.status(400).json({ error: 'Exportação de produtos disponível apenas para Shopify - Coco and Luna EUA por enquanto.' });
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
    res.json({ groups: getProductGroups()[market] || {}, types: getProductGroupTypes()[market] || {} });
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
// "Tag mãe" do grupo: o tipo (forma física) e a categoria de um grupo unificado, definidos à mão
// em vez de inferidos das vendas do período. Ver setProductGroupType (store.js) e resolveGroupTypes
// (metrics.js) pro porquê. Campo vazio limpa aquele eixo e volta pro automático.
app.post('/api/product-groups/type', requireAdmin, (req, res) => {
  const { market, name } = req.body || {};
  if (!market || !name) return res.status(400).json({ error: 'market e name são obrigatórios.' });
  const patch = {};
  for (const k of ['type', 'typeGroup']) if (k in (req.body || {})) patch[k] = req.body[k];
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'informe type e/ou typeGroup.' });
  const types = setProductGroupType(market, name, patch);
  res.json({ types });
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

// Produtos ocultos (controlado no Unificador — "essa função deve estar no unificador, que é onde iremos
// controlar tudo") — palavras-chave buscadas só nas tags de cada item (ver metrics.js isHiddenItem);
// produto que bater sai dos cards normais (Gato/Cachorro/Outros) de Segmentos e vai pro card "Ocultos"
// lá. Admin-only, mesmo padrão de /api/product-groups (única tela que chama esses endpoints é
// unificador.html — segmentos.html só exibe o resultado já calculado).
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

// Estoque + produção por canal (para a tela de Estoque) — período do seletor da tela; sem
// since/until, cai nos últimos 30 dias corridos (ver computeStock). Sem cache.
app.get('/api/stock', (req, res) => {
  try {
    const { market = 'br', since, until } = req.query;
    res.json(computeStock({ market, since, until }));
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

// Cancelamento cooperativo dos jobs em segundo plano (botão × no widget flutuante). Só os três
// jobs com loop em etapas (backfill/imagens/itens da Amazon) têm ponto seguro pra checar a flag
// no meio do caminho — backup e geografia via Bling terminam em segundos e não valem o risco de
// interromper no meio de um upload/gravação, então não entram em CANCELABLE_JOB_IDS (o botão
// nem aparece pra eles).
class JobCancelledError extends Error {}
const CANCELABLE_JOB_IDS = new Set(['amazon-backfill', 'amazon-images', 'amazon-items', 'shopify-backfill']);
const cancelFlags = {};
function checkCancelled(jobId) {
  if (cancelFlags[jobId]) { cancelFlags[jobId] = false; throw new JobCancelledError('Cancelado pelo usuário'); }
}

// Um "running" persistido sobrevive a um reinício do servidor no meio do processo (deploy no meio
// de um backfill, por exemplo — ver CLAUDE.md 4.7.3) porque a flag *Running em memória zera
// sozinha ao reiniciar, mas ninguém nunca escreve por cima do status salvo em kv. Usado tanto por
// GET /api/status quanto por GET /api/jobs — precisavam concordar: antes só /api/jobs (o widget)
// detectava isso, então o painel de Integrações (que lê /api/status pra saber se pode reativar o
// botão "Aplicar") ficava com o botão travado pra sempre olhando pro mesmo job fantasma que o
// widget já mostrava como erro (reportado em produção — via CLAUDE.md "Campanhas": os dois
// lugares que mostram o mesmo dado nunca podem discordar).
// 'amazon-returns' tem a folga maior de todos de propósito: a varredura funda espera a cota de
// download da Amazon (~1 extrato por minuto), então dezenas de extratos levam mais de meia hora
// sem que nada esteja travado.
const STALE_AFTER_MS = { 'amazon-backfill': 45 * 60 * 1000, 'shopify-backfill': 45 * 60 * 1000, 'amazon-images': 20 * 60 * 1000, 'amazon-items': 20 * 60 * 1000, 'amazon-returns': 90 * 60 * 1000, 'bling-geo': 10 * 60 * 1000, 'backup': 10 * 60 * 1000 };
function destaleJob(jobId, raw) {
  if (!raw || raw.status !== 'running' || !raw.startedAt) return raw;
  const age = Date.now() - Date.parse(raw.startedAt);
  if (age <= (STALE_AFTER_MS[jobId] || 30 * 60 * 1000)) return raw;
  return { ...raw, status: 'error', message: 'Interrompido — sem resposta por tempo demais (provável reinício do servidor no meio do processo). Pode tentar de novo.' };
}

// Backfill histórico da Amazon via Reports API. Roda em background (leva minutos:
// cada janela de 30 dias é um relatório que a Amazon monta e nós baixamos) e responde
// na hora. Progresso em GET /api/status → amazon.backfill. Ver CLAUDE.md 4.7.3.
let backfillRunning = false;
// Extraído do handler abaixo pra ser reaproveitado por /api/amazon/history (painel unificado de
// retenção+histórico em Integrações) — mesmo job em background, mesma forma de acompanhar
// progresso (GET /api/status → amazon.backfill).
function startBackfillJob(market, days, startedBy) {
  backfillRunning = true;
  // Progresso aproximado: a Amazon exige relatório por janela de 30 dias (REPORT_CHUNK_DAYS em
  // amazon.js) — cada onChunk é uma janela concluída, então chunk/totalChunks já dá uma % real
  // pro widget de progresso, sem precisar mexer no amazon.js.
  const totalChunks = Math.max(1, Math.ceil(days / 30));
  let chunksDone = 0;
  setAmazonBackfill({ status: 'running', market, days, orders: 0, progressPct: 0, message: 'iniciando', startedBy, startedAt: new Date().toISOString() });

  (async () => {
    let orders = 0;
    try {
      await amazon.backfillOrders({
        market, days,
        onProgress: message => {
          checkCancelled('amazon-backfill');
          setAmazonBackfill({ status: 'running', market, days, orders, progressPct: Math.round(chunksDone / totalChunks * 100), message, startedBy, startedAt: new Date().toISOString() });
        },
        onChunk: chunk => {
          checkCancelled('amazon-backfill');
          upsertOrders(chunk);           // grava lote a lote: uma falha adiante não perde o que já veio
          orders += chunk.length;
          chunksDone++;
          setAmazonBackfill({ status: 'running', market, days, orders, progressPct: Math.round(Math.min(chunksDone, totalChunks) / totalChunks * 100), message: `${orders} pedidos gravados`, startedBy, startedAt: new Date().toISOString() });
        },
      });
      setAmazonBackfill({ status: 'done', market, days, orders, progressPct: 100, message: `concluído — ${orders} pedidos`, startedBy, finishedAt: new Date().toISOString() });
    } catch (e) {
      if (e instanceof JobCancelledError) {
        setAmazonBackfill({ status: 'cancelled', market, days, orders, message: `cancelado — ${orders} pedidos já gravados até aqui`, startedBy, finishedAt: new Date().toISOString() });
      } else {
        setAmazonBackfill({ status: 'error', market, days, orders, message: e.message, startedBy, finishedAt: new Date().toISOString() });
        console.error('Backfill Amazon falhou:', e.message);
      }
    } finally {
      backfillRunning = false;
    }
  })();
}

app.post('/api/amazon/backfill', (req, res) => {
  if (backfillRunning) return res.status(409).json({ error: 'Backfill já em andamento.' });

  const days   = Math.min(Number(req.query.days || 90), 730);
  const market = req.query.market === 'br' ? 'br' : 'us';

  startBackfillJob(market, days, req.authUser?.name || req.authUser?.username || null);

  res.json({ ok: true, message: `Backfill de ${days} dias (${market.toUpperCase()}) iniciado. Acompanhe em GET /api/status.` });
});

// Backfill histórico das lojas Shopify (Coco and Luna + Yucaloo). Mesmo papel do backfill da
// Amazon acima, e por isso a mesma forma: roda em background, grava bloco a bloco e responde na
// hora. Chave de estado própria (shopifyBackfill) porque os dois podem rodar ao mesmo tempo —
// APIs e cotas diferentes — e um não pode sobrescrever o progresso do outro.
let shopifyBackfillRunning = false;
function startShopifyBackfillJob(market, days, startedBy) {
  shopifyBackfillRunning = true;
  const base = { market, days, startedBy };
  setShopifyBackfill({ ...base, status: 'running', orders: 0, progressPct: 0, message: 'iniciando', startedAt: new Date().toISOString() });

  (async () => {
    let orders = 0;
    const startedAt = new Date().toISOString();
    const pct = p => (p && p.total ? Math.round(Math.min(p.feitos, p.total) / p.total * 100) : 0);
    try {
      const r = await backfillShopify({
        market, days,
        onProgress: (message, p) => {
          checkCancelled('shopify-backfill');
          setShopifyBackfill({ ...base, status: 'running', orders, progressPct: pct(p), message, startedAt });
        },
        onChunk: lote => {
          checkCancelled('shopify-backfill');
          upsertOrders(lote);          // grava bloco a bloco: uma falha adiante não perde o que já veio
          orders += lote.length;
        },
      });
      const aviso = r.falhas?.length ? ` (${r.falhas.length} janela(s) falharam)` : '';
      setShopifyBackfill({ ...base, status: 'done', orders, progressPct: 100, message: `concluído — ${orders} pedidos${aviso}`, falhas: r.falhas || [], porLoja: r.porLoja || {}, finishedAt: new Date().toISOString() });
      if (r.falhas?.length) console.error('Backfill Shopify terminou com falhas:', r.falhas.join(' | '));
    } catch (e) {
      if (e instanceof JobCancelledError) {
        setShopifyBackfill({ ...base, status: 'cancelled', orders, message: `cancelado — ${orders} pedidos já gravados até aqui`, finishedAt: new Date().toISOString() });
      } else {
        setShopifyBackfill({ ...base, status: 'error', orders, message: e.message, finishedAt: new Date().toISOString() });
        console.error('Backfill Shopify falhou:', e.message);
      }
    } finally {
      shopifyBackfillRunning = false;
    }
  })();
}

// Onde o histórico de cada mercado começa hoje, e quais lojas Shopify o backfill alcançaria.
// É o que o painel de Integrações mostra antes de você escolher quantos dias buscar: sem isso a
// tela pediria um número sem dizer contra o que ele está sendo comparado.
// As lojas Shopify de cada mercado, e quanto histórico elas já têm. Os campos são os mesmos que
// /api/amazon/history devolve, de propósito: a tela mostra a mesma frase nas quatro linhas, e
// duas frases diferentes pro mesmo tipo de informação era o que fazia o painel parecer dois
// painéis sem relação.
app.get('/api/shopify/history', requireAdmin, (_req, res) => {
  const porMercado = {};
  for (const market of ['br', 'us']) {
    const lojas = lojasDoMercado(market);
    const canais = market === 'br' ? ['shopify', 'yucaloo_br'] : ['shopify_us', 'yucaloo_us'];
    const h = historicoDosCanais(canais, market);
    porMercado[market] = {
      totalOrders: h.orders,
      oldestOrderDate: h.oldestDate,
      oldestOrderDays: h.oldestDays,
      lojas: lojas.map(l => l.nome),
    };
  }
  res.json(porMercado);
});

app.post('/api/shopify/backfill', requireAdmin, (req, res) => {
  if (shopifyBackfillRunning) return res.status(409).json({ error: 'Já existe uma busca de histórico Shopify em andamento.' });

  const days   = Math.min(Math.max(Number(req.query.days || 365), 1), 1825);
  const market = req.query.market === 'us' ? 'us' : 'br';

  startShopifyBackfillJob(market, days, req.authUser?.name || req.authUser?.username || null);

  res.json({ ok: true, message: `Busca de ${days} dias de histórico Shopify (${market.toUpperCase()}) iniciada. Acompanhe em GET /api/jobs.` });
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

  const startedBy = req.authUser?.name || req.authUser?.username || null;
  imagesJobRunning = true;
  setAmazonImagesJob({ status: 'running', market, total: asins.length, found: 0, message: 'iniciando', startedBy, startedAt: new Date().toISOString() });

  (async () => {
    try {
      const found = await amazon.fetchProductImages(asins, market, message => {
        checkCancelled('amazon-images');
        setAmazonImagesJob({ status: 'running', market, total: asins.length, found: 0, message, startedBy, startedAt: new Date().toISOString() });
      });
      setAmazonProductImages({ ...getAmazonProductImages(), ...Object.fromEntries(found) });
      setAmazonImagesJob({ status: 'done', market, total: asins.length, found: found.size, message: `concluído — ${found.size}/${asins.length} imagens encontradas`, startedBy, finishedAt: new Date().toISOString() });
    } catch (e) {
      if (e instanceof JobCancelledError) {
        setAmazonImagesJob({ status: 'cancelled', market, total: asins.length, found: 0, message: 'cancelado pelo usuário', startedBy, finishedAt: new Date().toISOString() });
      } else {
        setAmazonImagesJob({ status: 'error', market, total: asins.length, found: 0, message: e.message, startedBy, finishedAt: new Date().toISOString() });
        console.error('Busca de imagens Amazon falhou:', e.message);
      }
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

// Forçar a reconciliação de devoluções da Amazon (relatório de devoluções da FBA). A Amazon
// não marca devolução no pedido — este relatório é a única fonte que o papel do app alcança
// (ver src/sync.js). Ignora o throttle e roda em background; confirme em "Pedidos recentes",
// o pedido devolvido passa a mostrar a tag "Reembolsado".
app.post('/api/amazon/sync-returns', requireAdmin, (req, res) => {
  if (backfillRunning) return res.status(409).json({ error: 'Backfill em andamento — tente depois que terminar.' });
  if (returnsRunning) return res.status(409).json({ error: 'Já tem uma busca de reembolsos rodando.' });
  const markets = req.query.market === 'br' ? ['br'] : req.query.market === 'us' ? ['us'] : ['us', 'br'];
  // Varredura funda pra recuperar reembolso antigo: cada extrato de repasse é um download, e a
  // cota é de ~1 por minuto, então `docs` alto faz a rodada demorar dezenas de minutos. É o preço
  // de consertar quantidade de período passado.
  const dias = Math.min(730, Math.max(1, Number(req.query.days) || 60));
  const docs = Math.min(40, Math.max(1, Number(req.query.docs) || 6));
  const market = markets.length === 1 ? markets[0] : 'br';

  returnsRunning = true;
  returnsStatus = { status: 'running', market, message: 'iniciando', startedBy: req.authUser?.name || null, startedAt: new Date().toISOString() };
  reconcileAmazonReturns({
    markets, force: true, dias, docs,
    onProgress: m => { returnsStatus = { ...returnsStatus, status: 'running', message: m }; },
  })
    .then(r => {
      const marcados = r.patched || 0;
      // A mensagem final diz o número, não "concluído": o que interessa é se algum pedido mudou.
      returnsStatus = { ...returnsStatus, status: r.errors.length ? 'error' : 'done',
        message: r.errors.length ? r.errors.join(' · ') : `${marcados} pedido(s) marcado(s) como reembolsado`,
        result: r, finishedAt: new Date().toISOString() };
      console.log('Amazon reembolsos (manual):', r);
    })
    .catch(e => {
      returnsStatus = { ...returnsStatus, status: 'error', message: e.message, finishedAt: new Date().toISOString() };
      console.error('Amazon reembolsos (manual) falhou:', e.message);
    })
    .finally(() => { returnsRunning = false; });

  res.json({ ok: true, message: `Busca de reembolsos (${markets.join(', ')}, ${dias} dias, até ${docs} repasses) iniciada. Acompanhe no card de processos.` });
});

// Diagnóstico do relatório de REPASSE (settlement) da Amazon, que é o extrato do dinheiro.
// Ele enxerga reembolso que o relatório de devoluções NÃO enxerga: quando o dinheiro volta sem a
// mercadoria voltar, não existe devolução pra registrar, e só o repasse mostra. Sem PII — o
// settlement não traz nome nem endereço de comprador, só número de pedido, SKU e valor.
// `orderIds` (separados por vírgula) filtra as linhas de pedidos específicos.
app.get('/api/amazon/settlement-probe', requireAdmin, async (req, res) => {
  const market = req.query.market === 'us' ? 'us' : 'br';
  const days   = Math.min(365, Math.max(1, Number(req.query.days) || 60));
  const limite = Math.min(15, Math.max(1, Number(req.query.limite) || 3));
  const orderIds = String(req.query.orderIds || '').split(',').map(x => x.trim()).filter(Boolean);
  try { res.json(await amazon.inspectSettlementRefunds({ market, days, orderIds, limite })); }
  catch (e) { res.status(500).json({ error: e.message }); }
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

// Histórico da Amazon por mercado (BR/EUA separados) — painel único em Integrações, pedido do
// Luan 18/08/2026 (Amazon EUA sozinha soma ~342 mil pedidos/ano, muito mais que os outros
// canais). Um campo só, "dias de histórico desejado" — nada de "retenção" e "buscar mais
// histórico" como dois controles separados (confundia: o usuário perguntou se um somava com o
// outro). GET devolve a janela hoje + quantos dias o pedido mais antigo já cobre, pra tela poder
// mostrar o estado atual. /preview diz de antemão qual ação o número resultaria (podar, buscar
// mais, ou nada), sem fazer nada — POST decide e executa a mesma coisa de verdade:
//   • pedido mais antigo é MAIS VELHO que o pedido → sobra dado, poda (só a poda pede prévia +
//     confirmação no frontend antes de chamar aqui — é a única ação que apaga pedido de verdade,
//     mesmo cuidado do quase-desastre de 10/07/2026 documentado em sync.js);
//   • pedido mais antigo é MAIS NOVO que o pedido (ou não existe nenhum ainda) → falta dado,
//     dispara backfill (só soma, não precisa de confirmação) — reaproveita o job de
//     startBackfillJob(), reconstrói a janela inteira em vez de só o trecho novo (mais simples;
//     upsert por id não duplica, só reprocessa relatório que já tinha sido baixado antes).
// A config salva (kv.amazonRetentionConfig) também é o que sync.js usa pra poda automática do
// dia-a-dia — um valor só, uma fonte de verdade.
const AMAZON_RETENTION_CHANNEL = { br: 'amazon', us: 'amazon_us' };
// Quanto histórico existe hoje para um conjunto de canais dentro de um mercado.
// Serve aos dois painéis de histórico (Amazon e Shopify), e é por isso que recebe uma LISTA de
// canais: a Amazon tem um canal por mercado, a Shopify tem duas lojas (Coco and Luna e Yucaloo).
// Medir por canal e não por mercado é o que importa aqui — getOldestOrderDate(market) devolveria
// o pedido mais antigo de QUALQUER canal, e o painel da Shopify chegou a mostrar a data da
// Amazon BR como se fosse o começo do histórico das lojas Shopify.
function historicoDosCanais(canais, market) {
  let orders = 0, oldest = null;
  for (const channel of canais) {
    const lista = getOrders({ channel, market });
    orders += lista.length;
    for (const o of lista) if (oldest === null || o.createdAt < oldest) oldest = o.createdAt;
  }
  return {
    orders,
    oldestDate: oldest ? String(oldest).slice(0, 10) : null,
    oldestDays: oldest ? Math.floor((Date.now() - new Date(oldest).getTime()) / 864e5) : null,
  };
}
function oldestOrderAgeDays(channel, market) {
  return historicoDosCanais([channel], market).oldestDays;
}
function planAmazonHistory(market, days) {
  const channel = AMAZON_RETENTION_CHANNEL[market];
  const { orders: totalOrders, oldestDate: oldestOrderDate, oldestDays: oldestOrderDays } =
    historicoDosCanais([channel], market);
  if (days === 0) return { action: 'unlimited', totalOrders, oldestOrderDate, oldestOrderDays };
  if (oldestOrderDays === null) return { action: 'backfill', missingDays: days, totalOrders, oldestOrderDate, oldestOrderDays };
  if (oldestOrderDays > days) {
    const cutoff = new Date(Date.now() - days * 864e5).toISOString();
    return { action: 'prune', wouldDelete: countOrdersOlderThan({ channel, olderThanIso: cutoff }), totalOrders, oldestOrderDate, oldestOrderDays };
  }
  if (oldestOrderDays < days) return { action: 'backfill', missingDays: days - oldestOrderDays, totalOrders, oldestOrderDate, oldestOrderDays };
  return { action: 'noop', totalOrders, oldestOrderDate, oldestOrderDays };
}

app.get('/api/amazon/history', requireAdmin, (_req, res) => {
  const cfg = getAmazonRetentionConfig();
  const legacyDefault = Number(process.env.AMAZON_RETENTION_DAYS || 0);
  const out = {};
  for (const mkt of ['br', 'us']) {
    const days = cfg[mkt] ?? legacyDefault;
    out[mkt] = { days, ...planAmazonHistory(mkt, days) };
  }
  res.json(out);
});

app.get('/api/amazon/history/preview', requireAdmin, (req, res) => {
  const market = req.query.market === 'br' ? 'br' : 'us';
  const days = Number(req.query.days);
  if (!(days >= 0)) return res.status(400).json({ error: 'days precisa ser um número ≥ 0.' });
  res.json({ market, days, ...planAmazonHistory(market, days) });
});

app.post('/api/amazon/history', requireAdmin, (req, res) => {
  const market = req.body?.market === 'br' ? 'br' : req.body?.market === 'us' ? 'us' : null;
  const days = Number(req.body?.days);
  if (!market) return res.status(400).json({ error: 'market precisa ser "br" ou "us".' });
  if (!(days >= 0)) return res.status(400).json({ error: 'days precisa ser um número ≥ 0 (0 = sem limite).' });

  const cfg = getAmazonRetentionConfig();
  cfg[market] = days;
  setAmazonRetentionConfig(cfg);

  const plan = planAmazonHistory(market, days);
  if (plan.action === 'prune') {
    const channel = AMAZON_RETENTION_CHANNEL[market];
    const cutoff = new Date(Date.now() - days * 864e5).toISOString();
    const deleted = pruneOrders({ channels: [channel], olderThanIso: cutoff });
    return res.json({ ok: true, action: 'pruned', market, days, deleted });
  }
  if (plan.action === 'backfill') {
    if (backfillRunning) return res.status(409).json({ error: 'Já existe uma busca de histórico em andamento — espere terminar e aplique de novo.' });
    startBackfillJob(market, days, req.authUser?.name || req.authUser?.username || null);
    return res.json({ ok: true, action: 'backfill_started', market, days });
  }
  res.json({ ok: true, action: plan.action, market, days });
});

// Backup diário do banco pra Backblaze B2 (ver src/backup.js) — sem plano Pro no Railway não
// existe backup automático do Postgres. GET devolve status configurado + último resultado +
// lista dos backups guardados hoje no bucket. POST dispara um backup na hora (ex.: testar a
// configuração antes de esperar o job automático).
let backupRunning = false;
app.get('/api/backup/status', requireAdmin, async (_req, res) => {
  try {
    const configured = isBackupConfigured();
    const last = getBackupStatus();
    const files = configured ? await listBackups() : [];
    res.json({ configured, running: backupRunning, last, files: files.map(f => ({ fileName: f.fileName, sizeBytes: f.contentLength, uploadedAt: new Date(f.uploadTimestamp).toISOString() })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/backup/run', requireAdmin, async (req, res) => {
  if (backupRunning) return res.status(409).json({ error: 'Backup já em andamento.' });
  if (!isBackupConfigured()) return res.status(400).json({ error: 'Backup não configurado (faltam B2_KEY_ID/B2_APPLICATION_KEY/B2_BUCKET_NAME).' });
  backupRunning = true;
  try {
    const result = await runBackup(req.authUser?.name || req.authUser?.username || null);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    backupRunning = false;
  }
});

// Alerta de sync travado via Telegram (src/alerts.js) — POST manda uma mensagem de teste, pra
// confirmar TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID sem esperar um canal ficar horas travado de verdade.
app.post('/api/alerts/test', requireAdmin, async (req, res) => {
  if (!isAlertsConfigured()) return res.status(400).json({ error: 'Alerta não configurado (faltam TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID).' });
  try {
    const by = req.authUser?.name || req.authUser?.username || 'alguém';
    await sendTelegramMessage(`🔔 Teste de alerta disparado por ${by} — se você recebeu isso, está tudo certo.`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Correção pontual: só pedido com pagamento de verdade conta como venda (CLAUDE.md 4.1) —
// pedido já gravado com status "sem pagamento" (Pending/PendingAvailability na Amazon,
// PENDING/AUTHORIZED no Shopify, confirmed/payment_required/payment_in_process no ML) ficou
// marcado cancelled:false por engano. Corrige o flag local de quem já está no banco, sem chamar
// nenhuma API de novo — ver UNPAID_STATUS_BY_CHANNEL em store.js.
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
// Estado do job de reembolsos, pro widget de processos. Sem isto o botão de Integrações dispara e
// some: quem clicou nunca saberia se achou reembolso, se deu erro ou se ainda está rodando — e
// aqui isso importa, porque o resultado mexe em quantidade vendida.
let returnsStatus  = null;
let returnsRunning = false;

let geoRunning = false;
let geoStatus  = null; // último resultado de reconcileGeoFromBling, ver GET /api/status → bling.geo
app.post('/api/amazon/fetch-items', (req, res) => {
  if (itemsRunning) return res.status(409).json({ error: 'Busca de itens já em andamento.' });
  const market = req.query.market === 'us' ? 'us' : 'br';
  const limit  = Math.min(Number(req.query.limit || 1000), 5000);
  const startedBy = req.authUser?.name || req.authUser?.username || null;
  itemsRunning = true;
  itemsStatus  = { status: 'running', market, message: 'iniciando', startedBy, startedAt: new Date().toISOString() };
  enrichAmazonItems({ market, limit, onProgress: m => {
    checkCancelled('amazon-items');
    itemsStatus = { status: 'running', market, message: m, startedBy, startedAt: itemsStatus.startedAt };
  } })
    .then(r => { itemsStatus = { status: 'done', market, result: r, startedBy, finishedAt: new Date().toISOString() }; console.log('Amazon itens:', r); })
    .catch(e => {
      if (e instanceof JobCancelledError) {
        itemsStatus = { status: 'cancelled', market, message: 'cancelado pelo usuário', startedBy, finishedAt: new Date().toISOString() };
      } else {
        itemsStatus = { status: 'error', market, message: e.message, startedBy, finishedAt: new Date().toISOString() };
        console.error('Amazon itens falhou:', e.message);
      }
    })
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

// Diagnóstico das devoluções da Shopee: devolve o ESQUELETO da resposta da API de devolução
// (nomes de campo, sem nome/endereço/comentário de comprador). A documentação pública não expõe
// esses nomes, então o mapeamento só será escrito depois de ver a resposta real — o mesmo
// caminho usado na Amazon. Ver src/shopee.js (probeReturns).
app.get('/api/shopee/probe-returns', requireAdmin, async (req, res) => {
  const days = Math.min(180, Math.max(1, Number(req.query.days) || 60));
  try { res.json(await shopee.probeReturns({ days })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Releitura manual das devoluções da Shopee. Diferente da Amazon, aqui não é job em segundo
// plano: é uma chamada só, responde em segundos. O sync normal já faz isso a cada ciclo — este
// endpoint serve pra conferir o resultado na hora (`porStatus` mostra o que ficou de fora).
app.post('/api/shopee/sync-returns', requireAdmin, async (req, res) => {
  try { res.json(await reconcileShopeeReturns()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Histórico de edições ──
// Quem mudou o quê, quando, e de quanto pra quanto. Admin, como as outras telas de sistema: ele
// mostra o que cada pessoa fez, e isso não é informação pra qualquer usuário.
app.get('/api/history/paginas', requireAdmin, (req, res) => res.json({ paginas: PAGINAS_HISTORICO }));

app.get('/api/history', requireAdmin, async (req, res) => {
  const { page, market, since, until } = req.query;
  if (!page) return res.status(400).json({ error: 'page é obrigatório.' });
  try {
    // O período chega como data (AAAA-MM-DD) e vira instante: sem o fim do dia em "until", o
    // último dia do período selecionado ficaria de fora inteiro.
    const desde = since ? new Date(since + 'T00:00:00.000Z').toISOString() : new Date(0).toISOString();
    const ate   = until ? new Date(until + 'T23:59:59.999Z').toISOString() : new Date().toISOString();
    const linhas = await lerHistorico({ desde, ate });
    res.json({ itens: montarHistorico(linhas, { pagina: page, market: market || null }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
// Sonda das saídas em bonificação (doação para UGC). Admin: a resposta descreve a operação da
// empresa, e é feita pra ser lida e colada numa conversa — por isso ela já vem sem dado do
// destinatário (ver esqueletoBling em src/bling.js).
app.get('/api/bling/probe-bonificacao', requireAdmin, syncLimiter, async (req, res) => {
  try {
    const { since, until } = req.query;
    if (!since || !until) return res.status(400).json({ error: 'Parâmetros since/until obrigatórios (YYYY-MM-DD).' });
    res.json(await bling.probeBonificacao(since, until));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
  const startedBy = req.authUser?.name || req.authUser?.username || null;
  geoRunning = true;
  geoStatus = { status: 'running', startedBy, startedAt: new Date().toISOString() };
  const days = req.query.days ? Number(req.query.days) : undefined;
  reconcileGeoFromBling({ market: req.query.market || 'br', force: true, ...(days ? { days } : {}) })
    .then(r => { geoStatus = { status: 'done', result: r, startedBy, finishedAt: new Date().toISOString() }; })
    .catch(e => { geoStatus = { status: 'error', message: e.message, startedBy, finishedAt: new Date().toISOString() }; })
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
      // independentes. Ver CLAUDE.md 4.7.1 — eram pra ser diferentes desde o início; exposto aqui
      // pra confirmar de fora sem adivinhar.
      sameToken:   amazon.isSameToken(),
      cursors: {
        us:       getAmazonCursor('us'),
        br:       getAmazonCursor('br'),
        combined: getAmazonCursor('combined'),
      },
      backoffActive,
      backoffUntil:  backoffActive ? new Date(backoffUntil).toISOString() : null,
      nextSyncIn:    backoffActive ? `${Math.ceil((backoffUntil - Date.now()) / 60000)} min` : 'agora',
      backfill:      destaleJob('amazon-backfill', getAmazonBackfill()),
      images:        destaleJob('amazon-images', getAmazonImagesJob()),
      items:         destaleJob('amazon-items', itemsStatus),
    },
    amazon_br: {
      configured:  amazon.isConfiguredBR(),
      hasLwa:      has('AMAZON_BR_REFRESH_TOKEN') || (has('AMAZON_REFRESH_TOKEN') && amazon.isSameToken()),
      hasAwsCreds: has('AMAZON_AWS_ACCESS_KEY') && has('AMAZON_AWS_SECRET_KEY'),
      sharedWithUs:  amazon.isSameToken(),
      // Bug corrigido: mostrava o backoff da US (backoffActive/backoffUntil) em vez do da BR —
      // backoffBRActive/backoffBRUntil já eram calculados acima mas nunca usados aqui.
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
      geo: destaleJob('bling-geo', geoStatus), // última rodada de reconcileGeoFromBling (preenche state via Bling)
    },
    alerts: {
      // Telegram — avisa quando um canal fica travado sem sincronizar (src/alerts.js).
      configured: isAlertsConfigured(),
      hasCreds:   has('TELEGRAM_BOT_TOKEN') && has('TELEGRAM_CHAT_ID'),
    },
    lastSync: db.lastSync || null,
  });
});

// Lista normalizada dos processos em segundo plano (backfill/imagens/itens da Amazon, geografia
// via Bling, backup) — alimenta o widget flutuante (jobs-widget.js, compartilhado em toda
// página) em vez de cada página ter que saber os detalhes de cada job específico. Cada job já
// carrega quem disparou (startedBy, capturado no POST que iniciou). Job
// concluído/erro/cancelado some da lista sozinho depois de um tempo (destaleJob acima só cuida
// do "running" fantasma) — pra uma execução de teste de semanas atrás não continuar aparecendo
// em toda página pra sempre (reportado em produção, como "fica criando tarefa nova sem eu
// pedir": na real eram jobs antigos nunca esquecidos).
const FORGET_FINISHED_AFTER_MS = 15 * 60 * 1000;
function normalizeJob(id, label, rawIn) {
  const raw = destaleJob(id, rawIn);
  if (!raw) return null;
  if (raw.status !== 'running' && raw.finishedAt) {
    const age = Date.now() - Date.parse(raw.finishedAt);
    if (age > FORGET_FINISHED_AFTER_MS) return null;
  }
  return {
    id, label, status: raw.status, message: raw.message || null,
    progressPct: typeof raw.progressPct === 'number' ? raw.progressPct : null,
    startedBy: raw.startedBy || null,
    startedAt: raw.startedAt || null, finishedAt: raw.finishedAt || null,
    cancelable: raw.status === 'running' && CANCELABLE_JOB_IDS.has(id),
  };
}
app.get('/api/jobs', (_req, res) => {
  const backfill = getAmazonBackfill();
  const shopifyBf = getShopifyBackfill();
  const images = getAmazonImagesJob();
  const backupSt = getBackupStatus();
  const jobs = [
    normalizeJob('amazon-backfill', `Buscar histórico Amazon ${backfill?.market === 'us' ? 'EUA' : 'BR'}`, backfill),
    normalizeJob('shopify-backfill', `Buscar histórico Shopify ${shopifyBf?.market === 'us' ? 'EUA' : 'BR'}`, shopifyBf),
    normalizeJob('amazon-images', `Buscar imagens Amazon ${images?.market === 'us' ? 'EUA' : 'BR'}`, images),
    normalizeJob('amazon-items', `Reconciliar itens Amazon ${itemsStatus?.market === 'us' ? 'EUA' : 'BR'}`, itemsStatus),
    normalizeJob('amazon-returns', `Buscar reembolsos Amazon ${returnsStatus?.market === 'us' ? 'EUA' : 'BR'}`, returnsStatus),
    normalizeJob('bling-geo', 'Geografia via Bling', geoStatus),
    normalizeJob('backup', 'Backup do banco', backupSt),
  ].filter(Boolean);
  res.json({ jobs });
});

// Cancelamento cooperativo (botão × no widget) — só os jobs em CANCELABLE_JOB_IDS aceitam.
app.post('/api/jobs/:id/cancel', (req, res) => {
  const id = req.params.id;
  if (!CANCELABLE_JOB_IDS.has(id)) return res.status(400).json({ error: 'Esse processo não pode ser cancelado (termina sozinho em segundos).' });
  cancelFlags[id] = true;
  res.json({ ok: true });
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

  // `group` identifica a PLATAFORMA por trás do canal (não o país nem a categoria) — usado pelo
  // front (integracoes.html) pra agrupar visualmente, ex.: "Shopify" reúne shopify_br + yucaloo_br
  // (duas lojas na mesma plataforma), "amazon" reúne a loja Amazon e o card de Amazon Ads (ainda
  // planejado). Grupo com um item só é exibido como card avulso, sem cabeçalho de grupo.
  const items = [
    // ── Brasil · Geral ──
    // Logo com "/" na frente é um caminho absoluto dentro de public/ (fora de img/integracoes/,
    // ver LOGO_BASE em integracoes.html) — Logo2.png é o ícone "CC" da própria Coco and Luna (mesmo
    // usado no topo da sidebar), não o logo genérico da plataforma Shopify: essa loja É a Coco and
    // Luna, então o logo do card deve identificar a MARCA, não a plataforma por trás dela.
    { key: 'shopify_br', label: 'Shopify - Coco and Luna BR', country: 'br', category: 'geral', group: 'shopify', logo: '/img/marca/Logo2.png', detail: has('SHOPIFY_STORE') ? process.env.SHOPIFY_STORE : '',
      ...integrationStatus({ key: 'shopify_br', configured: has('SHOPIFY_STORE') && has('SHOPIFY_ADMIN_TOKEN') }) },
    { key: 'yucaloo_br', label: 'Yucaloo BR', country: 'br', category: 'geral', group: 'shopify', logo: 'Yucaloo2.png', detail: getYucalooTokens().br?.shop || '',
      ...integrationStatus({ key: 'yucaloo_br', configured: shopifyYucaloo.isConfigured('br'), authorized: Boolean(getYucalooTokens().br) }) },
    { key: 'mercadolivre', label: 'Mercado Livre', country: 'br', category: 'geral', group: 'mercadolivre', logo: 'Logotipo_MercadoLivre.png', detail: db.mlTokens ? 'Conta autorizada' : '',
      ...integrationStatus({ key: 'mercadolivre', configured: ml.isConfigured(), authorized: Boolean(getMlTokens()) }) },
    { key: 'amazon_br', label: 'Amazon BR', country: 'br', category: 'geral', group: 'amazon', logo: 'Amazon_logo.png', detail: 'Conta CocoandLuna',
      ...integrationStatus({ key: 'amazon_br', configured: amazon.isConfiguredBR(), paused: backoffBRActive, pausedNote: backoffBRActive ? amazonPauseNote(Math.ceil((backoffBRUntil - Date.now()) / 60000)) : '' }) },
    { key: 'shopee', label: 'Shopee', country: 'br', category: 'geral', group: 'shopee', logo: 'logo-shopee.png', detail: db.shopeeTokens ? 'Loja autorizada' : '',
      ...integrationStatus({ key: 'shopee', configured: shopee.isConfigured(), authorized: Boolean(getShopeeTokens()) }) },
    { key: 'bling', label: 'Bling', country: 'br', category: 'geral', group: 'bling', logo: 'logo-bling1.png', detail: 'Informações de ERP para complementar dados dos outros canais',
      ...integrationStatus({ key: 'bling', configured: bling.isConfigured(), authorized: Boolean(db.blingTokens) }) },

    // ── Brasil · Marketing ──
    { key: 'mercadolivre_ads', label: 'Mercado Ads', country: 'br', category: 'marketing', group: 'mercadolivre', logo: 'Mercado-ADS.png', detail: 'Product Ads do Mercado Livre',
      ...integrationStatus({ key: 'mercadolivre_ads', configured: ml.isConfigured(), authorized: Boolean(getMlTokens()) }) },
    { key: 'meta_br', label: 'Meta Ads BR', country: 'br', category: 'marketing', group: 'meta', logo: 'logo-meta.png', detail: 'Conta Coco and Luna',
      ...integrationStatus({ key: 'meta_br', configured: meta.isConfigured() }) },

    // ── Brasil · Planejadas ──
    { key: null, label: 'Amazon Ads BR', country: 'br', category: 'planned', group: 'amazon', logo: 'Amazon_Ads_Horizontal_SquidInk.png', detail: 'Ainda não conectada', state: 'planned', note: '' },
    { key: null, label: 'TikTok Shop', country: 'br', category: 'planned', group: 'tiktok', logo: 'logo-tiktok-shop.png', detail: 'Loja em configuração, sem pedidos ainda', state: 'planned', note: '' },

    // ── Estados Unidos · Geral ──
    { key: 'shopify_us', label: 'Shopify - Coco and Luna EUA', country: 'us', category: 'geral', group: 'shopify', logo: '/img/marca/Logo2.png', detail: has('SHOPIFY_US_STORE') ? process.env.SHOPIFY_US_STORE : '',
      ...integrationStatus({ key: 'shopify_us', configured: has('SHOPIFY_US_STORE') && has('SHOPIFY_US_ADMIN_TOKEN') }) },
    { key: 'yucaloo_us', label: 'Yucaloo EUA', country: 'us', category: 'geral', group: 'shopify', logo: 'Yucaloo2.png', detail: getYucalooTokens().us?.shop || '',
      ...integrationStatus({ key: 'yucaloo_us', configured: shopifyYucaloo.isConfigured('us'), authorized: Boolean(getYucalooTokens().us) }) },
    { key: 'amazon_us', label: 'Amazon EUA', country: 'us', category: 'geral', group: 'amazon', logo: 'Amazon_logo.png', detail: 'Conta VITA PET LIFE',
      ...integrationStatus({ key: 'amazon_us', configured: amazon.isConfigured(), paused: backoffActive, pausedNote: backoffActive ? amazonPauseNote(Math.ceil((backoffUntil - Date.now()) / 60000)) : '' }) },

    // ── Estados Unidos · Marketing ──
    { key: 'meta_us', label: 'Meta Ads EUA', country: 'us', category: 'marketing', group: 'meta', logo: 'logo-meta.png', detail: 'Conta Vita Pet Life',
      ...integrationStatus({ key: 'meta_us', configured: meta.isConfigured(process.env.META_US_AD_ACCOUNT_ID) }) },
    { key: 'google_ads', label: 'Google Ads', country: 'us', category: 'marketing', group: 'google', logo: 'google_ads_logo_icon.png', detail: has('GOOGLE_ADS_CUSTOMER_ID') ? 'Conta Coco and Luna' : '',
      ...integrationStatus({ key: 'google_ads', configured: googleads.isConfigured(), authorized: Boolean(db.googleAdsTokens) }) },

    // ── Estados Unidos · Planejadas ──
    { key: null, label: 'Amazon Ads EUA', country: 'us', category: 'planned', group: 'amazon', logo: 'Amazon_Ads_Horizontal_SquidInk.png', detail: 'Ainda não conectada', state: 'planned', note: '' },
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

// Catch-all 404 — precisa ficar depois de toda rota/static acima (Express casa middleware na
// ordem). API mantém erro em JSON (consistente com o resto de /api/*); asset estático que não
// existe (express.static já tentou e chamou next()) continua com 404 puro, sem sentido devolver a
// página bonita no lugar de uma imagem/script quebrado. Navegação de página (GET normal) cai na
// página ilustrada — ver public/404.html.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada.' });
  if (STATIC_ASSET_RE.test(req.path)) return res.status(404).end();
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

await initStore();
auth.initAuth();

app.listen(PORT, () => {
  console.log(`Dashboard rodando em http://localhost:${PORT}`);
  runSync().then(r => { console.log('Sync inicial:', r); checkSyncHealth(r); }).catch(e => console.error('Sync inicial falhou:', e.message));
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES || 15);
  // checkSyncHealth (src/alerts.js) só entra no sync AUTOMÁTICO/agendado — é o único que roda sem
  // ninguém olhando. Um "Sincronizar agora" manual já mostra o erro na hora pra quem clicou, não
  // precisa do alerta assíncrono de canal travado por horas.
  setInterval(() => runSync().then(r => { console.log('Sync:', r); checkSyncHealth(r); }).catch(e => console.error('Sync falhou:', e.message)), minutes * 60 * 1000);

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

  // Devoluções da Amazon (mesma Reports API, mesmo balde de cota). Job à parte do de nomes de
  // propósito: são relatórios diferentes, com janelas diferentes (2 dias contra 60), e um não
  // pode segurar o outro. Sai defasado dos nomes pra não criar dois relatórios no mesmo
  // instante — criar relatório tem cota de 1/min.
  const runAmazonReturns = () => {
    if (backfillRunning) return;
    reconcileAmazonReturns({ markets: ['br', 'us'] })
      .then(r => { if (r.patched || r.errors.length) console.log('Amazon devoluções:', r); })
      .catch(e => console.error('Amazon devoluções falhou:', e.message));
  };
  setTimeout(runAmazonReturns, 8 * 60 * 1000);        // 8 min após subir (5 min depois dos nomes)
  setInterval(runAmazonReturns, 6 * 60 * 60 * 1000);  // a cada 6h (throttle interno limita a 12h)

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

  // Backup diário pra Backblaze B2 (ver src/backup.js) — sem plano Pro no Railway não existe
  // backup automático do Postgres. runBackupIfDue() só roda de fato se já passou
  // BACKUP_EVERY_HOURS desde o último (padrão 24h); sem B2_KEY_ID/etc configurado, no-op
  // silencioso (não quebra o boot em ambiente sem backup configurado ainda, ex.: dev local).
  const runBackupJob = () => {
    runBackupIfDue()
      .then(r => { if (r) console.log('Backup:', r.fileName, r.sizeBytes + ' bytes'); })
      .catch(e => console.error('Backup falhou:', e.message));
  };
  setTimeout(runBackupJob, 5 * 60 * 1000);        // 5 min após subir
  setInterval(runBackupJob, 6 * 60 * 60 * 1000);  // checa a cada 6h (throttle interno limita a 1x/dia)
});
