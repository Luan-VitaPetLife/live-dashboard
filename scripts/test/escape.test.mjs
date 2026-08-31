// Uma função de escape só, e ela precisa estar certa.
//
// Escapar texto de fora é o tipo de coisa em que nenhuma cópia pode ser "quase igual": eram OITO
// implementações, e duas escapavam pela metade (só `&` e `"`, deixando `<` passar). Não era bug
// ainda porque só apareciam dentro de atributo entre aspas, mas quem reaproveitasse a função pra
// montar texto de elemento abriria um buraco sem que nada acusasse.
//
// Este teste guarda três coisas: a função se comporta, ninguém escreveu outra, e toda página que
// usa carrega o arquivo — sem o script, `escapeHtml` é `undefined` e a tela quebra só na hora em
// que alguém abre um card, não no carregamento.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, PUB, paginas, fontePagina } from './_lib.mjs';

const t = criarTeste('Escape de texto: uma função só');

// ── A função se comporta ──
const fonte = fs.readFileSync(path.join(PUB, 'js', 'escape.js'), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fonte, ctx);
const esc = ctx.window.escapeHtml;
t.ok(typeof esc === 'function', 'escape.js exporta window.escapeHtml');

if (typeof esc === 'function') {
  t.eq(esc('<script>'), '&lt;script&gt;', 'fecha e abre tag');
  t.eq(esc('a"b'), 'a&quot;b', 'aspas duplas (fecham atributo)');
  t.eq(esc("a'b"), 'a&#39;b', 'aspas simples (também fecham atributo)');
  // Sem escapar o & primeiro, um texto que já contenha "&lt;" voltaria a virar "<" no navegador.
  t.eq(esc('&lt;'), '&amp;lt;', 'e comercial, contra dupla decodificação');
  t.eq(esc(null), '', 'null vira string vazia, não "null"');
  t.eq(esc(undefined), '', 'undefined vira string vazia');
  t.eq(esc(0), '0', 'zero não vira vazio');
  // O caso que motivou tudo: usado em atributo, o valor precisa voltar inteiro ao ser lido.
  const json = JSON.stringify([{ t: 'Lisina <gato> "120g"' }]);
  t.eq(esc(json).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    json, 'valor de atributo volta idêntico quando o navegador decodifica');
}

// ── Ninguém escreveu outra ──
// Procura a tabela de entidades em qualquer arquivo de public/ que não seja o escape.js.
const outras = [];
(function varrer(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { varrer(p); continue; }
    if (!/\.(js|html)$/.test(e.name)) continue;
    const rel = path.relative(PUB, p).replace(/\\/g, '/');
    if (rel === 'js/escape.js') continue;
    const s = fs.readFileSync(p, 'utf8');
    // Uma linha de CÓDIGO que mapeia '&' para '&amp;' é uma implementação própria. Comentário não.
    s.split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      if (/'&'\s*:\s*'&amp;'|replace\(\/&\/g/.test(l)) outras.push(`${rel}:${i + 1}`);
    });
  }
})(PUB);
for (const o of outras) t.ok(false, `${o} escreve o próprio escape`);
t.ok(outras.length === 0, `só existe uma implementação (${outras.length} concorrente(s))`);

// ── Toda página que usa, carrega ──
// E carrega ANTES de quem usa: script clássico executa na ordem, então um arquivo que chame
// escapeHtml durante o carregamento não pode vir primeiro.
let conferidas = 0;
for (const nome of paginas()) {
  const { html, js } = fontePagina(nome);
  const usaNaPagina = /\bescapeHtml\s*\(/.test(js);
  const usaComponente = /js\/(sidebar|jobs-widget)\.js/.test(html);
  if (!usaNaPagina && !usaComponente) continue;
  conferidas++;
  const iEsc = html.indexOf('js/escape.js');
  t.ok(iEsc >= 0, `${nome} carrega js/escape.js`);
  if (iEsc < 0) continue;
  for (const dep of ['js/sidebar.js', 'js/jobs-widget.js']) {
    const iDep = html.indexOf(dep);
    if (iDep >= 0) t.ok(iEsc < iDep, `${nome}: escape.js vem antes de ${dep}`);
  }
}
t.ok(conferidas > 0, `achou as páginas que dependem do escape (${conferidas})`);

t.fim();
