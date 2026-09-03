// Catálogo bruto da Shopify: o que entra na lista de Produtos/Estoque.
//
// O catálogo existe pra um produto CADASTRADO mas nunca vendido aparecer na tela. A consulta traz
// os três status da Shopify (ACTIVE, DRAFT, ARCHIVED), e listar os três faz a dashboard inventar
// produto: o Shopify BR aparecia com 11 produtos, dos quais 9 o dono não tem na loja dele
// (relatado pelo Luan em 03/09/2026). Rascunho e arquivado não são catálogo.
//
// Os três status continuam sendo buscados de propósito: os índices de tag e de tipo precisam das
// tags ATUAIS até de produto arquivado que já vendeu, pra decisão de ocultar produto não voltar a
// depender da tag presa no pedido antigo (ver "Ocultar produtos" no CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, ROOT } from './_lib.mjs';

const t = criarTeste('Catálogo da loja em Produtos/Estoque');

const src = fs.readFileSync(path.join(ROOT, 'src', 'metrics.js'), 'utf8');
const ini = src.indexOf('function mergeShopifyCatalog(');
t.ok(ini >= 0, 'achou o merge do catálogo');
let prof = 0, fim = ini;
for (let j = src.indexOf('{', src.indexOf(')', ini)); j < src.length; j++) {
  if (src[j] === '{') prof++;
  else if (src[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
}

let bruto = {};
const ctx = {
  console,
  SHOPIFY_CATALOG_CHANNELS: { br: ['shopify', 'yucaloo_br'], us: ['shopify_us', 'yucaloo_us'] },
  getShopifyProductCatalog: () => bruto,
  classifyType: p => p.productType || null,
};
vm.createContext(ctx);
vm.runInContext(src.slice(ini, fim), ctx);

const titulos = (r, canal) => Object.keys(r[canal].products);

// ── Só produto ativo vira linha ──
bruto = { shopify: [
  { title: 'Lisina',      status: 'ACTIVE',   productType: 'Pó' },
  { title: 'Turmeric',    status: 'DRAFT',    productType: 'Tablets' },
  { title: 'Omega 3',     status: 'ARCHIVED', productType: 'Tablets' },
] };
const br = ctx.mergeShopifyCatalog({}, 'br');
t.ok(titulos(br, 'shopify').includes('Lisina'), 'produto ativo entra na lista');
t.ok(!titulos(br, 'shopify').includes('Turmeric'), 'rascunho não entra: o dono não tem esse produto na loja');
t.ok(!titulos(br, 'shopify').includes('Omega 3'), 'arquivado também não');
t.eq(titulos(br, 'shopify').length, 1, 'a contagem do card mostra só o que existe de verdade');

// ── Catálogo gravado antes desta regra não some da tela ──
// O sync reescreve o catálogo a cada ciclo; até lá, produto sem status conta como ativo, senão a
// lista encolheria sozinha depois do deploy e voltaria minutos depois, sem explicação.
bruto = { shopify: [{ title: 'Daily', productType: 'Pó' }] };
t.ok(titulos(ctx.mergeShopifyCatalog({}, 'br'), 'shopify').includes('Daily'),
  'produto sem status (catálogo antigo) continua listado até o próximo sync');

// ── O que já vendeu continua na lista, venha de onde vier ──
const jaVendeu = () => ({ shopify: { revenue: 100, orders: 1, products: { Lisina: { revenue: 100, avulsoQty: 1, comboQty: 0, comboBySize: {} } } } });
bruto = { shopify: [{ title: 'Lisina', status: 'ARCHIVED' }] };
const arquivado = ctx.mergeShopifyCatalog(jaVendeu(), 'br');
t.eq(arquivado.shopify.products.Lisina.revenue, 100, 'produto arquivado que vendeu mantém a venda dele');
t.eq(arquivado.shopify.products.Lisina.avulsoQty, 1, 'e a quantidade');
// O caso que importa mais: o produto está ATIVO no catálogo E já vendeu. O catálogo não pode
// sobrescrever a linha, senão a venda vira zero e o produto some do ranking sem erro nenhum.
bruto = { shopify: [{ title: 'Lisina', status: 'ACTIVE' }] };
const ativoQueVendeu = ctx.mergeShopifyCatalog(jaVendeu(), 'br');
t.eq(ativoQueVendeu.shopify.products.Lisina.revenue, 100, 'produto ativo que vendeu não é zerado pelo catálogo');
t.eq(ativoQueVendeu.shopify.products.Lisina.avulsoQty, 1, 'nem perde a quantidade vendida');

// ── Canal sem catálogo nenhum não quebra e nasce vazio ──
bruto = {};
const vazio = ctx.mergeShopifyCatalog({}, 'br');
t.eq(titulos(vazio, 'shopify').length, 0, 'loja sem catálogo fica sem produto, não quebra');
t.ok(!!vazio.yucaloo_br, 'e o canal existe na resposta, pro card aparecer vazio em vez de sumir');

// ── A origem: os três status continuam vindo da Shopify ──
const shopify = fs.readFileSync(path.join(ROOT, 'src', 'shopify.js'), 'utf8');
const consulta = shopify.slice(shopify.indexOf('export async function fetchProductCatalog'));
t.ok(/node \{ title status productType/.test(consulta), 'a consulta pede o status de cada produto');
t.ok(!/query:\s*["'`]status:/.test(consulta),
  'e não filtra na consulta: os índices de tag e tipo precisam do arquivado que já vendeu');
t.ok(/status: n\.status \|\| null/.test(consulta), 'o status é guardado junto do produto');

t.fim();
