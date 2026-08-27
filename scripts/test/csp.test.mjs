// Domínio que falta na CSP é bloqueado SEM erro visível: a página abre, só falta o recurso.
// Foi assim que a fonte Inter ficou fora do ar sem ninguém notar. Este teste percorre todo
// host externo citado em public/ e confere se a diretiva certa da CSP o autoriza.
import { criarTeste, ler, paginas, PUB } from './_lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const t = criarTeste('CSP autoriza todo recurso externo');

// Lê o array CSP direto do server.js. Importar o server.js subiria o servidor de verdade,
// e subir o servidor dispara o sync — a cota da Amazon é por conta, não por processo.
const server = ler('server.js');
const bloco = server.match(/const CSP = \[([\s\S]*?)\]\.join\('; '\)/);
if (!bloco) { t.ok(false, 'não achei o array CSP em server.js'); t.fim(); }

const diretivas = {};
for (const m of bloco[1].matchAll(/"([a-z-]+) ([^"]*)"/g)) diretivas[m[1]] = m[2].split(/\s+/);

const REGRA = { script: 'script-src', stylesheet: 'style-src', font: 'font-src', img: 'img-src', connect: 'connect-src' };
const permitido = (tipo, host) => {
  const lista = diretivas[REGRA[tipo]] || diretivas['default-src'] || [];
  return lista.some(v => v === `https://${host}` || v === 'https:');
};

const achados = new Map();
const add = (tipo, host, onde) => { if (!achados.has(`${tipo}|${host}`)) achados.set(`${tipo}|${host}`, { tipo, host, onde }); };

for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  s.split(/\r?\n/).forEach((l, i) => {
    const onde = `${nome}:${i + 1}`;
    for (const m of l.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      // preconnect não carrega nada; link de crédito do mapa e <a href> também não são buscados.
      if (/preconnect|dns-prefetch|attribution|<a\s/i.test(l)) continue;
      if (/<script[^>]+src=/i.test(l)) add('script', host, onde);
      else if (/rel="stylesheet"/i.test(l)) add('stylesheet', host, onde);
      else if (/\bfetch\(/.test(l)) add('connect', host, onde);
      else if (/tileLayer|TILE|<img[^>]+src=/i.test(l)) add('img', host, onde);
    }
  });
}
// A folha do Google Fonts baixa os .woff2 de outro domínio. Ele não aparece em nenhum HTML,
// mas o navegador vai buscá-lo, então precisa estar liberado em font-src.
if ([...achados.values()].some(a => a.host === 'fonts.googleapis.com'))
  add('font', 'fonts.gstatic.com', '(baixado pela folha do Google Fonts)');

for (const { tipo, host, onde } of [...achados.values()].sort((a, b) => a.host.localeCompare(b.host)))
  t.ok(permitido(tipo, host), `${REGRA[tipo].padEnd(12)} ${host.padEnd(32)} ${onde}`);

t.ok(achados.size > 0, `encontrou recursos externos para conferir (${achados.size})`);
t.fim();
