// Nome, cor e logo de canal viviam em cinco tabelas espalhadas pelas telas, e elas discordavam:
// a mesma Shopify saía verde numa página e vermelha na outra, a Amazon BR preta aqui e laranja
// na Geografia. Ninguém percebia porque nenhuma tela mostra duas versões do mesmo canal lado a
// lado. Agora a fonte é o catálogo do colors.js, e este teste existe pra que nenhuma tela volte
// a declarar a sua própria tabela.
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, PUB, paginas } from './_lib.mjs';

const t = criarTeste('Catálogo de canais');

const colors = fs.readFileSync(path.join(PUB, 'js', 'colors.js'), 'utf8');

// Lê o catálogo do arquivo sem executar o colors.js: ele é uma IIFE que mexe em window,
// localStorage e document, nada disso existe aqui no Node.
const bloco = colors.match(/const DEFAULT_CH = \{([\s\S]*?)\n  \};/);
t.ok(!!bloco, 'colors.js declara o catálogo DEFAULT_CH');

const canais = {};
if (bloco) {
  for (const l of bloco[1].split('\n')) {
    const m = l.match(/^\s*(\w+):\s*\{(.*)\},?\s*$/);
    if (!m) continue;
    const corpo = m[2];
    canais[m[1]] = {
      bg: corpo.match(/bg:\s*'([^']+)'/)?.[1],
      label: corpo.match(/label:\s*'([^']+)'/)?.[1],
      market: corpo.match(/market:\s*'([^']+)'/)?.[1],
      logo: corpo.match(/logo:\s*'([^']+)'/)?.[1],
    };
  }
}

const chaves = Object.keys(canais);
t.ok(chaves.length === 8, `oito canais no catálogo (achei ${chaves.length}: ${chaves.join(', ')})`);

for (const [k, c] of Object.entries(canais)) {
  t.ok(/^#[0-9A-Fa-f]{6}$/.test(c.bg || ''), `${k}: cor em hex de 6 dígitos (${c.bg})`);
  t.ok(!!c.label, `${k}: tem nome exibido`);
  t.ok(c.market === 'br' || c.market === 'us', `${k}: mercado é br ou us (${c.market})`);
  t.ok(!!c.logo && fs.existsSync(path.join(PUB, c.logo)), `${k}: o arquivo de logo existe (${c.logo})`);
}

// Nome repetido faria duas linhas idênticas num seletor, sem como distinguir.
const nomes = Object.values(canais).map(c => c.label);
t.ok(new Set(nomes).size === nomes.length, 'nenhum nome de canal se repete');

// Os dois mercados precisam ter canal, senão um seletor nasce vazio.
for (const m of ['br', 'us'])
  t.ok(Object.values(canais).some(c => c.market === m), `o mercado ${m} tem pelo menos um canal`);

// ── Nenhuma página pode declarar a própria tabela de canal ──
// Estes são os nomes exatos das cinco tabelas que existiam antes desta unificação.
const TABELAS_ANTIGAS = ['CH_META', 'CHAN_COLORS_MAP', 'CHAN_LABELS_MAP', 'MARKET_CHANNELS', 'CH_BY_MARKET', 'CHANNELS_BR', 'CHANNELS_US', 'CHAN_BR', 'CHAN_US'];
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  for (const tabela of TABELAS_ANTIGAS)
    t.ok(!new RegExp(`(const|let|var)\\s+${tabela}\\s*=`).test(s), `${nome} não redeclara ${tabela}`);
}

// Cor de canal escrita à mão numa página é o jeito mais fácil de a divergência voltar.
// Procuro pelas cores do catálogo aparecendo soltas fora do colors.js.
const cores = new Set(Object.values(canais).map(c => (c.bg || '').toUpperCase()));
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  const soltas = [];
  s.split(/\r?\n/).forEach((l, i) => {
    // O tema da própria página (:root) tem hex de sobra que não é cor de canal.
    if (/--[a-z-]+\s*:/.test(l)) return;
    for (const m of l.matchAll(/#[0-9A-Fa-f]{6}/g))
      if (cores.has(m[0].toUpperCase())) soltas.push(`${nome}:${i + 1} ${m[0]}`);
  });
  t.ok(soltas.length === 0, `${nome} não escreve cor de canal à mão${soltas.length ? ' (' + soltas.slice(0, 3).join(', ') + ')' : ''}`);
}

// ── Comportamento, não só o texto do arquivo ──
// O colors.js é uma IIFE que mexe em window, localStorage e document, nada disso existe no
// Node. Com três dublês simples ele roda inteiro aqui, e aí dá pra testar o que as telas de
// verdade vão chamar, em vez de só conferir que o arquivo tem as linhas certas.
const janela = {};
const guardado = {};
const contexto = {
  window: janela,
  document: { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, classList: { add() {}, remove() {} } }), head: { appendChild() {} }, addEventListener() {} },
  localStorage: {
    getItem: k => guardado[k] ?? null,
    setItem: (k, v) => { guardado[k] = String(v); },
    removeItem: k => { delete guardado[k]; },
  },
};
const { createContext, runInContext } = await import('node:vm');
const ctx = createContext(contexto);
try {
  runInContext(colors, ctx);
} catch (e) {
  t.ok(false, `colors.js não executou: ${e.message}`);
}

const C = janela.CocoColors;
if (t.ok(!!C, 'colors.js expõe window.CocoColors')) {
  const br = C.channelsFor('br');
  const us = C.channelsFor('us');
  t.ok(br.length === 5 && us.length === 3, `5 canais no BR e 3 nos EUA (veio ${br.length} e ${us.length})`);
  t.ok(!br.includes('todos'), '"todos" não entra na lista sem ser pedido');
  t.ok(C.channelsFor('br', { comTodos: true })[0] === 'todos', 'com comTodos, "todos" vem primeiro');
  t.ok(br.every(k => C.ch[k].market === 'br'), 'nenhum canal dos EUA vaza pra lista do BR');

  t.ok(C.chLabel('todos') === 'Todos os canais', '"todos" tem rótulo próprio');
  t.ok(C.chLabel('shopify') === 'Shopify - Coco and Luna BR', 'rótulo de canal conhecido');
  t.ok(C.chLabel('canal_que_nao_existe') === 'canal_que_nao_existe', 'canal desconhecido devolve a chave em vez de quebrar');
  t.ok(C.chLabel(undefined) === '?', 'chave vazia não vira "undefined" na tela');

  // A cor personalizada não pode levar embora logo e mercado: o card ficaria sem logo e o
  // canal sumiria do seletor do próprio mercado, logo depois de alguém escolher uma cor.
  const antes = { ...C.ch.amazon };
  C.setChannelColor('amazon', '#ABCDEF');
  t.ok(C.ch.amazon.bg === '#ABCDEF', 'setChannelColor troca a cor');
  t.ok(C.ch.amazon.logo === antes.logo, 'setChannelColor preserva a logo');
  t.ok(C.ch.amazon.market === antes.market, 'setChannelColor preserva o mercado');
  t.ok(C.ch.amazon.label === antes.label, 'setChannelColor preserva o nome');
  t.ok(guardado['coco_colors']?.includes('ch.amazon'), 'setChannelColor persiste a escolha');
  t.ok(C.ch.amazon.text === '#333' || C.ch.amazon.text === '#fff', 'recalcula a cor do texto pro novo fundo');

  // Cor salva de uma sessão anterior tem que vencer o padrão, sem apagar o resto da entrada.
  C.load();
  t.ok(C.ch.amazon.bg === '#ABCDEF', 'a cor salva sobrevive a um recarregamento');
  t.ok(C.ch.amazon.logo === antes.logo, 'a logo continua vindo do catálogo, não do que foi salvo');
}

t.fim();
