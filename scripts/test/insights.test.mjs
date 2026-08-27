// insights.js é puro (recebe dois retratos já calculados e devolve a lista de frases), então
// dá pra testar as regras inteiras sem banco e sem rede. O que mais importa aqui não é o
// caminho feliz: é o anti-ruído. Com algumas dezenas de pedidos por dia, um estado que foi de
// 1 pra 4 vendas vira "+300%" e não significa nada — os cenários 3 e 3b existem pra travar isso.
import { criarTeste } from './_lib.mjs';
import { buildInsights } from '../../src/insights.js';

const t = criarTeste('Regras do card de Insights');
const { ok, info } = t;

const CH = {
  shopify: 'Shopify - Coco and Luna BR', shopee: 'Shopee',
  amazon: 'Amazon BR', mercadolivre: 'Mercado Livre', yucaloo_br: 'Shopify - Yucaloo BR',
};
const UF = { SP: 'São Paulo', MG: 'Minas Gerais', RJ: 'Rio de Janeiro' };
const gerar = o => buildInsights({ market: 'br', channel: 'todos', channelLabels: CH, stateNames: UF, ...o });

// ── Cenário 1: um dia real ──
const cur = {
  revenue: 3065, orders: 27, aov: 113.53,
  byChannel: { shopify: 1340, yucaloo_br: 0, shopee: 121, mercadolivre: 480, amazon: 1125 },
  byState: { SP: { revenue: 1500 }, MG: { revenue: 900 }, RJ: { revenue: 665 } },
  products: [
    { title: 'Lysine', revenue: 2646 },
    { title: 'Areia Grãos Finos', revenue: 172 },
    { title: 'Daily', revenue: 130 },
    { title: 'Areia Grãos Mistos', revenue: 116 },
  ],
  sessions: 415, conversion: 0.0265,
  funnel: { sessions: 415, cart: 23, checkout: 16, completed: 11 },
  adCost: 400, roas: 2.17,
};
const prev = {
  revenue: 2000, orders: 18, aov: 111.1,
  byChannel: { shopify: 1200, yucaloo_br: 0, shopee: 110, mercadolivre: 445, amazon: 245 },
  byState: { SP: { revenue: 1400 }, MG: { revenue: 300 }, RJ: { revenue: 300 } },
  products: [
    { title: 'Lysine', revenue: 1500 },
    { title: 'Areia Grãos Finos', revenue: 300 },
    { title: 'Daily', revenue: 200 },
  ],
  sessions: 380, conversion: 0.031,
  funnel: { sessions: 380, cart: 40, checkout: 30, completed: 12 },
  adCost: 350, roas: 3.1,
};

const r = gerar({ cur, prev });
info('dia real: ' + r.map(i => i.id).join(', '));
ok(r.length > 0 && r.length <= 10, 'devolve entre 1 e 10 insights (teto MAX_INSIGHTS)');
ok(r.some(i => i.title.includes('Amazon BR')), 'Amazon de 245 para 1125 aparece como maior alta');

// ── Cenário 2: canal parado, quase sempre integração quebrada e não queda de venda ──
const c2 = { ...cur, byChannel: { ...cur.byChannel, amazon: 0 }, revenue: 1940 };
const r2 = gerar({ cur: c2, prev });
ok(r2[0]?.id === 'canal-parado-amazon', 'canal parado vem PRIMEIRO na lista');
ok(r2[0]?.kind === 'ruim', 'canal parado é vermelho');

// Semáforo: quem classifica é a regra no servidor, nunca o sinal do número.
const kinds = [...r, ...r2].map(i => i.kind);
ok(kinds.every(k => ['bom', 'medio', 'ruim'].includes(k)), `kind só pode ser bom/medio/ruim (achei: ${[...new Set(kinds)].join(',')})`);
const alta = r.find(i => i.id?.startsWith('canal-up'));
if (alta) ok(alta.kind === 'bom', 'canal em alta é verde');
const quedaConv = r.find(i => i.id === 'conversao');
if (quedaConv) ok(quedaConv.kind === 'ruim', 'conversão em queda é vermelha');
ok(!r2.find(i => i.id === 'concentracao'), 'não afirma concentração quando o produto passa da receita total');

for (const [nome, lista] of [['dia real', r], ['canal parado', r2]]) {
  const cont = {};
  lista.forEach(i => { cont[i.dimension] = (cont[i.dimension] || 0) + 1; });
  ok(Object.values(cont).every(n => n <= 2), `${nome}: nenhuma dimensão passa de 2 insights (${JSON.stringify(cont)})`);
}

// ── Cenário 3: volume minúsculo, variação percentual enorme ──
const c3 = {
  revenue: 120, orders: 2, aov: 60, byChannel: { shopify: 90, shopee: 30 },
  byState: { RR: { revenue: 120 } }, products: [{ title: 'Lysine', revenue: 120 }],
  sessions: 12, conversion: 0.16, funnel: { sessions: 12, cart: 2, checkout: 1, completed: 1 },
  adCost: 0, roas: 0,
};
const p3 = {
  revenue: 30, orders: 1, aov: 30, byChannel: { shopify: 30 },
  byState: { RR: { revenue: 30 } }, products: [{ title: 'Lysine', revenue: 30 }],
  sessions: 9, conversion: 0.11, funnel: { sessions: 9, cart: 1, checkout: 1, completed: 1 },
  adCost: 0, roas: 0,
};
const r3 = gerar({ cur: c3, prev: p3 });
ok(!r3.some(i => i.id === 'conversao'), 'conversão com 12 sessões não vira insight');
ok(!r3.some(i => i.id === 'ticket'), 'ticket com 2 pedidos não vira insight');
ok(r3.length === 0, 'dia de R$ 120 é troco: não gera insight nenhum');

// ── Cenário 3b: MESMA variação relativa, em dinheiro de verdade ──
const escala = (o, k) => ({
  ...o, revenue: o.revenue * k, orders: o.orders * 10,
  byChannel: Object.fromEntries(Object.entries(o.byChannel).map(([a, b]) => [a, b * k])),
  byState: Object.fromEntries(Object.entries(o.byState).map(([a, b]) => [a, { revenue: b.revenue * k }])),
  products: o.products.map(p => ({ ...p, revenue: p.revenue * k })),
});
const r3b = gerar({ cur: escala(c3, 40), prev: escala(p3, 40) });
ok(r3b.length > 0, 'a mesma variação relativa, 40x maior em dinheiro, gera insight');

// ── Cenários de borda ──
const r4 = gerar({ cur, prev: null });
ok(Array.isArray(r4), 'não quebra sem período anterior');
const r5 = buildInsights({ cur, prev, market: 'br', channel: 'amazon', channelLabels: CH, stateNames: UF });
ok(!r5.some(i => i.dimension === 'Canal'), 'com um canal específico selecionado, não há insight de canal');
const r6 = buildInsights({ cur, prev, market: 'us', channel: 'todos', channelLabels: CH, stateNames: UF });
ok(r6.some(i => /\$/.test(i.detail)) && !r6.some(i => /R\$/.test(i.detail)), 'mercado EUA formata em USD, não em BRL');
const vazio = { revenue: 0, orders: 0, aov: 0, byChannel: {}, byState: {}, products: [], sessions: 0, conversion: 0, funnel: {}, adCost: 0, roas: 0 };
ok(gerar({ cur: vazio, prev: vazio }).length === 0, 'período sem nada não inventa insight');

// ── Redação, em todos os cenários de uma vez ──
// As frases vão PRONTAS pro front, que só desenha. Um "undefined" aqui chega na tela do usuário.
const todos = [...r, ...r2, ...r3b, ...r4, ...r5, ...r6];
ok(todos.every(i => !/NaN|undefined|Infinity|null/.test(i.title + i.detail)), 'nenhuma frase contém NaN, undefined, Infinity ou null');
ok(todos.every(i => !/de -\d/.test(i.detail)), 'nunca "queda de -13%": o verbo já diz a direção');
ok(todos.every(i => !/\d+% em pontos percentuais/.test(i.detail)), 'não mistura "%" com "pontos percentuais"');
ok(todos.every(i => i.chart?.rows.every(x => Number.isFinite(x.value))), 'todo gráfico tem valores numéricos finitos');
ok(todos.every(i => i.chart.rows.every(x => x.value >= 0)), 'nenhum gráfico tem barra negativa');

const roasBr = r.find(i => i.id === 'roas');
if (roasBr) ok(/\d,\d{2}×/.test(roasBr.detail), 'ROAS em pt-BR usa vírgula decimal (3,10× e não 3.10×)');
const convBr = r.find(i => i.id === 'conversao');
if (convBr) ok(/pontos? percentua/.test(convBr.detail), 'conversão fala em pontos percentuais');

// A tira de abas dá cerca de 200px por item, então `label` é obrigatório e curto.
const semLabel = todos.filter(i => !i.label);
ok(semLabel.length === 0, `toda regra manda um label${semLabel.length ? ' (faltou em: ' + semLabel.map(i => i.id).join(', ') + ')' : ''}`);
const longos = todos.filter(i => i.label && i.label.length > 42);
ok(longos.length === 0, `nenhum label passa de 42 caracteres${longos.length ? ' (' + longos.map(i => i.id).join(', ') + ')' : ''}`);
ok(todos.every(i => !i.label || i.label.length < i.title.length), 'o label é sempre mais curto que o título');

t.fim();
