// Toda função chamada no código do servidor existe.
//
// Em 22/09/2026 uma limpeza removeu `fixUnpaidOrders` do store.js cortando "até a próxima função
// exportada" — e levou junto `usOffsetForDate`, uma função NÃO exportada que ficava logo abaixo. A
// sintaxe continuou válida (`node --check` passa), nenhum teste executa a consulta dos EUA, e a
// Visão geral dos EUA inteira passou a responder "usOffsetForDate is not defined". O Brasil seguiu
// funcionando, porque só o mercado EUA chama essa função.
//
// Este teste lê cada arquivo do servidor e confere que todo nome chamado como função (`nome(`) está
// DECLARADO no próprio arquivo (function, const/let, parâmetro, desestruturação), IMPORTADO, ou é
// global do Node. É uma verificação de texto, não um analisador completo — mas é exatamente a classe
// de erro que a sintaxe não pega e que só aparece em produção, no caminho que ninguém exercitou.
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, ROOT } from './_lib.mjs';

const t = criarTeste('toda função chamada existe (servidor)');

const GLOBAIS = new Set(`
  fetch setTimeout setInterval clearTimeout clearInterval setImmediate queueMicrotask structuredClone
  parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI escape
  Number String Boolean Object Array Date Promise Error TypeError RangeError JSON Math Map Set WeakMap
  WeakSet Symbol RegExp BigInt Buffer URL URLSearchParams TextDecoder TextEncoder AbortController
  Intl Proxy Reflect require import super
`.split(/\s+/).filter(Boolean));
const PALAVRAS = new Set(`
  if for while switch catch return function typeof await new async else do in of instanceof void delete
  throw case yield with
`.split(/\s+/).filter(Boolean));

const semComentarioNemTexto = src => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
  .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
  .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
  // Template: o texto some, as expressões `${...}` ficam (podem chamar função).
  .replace(/`(?:\\[\s\S]|[^`\\])*`/g, m => ' ' + [...m.matchAll(/\$\{([^}]*)\}/g)].map(x => x[1]).join(' ; ') + ' ')
  // Expressão regular literal (vem depois de operador ou de abre-parêntese): o conteúdo não é código.
  .replace(/([=(,:!&|?{};]\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[a-z]*/g, '$1/re/');

// Conteúdo entre o parêntese em `ini` e o que fecha ele, contando os aninhados (parâmetro com valor
// padrão `agora = () => Date.now()` tem parênteses dentro).
function entreParenteses(src, ini) {
  let prof = 0;
  for (let i = ini; i < src.length; i++) {
    if (src[i] === '(') prof++;
    else if (src[i] === ')' && --prof === 0) return src.slice(ini + 1, i);
  }
  return '';
}
function parenteseQueAbre(src, fim) {
  let prof = 0;
  for (let i = fim; i >= 0; i--) {
    if (src[i] === ')') prof++;
    else if (src[i] === '(' && --prof === 0) return i;
  }
  return -1;
}

function declarados(src) {
  const nomes = new Set();
  const add = s => { for (const n of (s || '').match(/[A-Za-z_$][\w$]*/g) || []) nomes.add(n); };
  for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/g)) {
    if (m[1]) nomes.add(m[1]);
    add(entreParenteses(src, m.index + m[0].length - 1));
  }
  // Parâmetros de arrow function `( ... ) =>`, com parênteses aninhados.
  for (const m of src.matchAll(/\)\s*=>/g)) {
    const abre = parenteseQueAbre(src, m.index);
    if (abre >= 0) add(src.slice(abre + 1, m.index));
  }
  for (const m of src.matchAll(/\b(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) nomes.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s*[{[]([^=]*?)[}\]]\s*=/g)) add(m[1]);
  for (const m of src.matchAll(/\bimport\s+([\s\S]*?)\s+from\s/g)) add(m[1].replace(/\bas\b/g, ' '));
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) nomes.add(m[1]);
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) nomes.add(m[1]);
  // métodos de objeto literal e de classe: `nome(args) {`
  for (const m of src.matchAll(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) nomes.add(m[1]);
  return nomes;
}

const arquivos = [path.join(ROOT, 'server.js'),
  ...fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).map(f => path.join(ROOT, 'src', f))];
t.ok(arquivos.length > 20, `leu os arquivos do servidor (${arquivos.length})`);

for (const arq of arquivos) {
  const src = semComentarioNemTexto(fs.readFileSync(arq, 'utf8'));
  const ok = declarados(src);
  const faltando = new Set();
  for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const nome = m[2];
    if (PALAVRAS.has(nome) || GLOBAIS.has(nome) || ok.has(nome)) continue;
    faltando.add(nome);
  }
  t.ok(faltando.size === 0, `${path.basename(arq)}: toda função chamada está declarada ou importada` +
    (faltando.size ? ` (faltando: ${[...faltando].join(', ')})` : ''));
}

t.fim();
