// Guarda os quatro ajustes de consumo do servidor (análise de custo do Railway, 22/09/2026):
// aba escondida não consulta, o cache de Campanhas esvazia, o sync só grava o que mudou e o backup
// é montado em partes.
//
// Os quatro falham em silêncio. O pior é o do sync: dizer "igual" pra um pedido que mudou faria a
// mudança nunca chegar no banco, e só se descobriria no próximo reinício. O segundo pior é o do
// backup: um arquivo que não restaura só é descoberto no dia em que se precisa dele.
//
// Não faz rede e não toca no banco. Lê data/db.json (se existir) sem gravar nada.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { criarTeste, ler, ROOT, PUB } from './_lib.mjs';

const t = criarTeste('consumo do servidor');
const imp = rel => import('file:///' + path.join(ROOT, rel).replace(/\\/g, '/'));
const semComentario = txt => txt.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ── 1. "Esse pedido mudou?" ──────────────────────────────────────────────────
const { mesmoPedido } = await imp('src/comparar.js');
const base = { id: 'a', total: 10, items: [{ title: 'Lisina', qty: 1 }], state: 'SP' };
t.ok(mesmoPedido(base, structuredClone(base)), 'cópia idêntica é o mesmo pedido');
// O Postgres devolve as chaves em outra ordem: sem isso, tudo seria regravado depois de um reinício.
t.ok(mesmoPedido(base, { state: 'SP', items: [{ qty: 1, title: 'Lisina' }], total: 10, id: 'a' }), 'ordem das chaves não importa');
t.ok(mesmoPedido(base, { ...base, refunded: undefined }), 'chave com undefined é o mesmo que chave ausente (o banco descarta)');
for (const [rot, outro] of [
  ['total mudou', { ...base, total: 11 }],
  ['status novo', { ...base, status: 'REFUNDED' }],
  ['campo sumiu', { id: 'a', total: 10, items: base.items }],
  ['quantidade do item', { ...base, items: [{ title: 'Lisina', qty: 2 }] }],
  ['item a mais', { ...base, items: [...base.items, { title: 'Daily', qty: 1 }] }],
  ['número virou texto', { ...base, total: '10' }],
  ['null no lugar de valor', { ...base, state: null }],
  ['lista no lugar de objeto', { ...base, items: {} }],
]) t.ok(!mesmoPedido(base, outro), `mudança detectada: ${rot}`);

const STORE = semComentario(ler('src/store.js'));
const upsert = STORE.slice(STORE.indexOf('export function upsertOrders'), STORE.indexOf('export function podarPedidosAntigos'));
t.ok(/if \(existing && existing !== o && mesmoPedido\(existing, o\)\) continue;/.test(upsert),
  'o sync pula o pedido igual, mas nunca o MESMO objeto da memória (alterado no lugar)');
t.ok(upsert.indexOf('mesmoPedido(') > upsert.indexOf('o.refundedQty'), 'a comparação vem depois das guardas que completam o pedido novo');
t.ok(/if \(mudaram\.length\) \{ indexDirty = true;/.test(upsert), 'o índice só é refeito quando algo mudou');
t.ok(/pgUpsertOrders\(mudaram\)/.test(upsert), 'e só o que mudou vai pro banco');
// Gravação que falha precisa voltar: sem regravar tudo a cada ciclo, ninguém mais a repetiria.
const pgUp = STORE.slice(STORE.indexOf('function pgUpsertOrders'), STORE.indexOf('export function upsertOrders'));
t.ok(/\.catch\(e => \{[\s\S]*pendentesNoBanco\.add\(o\.id\)/.test(pgUp), 'gravação que falhou fica anotada');
t.ok(/for \(const id of pendentesNoBanco\)[\s\S]*cache\.orders\[id\]/.test(pgUp), 'e volta na próxima, na versão atual da memória');
t.ok(/pendentesNoBanco\.size\)\) pgUpsertOrders/.test(upsert), 'mesmo num ciclo em que nada mudou');

// ── 2. Backup em partes, idêntico ao de antes ────────────────────────────────
const { snapshotGzip } = await imp('src/snapshot.js');
const casos = [
  { orders: {}, lastSync: null },
  { orders: { 'x:1': { id: 'x:1', nome: 'Pão de açúcar "aspas" \\  ', v: 1.5, faltando: undefined } },
    vazio: undefined, lista: [1, undefined, 'a'], aninhado: { a: { b: [null] } }, n: 0 },
];
const dbLocal = path.join(ROOT, 'data', 'db.json');
if (fs.existsSync(dbLocal)) {
  const { authSessions, ...resto } = JSON.parse(fs.readFileSync(dbLocal, 'utf8'));
  casos.push(resto);
}
for (const [i, caso] of casos.entries()) {
  const gz = await snapshotGzip(caso);
  const texto = zlib.gunzipSync(gz).toString('utf8');
  t.ok(texto === JSON.stringify(caso), `backup ${i + 1}: texto idêntico ao JSON.stringify de antes`);
  t.ok(JSON.parse(texto) !== null, `backup ${i + 1}: restaura com JSON.parse`);
}
t.ok(casos.length === 3 || !fs.existsSync(dbLocal), 'o caso com os dados locais reais entrou');

const BACKUP = semComentario(ler('src/backup.js'));
t.ok(/return snapshotGzip\(rest\)/.test(BACKUP) && /await buildSnapshotBuffer\(\)/.test(BACKUP), 'o backup usa a montagem em partes');
t.ok(!/gzipSync|JSON\.stringify\(rest\)/.test(BACKUP), 'e não voltou a montar o banco num texto só');
t.ok(/authSessions, \.\.\.rest/.test(BACKUP), 'sessão de login continua fora do backup');

// ── 3. Cache de Campanhas que esvazia ────────────────────────────────────────
const { lerDoCache, guardarNoCache } = await imp('src/cache.js');
const V = 5 * 60 * 1000;
const m = new Map();
guardarNoCache(m, 'a', 1, { agora: 0, validadeMs: V });
t.eq(lerDoCache(m, 'a', { agora: V - 1, validadeMs: V }), 1, 'dentro do prazo, lê');
t.eq(lerDoCache(m, 'a', { agora: V, validadeMs: V }), undefined, 'vencido, não lê');
t.eq(m.size, 0, 'e o vencido sai do cache ao ser lido');
guardarNoCache(m, 'b', 1, { agora: 0, validadeMs: V });
guardarNoCache(m, 'c', 1, { agora: V + 10, validadeMs: V });
t.ok(!m.has('b') && m.has('c'), 'gravar varre o que venceu, mesmo sem ninguém ter lido');
const m2 = new Map();
for (let i = 0; i < 60; i++) guardarNoCache(m2, 'p' + i, i, { agora: i, validadeMs: V, teto: 50 });
t.eq(m2.size, 50, 'com muitos períodos dentro do prazo, o teto segura o tamanho');
t.ok(!m2.has('p0') && m2.has('p59'), 'e sai o mais antigo');
const SERVER = semComentario(ler('server.js'));
t.ok(/lerDoCache\(campaignCache/.test(SERVER) && /guardarNoCache\(campaignCache/.test(SERVER), 'Campanhas usa o cache que esvazia');
t.ok(!/campaignCache\.set\(/.test(SERVER), 'e ninguém grava nele por fora');

// ── 4. Aba escondida não consulta ────────────────────────────────────────────
function ambiente() {
  const timers = [], ouvintes = {};
  const doc = { hidden: false, addEventListener: (ev, fn) => ((ouvintes[ev] ||= []).push(fn)) };
  const ctx = {
    document: doc, window: {},
    setInterval: fn => { timers.push(fn); return timers.length; },
    clearInterval: id => { timers[id - 1] = null; },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(PUB, 'js', 'visivel.js'), 'utf8'), ctx);
  const tique = () => timers.forEach(fn => fn && fn());
  const mostrar = hidden => { doc.hidden = hidden; (ouvintes.visibilitychange || []).forEach(f => f()); };
  return { V: ctx.window.CocoVisivel, tique, mostrar, doc };
}
{
  const { V, tique, mostrar, doc } = ambiente();
  let n = 0;
  V.agendar('dados', () => n++, 1000);
  tique(); t.eq(n, 1, 'com a aba visível, atualiza no intervalo');
  doc.hidden = true; tique(); tique(); tique();
  t.eq(n, 1, 'com a aba escondida, não atualiza');
  mostrar(false); t.eq(n, 2, 'ao voltar, atualiza na hora UMA vez, porque perdeu rodadas');
  mostrar(true); mostrar(false); t.eq(n, 2, 'esconder e voltar sem perder rodada não atualiza à toa');
  V.agendar('dados', () => n++, 0); tique(); t.eq(n, 2, 'intervalo zero ("nunca") cancela');
  let a = 0, b = 0;
  V.agendar('dados', () => a++, 1000); V.agendar('dados', () => b++, 1000); tique();
  t.ok(a === 0 && b === 1, 'reagendar a mesma chave substitui, não acumula');
}
for (const p of ['index', 'campanhas', 'estoque', 'geografia', 'produtos']) {
  const js = semComentario(ler(`public/js/paginas/${p}.js`));
  t.ok(/CocoVisivel\.agendar\('dados'/.test(js), `${p}: a atualização periódica pausa com a aba escondida`);
  t.ok(!/setInterval\((load|loadData)\b/.test(js), `${p}: e não sobrou setInterval direto`);
  const html = ler(`public/${p}.html`);
  const iv = html.indexOf('js/visivel.js'), ip = html.indexOf(`js/paginas/${p}.js`);
  t.ok(iv > 0 && iv < ip, `${p}: visivel.js carrega antes do script da página`);
}
const JW = semComentario(ler('public/js/jobs-widget.js'));
t.ok(/setInterval\(\(\) => \{ if \(!document\.hidden\) poll\(\); \}, POLL_MS\)/.test(JW), 'o card de processos não consulta com a aba escondida');
t.ok(/visibilitychange', \(\) => \{ if \(!document\.hidden\) poll\(\); \}/.test(JW), 'e consulta na hora quando ela volta');

t.fim();
