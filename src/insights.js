// insights.js — "Insights" da Visão geral
//
// Gera frases curtas explicando O QUE mudou no período em relação ao período anterior
// comparável. Regras determinísticas, SEM IA: o número exibido é sempre o número calculado
// (modelo de linguagem erra conta e inventa com convicção), não custa por acesso, não manda
// dado de faturamento pra fora, e o mesmo dado gera sempre a mesma frase — dá pra testar.
// Decisão de produto, a partir do card de Insights do Shopify.
//
// A faixa de Indicadores no topo já responde "receita subiu 53%". Este card responde "por causa
// de quê": qual canal/produto/estado/etapa do funil puxou o número.
//
// Módulo PURO de propósito: recebe dois retratos já calculados (atual e anterior) e devolve a
// lista. Não lê store, não faz I/O, não importa metrics.js (evita import circular — os rótulos
// de canal chegam por parâmetro). É o que permite testar as regras sem banco.

// ── Pisos anti-ruído ──
// O volume diário do BR gira em torno de algumas dezenas de pedidos. Nesse tamanho, variação
// percentual isolada é ruído puro: um estado que fez 1 venda e passou pra 4 vira "+300%" e não
// significa nada. Por isso TODA regra de variação exige as duas coisas ao mesmo tempo — que a
// mudança seja grande em percentual E que ela pese no total do período. E a ordenação final é
// por impacto em dinheiro, nunca por percentual.
const MIN_PCT = 15;          // variação relativa mínima (%)
const MIN_SHARE = 0.08;      // a variação precisa valer ao menos 8% do total do período maior
const MIN_ORDERS = 8;        // piso de pedidos pra falar de ticket médio
const MIN_SESSIONS = 100;    // piso de sessões pra falar de conversão/funil
// Teto da lista. Subiu de 6 pra 10 quando a tira virou horizontal com carrossel: o que limitava
// antes era altura de card, e agora não limita mais. Os pisos anti-ruído abaixo é que decidem
// de verdade quantos aparecem — este número é só o teto, e na prática quase nunca é atingido,
// porque insight sem relevância nem chega aqui.
const MAX_INSIGHTS = 10;
const MAX_POR_DIMENSAO = 2;  // evita lista inteira falando só de canal (ou só de produto)
// Piso ABSOLUTO em dinheiro, além do piso relativo (MIN_SHARE). Os dois são necessários: num
// período de volume baixo (um único dia fraco), uma variação de R$ 60 pode representar 50% do
// total e passar no piso relativo, mas continua sendo troco e não merece uma frase no card.
const MIN_ABS = { br: 200, us: 50 };

const pct = (cur, prev) => (prev === 0 ? null : ((cur - prev) / prev) * 100);

// Formatação no padrão do resto do app: BRL/pt-BR no Brasil, USD/en-US nos EUA.
function makeFmt(market) {
  const loc = market === 'us' ? 'en-US' : 'pt-BR';
  const cur = market === 'us' ? 'USD' : 'BRL';
  const num = (v, dec = 1) => Number(v || 0).toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return {
    money: v => Number(v || 0).toLocaleString(loc, { style: 'currency', currency: cur, maximumFractionDigits: 0 }),
    int: v => Number(v || 0).toLocaleString(loc, { maximumFractionDigits: 0 }),
    pct: v => `${num(v)}%`,
    num,
    // Ponto percentual não é a mesma coisa que percentual: a conversão sair de 3,1% para 2,7% é
    // uma queda de 0,4 PONTO percentual (e de 13% em termos relativos). Escrever "queda de 0,4%"
    // ali estaria errado, e "queda de 0,4% em pontos percentuais" fica confuso.
    pp: v => {
      const a = Math.abs(Number(v) || 0);
      return `${num(a)} ${a === 1 ? 'ponto percentual' : 'pontos percentuais'}`;
    },
  };
}

// Variação em texto, sempre positiva ("aumento de 13%" / "queda de 13%") — quem diz a direção
// é o verbo da frase, não o sinal do número, pra não sair "queda de -13%".
const absPct = (v, f) => f.pct(Math.abs(v));

// Título de produto entra no MEIO de uma frase, e os títulos reais aqui são descrições inteiras
// ("Lisina para gatos - 120g - Ajuda na imunidade e visão. Sabor salmão."). Sem cortar, a frase
// fica ilegível e o ponto final do título quebra a leitura no meio.
function curto(s, max = 42) {
  const t = String(s || '').trim().replace(/[.\s]+$/, '');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// Duas barras comparativas (atual em cima, anterior embaixo), mesmo desenho do card do Shopify.
function chart(fmt, curVal, prevVal, curLabel = 'Período atual', prevLabel = 'Período anterior') {
  return { fmt, rows: [{ label: curLabel, value: curVal }, { label: prevLabel, value: prevVal }] };
}

// Uma variação em dinheiro só entra na lista se passar nos TRÊS pisos: valer alguma coisa em
// valor absoluto, pesar no total do período, e ser grande em percentual.
function relevante(curVal, prevVal, totalRef, market) {
  const diff = Math.abs(curVal - prevVal);
  const p = pct(curVal, prevVal);
  if (diff < (MIN_ABS[market] ?? MIN_ABS.br)) return false;
  if (totalRef > 0 && diff < totalRef * MIN_SHARE) return false;
  if (p === null) return prevVal === 0 && curVal > 0; // nasceu do zero: relevante se passou nos pisos acima
  return Math.abs(p) >= MIN_PCT;
}

// ── Regras ──
// Cada regra devolve 0..n insights. Assinatura igual pra todas, pra ficar fácil adicionar
// regra nova depois sem mexer no orquestrador.
//
// Todo insight tem DOIS textos, e a diferença importa:
//   `label` — sintagma curto ("Conversão em queda", "Amazon BR sem vendas"), do tamanho de uma
//             aba. É o que aparece na tira horizontal de seleção no topo do card, onde o espaço
//             por item é de uns 200px. Frase inteira ali não cabe e vira reticências.
//   `title` — a frase completa ("A conversão da loja caiu em relação ao período anterior"), que
//             aparece no detalhe, embaixo, com a largura do card inteiro.
// Regra nova que esquecer o `label` não quebra (o front cai no `title`), mas fica feia na tira.
//
// `kind` é o SEMÁFORO do insight, e é o servidor que decide (pedido do Luan, 24/08/2026):
//   'bom'   → verde     ganho claro
//   'medio' → amarelo   nem ganho nem perda: risco, concentração, movimento de dimensão secundária
//   'ruim'  → vermelho  perda clara, ou algo que precisa de ação
// Não dá pra derivar isso do SINAL da variação no front: ACOS caindo é ótimo, custo subindo é
// ruim, e "concentração de 80% num produto" não tem sinal nenhum. Quem sabe o que o número
// significa é a regra que o produziu, então a decisão nasce aqui e o front só pinta.

// Canal que simplesmente parou de vender. É a regra mais valiosa do card: quase sempre significa
// integração quebrada (token expirado, canal desligado sem querer), não queda de vendas de
// verdade. Por isso não depende de percentual e sobe pro topo da lista.
function regraCanalParado({ cur, prev, ctx }) {
  if (ctx.channel !== 'todos') return [];
  const out = [];
  for (const [ch, prevRev] of Object.entries(prev.byChannel || {})) {
    const curRev = cur.byChannel?.[ch] || 0;
    if (curRev > 0 || prevRev <= 0) continue;
    if (prev.revenue > 0 && prevRev / prev.revenue < 0.05) continue; // canal irrelevante antes
    out.push({
      id: `canal-parado-${ch}`,
      kind: 'ruim',
      dimension: 'Canal',
      label: `${ctx.label(ch)} sem vendas`,
      title: `${ctx.label(ch)} não registrou nenhuma venda no período`,
      detail: `No período anterior esse canal fez ${ctx.f.money(prevRev)}. Vale conferir se a integração está sincronizando antes de tratar como queda de vendas.`,
      impact: prevRev,
      priority: 100,
      chart: chart('money', 0, prevRev),
      deltaPct: -100,
    });
  }
  return out;
}

// Qual canal puxou a variação da receita total, pra cima e pra baixo.
function regraCanal({ cur, prev, ctx }) {
  if (ctx.channel !== 'todos') return [];
  const ref = Math.max(cur.revenue, prev.revenue);
  const moves = [];
  const keys = new Set([...Object.keys(cur.byChannel || {}), ...Object.keys(prev.byChannel || {})]);
  for (const ch of keys) {
    const c = cur.byChannel?.[ch] || 0;
    const p = prev.byChannel?.[ch] || 0;
    if (p === 0 && c === 0) continue;
    if (c === 0) continue; // canal zerado é assunto da regraCanalParado
    if (!relevante(c, p, ref, ctx.market)) continue;
    moves.push({ ch, c, p, diff: c - p, pctv: pct(c, p) });
  }
  moves.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const out = [];
  for (const dir of ['up', 'down']) {
    const m = moves.find(x => (dir === 'up' ? x.diff > 0 : x.diff < 0));
    if (!m) continue;
    const subiu = m.diff > 0;
    const novo = m.p === 0;
    out.push({
      id: `canal-${dir}-${m.ch}`,
      kind: subiu ? 'bom' : 'ruim',
      dimension: 'Canal',
      label: `${ctx.label(m.ch)} ${novo ? 'estreou' : (subiu ? 'em alta' : 'em queda')}`,
      title: novo
        ? `${ctx.label(m.ch)} começou a vender no período`
        : `${ctx.label(m.ch)} foi o canal que mais ${subiu ? 'cresceu' : 'caiu'} em receita`,
      detail: novo
        ? `Fez ${ctx.f.money(m.c)}, sem nenhuma venda no período anterior.`
        : `Passou de ${ctx.f.money(m.p)} para ${ctx.f.money(m.c)}, ${subiu ? 'um aumento' : 'uma queda'} de ${absPct(m.pctv, ctx.f)}.`,
      impact: Math.abs(m.diff),
      priority: subiu ? 60 : 80,
      chart: chart('money', m.c, m.p),
      deltaPct: m.pctv,
    });
  }
  return out;
}

// Produto que mais mexeu no faturamento.
function regraProduto({ cur, prev, ctx }) {
  const ref = Math.max(cur.revenue, prev.revenue);
  const prevByTitle = new Map((prev.products || []).map(p => [p.title, p.revenue]));
  const moves = [];
  for (const p of cur.products || []) {
    const pr = prevByTitle.get(p.title) || 0;
    if (!relevante(p.revenue, pr, ref, ctx.market)) continue;
    moves.push({ title: p.title, c: p.revenue, p: pr, diff: p.revenue - pr, pctv: pct(p.revenue, pr) });
  }
  // Produto que sumiu: vendia antes, zerou agora.
  for (const [title, pr] of prevByTitle) {
    if ((cur.products || []).some(p => p.title === title)) continue;
    if (!relevante(0, pr, ref, ctx.market)) continue;
    moves.push({ title, c: 0, p: pr, diff: -pr, pctv: -100 });
  }
  moves.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const m = moves[0];
  if (!m) return [];
  const subiu = m.diff > 0;
  return [{
    id: `produto-${subiu ? 'up' : 'down'}`,
    kind: subiu ? 'bom' : 'ruim',
    dimension: 'Produto',
    label: `${curto(m.title, 26)} ${subiu ? 'em alta' : 'em queda'}`,
    title: `${curto(m.title)} ${subiu ? 'puxou o faturamento pra cima' : 'perdeu faturamento'}`,
    detail: m.p === 0
      ? `Fez ${ctx.f.money(m.c)}, sem venda no período anterior.`
      : m.c === 0
        ? `Fez ${ctx.f.money(m.p)} no período anterior e não vendeu nada agora.`
        : `Passou de ${ctx.f.money(m.p)} para ${ctx.f.money(m.c)}, ${subiu ? 'um aumento' : 'uma queda'} de ${absPct(m.pctv, ctx.f)}.`,
    impact: Math.abs(m.diff),
    priority: subiu ? 55 : 70,
    chart: chart('money', m.c, m.p),
    deltaPct: m.pctv,
  }];
}

// Dependência de um produto só. Não é variação, é risco de concentração: não entra se a loja
// tem poucos produtos vendendo por natureza no período.
function regraConcentracao({ cur, ctx }) {
  const prods = cur.products || [];
  if (prods.length < 3 || cur.revenue <= 0) return [];
  const top = prods[0];
  // Guarda contra "concentra 136% da receita": receita por produto e receita total saem da mesma
  // passada de pedidos, então não deveria acontecer — mas se algum dia divergirem (produto oculto
  // filtrado de um lado e não do outro, por exemplo), é melhor não dizer nada do que dizer um
  // absurdo, e o gráfico de "todo o resto" ficaria negativo.
  if (top.revenue > cur.revenue) return [];
  const share = top.revenue / cur.revenue;
  if (share < 0.6) return [];
  return [{
    id: 'concentracao',
    kind: 'medio',
    dimension: 'Produto',
    label: `Concentração em ${curto(top.title, 18)}`,
    title: `${curto(top.title)} concentra ${ctx.f.pct(share * 100)} da receita do período`,
    detail: `De ${ctx.f.money(cur.revenue)} faturados, ${ctx.f.money(top.revenue)} vieram de um produto só. Vale acompanhar o estoque dele de perto.`,
    impact: top.revenue * 0.25, // pesa menos que uma variação de verdade na ordenação
    priority: 30,
    chart: chart('money', top.revenue, cur.revenue - top.revenue, curto(top.title, 24), 'Todo o resto'),
    deltaPct: null,
  }];
}

// Estado que mais mexeu. Só faz sentido com o mercado inteiro à vista.
function regraEstado({ cur, prev, ctx }) {
  const ref = Math.max(cur.revenue, prev.revenue);
  const keys = new Set([...Object.keys(cur.byState || {}), ...Object.keys(prev.byState || {})]);
  const moves = [];
  for (const uf of keys) {
    const c = cur.byState?.[uf]?.revenue || 0;
    const p = prev.byState?.[uf]?.revenue || 0;
    if (!relevante(c, p, ref, ctx.market)) continue;
    moves.push({ uf, c, p, diff: c - p, pctv: pct(c, p) });
  }
  moves.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const m = moves[0];
  if (!m) return [];
  const subiu = m.diff > 0;
  return [{
    id: `estado-${subiu ? 'up' : 'down'}`,
    kind: subiu ? 'bom' : 'medio',
    dimension: 'Geografia',
    label: `${ctx.stateLabel(m.uf)} ${subiu ? 'em alta' : 'em queda'}`,
    title: `${ctx.stateLabel(m.uf)} ${subiu ? 'comprou mais' : 'comprou menos'} que no período anterior`,
    detail: m.p === 0
      ? `Fez ${ctx.f.money(m.c)}, sem venda no período anterior.`
      : `Passou de ${ctx.f.money(m.p)} para ${ctx.f.money(m.c)}, ${subiu ? 'um aumento' : 'uma queda'} de ${absPct(m.pctv, ctx.f)}.`,
    impact: Math.abs(m.diff) * 0.6, // dimensão secundária: não deve ofuscar canal/produto
    priority: 25,
    chart: chart('money', m.c, m.p),
    deltaPct: m.pctv,
  }];
}

// Conversão da loja (só Shopify tem sessão; marketplace não reporta).
function regraConversao({ cur, prev, ctx }) {
  if (!cur.sessions || cur.sessions < MIN_SESSIONS || !prev.sessions || prev.sessions < MIN_SESSIONS) return [];
  const c = cur.conversion || 0, p = prev.conversion || 0;
  const diffPP = (c - p) * 100; // conversion vem como fração (0.0265)
  if (Math.abs(diffPP) < 0.3) return [];
  const caiu = diffPP < 0;
  return [{
    id: 'conversao',
    kind: caiu ? 'ruim' : 'bom',
    dimension: 'Conversão',
    label: `Conversão ${caiu ? 'em queda' : 'em alta'}`,
    title: `A conversão da loja ${caiu ? 'caiu' : 'subiu'} em relação ao período anterior`,
    detail: `Passou de ${ctx.f.pct(p * 100)} para ${ctx.f.pct(c * 100)} das sessões, ${caiu ? 'uma queda' : 'um ganho'} de ${ctx.f.pp(diffPP)}.`,
    impact: Math.abs(diffPP) * (cur.revenue / 100), // traduz em ordem de grandeza de dinheiro
    priority: caiu ? 75 : 50,
    chart: chart('pct', c * 100, p * 100),
    deltaPct: p === 0 ? null : ((c - p) / p) * 100,
  }];
}

// Onde o funil mais vaza no período atual. Não é comparação com o anterior: é diagnóstico do
// agora, respondendo "perdi gente em qual etapa".
function regraFunil({ cur, ctx }) {
  const f = cur.funnel || {};
  if (!f.sessions || f.sessions < MIN_SESSIONS) return [];
  const etapas = [
    ['Sessões', f.sessions],
    ['Adicionou carrinho', f.cart],
    ['Iniciou checkout', f.checkout],
    ['Concluiu compra', f.completed],
  ];
  let pior = null;
  for (let i = 1; i < etapas.length; i++) {
    const [nome, v] = etapas[i];
    const [nomeAnt, ant] = etapas[i - 1];
    if (!ant) continue;
    const perda = (1 - v / ant) * 100;
    if (!pior || perda > pior.perda) pior = { nome, nomeAnt, v, ant, perda };
  }
  if (!pior || pior.perda < 50) return [];
  // Amarelo, não vermelho: perder 90%+ entre sessão e carrinho é o normal de qualquer loja, e
  // esta regra é diagnóstico ("onde vaza mais"), não alarme de que algo quebrou. Vermelho fixo
  // aqui apareceria em TODO período e treinaria o olho a ignorar o vermelho do card inteiro.
  // Só vira vermelho quando o vazamento é no fim do funil (quem já chegou no checkout e desiste
  // de pagar), que aí sim é dinheiro perdido na porta e costuma ter causa acionável.
  const noFim = pior.nome === 'Concluiu compra';
  return [{
    id: 'funil',
    kind: noFim ? 'ruim' : 'medio',
    dimension: 'Funil',
    label: `Vazamento em ${pior.nome.toLowerCase()}`,
    title: `A maior perda do funil está entre ${pior.nomeAnt.toLowerCase()} e ${pior.nome.toLowerCase()}`,
    detail: `De ${ctx.f.int(pior.ant)} que chegaram nessa etapa, ${ctx.f.int(pior.v)} seguiram adiante. São ${ctx.f.pct(pior.perda)} que ficaram pelo caminho.`,
    impact: 0.5, // diagnóstico, não movimento: fica no fim da lista se houver coisa mais forte
    priority: 40,
    chart: chart('int', pior.v, pior.ant, pior.nome, pior.nomeAnt),
    deltaPct: -pior.perda,
  }];
}

// Ticket médio.
function regraTicket({ cur, prev, ctx }) {
  if (cur.orders < MIN_ORDERS || prev.orders < MIN_ORDERS) return [];
  const p = pct(cur.aov, prev.aov);
  if (p === null || Math.abs(p) < MIN_PCT) return [];
  const subiu = p > 0;
  return [{
    id: 'ticket',
    kind: subiu ? 'bom' : 'medio',
    dimension: 'Ticket médio',
    label: `Ticket médio ${subiu ? 'em alta' : 'em queda'}`,
    title: `O ticket médio ${subiu ? 'subiu' : 'caiu'} em relação ao período anterior`,
    detail: `Passou de ${ctx.f.money(prev.aov)} para ${ctx.f.money(cur.aov)} por pedido, ${subiu ? 'um aumento' : 'uma queda'} de ${absPct(p, ctx.f)}.`,
    impact: Math.abs(cur.aov - prev.aov) * cur.orders,
    priority: 45,
    chart: chart('money', cur.aov, prev.aov),
    deltaPct: p,
  }];
}

// Eficiência do investimento em anúncio (Meta). ACOS/ROAS já aparecem como número na faixa de
// indicadores; aqui o ponto é a MUDANÇA de eficiência.
function regraRoas({ cur, prev, ctx }) {
  if (!(cur.adCost > 0)) return [];
  const c = cur.roas || 0, p = prev.roas || 0;

  // Gastou e não veio NENHUMA venda atribuída. "O ROAS passou de 1,14× para 0,00×" está certo na
  // conta mas parece defeito de tela; e o mais importante ali não é a variação, é o dinheiro
  // torrado sem retorno rastreado. Frase própria, e não depende de haver período anterior.
  if (c === 0) {
    return [{
      id: 'roas-zero',
      kind: 'ruim',
      dimension: 'Anúncios',
      label: 'Anúncios sem retorno',
      title: 'Nenhuma venda foi atribuída aos anúncios no período',
      detail: `Foram ${ctx.f.money(cur.adCost)} investidos sem nenhum pedido com origem de anúncio identificada. Em período curto isso costuma ser a atribuição demorando a chegar, mas se repetir vale investigar.`,
      impact: cur.adCost,
      priority: 70,
      chart: chart('money', 0, cur.adCost, 'Receita atribuída', 'Investido'),
      deltaPct: null,
    }];
  }

  if (!(prev.adCost > 0) || p === 0) return [];
  const pv = pct(c, p);
  if (Math.abs(pv) < 20) return [];
  const piorou = pv < 0;
  return [{
    id: 'roas',
    kind: piorou ? 'ruim' : 'bom',
    dimension: 'Anúncios',
    label: `Retorno dos anúncios ${piorou ? 'pior' : 'melhor'}`,
    title: `O retorno sobre o gasto com anúncio ${piorou ? 'piorou' : 'melhorou'}`,
    // ctx.f.num, não toFixed: toFixed sempre usa ponto decimal, e em pt-BR o separador é vírgula.
    detail: `O ROAS passou de ${ctx.f.num(p, 2)}× para ${ctx.f.num(c, 2)}×, com ${ctx.f.money(cur.adCost)} investidos no período contra ${ctx.f.money(prev.adCost)} antes.`,
    impact: Math.abs(cur.adCost - prev.adCost) + Math.abs(pv),
    priority: piorou ? 65 : 50,
    chart: chart('x', c, p),
    deltaPct: pv,
  }];
}

const REGRAS = [
  regraCanalParado,
  regraCanal,
  regraProduto,
  regraConcentracao,
  regraConversao,
  regraFunil,
  regraTicket,
  regraRoas,
  regraEstado,
];

/**
 * Monta a lista de insights do período.
 *
 * @param {object}  cur    retrato do período atual (ver dimensionSnapshot em metrics.js)
 * @param {object}  prev   mesmo formato, período anterior comparável
 * @param {string}  market 'br' | 'us' (define moeda/locale das frases)
 * @param {string}  channel canal selecionado na tela — regras de canal só rodam em 'todos'
 * @param {object}  channelLabels mapa { chave: 'Rótulo' } vindo do metrics.js (evita duplicar
 *                  o vocabulário de canal e evita import circular)
 * @param {object}  stateNames mapa opcional { UF: 'Nome por extenso' }
 * @returns {Array} insights ordenados: primeiro por prioridade da regra, depois por impacto
 */
export function buildInsights({ cur, prev, market = 'br', channel = 'todos', channelLabels = {}, stateNames = {} } = {}) {
  if (!cur) return [];
  const ctx = {
    market,
    channel,
    f: makeFmt(market),
    label: ch => channelLabels[ch] || ch,
    stateLabel: uf => stateNames[uf] || uf,
  };
  const prevSafe = prev || { revenue: 0, orders: 0, aov: 0, byChannel: {}, byState: {}, products: [] };

  const todos = [];
  for (const regra of REGRAS) {
    try {
      todos.push(...(regra({ cur, prev: prevSafe, ctx }) || []));
    } catch (e) {
      // Uma regra com defeito não pode derrubar o card inteiro nem o /api/dashboard. Loga e segue
      // (o projeto proíbe engolir erro em silêncio — ver CLAUDE.md, "Nunca engolir erro").
      console.error(`[insights] regra ${regra.name} falhou:`, e);
    }
  }
  // Ordena por prioridade da regra e, no empate, por impacto em dinheiro. Depois limita a
  // MAX_POR_DIMENSAO por assunto: sem isso, um dia em que tudo mexeu no mesmo eixo (dois canais
  // pra cima, um pra baixo, um parado) enchia as 6 vagas só com "Canal" e o card deixava de
  // mostrar conversão/funil/produto, que é justamente onde está a informação nova.
  const porDimensao = {};
  const jaDito = new Set();
  return todos
    .sort((a, b) => (b.priority - a.priority) || (b.impact - a.impact))
    .filter(i => {
      // Dois insights com exatamente os mesmos dois números estão contando o mesmo fato por
      // ângulos diferentes. Acontece de verdade num canal que vende um produto só: "Shopify caiu
      // de R$ 587 pra R$ 357" e "Lisina caiu de R$ 587 pra R$ 357" viram duas linhas dizendo a
      // mesma coisa. Fica a de maior prioridade (a ordenação já rodou).
      const assinatura = i.chart.rows.map(r => Math.round(r.value * 100)).join('|');
      if (jaDito.has(assinatura)) return false;
      jaDito.add(assinatura);

      const n = (porDimensao[i.dimension] || 0) + 1;
      if (n > MAX_POR_DIMENSAO) return false;
      porDimensao[i.dimension] = n;
      return true;
    })
    .slice(0, MAX_INSIGHTS);
}
