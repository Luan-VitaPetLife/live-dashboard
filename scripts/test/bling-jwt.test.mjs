// Migração do Bling pro token JWT (obrigatória até 15/10/2026: depois disso o Bling recusa
// requisição fora do padrão). https://developer.bling.com.br/migracao-jwt
//
// O que quebra em silêncio aqui:
//   1. o header `enable-jwt: 1` sumir de um dos dois pontos de rede — o token continuaria opaco,
//      tudo funcionaria até o dia do corte e aí o Bling inteiro pararia de uma vez;
//   2. alguém chamar o Bling por fora do bling.js, sem o header;
//   3. duas renovações ao mesmo tempo usarem o mesmo refresh token, que o Bling invalida na
//      primeira: a saída passa a ser reautorizar pelo navegador;
//   4. a rota de conferência devolver o token (repositório público, resposta feita pra ser colada).
//
// Não faz rede e não toca no banco.
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, ler, ROOT } from './_lib.mjs';

const t = criarTeste('Bling: token JWT');
const semComentario = txt => txt.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const BLING = semComentario(ler('src/bling.js'));

// ── 1. O header nos dois únicos pontos de rede ──
t.ok(/const JWT_HEADER = \{ 'enable-jwt': '1' \};/.test(BLING), 'o header é enable-jwt: 1');
const fetches = [...BLING.matchAll(/await fetch\(/g)].length;
t.eq(fetches, 2, 'bling.js tem exatamente dois pontos de rede (token e leitura)');
const token = BLING.slice(BLING.indexOf('async function tokenRequest'), BLING.indexOf('function saveTokens'));
t.ok(/Authorization: basicAuthHeader\(\),\s*\.\.\.JWT_HEADER,/.test(token), 'troca do code e renovação pedem JWT (as duas passam por tokenRequest)');
t.ok(/grant_type:\s*'authorization_code'/.test(BLING) && /grant_type:\s*'refresh_token'/.test(BLING), 'as duas usam tokenRequest');
const leitura = BLING.slice(BLING.indexOf('async function apiGet'), BLING.indexOf('async function apiGet') + 1500);
t.ok(/Authorization: `Bearer \$\{tk\.access_token\}`, Accept: 'application\/json', \.\.\.JWT_HEADER \}/.test(leitura), 'toda leitura leva o header');

// ── 2. Ninguém fala com o Bling por fora ──
const arquivos = [path.join(ROOT, 'server.js'), ...fs.readdirSync(path.join(ROOT, 'src')).map(f => path.join(ROOT, 'src', f))]
  .filter(f => f.endsWith('.js') && !f.endsWith(path.join('src', 'bling.js')));
for (const f of arquivos) {
  const s = semComentario(fs.readFileSync(f, 'utf8'));
  t.ok(!/bling\.com\.br/.test(s), `${path.basename(f)} não chama o Bling direto`);
}

// ── 3. Uma renovação por vez ──
const { umaPorVez } = await import('file:///' + path.join(ROOT, 'src/umaPorVez.js').replace(/\\/g, '/'));
{
  let execucoes = 0, soltar;
  const f = umaPorVez(() => { execucoes++; return new Promise(r => { soltar = r; }); });
  const a = f(), b = f(), c = f();
  await Promise.resolve();
  t.eq(execucoes, 1, 'três chamadas ao mesmo tempo disparam UMA renovação');
  t.ok(a === b && b === c, 'e todas recebem a mesma resposta');
  soltar('token novo');
  t.eq(await b, 'token novo', 'quem chegou no meio recebe o resultado da renovação em curso');
  const d = f();
  await Promise.resolve(); await Promise.resolve();
  t.eq(execucoes, 2, 'terminada, a próxima chamada renova de novo');
  t.ok(d !== a, 'com uma resposta nova, não a da renovação anterior');
  soltar('outro token');
  t.eq(await d, 'outro token', 'e ela também termina');
}
{
  let execucoes = 0;
  const f = umaPorVez(async () => { execucoes++; if (execucoes === 1) throw new Error('recusado'); return 'ok'; });
  let erro = null;
  try { await f(); } catch (e) { erro = e.message; }
  t.eq(erro, 'recusado', 'o erro da renovação chega a quem pediu');
  t.eq(await f(), 'ok', 'e uma falha não trava a próxima tentativa');
}
t.ok(/const refreshToken = umaPorVez\(async \(\) => \{/.test(BLING), 'a renovação do Bling passa pela trava');
t.ok(!/async function refreshToken/.test(BLING), 'e não existe outra renovação por fora dela');

// ── 4. A conferência nunca devolve o token ──
const formato = BLING.slice(BLING.indexOf('export function formatoDoToken'), BLING.indexOf('export async function renovarAgora'));
const retorno = formato.slice(formato.lastIndexOf('return {'));
// Nenhum campo do retorno pode SER o token (usar `t.length` pra medir é permitido), nem espalhar o
// objeto guardado inteiro.
t.ok(!/:\s*(t|tk|tk\.access_token|tk\.refresh_token|String\(tk\.\w+\))\s*[,}\n]/.test(retorno), 'nenhum campo do retorno é o token');
t.ok(!/\.\.\.tk\b|refresh_token/.test(retorno), 'e nada do objeto guardado vai junto');
t.ok(/tamanho: t\.length,/.test(retorno), 'o retorno tem formato, tamanho e validade');
t.ok(/formato: \/\^eyJ/.test(formato), 'JWT é reconhecido pelo formato (eyJ… com três partes)');
const SERVER = semComentario(ler('server.js'));
t.ok(SERVER.includes("app.get('/api/bling/token', requireAdmin,"), 'conferir o token é só de admin');
t.ok(SERVER.includes("app.post('/api/bling/token/renovar', requireAdmin,"), 'renovar é só de admin, e por POST');

t.fim();
