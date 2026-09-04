// Período de comparação — com o quê a dashboard compara o período escolhido.
//
// Por padrão é a janela imediatamente anterior, do mesmo tamanho. O botão "Trocar" no card de
// Insights deixa escolher outra, e aí a comparação inteira (deltas dos Indicadores e Insights)
// passa a ser contra ela.
//
// O que este teste protege, que quebra em silêncio:
//   1. a janela automática precisa terminar no dia ANTERIOR ao período e ter o mesmo tamanho —
//      errar por um dia sobrepõe os dois períodos e a comparação passa a contar o mesmo pedido
//      dos dois lados;
//   2. meia escolha (só uma ponta) cai no automático, nunca numa janela pela metade;
//   3. só as barras que comparam PERÍODO recebem a data ao lado: três regras usam as mesmas
//      barras pra comparar outra coisa ("Todo o resto", "Investido"), e escrever uma data ali
//      seria dizer que aquilo é um período;
//   4. trocar o período atual desfaz a comparação escolhida — senão um período de 7 dias
//      apareceria comparado com um de 90, e a queda enorme seria só a diferença de tamanho.
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, ROOT, PUB } from './_lib.mjs';
import { janelaDeComparacao } from '../../src/metrics.js';
import { buildInsights } from '../../src/insights.js';

const t = criarTeste('Período de comparação');

// ── 1. A janela automática ────────────────────────────────────────────────────
{
  const j = janelaDeComparacao({ since: '2026-08-15', span: 7 });
  t.eq(j.prevUntil, '2026-08-14', 'a janela automática termina no dia anterior ao período');
  t.eq(j.prevSince, '2026-08-08', 'e tem o mesmo tamanho do período');
  t.eq(j.comparacaoManual, false, 'e não se declara escolhida à mão');

  // Um dia de erro aqui faria os dois períodos se sobreporem e o mesmo pedido contar dos dois lados.
  const umDia = janelaDeComparacao({ since: '2026-08-15', span: 1 });
  t.eq(umDia.prevSince, '2026-08-14', 'período de um dia compara com o dia anterior');
  t.eq(umDia.prevUntil, '2026-08-14', 'começando e terminando nele');

  // Virada de mês e de ano: a conta é em dias, não em "mesmo dia do mês anterior".
  t.eq(janelaDeComparacao({ since: '2026-01-01', span: 31 }).prevSince, '2025-12-01', 'atravessa a virada de ano');
  t.eq(janelaDeComparacao({ since: '2026-03-01', span: 1 }).prevUntil, '2026-02-28', 'e o fim de fevereiro');
}

// ── 2. A janela escolhida à mão ───────────────────────────────────────────────
{
  const j = janelaDeComparacao({ since: '2026-08-15', span: 7, compSince: '2026-07-01', compUntil: '2026-07-07' });
  t.eq(j.prevSince, '2026-07-01', 'a janela escolhida é usada como está');
  t.eq(j.prevUntil, '2026-07-07', 'nas duas pontas');
  t.eq(j.comparacaoManual, true, 'e se declara escolhida, pra tela poder dizer isso');

  // Meia escolha compararia com um intervalo que ninguém pediu, sem nada denunciando na tela.
  for (const meia of [{ compSince: '2026-07-01' }, { compUntil: '2026-07-07' }]) {
    const m = janelaDeComparacao({ since: '2026-08-15', span: 7, ...meia });
    t.eq(m.prevSince, '2026-08-08', 'meia escolha cai na janela automática');
    t.eq(m.comparacaoManual, false, 'e não se declara escolhida');
  }
}

// ── 3. Só barra de PERÍODO leva data ──────────────────────────────────────────
{
  const base = {
    revenue: 1000, orders: 10, aov: 100, byChannel: { shopee: 1000 }, byState: {},
    products: [], sessions: 0, conversion: 0, adCost: 0, roas: 0,
    funnel: { sessions: 0, cart: 0, checkout: 0, completed: 0 },
  };
  const cur = { ...base };
  const prev = { ...base, revenue: 500, aov: 50, byChannel: { shopee: 500 } };
  const lista = buildInsights({ cur, prev, market: 'br', channel: 'todos', channelLabels: { shopee: 'Shopee' }, stateNames: {} });
  t.ok(lista.length > 0, 'as regras produziram algum insight pra examinar');
  for (const i of lista) {
    for (const r of (i.chart?.rows || [])) {
      const ehPeriodo = r.label === 'Período atual' || r.label === 'Período anterior';
      t.eq(Boolean(r.periodo), ehPeriodo, `"${r.label}" ${ehPeriodo ? 'é' : 'não é'} barra de período`);
    }
  }

  // Uma regra que compara OUTRA coisa: um produto contra todo o resto. Sem a distinção, a tela
  // escreveria uma data ao lado de "Todo o resto".
  // A regra de concentração exige pelo menos três produtos vendendo e 60% num só.
  const comProduto = {
    ...base,
    products: [
      { title: 'Lisina 120g', revenue: 900, qty: 9 },
      { title: 'Daily', revenue: 60, qty: 1 },
      { title: 'Areia', revenue: 40, qty: 1 },
    ],
  };
  const conc = buildInsights({
    cur: comProduto, prev: { ...prev, products: [] },
    market: 'br', channel: 'todos', channelLabels: {}, stateNames: {},
  }).find(i => i.id === 'concentracao');
  t.ok(!!conc, 'a regra de concentração entrou (é ela que compara um produto com todo o resto)');
  for (const r of (conc?.chart?.rows || [])) {
    t.ok(!r.periodo, `"${r.label}" não é período e não leva data`);
  }
}

// ── 4. Guardas da tela ────────────────────────────────────────────────────────
const tela = fs.readFileSync(path.join(PUB, 'js', 'paginas', 'index.js'), 'utf8');
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const css  = fs.readFileSync(path.join(PUB, 'css', 'paginas', 'index.css'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// O cálculo pode estar certo e a tela não receber a janela: sem estes três campos em `period`,
// a barra não tem o que escrever entre parênteses e volta a comparar com algo anônimo.
const metrics = fs.readFileSync(path.join(ROOT, 'src', 'metrics.js'), 'utf8');
t.ok(/period: \{ since, until, span, grain, prevSince, prevUntil, comparacaoManual \}/.test(metrics),
  'a janela comparada volta no payload, junto do período');

t.ok(/id="insCmpBtn"/.test(html), 'o botão "Trocar" existe no card de Insights');
t.ok(/id="insCmpApply"/.test(html) && /id="insCmpAuto"/.test(html), 'com aplicar e voltar ao automático');
t.ok(/\.ins-cmp-btn\{/.test(css), 'e tem estilo próprio');

// A data só aparece na barra do período anterior, e sai do CocoPeriodo — que é a fonte única do
// texto de intervalo no app inteiro (ver CLAUDE.md, "Rótulo de período").
t.ok(/r\.periodo === 'prev' \? rotuloComparacao\(\)/.test(tela), 'a data vai só na barra do período anterior');
t.ok(/CocoPeriodo\.rotulo/.test(tela), 'formatada pela fonte única de rótulo de período');

// Trocar o período atual desfaz a comparação escolhida, e isso precisa valer nas DUAS portas que
// mudam o período (os presets e o intervalo personalizado). Contar ocorrências no arquivo não
// serve: sobrando as outras chamadas, a conta continua batendo com uma das portas furada.
const portas = [...tela.matchAll(/localStorage\.setItem\('coco_since'/g)];
t.eq(portas.length, 2, 'as duas portas que mudam o período continuam sendo duas');
for (const [i, m] of portas.entries()) {
  const antes = tela.slice(Math.max(0, m.index - 400), m.index);
  t.ok(/resetarComparacao\(\)/.test(antes), `a porta ${i + 1} que muda o período desfaz a comparação escolhida`);
}

// Sem isto o botão "Trocar" guarda a escolha e o servidor nunca fica sabendo dela.
t.ok(/p\.set\('prevSince', compSince\)/.test(tela) && /p\.set\('prevUntil', compUntil\)/.test(tela),
  'a tela manda a janela escolhida pro servidor');
t.ok(/if \(comparacaoManual\(\)\)/.test(tela), 'e só quando ela foi mesmo escolhida');

// sessionStorage e não localStorage: a escolha sobrevive à navegação na aba, mas não pra sempre —
// uma comparação esquecida de semanas atrás faria a dashboard mentir sem ninguém lembrar por quê.
t.ok(/sessionStorage\.(get|set)Item\('coco_comp_/.test(tela), 'a comparação escolhida vive na sessão');
t.ok(!/localStorage\.setItem\('coco_comp_/.test(tela), 'e não fica guardada pra sempre');

// "anterior" deixa de ser verdade quando a janela é escolhida: ela pode nem vir antes.
t.ok(/vs\. período escolhido/.test(tela), 'o texto muda quando a comparação é escolhida à mão');

// O servidor precisa recusar data fora de formato em vez de repassar pro cálculo, e a comparação
// volta a ser a automática em vez de a tela inteira falhar por causa de um parâmetro.
t.ok(/\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(server) && /prevSince/.test(server), 'o servidor valida o formato da data recebida');
t.ok(/compSince > compUntil/.test(server), 'e endireita um intervalo invertido em vez de comparar ao contrário');

t.fim();
