// Imagem de produto não depende do período escolhido (Segmentos, Produtos, Estoque).
//
// Caso real (25/09/2026): as areias da Yucaloo estão unificadas no Unificador, com membros na Amazon
// (sem imagem), no Mercado Livre, na Shopee e na Shopify (com imagem). Num período em que só as
// listagens da Amazon venderam, Segmentos mostrava o grupo sem foto, porque a imagem vinha só dos
// pedidos da janela. O Unificador mostrava a foto, porque olha o histórico inteiro.
//
// Executa as funções puras de metrics.js (sem banco: o store só é lido quando uma tela é calculada).
import path from 'node:path';
import { criarTeste, ler, ROOT } from './_lib.mjs';

const t = criarTeste('imagem de produto não depende do período');
delete process.env.DATABASE_URL;
const { montarIndiceDeImagens, completarImagens } =
  await import('file:///' + path.join(ROOT, 'src/metrics.js').replace(/\\/g, '/'));

const AMZ = 'Areia de Mandioca Para Gatos Yucaloo (Amazon)';
const ML = 'Areia De Mandioca Biodegradável Pra Gatos 4.5kg Grãos Finos';
const SHOPEE = 'Areia Biodegradável para Gatos 100% Mandioca';
const SHOPIFY = 'Areia higiênica natural (da raiz) - Grãos finos';
const grupos = { 'Areia Grãos Finos': [AMZ, ML, SHOPEE, SHOPIFY], 'Lysine': ['Lisina 120g'] };

// Histórico inteiro (90 dias): o ML vendeu semanas atrás, com imagem; a Amazon nunca traz imagem.
const idx = montarIndiceDeImagens({
  pedidos: [
    { items: [{ title: AMZ, asin: 'B0X', image: null }] },
    { items: [{ title: ML, image: 'ml.jpg' }] },
    { items: [{ title: ML, image: 'ml-outra.jpg' }] },
    { items: [{ title: 'Com ASIN', asin: 'B0Y', image: null }] },
    // Membro do Lysine com OUTRA foto no histórico: a linha do período já tem a dela e não pode trocar.
    { items: [{ title: 'Lisina 120g', image: 'lisina-antiga.jpg' }] },
  ],
  imagensAmazon: { B0Y: 'amazon-cache.jpg' },
  catalogoShopify: [{ title: SHOPIFY, image: 'shopify.jpg' }, { title: 'Sem foto', image: null }],
});
t.eq(idx[ML], 'ml.jpg', 'a imagem do pedido entra no índice (a primeira encontrada vale)');
t.eq(idx['Com ASIN'], 'amazon-cache.jpg', 'produto da Amazon usa o cache de imagem por ASIN');
t.eq(idx[SHOPIFY], 'shopify.jpg', 'o catálogo da Shopify entra também (produto que nem vendeu)');
t.ok(!(AMZ in idx) && !('Sem foto' in idx), 'título sem imagem nenhuma fica fora do índice');

// No período escolhido só a Amazon vendeu: a linha unificada chega SEM imagem e só com esse membro.
const linhas = completarImagens([
  { title: 'Areia Grãos Finos', image: null, _grouped: true, _members: [AMZ] },
  { title: 'Lysine', image: 'lysine-do-periodo.jpg', _grouped: true, _members: ['Lisina 120g'] },
  { title: ML, image: null },
  { title: 'Produto sem foto em lugar nenhum', image: null },
], idx, grupos);
t.eq(linhas[0].image, 'ml.jpg', 'o grupo que só vendeu pela Amazon ganha a foto de outro membro cadastrado (o caso das areias)');
t.eq(linhas[1].image, 'lysine-do-periodo.jpg', 'imagem que a linha já tem nunca é trocada');
t.eq(linhas[2].image, 'ml.jpg', 'linha comum procura pelo próprio título');
t.eq(linhas[3].image, null, 'sem imagem em lugar nenhum, continua sem (placeholder na tela)');

// As três telas usam a correção.
const M = ler('src/metrics.js');
t.ok(/productGeo = completarImagens\(applyProductGroups\(productGeo, productGroupsMkt,/.test(M), 'Segmentos completa as imagens');
t.ok(/products = completarImagens\(mergeProductRows\(products, productGroupsMkt, groupTypeIdx\), imagens, productGroupsMkt\);/.test(M), 'Produtos também');
t.ok(/products = completarImagens\(applyGroupTypes\(applyProductGroups\(products, productGroupsMkt,/.test(M) &&
  /aggProducts = completarImagens\(aggProducts, imagens, productGroupsMkt\);/.test(M), 'Estoque também (por canal e panorama)');

t.fim();
