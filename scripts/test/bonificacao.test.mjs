// Saída em bonificação (doação para UGC) — mercadoria que sai sem venda.
//
// A regra de negócio é uma frase só: a unidade conta, o dinheiro nunca. E ela é frágil de um jeito
// específico — basta um cálculo esquecer de excluir a doação pra ela virar faturamento.
//
// O que este teste protege, que quebra em silêncio:
//   1. quem identifica a doação é a NATUREZA DE OPERAÇÃO, nunca o valor (que vai deixar de ser
//      zero) nem a loja (que pode mudar);
//   2. a doação sai da conta numa PORTA SÓ (getOrders em metrics.js), e não em cada cálculo;
//   3. o valor da nota nunca vira receita, mesmo quando a nota tem valor;
//   4. produto que só foi doado não pode sumir do card — a mercadoria saiu do estoque de verdade;
//   5. o rótulo "Bonificação" concorda entre servidor e tela, como os outros quatro.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, ROOT, PUB } from './_lib.mjs';
import { ehNaturezaDeBonificacao } from '../../src/bling.js';

const t = criarTeste('Saída em bonificação');

const BLING   = fs.readFileSync(path.join(ROOT, 'src', 'bling.js'), 'utf8');
const METRICS = fs.readFileSync(path.join(ROOT, 'src', 'metrics.js'), 'utf8');
const SYNC    = fs.readFileSync(path.join(ROOT, 'src', 'sync.js'), 'utf8');
const TELA    = fs.readFileSync(path.join(PUB, 'js', 'paginas', 'index.js'), 'utf8');

function corpoDaFuncao(src, i) {
  let paren = 0, inicio = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '(') paren++;
    else if (src[j] === ')') { paren--; if (paren === 0) { inicio = src.indexOf('{', j); break; } }
  }
  let prof = 0;
  for (let j = inicio; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (prof === 0) return src.slice(i, j + 1); }
  }
  return '';
}

function carregar(src, nome, ctxExtra = {}) {
  const ctx = { console, ...ctxExtra };
  vm.createContext(ctx);
  vm.runInContext(corpoDaFuncao(src, src.indexOf(`function ${nome}(`)), ctx);
  return ctx[nome];
}

// ── 1. Quem identifica é a natureza ───────────────────────────────────────────
t.ok(ehNaturezaDeBonificacao('Saída em bonificação'), 'a natureza de saída é doação');
t.ok(!ehNaturezaDeBonificacao('Entrada de bonificação'), 'a de entrada não é');
t.ok(!ehNaturezaDeBonificacao('Venda de mercadoria'), 'e venda muito menos');

// A captura não pode voltar a se apoiar no valor nem na loja: o valor vai deixar de ser zero
// (decisão do Luan, 04/09/2026) e a loja pode mudar.
const iFetch = BLING.indexOf('export async function fetchBonificacoes');
t.ok(iFetch > 0, 'bling.js expõe fetchBonificacoes');
const corpoFetch = corpoDaFuncao(BLING, iFetch);
t.ok(/ehNaturezaDeBonificacao\(/.test(corpoFetch), 'a captura decide pela natureza');
t.ok(!/valorNota/.test(corpoFetch), 'e nunca olha o valor da nota pra decidir nem pra somar');
t.ok(!/206202176|loja\?\.id/.test(corpoFetch), 'nem a loja de onde a nota saiu');

// ── 2. O dinheiro da doação nunca entra ───────────────────────────────────────
t.ok(/total:     0,/.test(corpoFetch), 'o pedido de doação nasce com total zero');
t.ok(/amount: 0,/.test(corpoFetch), 'e cada item também');
// Nome e CPF de quem recebeu não entram: são criadores de conteúdo, não clientes, e a dashboard
// não precisa deles pra contar unidade.
t.ok(/customer:  '',/.test(corpoFetch), 'e nada de dado de quem recebeu');

// ── 3. Uma porta só decide se a doação entra na conta ─────────────────────────
// Espalhar esse filtro por cálculo é como a doação vira faturamento: basta um esquecer.
t.ok(/return incluirBonificacao \? todos : todos\.filter\(o => !o\.bonificacao\);/.test(METRICS),
  'getOrders tira a doação por padrão');
const usosSoltos = (METRICS.match(/\.bonificacao/g) || []).length;
t.ok(usosSoltos <= 3, `a checagem de doação vive em poucos lugares em metrics.js (achei ${usosSoltos})`);

// ── 4. Situação da nota: allowlist positiva ───────────────────────────────────
// Só conta o que SAIU. Uma situação nova (rejeitada, denegada) não pode começar a contar unidade
// enviada sozinha — e o que fica de fora precisa aparecer, senão some unidade sem ninguém ver.
t.ok(/const SITUACOES_SAIU = new Set\(\[5, 6\]\)/.test(BLING), 'a allowlist de situação é positiva');
t.ok(/porSituacaoIgnorada/.test(BLING), 'e o que fica de fora volta contado');
t.ok(/notas fora da allowlist de situação/.test(SYNC), 'aparecendo no relatório do sync');

// ── 5. Data do Bling vira instante com o fuso certo ───────────────────────────
const paraISO = carregar(BLING, 'dataBlingParaISO');
t.ok(typeof paraISO === 'function', 'achou dataBlingParaISO');
// O fuso precisa ser CONFERIDO NO TEXTO, e não só pelo resultado: nesta máquina o fuso local já é
// o de Brasília, então tirar o "-03:00" do código não muda resposta nenhuma aqui — e mudaria em
// produção, que roda em UTC. Uma nota das 22h de 31/08 passaria a cair em 01/09 e mudaria de mês.
t.ok(/replace\(' ', 'T'\) \+ '-03:00'/.test(BLING), 'a data do Bling é lida como horário de Brasília');

if (typeof paraISO === 'function') {
  t.eq(paraISO('2026-08-31 22:00:00'), '2026-09-01T01:00:00.000Z', 'e a conversão bate com esse fuso');
  t.eq(paraISO('0000-00-00 00:00:00'), null, 'data vazia do Bling não vira instante inventado');
  t.eq(paraISO(''), null, 'nem string vazia');
}

// ── 6. Produto que só foi doado continua aparecendo ───────────────────────────
const mesclar = carregar(METRICS, 'mesclarDoacao');
t.ok(typeof mesclar === 'function', 'achou mesclarDoacao');
if (typeof mesclar === 'function') {
  const vendas = [
    { title: 'Lysine', revenue: 22548.08, avulsoQty: 153, comboQty: 46 },
    { title: 'Daily',  revenue: 3020.01,  avulsoQty: 16,  comboQty: 9 },
  ];
  const doacao = [
    { title: 'Daily',  revenue: 0, avulsoQty: 62, comboQty: 0 },
    { title: 'Areia Yucaloo', revenue: 0, avulsoQty: 18, comboQty: 0 },
  ];
  const mapa = new Map(doacao.map(p => [p.title, p.avulsoQty + p.comboQty]));
  const r = mesclar(vendas, doacao, mapa);

  t.eq(r.length, 3, 'o produto que só foi doado vira linha própria');
  const daily = r.find(p => p.title === 'Daily');
  t.eq(daily.bonusQty, 62, 'a doação entra na linha do produto que também vendeu');
  t.eq(daily.revenue, 3020.01, 'sem mexer na receita dele');
  const lysine = r.find(p => p.title === 'Lysine');
  t.eq(lysine.bonusQty, 0, 'produto sem doação fica com zero, não com undefined');

  const areia = r.find(p => p.title === 'Areia Yucaloo');
  t.eq(areia.bonusQty, 18, 'a linha só de doação carrega as unidades');
  t.eq(areia.revenue, 0, 'e receita zero');
  t.eq(areia.avulsoQty + areia.comboQty, 0, 'sem inventar unidade vendida');
  t.eq(r[r.length - 1].title, 'Areia Yucaloo', 'e cai pro fim, num card ordenado por receita');
}

// ── 7. A coluna aparece na tela, e só quando há doação ────────────────────────
t.ok(/class="tp-bonus"/.test(TELA), 'a coluna de doação existe no Top produtos');
t.ok(/bonus > 0/.test(TELA), 'e só aparece quando houve doação');
t.ok(!/fmtMoney\(bonus\)/.test(TELA), 'a doação nunca é desenhada como dinheiro');
const css = fs.readFileSync(path.join(PUB, 'css', 'paginas', 'index.css'), 'utf8');
t.ok(/\.tp-bonus\{/.test(css), 'com estilo próprio');

// ── 8. O rótulo concorda entre servidor e tela ────────────────────────────────
// Os quatro rótulos existentes já são conferidos por status-pedido.test.mjs; este é o quinto.
t.ok(/if \(o\.bonificacao\) return 'Bonificação';/.test(METRICS), 'o servidor rotula a doação');
t.ok(/if \(o\.bonificacao\) return \{ cls:'boni', label:'Bonificação' \};/.test(TELA), 'e a tela também');
t.ok(/\.st-tag\.boni\{/.test(css), 'com cor própria: não é pago nem cancelado');

t.fim();
