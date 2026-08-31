// Imagem sem tamanho declarado no próprio <img> aparece no tamanho do ARQUIVO até o CSS que a
// dimensiona chegar. Quando essa regra mora dentro de um script que injeta estilo (os componentes
// de public/js/), ela só existe depois que o script roda — e nesse intervalo a página desenha a
// imagem crua.
//
// Foi o que aconteceu com a bandeira dos EUA no seletor Brasil/EUA: a `.mkt-flag-img` é
// dimensionada dentro do pill-switch.js, e o arquivo da bandeira declara 1235x650, então ela
// piscava ocupando a tela inteira a cada troca de página. A do Brasil não aparecia porque é um
// .webp pequeno — o mesmo defeito, invisível.
//
// A correção é `width`/`height` como ATRIBUTO: vale já na análise do HTML, antes de qualquer CSS
// ou JS. Este teste falha se alguém tirar o atributo de novo, ou se uma imagem nova cair no mesmo
// caso.
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, PUB, paginas } from './_lib.mjs';

const t = criarTeste('Imagem com tamanho declarado antes do CSS chegar');

// Classes dimensionadas por CSS que um script injeta em tempo de execução.
const injetadas = new Map();
for (const f of fs.readdirSync(path.join(PUB, 'js')).filter(x => x.endsWith('.js'))) {
  const s = fs.readFileSync(path.join(PUB, 'js', f), 'utf8');
  for (const m of s.matchAll(/\.([a-z][\w-]*)\s*\{[^}]*\b(?:width|height)\s*:/g)) {
    if (!injetadas.has(m[1])) injetadas.set(m[1], f);
  }
}
t.ok(injetadas.size > 0, `achou as classes dimensionadas por script (${injetadas.size})`);

// Classes dimensionadas por folha de verdade: o <head> carrega antes de desenhar, então não
// existe o intervalo problemático.
const emFolha = new Set();
(function varrer(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) varrer(p);
    else if (e.name.endsWith('.css')) {
      const s = fs.readFileSync(p, 'utf8');
      for (const m of s.matchAll(/\.([a-z][\w-]*)\s*\{[^}]*\b(?:width|height)\s*:/g)) emFolha.add(m[1]);
    }
  }
})(path.join(PUB, 'css'));

let conferidas = 0;
const suspeitas = [];
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  for (const m of s.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    const classes = (tag.match(/class="([^"]+)"/) || [, ''])[1].split(/\s+/).filter(Boolean);
    const risco = classes.filter(c => injetadas.has(c) && !emFolha.has(c));
    if (!risco.length) continue;
    conferidas++;
    const temTamanho = /\swidth\s*=/.test(tag) && /\sheight\s*=/.test(tag);
    if (!temTamanho) {
      const linha = s.slice(0, m.index).split('\n').length;
      suspeitas.push(`${nome}:${linha} — .${risco[0]} é dimensionada em ${injetadas.get(risco[0])}, e o <img> não tem width/height`);
    }
  }
}

t.ok(conferidas > 0, `achou imagem que depende de CSS injetado por script (${conferidas})`);
for (const x of suspeitas) t.ok(false, x);
t.ok(suspeitas.length === 0, `toda imagem nesse caso declara o próprio tamanho (${suspeitas.length} sem)`);

t.fim();
