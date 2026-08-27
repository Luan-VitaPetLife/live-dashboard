// Tudo que abre e fecha na dashboard entra e sai suave. A regra que faz isso é sempre a mesma
// (`display:none` na base, `display:flex` com a classe `open`), e display não é animável — quem
// resolve é css/anim.css, com `transition-behavior: allow-discrete` e `@starting-style`.
//
// O que este teste protege de verdade é o esquecimento: uma caixa nova criada daqui a três meses
// abre e fecha num quadro só, e ninguém nota que ela ficou de fora do arquivo de animação. Aqui
// isso vira falha.
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, PUB, paginas } from './_lib.mjs';

const t = criarTeste('Animação de abrir e fechar');

const anim = fs.readFileSync(path.join(PUB, 'css', 'anim.css'), 'utf8');

// ── A guarda é o que impede um estrago ──
// Sem o @supports, o `opacity:0` da regra base valeria num navegador sem suporte e TODO menu do
// app abriria invisível. É a única forma deste arquivo quebrar a dashboard inteira.
t.ok(anim.includes('@supports (transition-behavior: allow-discrete)'),
  'as transições ficam dentro de um @supports, para navegador sem suporte seguir funcionando');
// Cada grupo precisa do SEU @starting-style. Verificar só que a palavra aparece no arquivo não
// serve: apagar o bloco de um grupo deixaria os menus daquele grupo aparecendo secos, com os
// outros três grupos ainda animando, e o teste passaria.
const blocosStarting = [...anim.matchAll(/@starting-style\s*\{([\s\S]*?)\n  \}/g)].map(m => m[1]);
t.ok(blocosStarting.length >= 4, `cada grupo tem seu @starting-style (achei ${blocosStarting.length})`);
const classesComEntrada = new Set();
for (const b of blocosStarting)
  for (const m of b.matchAll(/\.([a-z][\w-]*)/g)) classesComEntrada.add(m[1]);
t.ok(anim.includes('allow-discrete'), 'segura o display até a saída terminar');
t.ok(anim.includes('prefers-reduced-motion'), 'respeita movimento reduzido no sistema');

// ── Toda caixa que abre precisa estar coberta ──
const EXCECOES = new Set([
  // Não é caixa que abre: é o estado ligado de uma linha da lista, sem entrada nem saída.
  'fp-pop',
]);

const aAnimar = new Map();
const arquivos = [...paginas().map(f => path.join(PUB, f)),
                  ...fs.readdirSync(path.join(PUB, 'js')).map(f => path.join(PUB, 'js', f))];
for (const arq of arquivos) {
  const s = fs.readFileSync(arq, 'utf8');
  // `.alguma-coisa.open{display:...}` e `.pai.open .filha{display:...}`
  for (const m of s.matchAll(/\.([a-z][\w-]*)\.open(?:\s+\.([a-z][\w-]*))?\s*\{display:/g)) {
    const classe = m[2] || m[1];
    if (!aAnimar.has(classe)) aAnimar.set(classe, path.basename(arq));
  }
}

t.ok(aAnimar.size >= 15, `encontrou as caixas que abrem e fecham (${aAnimar.size})`);
const faltando = [];
for (const [classe, onde] of aAnimar) {
  if (EXCECOES.has(classe)) continue;
  if (!new RegExp(`\\.${classe}\\b`).test(anim)) faltando.push(`${classe} (${onde})`);
}
t.ok(faltando.length === 0,
  `toda caixa que abre está em anim.css${faltando.length ? '\n        faltam: ' + faltando.join(', ') : ''}`);

// E cada uma precisa aparecer também num @starting-style, senão ela sai suave mas ENTRA seca.
const semEntrada = [...aAnimar.keys()].filter(c => !EXCECOES.has(c) && !classesComEntrada.has(c));
t.ok(semEntrada.length === 0,
  `toda caixa tem estado de entrada declarado${semEntrada.length ? '\n        sem @starting-style: ' + semEntrada.join(', ') : ''}`);

// ── Modais centralizados ──
// Estes se centralizam com transform. Escrever só `scale()` na animação apagaria o translate e
// jogaria o modal pro canto inferior direito da tela — erro que não aparece em nenhum teste de
// sintaxe e some quando alguém "arruma" o CSS sem saber disso.
const CENTRADOS = ['sp-panel', 'smd-modal', 'geo-modal', 'exp-modal', 'tr-modal'];
for (const c of CENTRADOS) {
  const noArquivo = new RegExp(`\\.${c}\\b`).test(anim);
  t.ok(noArquivo, `${c} está no arquivo de animação`);
}
const transformsDosCentrados = [...anim.matchAll(/transform:\s*([^;]+);/g)].map(m => m[1].trim());
const escalaSemTranslate = transformsDosCentrados.filter(v => v.includes('scale') && !v.includes('translate'));
t.ok(escalaSemTranslate.length === 0,
  `nenhuma escala perde o translate de centralização${escalaSemTranslate.length ? ' (' + escalaSemTranslate.join(' | ') + ')' : ''}`);

// ── Toda página carrega o arquivo ──
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  t.ok(/<link rel="stylesheet" href="css\/anim\.css">/.test(s), `${nome} carrega css/anim.css`);
}

// ── Card que cresce ──
// A largura vem de grid-column, que o CSS não anima; quem cobre isso é a View Transition
// disparada no clique. Ela precisa continuar valendo só no clique: no carregamento não existe
// estado anterior pra interpolar.
const index = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
t.ok(index.includes('document.startViewTransition'), 'o card que expande usa View Transition');
t.ok(/comAnimacao\(applyTrendExpanded\)/.test(index) && /comAnimacao\(applyTrafficExpanded\)/.test(index),
  'os dois cards que expandem passam pela animação');
t.ok(/prefers-reduced-motion/.test(index.slice(index.indexOf('function comAnimacao'), index.indexOf('function comAnimacao') + 400)),
  'a View Transition também respeita movimento reduzido');
t.ok(/^applyTrendExpanded\(\);$/m.test(index), 'no carregamento a função é chamada direta, sem animação');

t.fim();
