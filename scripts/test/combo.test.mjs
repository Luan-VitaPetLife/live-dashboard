// Combos e kits no "Top produtos".
//
// Dois produtos diferentes vendidos juntos ("Daily Support + Lysine") NÃO são um combo: combo é o
// MESMO produto repetido ("Combo de 3 unidades"). A distinção não é cosmética — a unidade de um
// kit ia parar em `comboQty` sem nada em `comboBySize` (não há "combo de N" no título pra ler), e
// a tela caía no texto "0 un" para um produto que tinha acabado de vender uma unidade.
// Relatado pelo Luan em 03/09/2026, no combo Daily + Lysine.
//
// A outra metade é dinheiro sem mercadoria: linha com `currentQuantity` 0 saiu do pedido, mas o
// `discountedTotalSet` do Shopify continua com o valor cheio.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, PUB, ROOT, fontePagina } from './_lib.mjs';

const t = criarTeste('Combos e kits no Top produtos');

const src = fs.readFileSync(path.join(ROOT, 'src', 'metrics.js'), 'utf8');
function corpo(nome) {
  const i = src.indexOf(`function ${nome}(`);
  if (i < 0) return '';
  let prof = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (prof === 0) return src.slice(i, j + 1); }
  }
  return '';
}
const funcoes = ['aggregateProductsByChannel', 'comboSize', 'stripComboSuffix', 'legacyComboSize', 'itemRevFactor', 'canonicalTitle'];
for (const f of funcoes) t.ok(!!corpo(f), `achou ${f} em metrics.js`);

const ctx = {
  console,
  TITLE_ALIASES: {},
  POWDER_BASE_GRAMS: 120,
  hasComboTag: it => (it.tags || []).some(x => String(x).toLowerCase() === 'combo'),
  classifyType: () => null,
  getAmazonProductImages: () => ({}),
};
vm.createContext(ctx);
vm.runInContext(funcoes.map(corpo).join('\n'), ctx);

const pedido = (items, extra = {}) => ({
  id: 'x', channel: 'shopify', market: 'br', cancelled: false,
  total: items.reduce((a, i) => a + (i.amount || 0), 0), items, ...extra,
});
const produtos = ords => ctx.aggregateProductsByChannel(ords).shopify.products;

// ── Kit de produtos DIFERENTES: uma unidade avulsa de cada ──
const KIT = { id: 'gid://bundle/1', title: 'Daily Support + Lysine', qty: 1 };
const kit = produtos([pedido([
  { title: 'Daily',  qty: 1, amount: 103.51, bundle: KIT },
  { title: 'Lisina', qty: 1, amount: 95.49,  bundle: KIT },
])]);
t.eq(kit['Daily'].avulsoQty, 1, 'kit misto: o Daily conta 1 unidade avulsa');
t.eq(kit['Daily'].comboQty, 0, 'kit misto: e nenhuma como combo');
t.eq(Object.keys(kit['Daily'].comboBySize).length, 0, 'kit misto: sem tamanho de combo pra mostrar');
t.eq(kit['Lisina'].avulsoQty, 1, 'kit misto: o Lisina também conta 1 unidade avulsa');
t.eq(Math.round(kit['Daily'].revenue * 100) / 100, 103.51, 'kit misto: cada produto leva o próprio valor');
// É a soma dessas duas que a tela usa. Zero aqui era o "0 un" na frente de uma venda de verdade.
t.ok(kit['Daily'].avulsoQty + kit['Daily'].comboQty > 0, 'kit misto: o produto não aparece como se não tivesse vendido');

// ── Combo de verdade: N unidades do MESMO produto ──
const COMBO = { id: 'gid://bundle/2', title: 'Lisina para gatos - 120g - Combo de 3 unidades', qty: 1 };
const combo = produtos([pedido([
  { title: 'Lisina', qty: 2, amount: 179.34, bundle: COMBO },
  { title: 'Lisina', qty: 1, amount: 89.66,  bundle: COMBO },
])]);
t.eq(combo['Lisina'].comboQty, 3, 'combo real: as 3 unidades contam como combo');
t.eq(combo['Lisina'].avulsoQty, 0, 'combo real: nenhuma como avulsa');
t.eq(combo['Lisina'].comboBySize[3], 1, 'combo real: um pacote de 3');
// O mesmo combo vem em várias linhas; contar o pacote uma vez por linha diria 2 pacotes de 3.
t.eq(Object.values(combo['Lisina'].comboBySize).reduce((a, b) => a + b, 0), 1, 'o pacote é contado uma vez, não uma por linha');

// ── O detalhamento tem que fechar com o total ──
// "6 un total · 3 avulso, 1 combo de 2" dá 5, e era o que a tela mostrava.
const misto = produtos([
  pedido([{ title: 'Lisina', qty: 3, amount: 300 }]),
  pedido([{ title: 'Lisina', qty: 2, amount: 199, bundle: { id: 'gid://bundle/3', title: 'Lisina - Combo de 2 unidades', qty: 1 } }]),
  pedido([{ title: 'Lisina', qty: 1, amount: 95.49, bundle: KIT }]),
]);
const p = misto['Lisina'];
const somaDetalhe = p.avulsoQty + Object.entries(p.comboBySize).reduce((a, [tam, n]) => a + Number(tam) * n, 0);
t.eq(p.avulsoQty + p.comboQty, 6, 'seis unidades no total');
t.eq(somaDetalhe, 6, 'e o detalhamento soma exatamente as mesmas seis');

// ── Linha que saiu do pedido não conta unidade ──
const zerada = produtos([pedido([{ title: 'Daily', qty: 0, amount: 0, bundle: KIT }], { total: 0 })]);
t.eq(zerada['Daily'].avulsoQty + zerada['Daily'].comboQty, 0, 'linha sem unidade não inventa unidade');
t.eq(zerada['Daily'].revenue, 0, 'e não traz dinheiro junto');

// ── A origem: o Shopify não zera o valor quando zera a quantidade ──
const shopify = fs.readFileSync(path.join(ROOT, 'src', 'shopify.js'), 'utf8');
t.ok(/currentQuantity > 0\s*\n?\s*\?\s*parseFloat\(x\.node\.discountedTotalSet/.test(shopify),
  'linha com currentQuantity 0 não carrega dinheiro');
// A outra metade da mesma regra, e ela não tinha guarda nenhuma: o valor da linha é o cobrado
// MENOS o que voltou. Sem isso, um item devolvido continua valendo o preço cheio no Top produtos.
t.ok(/- \(refundByLineItemId\[x\.node\.id\] \|\| 0\)/.test(shopify),
  'o reembolso do item continua sendo descontado do valor da linha');

// ── Rede de segurança: produto sem unidade não entra no ranking ──
const ranking = src.slice(src.indexOf('function productRevenueRows('), src.indexOf('function revenueByState('));
t.ok(/avulsoQty \+ p\.comboQty\) > 0/.test(ranking), 'o Top produtos só ranqueia produto que vendeu alguma unidade');

// ── A frase de unidades na tela ──
const tela = fontePagina('index.html').tudo;
t.ok(/somaBits === total/.test(tela), 'o detalhamento só aparece quando fecha com o total');
t.ok(!/: '0 un'/.test(tela), 'a tela não tem mais o texto fixo "0 un" pra cair quando o detalhamento falha');

t.fim();
