// As cópias que precisam concordar.
//
// Um canal de venda está descrito em mais de um lugar, porque a tela (colors.js, carregado no
// navegador) não importa módulo do servidor: o catálogo das telas (DEFAULT_CH) e o do cálculo
// (CANAIS, metrics.js), que dá nome a canal em Insights e no Histórico. A lista de status "não pago"
// também existe duas vezes (store.js e a tela da Visão geral).
//
// Cópia que diverge não dá erro. Ela só faz a mesma coisa ter dois nomes, ou um canal existir numa
// tela e não na outra — foi o que quase aconteceu ao incluir o TikTok, que precisou de uma linha em
// cada lugar. Este teste é o que amarra as cópias.
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, ler, PUB } from './_lib.mjs';

const t = criarTeste('as cópias de canal concordam');

// Lê um objeto literal `{ chave: { label: '...', market: '..' }, ... }` do texto.
function canaisDoTexto(texto, inicio) {
  const i = texto.indexOf(inicio);
  // Termina no PRIMEIRO fechamento, indentado (dentro da IIFE do colors.js) ou não (metrics.js).
  const fins = [texto.indexOf('\n  };', i), texto.indexOf('\n};', i)].filter(x => x > i);
  const bloco = texto.slice(i, Math.min(...fins));
  const out = {};
  for (const m of bloco.matchAll(/^\s*([a-z_]+):\s*\{([^}]*)\}/gm)) {
    const label = /label:\s*'([^']*)'/.exec(m[2])?.[1];
    const market = /market:\s*'([^']*)'/.exec(m[2])?.[1];
    out[m[1]] = { label, market };
  }
  return out;
}

const tela = canaisDoTexto(ler('public/js/colors.js'), 'const DEFAULT_CH = {');
const calculo = canaisDoTexto(ler('src/metrics.js'), 'export const CANAIS = {');
t.ok(Object.keys(tela).length >= 9, `leu o catálogo da tela (${Object.keys(tela).length} canais)`);
t.ok(Object.keys(calculo).length >= 9, `leu o catálogo do cálculo (${Object.keys(calculo).length} canais)`);

for (const k of Object.keys(tela)) t.ok(k in calculo, `${k} está no cálculo também`);
for (const k of Object.keys(calculo)) t.ok(k in tela, `${k} está nas telas também`);
for (const k of Object.keys(tela)) {
  if (!calculo[k]) continue;
  t.eq(calculo[k].label, tela[k].label, `${k}: mesmo nome nos dois`);
  t.eq(calculo[k].market, tela[k].market, `${k}: mesmo mercado nos dois`);
}

// ── Status "não pago": servidor e tela ──
function naoPago(texto, inicio) {
  const i = texto.indexOf(inicio);
  const bloco = texto.slice(texto.indexOf('{', i), texto.indexOf('\n};', i) + 2);
  const out = {};
  for (const m of bloco.matchAll(/^\s*([a-z_]+):\s*\[([^\]]*)\]/gm)) {
    out[m[1]] = [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1]);
  }
  return out;
}
const servidor = naoPago(ler('src/store.js'), 'export const UNPAID_STATUS_BY_CHANNEL = {');
const naTela = naoPago(ler('public/js/paginas/index.js'), 'const UNPAID_STATUS_BY_CHANNEL = {');
t.ok(Object.keys(servidor).length >= 6, 'leu a lista do servidor');
t.eq(JSON.stringify(naTela), JSON.stringify(servidor), 'a lista de "não pago" da tela é igual à do servidor');
for (const k of Object.keys(servidor)) t.ok(k in tela, `canal "${k}" da lista de não pago existe no catálogo`);

// ── Nenhuma tela com lista própria de canais ──
// O card "Canais" da Visão geral tinha a sua (`chOrder`), e o TikTok Shop ficou fora dele sem erro
// nenhum quando entrou no catálogo (relatado pelo Luan com print, 22/09/2026). Lista de canal de
// venda na tela sai de CocoColors.channelsFor(). Integrações fica de fora: lá a lista é de GRUPOS de
// integração (Meta, Google, Bling...), outro conceito.
const CANAL = "'(?:shopify|shopify_us|yucaloo_br|yucaloo_us|shopee|mercadolivre|amazon|amazon_us|tiktok)'";
const LISTA = new RegExp(`\\[\\s*${CANAL}\\s*,\\s*${CANAL}`);
const dir = path.join(PUB, 'js', 'paginas');
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'integracoes.js')) {
  const js = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const m = LISTA.exec(js);
  t.ok(!m, `${f} não tem lista própria de canais${m ? ` (achei ${m[0]}…)` : ''}`);
}
const idx = ler('public/js/paginas/index.js');
t.ok(/const chOrder = CocoColors\.channelsFor\(d\.market\);/.test(idx), 'o card Canais lista os canais do catálogo');

t.fim();
