// Formatação de dinheiro: uma implementação só, e ela sempre mostra os centavos.
//
// Eram seis, uma por página, e tinham divergido em duas coisas ao mesmo tempo: as casas decimais
// (o mesmo pedido de R$ 119,90 saía como "R$ 120" na Visão geral e como "R$ 119,90" em Segmentos)
// e o símbolo do dólar ("U$", "US$", "$"). Nenhuma das duas dá erro — só faz quem confere o número
// contra a Shopify ou o Bling parar pra entender a diferença.
//
// Decisão do Luan (03/09/2026): tudo com centavos, sem arredondar. Por isso a função é EXECUTADA
// aqui, contra valores de verdade, em vez de conferida por texto.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, PUB, fontePagina } from './_lib.mjs';

const t = criarTeste('Formato de dinheiro');

const src = fs.readFileSync(path.join(PUB, 'js', 'moeda.js'), 'utf8');
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const M = ctx.window.CocoMoeda;
t.ok(!!M && typeof M.fmt === 'function', 'o módulo publica CocoMoeda.fmt');

// ── Centavos sempre, inclusive quando são zero ──
// "R$ 120" pra um pedido de R$ 119,90 foi o que originou tudo isto.
t.ok(/119,90$/.test(M.fmt(119.9, 'br')), 'R$ 119,90 não vira R$ 120');
t.ok(/120,00$/.test(M.fmt(120, 'br')), 'valor redondo mostra os centavos zerados, pra coluna ficar alinhada');
t.ok(/0,40$/.test(M.fmt(0.4, 'br')), 'valor menor que um real não vira zero');
// Três produtos de R$ 0,40 apareciam como "R$ 0" cada, com o total dizendo "R$ 1".
t.ok(!/^R\$\s*0$/.test(M.fmt(0.4, 'br')), 'e a coluna fecha com o total');
t.ok(/119\.90$/.test(M.fmt(119.9, 'us')), 'nos EUA também');

// ── Símbolo e separadores saem do idioma, não escritos à mão ──
t.ok(M.fmt(1234.5, 'br').includes('R$'), 'BR usa R$');
t.ok(/1\.234,50/.test(M.fmt(1234.5, 'br')), 'BR: ponto no milhar, vírgula no centavo');
t.ok(M.fmt(1234.5, 'us').includes('$'), 'EUA usa $');
t.ok(/1,234\.50/.test(M.fmt(1234.5, 'us')), 'EUA: vírgula no milhar, ponto no centavo');
// Mercado desconhecido não pode virar NaN nem sumir com o valor.
t.ok(/119,90$/.test(M.fmt(119.9, undefined)), 'sem mercado informado, cai no Brasil');

// ── Entrada ruim não vira "NaN" na tela ──
for (const [v, como] of [[null, 'null'], [undefined, 'undefined'], ['', 'texto vazio'], ['abc', 'texto']]) {
  t.ok(/0,00$/.test(M.fmt(v, 'br')), `${como} vira zero, não NaN`);
}
// O sinal vem ANTES do símbolo ("-R$ 119,90"), que é como o pt-BR escreve.
const negativo = M.fmt(-119.9, 'br').replace(/−/g, '-');
t.ok(negativo.startsWith('-') && negativo.endsWith('119,90'), 'valor negativo continua negativo');

// ── A forma curta é só pra rótulo de eixo ──
// Um eixo com cinco marcas de "R$ 651.487,32" empilhadas fica ilegível e empurra o gráfico pra
// fora do card. Abaixo de mil ela devolve o valor cheio, com centavos.
t.ok(/119,90$/.test(M.curto(119.9, 'br')), 'abaixo de mil, a forma curta mostra o valor cheio');
t.ok(/K$/.test(M.curto(651487.32, 'br')), 'acima de mil, abrevia');
t.ok(/651,5K$/.test(M.curto(651487.32, 'br')), 'e a abreviação tem uma casa');

// ── Nenhuma página formata dinheiro por conta própria ──
const paginas = ['index', 'geografia', 'campanhas', 'produtos', 'segmentos', 'unificador'];
for (const p of paginas) {
  const js = fs.readFileSync(path.join(PUB, 'js', 'paginas', p + '.js'), 'utf8');
  const semComentario = js.replace(/^\s*\/\/.*$/gm, '');
  t.ok(!/currency:\s*'(BRL|USD)'/.test(semComentario), `${p}: não monta moeda por conta própria`);
  t.ok(!/'(R|U|US)\$ '/.test(semComentario), `${p}: não escreve o símbolo à mão`);
  // O que sobrou é um repasse de uma linha; o `dec` que existia não decide mais nada.
  const corpo = semComentario.slice(semComentario.indexOf('function fmtMoney'));
  t.ok(/CocoMoeda\.fmt\(/.test(corpo.slice(0, 200)), `${p}: o fmtMoney repassa pro CocoMoeda`);
}

// ── E toda página que mostra dinheiro carrega o script ──
// Sem a tag, `CocoMoeda` não existe e a tela quebra na primeira formatação.
for (const p of paginas) {
  const html = fs.readFileSync(path.join(PUB, p + '.html'), 'utf8');
  t.ok(/<script src="js\/moeda\.js"><\/script>/.test(html), `${p}.html carrega o js/moeda.js`);
  t.ok(html.indexOf('js/moeda.js') < html.indexOf(`js/paginas/${p}.js`), `${p}.html carrega antes do script da página`);
}
// Estoque não mostra dinheiro nenhum — não deve carregar o script à toa.
t.ok(!/js\/moeda\.js/.test(fs.readFileSync(path.join(PUB, 'estoque.html'), 'utf8')),
  'Estoque não carrega o formatador: aquela tela não mostra valor');

// A forma curta continua restrita ao eixo dos gráficos.
const telaIndex = fontePagina('index.html').tudo;
const usos = [...telaIndex.matchAll(/fmtMoneyShort\(/g)].length;
t.ok(usos >= 1 && usos <= 5, `a forma curta é usada em poucos lugares (${usos})`);

t.fim();
