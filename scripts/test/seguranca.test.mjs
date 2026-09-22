// Quem pode chamar o quê no servidor. Revisão de 22/09/2026, que achou quatro portas abertas:
//
//   1. as rotas de CONECTAR conta (Bling, Shopee, Mercado Livre, Google Ads) eram públicas: um
//      estranho autorizava com a conta DELE e a dashboard gravava o token dele no lugar do nosso;
//   2. /api/sync passava sem login, e qualquer pessoa disparava a sincronização inteira;
//   3. o primeiro admin nascia com a senha "123456" escrita no código, num repositório público;
//   4. usuário comum alcançava rota de manutenção (inclusive uma que apaga pedido) e sonda que
//      devolve pedido cru com nome e endereço de cliente.
//
// Nenhuma dessas dá erro: a porta só fica aberta. Por isso o teste mais importante daqui não olha
// rota por rota — ele exige que TODA rota que grava alguma coisa diga quem pode chamá-la, com uma
// lista curta e explícita de exceções. Uma rota nova esquecida quebra o teste em vez de abrir porta.
//
// Não sobe o servidor: lê o texto de server.js e auth.js.
import { criarTeste, ler } from './_lib.mjs';

const t = criarTeste('segurança: quem pode chamar o quê');
const semComentario = txt => txt.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const SERVER = semComentario(ler('server.js'));

// ── Portão ──
const portao = SERVER.slice(SERVER.indexOf('const STATIC_ASSET_RE'), SERVER.indexOf('// Serve cada página pela URL limpa') > 0 ? SERVER.indexOf('app.get(Object.keys(SLUG_TO_FILE)') : undefined);
// O bloco de liberados é o `if` que começa por p === '/health'. Procurar o primeiro `if (` pegava
// outro (o do login desligado), e as verificações abaixo passavam sem olhar nada.
const iLib = portao.indexOf("p === '/health'");
const liberados = portao.slice(iLib, portao.indexOf(') return next();', iLib) + 1);
t.ok(iLib > 0 && liberados.includes("'/api/login'"), 'achou o bloco de rotas liberadas sem login');
for (const prefixo of ['/shopee/', '/mercadolivre/', '/googleads/', '/bling/']) {
  t.ok(!liberados.includes(`'${prefixo}'`), `${prefixo}… não passa mais sem login`);
}
t.ok(!/p === '\/api\/sync'\s*\|\|/.test(liberados), '/api/sync não passa mais sem login só por ser /api/sync');
t.ok(/const syncComToken = p === '\/api\/sync' && tokenDeSync && req\.headers\['x-sync-token'\] === tokenDeSync;/.test(portao),
  'sem login, só com o token de SYNC_SECRET configurado (agendador externo)');
const iUser = portao.indexOf('if (!user)');
const iConexao = portao.indexOf("(shopee|mercadolivre|googleads|bling)");
t.ok(iConexao > iUser, 'conectar conta exige login');
t.ok(/\(shopee\|mercadolivre\|googleads\|bling\)\\\/\/\.test\(p\) && user\.role !== 'admin'\) \{\s*return res\.status\(403\)/.test(portao),
  'e exige administrador');
t.ok(liberados.includes("'/shopify-yucaloo/'"), 'a Yucaloo continua aberta: quem chama é a Shopify, com requisição assinada');
t.ok(/verifyRequest/.test(SERVER), 'e a assinatura da Shopify continua sendo conferida');

// ── Toda rota que GRAVA diz quem pode chamá-la ──
const EXCECOES = new Map([
  ["post /api/login", 'é o próprio login'],
  ["post /api/logout", 'sair não precisa de permissão'],
  ["post /api/sync", 'botão Sincronizar de toda página; o portão já exige login ou token'],
  ["post /api/me/password", 'cada pessoa troca a própria senha'],
]);
const rotas = [...SERVER.matchAll(/^app\.(post|put|delete|patch)\('([^']+)',([^\n]*)/gm)];
t.ok(rotas.length > 30, `achou as rotas de escrita (${rotas.length})`);
for (const [, metodo, rota, resto] of rotas) {
  const chave = `${metodo} ${rota}`;
  if (EXCECOES.has(chave)) continue;
  t.ok(/requireAdmin|requirePage\('/.test(resto), `${chave} exige admin ou acesso à página`);
}
for (const chave of EXCECOES.keys()) {
  t.ok(rotas.some(([, m, r]) => `${m} ${r}` === chave), `a exceção "${chave}" ainda existe (senão sai da lista)`);
}

// ── Toda sonda e diagnóstico é só de admin: devolvem dado cru, às vezes com cliente ──
const leituras = [...SERVER.matchAll(/^app\.get\('([^']+)',([^\n]*)/gm)];
for (const [, rota, resto] of leituras) {
  if (!/probe|whoami|list-orders|report-columns|canais-venda|settlement/.test(rota)) continue;
  t.ok(/requireAdmin/.test(resto), `GET ${rota} é só de admin`);
}

// ── Gravação de página exige acesso à página ──
for (const [rota, pagina] of [
  ["app.post('/api/products/finance'", 'produtos.html'],
  ["app.post('/api/stock/finance'", 'estoque.html'],
  ["app.post('/api/stock/agg-finance'", 'estoque.html'],
  ["app.post('/api/product-types'", 'segmentos.html'],
  ["app.post('/api/product-types/remove-keyword'", 'segmentos.html'],
  ["app.delete('/api/product-types'", 'segmentos.html'],
]) t.ok(SERVER.includes(`${rota}, requirePage('${pagina}')`), `${rota.slice(9)} exige acesso a ${pagina}`);
const rp = SERVER.slice(SERVER.indexOf('function requirePage('), SERVER.indexOf('function requirePage(') + 400);
t.ok(/u\.role === 'admin' \|\| auth\.canAccessPage\(u, file\)/.test(rp), 'admin passa; os outros, só com a página liberada');

// ── Senha do primeiro admin ──
const AUTH = semComentario(ler('src/auth.js'));
const semente = AUTH.slice(AUTH.indexOf('export function initAuth'), AUTH.indexOf('export function initAuth') + 1500);
t.ok(!/hashPassword\('[^']*'\)/.test(semente), 'a senha semente não está escrita no código');
t.ok(/process\.env\.ADMIN_SEED_PASSWORD \|\| crypto\.randomBytes\(/.test(semente), 'vem de ADMIN_SEED_PASSWORD ou é sorteada');
t.ok(!/ADMIN_SEED_PASSWORD[^\n]*\$\{senha\}/.test(semente), 'a senha da variável de ambiente nunca vai pro log');

// ── O card de processos mostra a recusa ──
const JW = ler('public/js/jobs-widget.js');
const cancelar = JW.slice(JW.indexOf("fetch('/api/jobs/' + id + '/cancel'"), JW.indexOf("fetch('/api/jobs/' + id + '/cancel'") + 700);
t.ok(/if \(r\.ok\) return poll\(\);/.test(cancelar), 'o × do card lê a resposta do servidor');
t.ok(/cocoConfirm\(d\.error/.test(cancelar), 'e mostra o motivo quando ele recusa');

t.fim();
