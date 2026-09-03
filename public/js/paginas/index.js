// ── Settings panel ──
function buildSettingsPanel() {
  CocoColors.buildSection('sp-ch-colors', CocoColors.DEFAULT_CH, 'ch', k => CocoColors.ch[k].bg, (k, v) => {
    CocoColors.setChannelColor(k, v);
    if (lastData) render(lastData);
  });
  CocoColors.buildSection('sp-mkt-colors', CocoColors.DEFAULT_MKT, 'mkt', k => CocoColors.mkt[k], (k, v) => {
    CocoColors.mkt[k] = v;
    CocoColors.save(`mkt.${k}`, v);
    if (lastData) render(lastData);
  });
}

function openSettings() {
  buildSettingsPanel();
  document.getElementById('spOverlay').classList.add('open');
  document.getElementById('spPanel').classList.add('open');
}
function closeSettings() {
  document.getElementById('spOverlay').classList.remove('open');
  document.getElementById('spPanel').classList.remove('open');
}

document.getElementById('settingsBtn').addEventListener('click', e => { e.stopPropagation(); openSettings(); });
document.getElementById('spClose').addEventListener('click', closeSettings);
document.getElementById('spOverlay').addEventListener('click', closeSettings);
document.getElementById('spReset').addEventListener('click', () => {
  CocoColors.resetAll();
  buildSettingsPanel();
  if (lastData) render(lastData);
});
// Toggle canal breakdown
(function() {
  const tog = document.getElementById('toggleChanChart');
  if (!tog) return;
  tog.checked = isChanDetail();
  tog.addEventListener('change', () => {
    localStorage.setItem('coco_chan_detail', tog.checked ? '1' : '0');
    if (!tog.checked) document.getElementById('trendDrilldown').style.display = 'none';
  });
})();

// Toggle "Receita da Amazon": total cobrado × Ordered Product Sales (ver CLAUDE.md)
function isAmazonProductRev() { return localStorage.getItem('coco_amazon_rev_mode') === 'product'; }
(function() {
  const tog = document.getElementById('toggleAmazonRev');
  if (!tog) return;
  tog.checked = isAmazonProductRev();
  tog.addEventListener('change', () => {
    localStorage.setItem('coco_amazon_rev_mode', tog.checked ? 'product' : 'total');
    loadData();
  });
})();

// ── Canal breakdown ──
function isChanDetail() { return localStorage.getItem('coco_chan_detail') !== '0'; }

// ── Tendência: "Geral" (uma linha só) × "Por canal" (uma linha por canal, sem preenchimento de
// área nem linha de Custo ads — com vários canais ao mesmo tempo isso vira poluição visual) — só
// faz sentido com canal="todos" selecionado (um canal específico já filtrado não tem o que
// quebrar em mais linhas); o toggle some sozinho nesse caso.
let trendView = localStorage.getItem('coco_trend_view') || 'geral';
function setTrendView(v) {
  trendView = v;
  localStorage.setItem('coco_trend_view', v);
  document.querySelectorAll('#trendViewToggle .chart-type-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (lastData) render(lastData);
}
document.querySelectorAll('#trendViewToggle .chart-type-btn').forEach(b => b.classList.toggle('active', b.dataset.view === trendView));

// ── Expandir o card de Tendência (dobra a altura do gráfico e ocupa a largura toda).
// Preferência persiste; o resize do ECharts acontece sozinho via echartsRO (o ResizeObserver já
// observa #trendChart, então só precisa trocar largura/altura via CSS).
let trendExpanded = localStorage.getItem('coco_trend_expanded') === '1';
function applyTrendExpanded() {
  const card = document.querySelector('.edit-card[data-card-id="trend"]');
  const chartEl = document.getElementById('trendChart');
  const btn = document.getElementById('trendExpandBtn');
  if (!card || !chartEl || !btn) return;
  card.style.gridColumn = trendExpanded ? 'span 12' : 'span 7';
  chartEl.classList.toggle('ch220', !trendExpanded);
  chartEl.classList.toggle('ch380', trendExpanded);
  btn.title = trendExpanded ? 'Recolher card' : 'Expandir card';
  btn.querySelector('i').className = 'bi ' + (trendExpanded ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand');
}
// Expandir um card muda a ALTURA e a LARGURA ao mesmo tempo, e a largura vem de `grid-column`,
// que não é animável por CSS: sem isso o card saltava de tamanho num quadro só. A View
// Transition tira um retrato da página antes e depois e interpola a diferença, inclusive o
// reposicionamento dos cards vizinhos que cedem espaço.
// Só no CLIQUE: chamar applyTrendExpanded() no carregamento não tem estado anterior pra animar.
function comAnimacao(fn) {
  const reduzido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduzido || !document.startViewTransition) return fn();
  document.startViewTransition(fn);
}

document.getElementById('trendExpandBtn')?.addEventListener('click', () => {
  trendExpanded = !trendExpanded;
  localStorage.setItem('coco_trend_expanded', trendExpanded ? '1' : '0');
  comAnimacao(applyTrendExpanded);
});
applyTrendExpanded();

// ── Tráfego & conversão: mesmo padrão "Geral × Por canal" + expandir do card de Tendência, só
// que aqui "canal" é sempre Coco and Luna × Yucaloo (as duas únicas marcas com dado de sessão —
// Shopee/ML/Amazon não têm) em vez da lista de canais de venda. Backend já manda os dois baldes
// separados (traffic.seriesCoco/seriesYucaloo, ver aggregateSessions em metrics.js), sem
// precisar recalcular nada no front.
let trafficView = localStorage.getItem('coco_traffic_view') || 'geral';
function setTrafficView(v) {
  trafficView = v;
  localStorage.setItem('coco_traffic_view', v);
  document.querySelectorAll('#trafficViewToggle .chart-type-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (lastData) render(lastData);
}
document.querySelectorAll('#trafficViewToggle .chart-type-btn').forEach(b => b.classList.toggle('active', b.dataset.view === trafficView));

let trafficExpanded = localStorage.getItem('coco_traffic_expanded') === '1';
function applyTrafficExpanded() {
  const card = document.querySelector('.edit-card[data-card-id="traffic"]');
  const chartEl = document.getElementById('trafficChart');
  const btn = document.getElementById('trafficExpandBtn');
  if (!card || !chartEl || !btn) return;
  card.style.gridColumn = trafficExpanded ? 'span 12' : 'span 7';
  chartEl.classList.toggle('ch180', !trafficExpanded);
  chartEl.classList.toggle('ch380', trafficExpanded);
  btn.title = trafficExpanded ? 'Recolher card' : 'Expandir card';
  btn.querySelector('i').className = 'bi ' + (trafficExpanded ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand');
}
document.getElementById('trafficExpandBtn')?.addEventListener('click', () => {
  trafficExpanded = !trafficExpanded;
  localStorage.setItem('coco_traffic_expanded', trafficExpanded ? '1' : '0');
  comAnimacao(applyTrafficExpanded);
});
applyTrafficExpanded();

function showTrendDrilldown(label, val, byChannel, money, metric) {
  const el = document.getElementById('trendDrilldown');
  const entries = Object.entries(byChannel).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if (!entries.length) { el.style.display='none'; return; }
  const total = entries.reduce((s,[,v])=>s+v,0)||1;
  const metricLbl = METRIC_LABEL?.[metric]||'';
  const rows = entries.map(([ch,v])=>{
    const pct=Math.round(v/total*100);
    const color=CocoColors.ch[ch]?.bg||'#888';
    const lbl=CocoColors.ch[ch]?.label||ch;
    const txtC=ch==='mercadolivre'?'#1a1a1a':'#fff';
    return `<div class="drill-row">
      <span class="drill-dot" style="background:${color}"></span>
      <span class="drill-name">${lbl}</span>
      <div class="drill-bar"><div class="drill-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="drill-val">${money?fmtMoney(v,0):fmtInt(v)}</span>
      <span class="drill-pct">${pct}%</span>
    </div>`;
  }).join('');
  el.innerHTML=`<div class="drill-head">
    <span class="drill-period">${label}${metricLbl?' · '+metricLbl:''}</span>
    <span class="drill-total">${money?fmtMoney(val,0):fmtInt(val)}</span>
    <button class="drill-close" onclick="document.getElementById('trendDrilldown').style.display='none'" title="Fechar"><i class="bi bi-x-lg"></i></button>
  </div>${rows}`;
  el.style.display='block';
  // No mobile os cards empilham em largura total — clicar no gráfico lá em cima e o resultado
  // aparecer só depois de rolar a tela pra baixo parecia quebrado (reportado em produção: "eu
  // clico no gráfico lá em cima, e o card aparece lá embaixo"). `block:'nearest'` não mexe em
  // nada se já estiver visível (desktop já vê sem rolar).
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── App state ──
// Nome, cor e mercado de cada canal vêm do catálogo único em js/colors.js. Esta tela tinha
// duas tabelas próprias (CHAN e MARKET_CHANNELS) que repetiam o que outras quatro telas também
// repetiam, e as cópias já discordavam de cor entre si.
const METRIC_LABEL = { receita:'Receita', pedidos:'Pedidos', sessoes:'Sessões' };
const echartsInst = {};
let lastData = null;
let topProductsExpanded = false;
function toggleTopProducts() { topProductsExpanded = !topProductsExpanded; if (lastData) render(lastData); }

// ResizeObserver único cobre todos os gráficos: o ECharts não se redimensiona sozinho. Reage tanto
// a resize de janela quanto ao recolher/expandir a sidebar (que muda a largura do card sem
// disparar resize da janela).
const echartsRO = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(entries => {
  for (const entry of entries) {
    const inst = echartsInst[entry.target.id];
    if (inst && !inst.isDisposed()) inst.resize();
  }
}) : null;
function setEChart(id, option) {
  const dom = document.getElementById(id);
  if (!dom) return null;
  const prev = echartsInst[id];
  // Os anéis de "Orgânico x Campanha" recriam o <div> via innerHTML a cada render — a instância
  // antiga fica órfã (dom desconectado) e precisa ser descartada antes de montar uma nova.
  if (prev && !prev.isDisposed() && prev.getDom() !== dom) prev.dispose();
  const inst = (prev && !prev.isDisposed() && prev.getDom() === dom) ? prev : echarts.init(dom);
  if (inst !== prev) { echartsInst[id] = inst; echartsRO?.observe(dom); }
  inst.setOption(option, true);
  return inst;
}

function isoLocal(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') }
function parseISO(s) { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d) }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate()+n); return x }

const todayISO = isoLocal(new Date());
let sinceDate = localStorage.getItem('coco_since') || todayISO;
let untilDate = localStorage.getItem('coco_until') || todayISO;
let market    = localStorage.getItem('coco_market')  || 'br';
let channel   = localStorage.getItem('coco_channel') || 'todos';
let metric    = localStorage.getItem('coco_metric')  || 'receita';
let refreshMin = Number(localStorage.getItem('coco_refresh') ?? 5);
if (channel !== 'todos' && !CocoColors.ch[channel]) channel = 'todos';
if (!METRIC_LABEL[metric]) metric = 'receita';

function rangeLabel(s, u) { return CocoPeriodo.rotulo(s, u, { hoje: todayISO }); }
function presetRange(p) {
  const n = new Date();
  if (p === 'today') return [todayISO, todayISO];
  if (p === '7d')    return [isoLocal(addDays(n,-6)), todayISO];
  if (p === '30d')   return [isoLocal(addDays(n,-29)), todayISO];
  if (p === 'month') return [isoLocal(new Date(n.getFullYear(),n.getMonth(),1)), todayISO];
  return [todayISO, todayISO];
}

// Delega pro CocoMoeda (js/moeda.js), fonte única do formato de dinheiro. O segundo parâmetro
// continua existindo só pra não mexer nas chamadas que já passam ele; as casas decimais não são
// mais escolha de quem chama — valor SEMPRE sai com centavos (decisão do Luan, 03/09/2026).
function fmtMoney(v) { return CocoMoeda.fmt(v, market); }
// Só o rótulo de eixo dos gráficos usa a forma curta: ali o número é régua, não valor a conferir.
function fmtMoneyShort(v) { return CocoMoeda.curto(v, market); }
function fmtInt(v) { return (Number(v)||0).toLocaleString('pt-BR') }
function pctStr(n, dec=1) { return (Number(n)||0).toLocaleString('pt-BR',{maximumFractionDigits:dec,minimumFractionDigits:dec})+'%' }

// ── Insights ──────────────────────────────────────────────────────────────────
// As frases e os números vêm PRONTOS do servidor (src/insights.js) — aqui só se desenha.
// De propósito: a regra que decide o que é relevante é a mesma pro Brasil e pros EUA, mora num
// lugar só e é testável sem navegador. O front não recalcula nada nem reformata número, senão
// viraria uma segunda fonte de verdade discordando da primeira (o mesmo erro que já aconteceu
// entre resumo e cards na tela de Campanhas, ver CLAUDE.md).
let _insights = [];
let _insightSel = 0;
// Semáforo: bom/medio/ruim vêm prontos do servidor (campo `kind`, ver src/insights.js).
// O ícone acompanha a cor pra não depender só dela — daltonismo, e print em preto e branco.
const INS_ICO = { bom: 'bi-check-circle-fill', medio: 'bi-exclamation-circle-fill', ruim: 'bi-exclamation-triangle-fill' };
const INS_BAR_COLOR = { bom: 'var(--green)', medio: 'var(--amber)', ruim: 'var(--red)' };
const INS_KIND_FALLBACK = 'medio';

// Selo de variação, usado tanto na aba quanto no detalhe. A SETA segue o número (subiu/caiu), a
// COR segue o `kind` do insight — não dá pra derivar a cor do sinal, porque nem toda queda é ruim
// (ACOS caindo é ótimo) nem toda alta é boa. Quem já decidiu isso foi a regra no servidor.
function insDeltaHTML(i, cls) {
  if (i.deltaPct == null || !isFinite(i.deltaPct)) return '';
  const seta = i.deltaPct >= 0 ? 'up' : 'down';
  return `<span class="${cls} ins-ico-${i.kind}"><i class="bi bi-arrow-${seta}-right"></i>${pctStr(Math.abs(i.deltaPct))}</span>`;
}

// Formata um valor conforme o tipo que o servidor mandou junto do gráfico.
function insFmtVal(v, fmt) {
  if (fmt === 'money') return fmtMoney(v);
  if (fmt === 'pct') return pctStr(v);
  if (fmt === 'x') return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×';
  return fmtInt(v);
}

// Texto do card de Insights quando não há nenhum destaque. `contexto` vem do payload:
// { pedidos, historyStart, since, until }.
function insEmptyHTML(contexto) {
  const c = contexto || {};
  const semPedido = Number(c.pedidos || 0) === 0;
  if (semPedido && c.historyStart && c.until && c.until < c.historyStart) {
    const inicio = CocoPeriodo.data(c.historyStart, { mercado: market });
    return `<div class="ins-empty">Este período é anterior ao histórico disponível.<br>`
      + `O primeiro pedido registrado neste mercado é de ${escapeHtml(inicio)}.</div>`;
  }
  if (semPedido) {
    return `<div class="ins-empty">Nenhum pedido neste período.<br>`
      + `Sem venda registrada não há o que comparar com o período anterior.</div>`;
  }
  return `<div class="ins-empty">Nada fora do normal neste período.<br>`
    + `Períodos maiores (7 ou 30 dias) costumam revelar mais que um dia isolado.</div>`;
}

function renderInsights(list, contexto) {
  _insights = Array.isArray(list) ? list : [];
  const body = document.getElementById('insightsBody');
  const count = document.getElementById('insightsCount');
  if (!body) return;
  if (!_insights.length) {
    count.textContent = '';
    // Duas ausências bem diferentes, que davam a mesma frase antes: um período estável (ou com
    // volume baixo demais pra afirmar algo sem virar ruído, ver os pisos em src/insights.js) e
    // um período em que simplesmente não existe pedido nenhum. Dizer "nada fora do normal" no
    // segundo caso é enganoso: não é que nada mudou, é que não há o que comparar.
    body.innerHTML = insEmptyHTML(contexto);
    return;
  }
  if (_insightSel >= _insights.length) _insightSel = 0;
  count.textContent = _insights.length === 1 ? '1 destaque' : `${_insights.length} destaques`;
  // Guarda a rolagem da tira: o refresh automático de dados (a cada poucos minutos) chama esta
  // função de novo, e sem isso o carrossel pulava de volta pro começo sozinho enquanto a pessoa
  // estava olhando um insight do fim da lista.
  const scrollAnterior = document.getElementById('insList')?.scrollLeft || 0;
  body.innerHTML = `
    <div class="ins-strip">
      <button class="ins-nav" id="insPrev" aria-label="Insights anteriores"><i class="bi bi-chevron-left"></i></button>
      <div class="ins-list" id="insList"></div>
      <button class="ins-nav" id="insNext" aria-label="Próximos insights"><i class="bi bi-chevron-right"></i></button>
    </div>
    <div class="ins-detail" id="insDetail"></div>`;
  // `label` é o sintagma curto feito pra caber na aba; `title` (frase inteira) é só o fallback
  // caso alguma regra nova esqueça de mandar o label. O title vai no `title=` pra quem passar o
  // mouse ler o texto completo sem precisar clicar.
  document.getElementById('insList').innerHTML = _insights.map((i, n) => `
    <button class="ins-item${n === _insightSel ? ' active' : ''}" data-n="${n}" title="${escapeHtml(i.title)}">
      <span class="ins-item-top">
        <i class="bi ${INS_ICO[i.kind] || INS_ICO[INS_KIND_FALLBACK]} ins-item-ico ins-ico-${i.kind}"></i>
        <span class="ins-item-txt">${escapeHtml(i.label || i.title)}</span>
      </span>
      ${insDeltaHTML(i, 'ins-item-delta')}
    </button>`).join('');
  // `tira` e não `list`: o parâmetro desta função já se chama list (é o array de insights).
  const tira = document.getElementById('insList');
  // Trocar de aba NÃO remonta a tira: só troca a classe ativa e redesenha o detalhe. Remontar
  // (como era antes) zerava a rolagem do carrossel a cada clique, o que tornava impossível
  // navegar até o fim da lista.
  tira.onclick = e => {
    // Um arraste que percorreu distância termina em `click` também (ele nasce do mouseup). Sem
    // essa guarda, puxar a tira a partir de cima de uma aba trocaria o insight selecionado no
    // fim do gesto, que não é o que a pessoa pediu ao arrastar.
    if (tira._arrastou) { tira._arrastou = false; return; }
    const b = e.target.closest('.ins-item');
    if (!b) return;
    _insightSel = Number(b.dataset.n);
    tira.querySelectorAll('.ins-item').forEach((el, n) => el.classList.toggle('active', n === _insightSel));
    renderInsightDetail();
  };
  tira.scrollLeft = scrollAnterior;
  tira.onscroll = insSyncNav;
  insEnableDrag(tira);
  document.getElementById('insPrev').onclick = () => insScroll(-1);
  document.getElementById('insNext').onclick = () => insScroll(1);
  // O ResizeObserver cobre recolher/expandir a sidebar e redimensionar a janela, que mudam a
  // largura da tira e portanto se ela ainda rola ou não.
  _insRO?.disconnect();
  _insRO = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(insSyncNav) : null;
  _insRO?.observe(tira);
  insSyncNav();
  renderInsightDetail();
}

let _insRO = null;

// Rola uma "página" (80% do que está visível) pra frente ou pra trás. Navegação finita: o alvo é
// grampeado entre 0 e o máximo, então nos extremos ele para em vez de dar a volta.
function insScroll(dir) {
  const tira = document.getElementById('insList');
  if (!tira) return;
  const passo = Math.max(tira.clientWidth * 0.8, 200);
  const max = tira.scrollWidth - tira.clientWidth;
  const antes = tira.scrollLeft;
  const alvo = Math.max(0, Math.min(antes + dir * passo, max));
  if (Math.abs(alvo - antes) < 1) return;
  tira.scrollTo({ left: alvo, behavior: 'smooth' });
  // `behavior:'smooth'` é ignorado SILENCIOSAMENTE em alguns ambientes (movimento reduzido no
  // sistema operacional, ou rolagem suave desligada no Chrome): a chamada não dá erro e o
  // elemento simplesmente não sai do lugar, então o clique na seta não faria nada e o carrossel
  // pareceria quebrado. Confirmado ao vivo aqui: scrollTo/scrollBy com 'auto' funcionam e com
  // 'smooth' ficam em zero. Por isso a checagem: se não andou, aplica direto (sem animação, mas
  // funcionando). Vale como regra pra qualquer rolagem programática nova neste app.
  setTimeout(() => {
    if (Math.abs(tira.scrollLeft - antes) < 1) tira.scrollLeft = alvo;
    insSyncNav();
  }, 250);
}

// Arrastar a tira com o ponteiro pra passar de insight, sem depender das setas. Só liga pra
// mouse/caneta: no toque o navegador já rola a tira sozinho por causa do `overflow-x:auto`, com
// inércia e sem brigar com o gesto de rolar a página, e reimplementar isso à mão só pioraria. Por
// isso também não existe `touch-action:none` aqui (ao contrário do drag do jobs-widget, onde o
// arraste é a única forma de mover o card e a rolagem nativa é que atrapalha).
function insEnableDrag(tira) {
  let ativo = false, xInicial = 0, scrollInicial = 0, distancia = 0;
  tira.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    // Tira que cabe inteira na linha não tem pra onde arrastar: fica tudo como era antes, e um
    // clique com a mão trêmula continua selecionando o insight (a guarda do onclick só entra em
    // cena quando um arraste de verdade aconteceu).
    if (tira.scrollWidth <= tira.clientWidth + 1) return;
    ativo = true; distancia = 0; xInicial = e.clientX; scrollInicial = tira.scrollLeft;
  });
  tira.addEventListener('pointermove', e => {
    if (!ativo) return;
    const d = e.clientX - xInicial;
    distancia = Math.max(distancia, Math.abs(d));
    // Limiar de 3px: um clique normal treme uns pixels, e capturar o ponteiro já no pointerdown
    // roubaria o clique da aba (com a captura ativa o alvo do evento passa a ser a tira, então
    // `closest('.ins-item')` no onclick viria vazio e selecionar um insight pararia de funcionar).
    if (distancia <= 3) return;
    if (!tira.hasPointerCapture(e.pointerId)) tira.setPointerCapture(e.pointerId);
    tira.classList.add('ins-arrastando');
    tira.scrollLeft = scrollInicial - d;
    e.preventDefault();
  });
  const soltar = e => {
    if (!ativo) return;
    ativo = false;
    tira.classList.remove('ins-arrastando');
    if (tira.hasPointerCapture(e.pointerId)) tira.releasePointerCapture(e.pointerId);
    if (distancia > 3) tira._arrastou = true;
    insSyncNav();
  };
  tira.addEventListener('pointerup', soltar);
  tira.addEventListener('pointercancel', soltar);
  // O arraste nativo do navegador (levar o elemento como se fosse uma imagem/link) dispararia por
  // cima do nosso gesto e deixaria um "fantasma" preso no cursor.
  tira.addEventListener('dragstart', e => e.preventDefault());
}

// Mostra as setas só quando a tira realmente rola, e desabilita a que já chegou no fim.
function insSyncNav() {
  const list = document.getElementById('insList');
  const prev = document.getElementById('insPrev');
  const next = document.getElementById('insNext');
  if (!list || !prev || !next) return;
  const rola = list.scrollWidth > list.clientWidth + 1;
  list.classList.toggle('ins-dragavel', rola);
  prev.hidden = next.hidden = !rola;
  if (!rola) return;
  prev.disabled = list.scrollLeft <= 1;
  next.disabled = list.scrollLeft >= list.scrollWidth - list.clientWidth - 1;
}

function renderInsightDetail() {
  const i = _insights[_insightSel];
  const el = document.getElementById('insDetail');
  if (!i || !el) return;
  const rows = i.chart?.rows || [];
  // Barra proporcional ao MAIOR valor do par. Piso de 2% pra uma barra de valor zero ainda
  // aparecer como um traço: sem isso ela some e parece dado faltando, quando o zero é a
  // informação (ex.: "nenhuma venda atribuída aos anúncios").
  const max = Math.max(...rows.map(r => Math.abs(Number(r.value) || 0)), 0) || 1;
  const bars = rows.map((r, n) => {
    const v = Number(r.value) || 0;
    const w = Math.max((Math.abs(v) / max) * 100, v === 0 ? 2 : 6);
    // A primeira linha é sempre o período/valor atual: ganha a cor do tipo, a segunda fica neutra.
    const cor = n === 0 ? (INS_BAR_COLOR[i.kind] || INS_BAR_COLOR[INS_KIND_FALLBACK]) : 'var(--border2)';
    return `<div class="ins-bar-cell">
      <div class="ins-bar-lbl">${escapeHtml(r.label)}</div>
      <div class="ins-bar-row">
        <div class="ins-bar-track"><div class="ins-bar-fill" style="width:${w}%;background:${cor}"></div></div>
        <span class="ins-bar-val">${insFmtVal(v, i.chart.fmt)}</span>
      </div>
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="ins-detail-main">
      <div class="ins-eyebrow">${escapeHtml(i.dimension)}</div>
      <div class="ins-title"><i class="bi ${INS_ICO[i.kind] || INS_ICO[INS_KIND_FALLBACK]} ins-title-ico ins-ico-${i.kind}"></i><span>${escapeHtml(i.title)}</span></div>
      <div class="ins-text">${escapeHtml(i.detail)}</div>
    </div>
    <div class="ins-bars">${bars}</div>`;
}

function renderDelta(el, p, suffix='vs. período anterior') {
  if (p === null || p === undefined) { el.innerHTML=`<span class="delta-val flat">—</span> ${suffix}`; return }
  const up = p >= 0, cls = Math.abs(p) < 0.05 ? 'flat' : (up ? 'up' : 'down');
  el.innerHTML = `<span class="delta-val ${cls}">${up?'↑':'↓'} ${Math.abs(p).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</span> ${suffix}`;
}
function setLive(s, t) {
  const d = document.getElementById('liveDot');
  d.className = 'ldot' + (s==='loading'?' loading':s==='error'?' error':'');
  if (t) document.getElementById('lastUpdate').textContent = t;
}

// Lê o valor computado de uma variável CSS do :root — fonte única de verdade pras cores usadas
// dentro de options do ECharts (que não resolvem var() em todo contexto).
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

const AXIS_FONT = { color:cssVar('--muted'), fontSize:11, fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif" };
// Base do tooltip reaproveitada por todo gráfico ECharts — cor/borda/raio consistentes com o
// resto da dashboard, texto principal em --text (formatter monta o HTML) e secundário em --sub.
const EC_TOOLTIP = {
  backgroundColor: cssVar('--surface'), borderColor:'rgba(30,28,24,0.12)', borderWidth:1,
  padding:[10,12], extraCssText:'border-radius:8px;box-shadow:0 8px 20px rgba(30,28,24,.14);',
  textStyle:{ color:cssVar('--sub'), fontSize:11, fontFamily:AXIS_FONT.fontFamily },
  // appendToBody: o tooltip do ECharts por padrão é um elemento DOM dentro do próprio container do
  // gráfico — se o mouse passa perto da borda do card, ele fica cortado pelo overflow:hidden do
  // .card (mesma família de bug do corte no hover dos anéis, só que essa nem chega a aparecer
  // truncada, some inteira). appendToBody joga o tooltip pro <body>, fora desse contexto de corte.
  appendToBody: true, confine: true,
};

// Preenchimento em degradê sob a linha (do tom sólido no topo até transparente) — efeito comum em
// libs de gráfico mais "premium", nativo no ECharts via areaStyle.color com um descritor de
// gradiente linear (x/y de 0 a 1 = relativo à própria área desenhada, sem precisar de canvas/ctx).
// hexToRgba vive em js/colors.js, junto dos outros utilitários de cor.
const hexToRgba = (hex, a) => CocoColors.hexToRgba(hex, a);
function areaGradient(color) {
  return { type:'linear', x:0, y:0, x2:0, y2:1, colorStops:[
    { offset:0, color:hexToRgba(color, 0.22) },
    { offset:1, color:hexToRgba(color, 0) },
  ] };
}

// Monta uma linha de legenda (.legend-row > .legend-item) a partir de uma lista de itens —
// reaproveitado pela Tendência e por Tráfego & conversão em vez de cada card montar o markup na mão.
// items: [{ label, color, sq? }] — sq:true usa o quadrado (.legend-sq), padrão é a linha (.legend-line).
function renderLegend(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.map(it => {
    const swatch = it.sq ? 'legend-sq' : 'legend-line';
    return `<div class="legend-item"><div class="${swatch}" style="background:${it.color}"></div>${it.label}</div>`;
  }).join('');
}

function drawDonut(id, data, colors, labels) {
  const total = data.reduce((a,b) => a+(Number(b)||0), 0);
  // emphasis.scaleSize cresce a fatia sob o mouse, então o raio externo precisa de folga dentro do
  // canvas: sem ela a fatia em destaque é cortada na borda. A folga sai do tamanho REAL do
  // container, em px, e não de uma porcentagem fixa. Uma % não serve porque os anéis têm tamanhos
  // muito diferentes: 8% do raio dá folga de sobra nos grandes (Canais/Marketing, 160px) e só
  // ~3,5px nos pequenos do card "Orgânico x Campanha" (88px), menos que os 6px que o hover cresce.
  const scaleSize = 6;
  const dom = document.getElementById(id);
  const half = dom ? Math.min(dom.clientWidth, dom.clientHeight) / 2 : 80;
  const outerPct = half > 0 ? Math.max(60, Math.min(92, Math.round(((half - scaleSize) / half) * 100))) : 92;
  if (total <= 0) {
    // Sem hover (emphasis desabilitado) — não precisa da folga, preenche o canvas inteiro.
    setEChart(id, { series:[{ type:'pie', radius:['70%','100%'], silent:true, label:{show:false}, emphasis:{disabled:true},
      data:[{ value:1, name:'Sem dados', itemStyle:{ color:'#e6e1d6' } }] }] });
    return;
  }
  setEChart(id, {
    tooltip:{ trigger:'item', ...EC_TOOLTIP, formatter: p =>
      `<div style="font-weight:700;color:${cssVar('--text')};margin-bottom:2px">${p.marker} ${p.name||'—'}</div>` +
      `<div>${fmtMoney(p.value)} · ${pctStr(p.percent)}</div>` },
    series:[{
      type:'pie', radius:['70%', outerPct+'%'], avoidLabelOverlap:false, padAngle:2,
      itemStyle:{ borderColor:'#faf8f4', borderWidth:2, borderRadius:4 },
      label:{ show:false }, labelLine:{ show:false },
      emphasis:{ scale:true, scaleSize },
      data: data.map((v,i) => ({ value:v, name:labels?.[i] ?? '', itemStyle:{ color:colors[i] } })),
    }],
  });
}

function render(d) {
  lastData = d;
  const label = rangeLabel(d.period.since, d.period.until);
  document.getElementById('pageSub').textContent = `Vita Pet Life · ${CocoColors.chLabel(d.channel)} · multicanal`;

  // KPIs
  const k = d.kpis;
  document.getElementById('kpiRevenue').textContent = fmtMoney(k.revenue); renderDelta(document.getElementById('kpiRevenueDelta'), k.revenueDelta);
  document.getElementById('kpiOrders').textContent = fmtInt(k.orders); renderDelta(document.getElementById('kpiOrdersDelta'), k.ordersDelta);
  document.getElementById('kpiAov').textContent = fmtMoney(k.aov,2); renderDelta(document.getElementById('kpiAovDelta'), k.aovDelta);
  // ML Breakdown card
  { const ml = d.mlBreakdown;
    document.getElementById('mlOrganic').textContent = ml && (ml.organic > 0 || ml.premium > 0) ? fmtMoney(ml.organic || 0) : '—';
    document.getElementById('mlPremium').textContent = ml && (ml.organic > 0 || ml.premium > 0) ? fmtMoney(ml.premium || 0) : '—';
    document.getElementById('mlAdCost').textContent = ml && ml.adCost > 0 ? fmtMoney(ml.adCost) : '—';
    document.getElementById('mlRoas').textContent = ml && ml.roas > 0 ? ml.roas.toFixed(2) + 'x' : '—';
  }
  // Card de marketing — títulos e nota adaptados por canal
  { const ch = d.channel;
    const isMkt = ['shopee','mercadolivre','amazon','amazon_us'].includes(ch);
    document.getElementById('mktTitle').textContent = ch === 'mercadolivre' ? 'Distribuição por tipo' : 'Marketing por origem';
    document.getElementById('mktSub').textContent   = ch === 'mercadolivre' ? 'Clássico vs Destaque' : isMkt ? 'Receita do canal' : 'Receita atribuída';
    document.getElementById('mktCenterSub').textContent = ch === 'mercadolivre' ? 'Total ML' : isMkt ? 'Total' : 'Atribuída';
    // Nota do card: nada de promessa de canal que não está de fato no roadmap (ver CLAUDE.md
    // "A fazer" — só Amazon Ads e TikTok Shop são integrações planejadas; Shopee não tem Ads
    // prometido em lugar nenhum). Google Ads também não some daqui por falta de conexão: é uma
    // exclusão deliberada deste payload (fica só em Campanhas), então "em breve" seria mentira,
    // inclusive no Brasil, onde Google Ads nem existe.
    document.getElementById('mktNote').textContent =
      ch === 'mercadolivre' ? 'Clássico = listagem grátis · Destaque = listagem paga' :
      ch === 'shopee'       ? 'Receita orgânica da Shopee · plataforma não expõe dados de Ads via API' :
      (ch === 'amazon' || ch === 'amazon_us') ? 'Receita orgânica da Amazon · Ads ainda não integrado' :
      k.adCost > 0          ? 'Meta Ads conectado · outros canais de Ads ficam na tela de Campanhas' : 'Meta Ads ainda sem dados · sincronize para atualizar';
  }
  // ROAS/ACOS — mostra só o que faz sentido pro canal selecionado (antes sempre misturava Meta+ML,
  // mesmo com Shopee/Amazon escolhido, o que não tinha relação nenhuma com o canal). "Todos": soma
  // tudo que existe no mercado (Meta Ads sempre; Mercado Ads também sempre, no BR — deixou de ser
  // opcional por decisão de produto, "não deve ser uma escolha, é obrigatório"). Shopify/Shopify
  // US: só Meta Ads (é quem leva tráfego pra lá). Mercado Livre: só Mercado Ads dele mesmo (Meta
  // não direciona venda pro ML). Shopee/Amazon: sem rastreamento de Ads ainda. d.mlBreakdown.adCost
  // (metrics.js) soma kv.mlAdCostsDaily dentro do período selecionado — não é mais um valor único
  // preso na janela fixa do sync (bug corrigido, mesmo princípio do metaSpendDaily do Meta Ads logo
  // acima).
  const ml = d.mlBreakdown || {};
  let roasVal = 0, roasAvail = false, roasLabel = '';
  if (d.channel === 'mercadolivre') {
    roasLabel = 'Mercado Ads';
    roasAvail = (ml.adCost || 0) > 0;
    roasVal = roasAvail ? (ml.premium || 0) / ml.adCost : 0;
  } else if (d.channel === 'shopee' || d.channel === 'amazon' || d.channel === 'amazon_us' || d.channel === 'yucaloo_br' || d.channel === 'yucaloo_us') {
    roasLabel = 'sem rastreamento de Ads ainda';
    roasAvail = false;
  } else {
    // "todos", shopify, shopify_us
    let rev = k.metaRevenue || 0, cost = k.adCost || 0;
    roasLabel = 'Meta Ads';
    if (d.market === 'br' && d.channel === 'todos') {
      rev += ml.premium || 0; cost += ml.adCost || 0;
      roasLabel = 'Meta + Mercado Ads';
    }
    roasAvail = cost > 0;
    roasVal = roasAvail ? rev / cost : 0;
  }
  document.getElementById('kpiRoas').textContent = roasAvail ? roasVal.toLocaleString('pt-BR',{maximumFractionDigits:2})+'×' : '—';
  document.getElementById('kpiRoasSub').textContent = roasAvail ? ('retorno sobre gasto (' + roasLabel + ')') : roasLabel;
  document.getElementById('kpiAcos').textContent = roasAvail && roasVal > 0 ? (100/roasVal).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%' : '—';
  document.getElementById('kpiAcosSub').textContent = roasAvail ? 'gasto ÷ vendas atribuídas' : roasLabel;

  // Trend
  const t = d.trend, money = t.fmt === 'money';
  const line1 = cssVar('--line1'), line2 = cssVar('--line2'), surface = cssVar('--surface');
  // "Custo ads" é gasto do Meta Ads (Instagram/Facebook) — só atribuído a Shopify (ver 4.4/isCampaignOrder).
  // Mostrar essa linha com Shopee/Mercado Livre/Amazon selecionado sugeria (errado) que o canal tinha
  // custo de ads próprio, quando na verdade é o gasto do Meta da conta inteira aparecendo por engano.
  // Mesma regra já usada pelo card "Marketing por origem" (cardMarketing: isTodos || isShopify).
  const showAdsLine = d.metric === 'receita' && (d.channel === 'todos' || d.channel === 'shopify' || d.channel === 'shopify_us');
  // "Por canal" só faz sentido com canal="todos" — um canal específico já filtrado não tem o que
  // quebrar em mais linhas. O toggle some sozinho nesse caso.
  const canChanView = d.channel === 'todos';
  const toggleEl = document.getElementById('trendViewToggle');
  if (toggleEl) toggleEl.style.display = canChanView ? '' : 'none';
  const useChanView = canChanView && trendView === 'canal';

  let ds, legendItems;
  if (useChanView) {
    // Uma linha por canal, sem preenchimento de área nem "Custo ads" — com vários canais ao
    // mesmo tempo isso vira poluição visual (área sobreposta ilegível). Ordenado por receita
    // total do período, maior primeiro, pra legenda/ordem de desenho fazer sentido.
    const chKeys = [];
    (t.byChannel || []).forEach(day => { for (const k in (day || {})) if (!chKeys.includes(k)) chKeys.push(k); });
    const totals = Object.fromEntries(chKeys.map(k => [k, (t.byChannel || []).reduce((s, day) => s + (day?.[k] || 0), 0)]));
    chKeys.sort((a, b) => totals[b] - totals[a]);
    ds = chKeys.map(ch => {
      const color = CocoColors.ch[ch]?.bg || '#888';
      return { name: CocoColors.chLabel(ch), type:'line', data: (t.byChannel || []).map(day => (day && day[ch]) || 0), smooth:.3, symbol:'circle', symbolSize:5, itemStyle:{ color }, lineStyle:{ color, width:2 }, emphasis:{ focus:'series' } };
    });
    legendItems = chKeys.map(ch => ({ label: CocoColors.chLabel(ch), color: CocoColors.ch[ch]?.bg || '#888' }));
  } else {
    ds = [{ name:METRIC_LABEL[d.metric], type:'line', data:t.data, smooth:.3, symbol:'circle', symbolSize:6, itemStyle:{ color:line1, borderColor:surface, borderWidth:1.5 }, lineStyle:{ color:line1, width:2 }, areaStyle:{ color:areaGradient(line1) }, emphasis:{ focus:'series', scale:false } }];
    if (showAdsLine) ds.push({ name:'Custo ads', type:'line', data:t.metaSpendDaily || t.data.map(()=>0), smooth:.3, symbol:'none', lineStyle:{ color:line2, width:1.5, type:[5,4] } });
    legendItems = showAdsLine
      ? [{ label:'Receita', color:'var(--line1)' }, { label:'Custo ads', color:'var(--line2)' }]
      : [{ label: METRIC_LABEL[d.metric], color:'var(--line1)' }];
  }
  const trendInst = setEChart('trendChart', {
    grid:{ left:8, right:8, top:12, bottom:22, containLabel:true },
    xAxis:{ type:'category', data:t.labels, boundaryGap:false, axisLine:{show:false}, axisTick:{show:false}, axisLabel:AXIS_FONT, splitLine:{show:false} },
    yAxis:{ type:'value', axisLine:{show:false}, axisTick:{show:false}, splitLine:{lineStyle:{color:'rgba(30,28,24,0.06)'}}, axisLabel:{ ...AXIS_FONT, formatter:v=>money?fmtMoneyShort(v):fmtInt(v) } },
    tooltip:{ trigger:'axis', axisPointer:{ type:'line', lineStyle:{ color:'rgba(30,28,24,0.15)', width:1 } }, ...EC_TOOLTIP, formatter: params => {
      if (!params.length) return '';
      const head = `<div style="font-weight:700;color:${cssVar('--text')};margin-bottom:4px">${params[0].axisValueLabel}</div>`;
      return head + params.map(p => `<div>${p.marker} ${p.seriesName}: ${money?fmtMoney(p.value,2):fmtInt(p.value)}</div>`).join('');
    } },
    series: ds,
  });
  // Click → drilldown de canais. Só na visão "Geral" — na "Por canal" cada linha já mostra o
  // próprio canal, o drilldown seria redundante. Usa getZr() (canvas bruto) + convertFromPixel em
  // vez do 'click' de série do ECharts: esse último só dispara em cima do traço/ponto exatos, e a
  // área preenchida acima da linha (bem comum num dia de valor baixo, sobra bastante espaço em
  // branco no card) não conta como "em cima da série". Com ele, o clique só funcionava se
  // acertasse o pixel certo, e a tela parecia quebrada. convertFromPixel faz a coluna inteira
  // do dia responder ao clique.
  document.getElementById('trendDrilldown').style.display = 'none';
  trendInst?.getZr().off('click');
  trendInst?.getZr().on('click', params => {
    if (useChanView || !isChanDetail()) return;
    const pt = trendInst.convertFromPixel({ seriesIndex: 0 }, [params.offsetX, params.offsetY]);
    if (!pt) return;
    const i = Math.round(pt[0]);
    if (!(i >= 0) || i >= t.labels.length) return;
    showTrendDrilldown(t.labels[i], t.data[i], t.byChannel?.[i]||{}, money, d.metric);
  });
  document.getElementById('trendTitle').textContent = 'Tendência · ' + METRIC_LABEL[d.metric];
  document.getElementById('trendSub').textContent = (d.period.grain==='hour'?'Por hora · ':'Por dia · ') + label.toLowerCase();
  document.getElementById('trendVal').textContent = (money?fmtMoney(t.total):fmtInt(t.total)) + ' ' + METRIC_LABEL[d.metric].toUpperCase();
  renderLegend('trendLegend', legendItems);

  // Channel split
  const cs = d.channelSplit;
  // Rótulo vem sempre de colors.js (CocoColors.ch) — fonte única, já traz "Shopify - Coco and
  // Luna BR"/"Shopify - Yucaloo BR" etc. (ver colors.js DEFAULT_CH). chOrder só define QUAIS canais
  // e em que ordem — não mais o texto do rótulo, pra não duplicar/desatualizar em relação às cores.
  const chOrder = d.market === 'us'
    ? ['shopify_us','yucaloo_us','amazon_us']
    : ['shopify','yucaloo_br','shopee','mercadolivre','amazon'];
  const cTotal = chOrder.reduce((a,k) => a+(cs[k]||0), 0);
  drawDonut('channelChart', chOrder.map(k=>cs[k]||0), chOrder.map(k=>CocoColors.ch[k]?.bg||'#999'), chOrder.map(k=>CocoColors.chLabel(k)));
  document.getElementById('chCenter').textContent = fmtMoneyShort(cTotal);
  document.getElementById('channelRows').innerHTML = cTotal > 0 ? chOrder.map(k => {
    const v = cs[k]||0;
    const pc = cTotal>0?(v/cTotal*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'0%';
    const nm = CocoColors.chLabel(k);
    return `<div class="dr-row"><div class="dr-left"><div class="dr-swatch" style="background:${CocoColors.ch[k]?.bg||'#999'}"></div>${nm}</div><div class="dr-right"><span class="dr-pct">${pc}</span><span class="dr-val">${fmtMoney(v)}</span></div></div>`;
  }).join('') : '<div class="muted-state">Sem dados para o período.</div>';

  // Marketing
  const mTotal = d.marketing.reduce((a,e)=>a+e.value, 0);
  drawDonut('mktChart', d.marketing.map(e=>e.value), d.marketing.map(e=>CocoColors.mkt[e.name]||'#b0a898'), d.marketing.map(e=>e.name));
  document.getElementById('mktCenter').textContent = fmtMoneyShort(mTotal);
  document.getElementById('mktRows').innerHTML = d.marketing.length
    ? d.marketing.map(e=>{ const pc=mTotal>0?(e.value/mTotal*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'0%'; return `<div class="dr-row"><div class="dr-left"><div class="dr-swatch" style="background:${CocoColors.mkt[e.name]||'#b0a898'}"></div>${e.name}</div><div class="dr-right"><span class="dr-pct">${pc}</span><span class="dr-val">${fmtMoney(e.value)}</span></div></div>`; }).join('')
    : '<div class="muted-state">Sem receita atribuída.</div>';

  // Sales split: orgânico x campanha — uma pizza por canal quando "Todos"; uma única pizza
  // (só daquele canal) quando um canal específico está selecionado. Canais sem atribuição
  // (ex. Shopee/Amazon) ficam naturalmente 100% orgânicos, já que isCampaignOrder nunca é true pra eles.
  const ssc = d.salesSplitByChannel || {};
  const ssIsAll = d.channel === 'todos';
  const ssChannels = ssIsAll
    ? (d.market === 'us' ? ['shopify_us', 'yucaloo_us', 'amazon_us'] : ['shopify', 'yucaloo_br', 'shopee', 'mercadolivre', 'amazon'])
    : [d.channel];
  document.getElementById('ssSub').textContent = ssIsAll ? 'Por canal' : `Canal: ${CocoColors.chLabel(d.channel)}`;
  const ssGridEl = document.getElementById('ssGrid');
  ssGridEl.classList.toggle('single', !ssIsAll);
  // Canal único: a pizza cresce (ver CSS .ss-grid.single) e ganha ao lado os pedidos de campanha
  // x orgânicos — dado real que já vem em salesSplitByChannel, não só espaço decorativo vazio.
  const singleKpisHtml = !ssIsAll ? (() => {
    const s = ssc[ssChannels[0]] || { campaignOrders: 0, organicOrders: 0 };
    return `<div class="ss-single-kpis">
      <div class="ss-single-kpi"><div class="ss-single-kpi-lbl">Pedidos de campanha</div><div class="ss-single-kpi-val">${fmtInt(s.campaignOrders||0)}</div></div>
      <div class="ss-single-kpi"><div class="ss-single-kpi-lbl">Pedidos orgânicos</div><div class="ss-single-kpi-val">${fmtInt(s.organicOrders||0)}</div></div>
    </div>`;
  })() : '';
  ssGridEl.innerHTML = ssChannels.map(ch => `
    <div class="ss-cell">
      <div class="ss-cell-title">${CocoColors.chLabel(ch)}</div>
      <div class="ss-pie-wrap"><div class="donut-canvas" id="ssPie-${ch}"></div></div>
      <div class="ss-cell-legend" id="ssLeg-${ch}"></div>
      <div class="ss-cell-total" id="ssTotal-${ch}">—</div>
    </div>`).join('') + singleKpisHtml;
  const ssRust = cssVar('--rust'), ssSage = cssVar('--sage');
  ssChannels.forEach(ch => {
    const s = ssc[ch] || { campaign: 0, organic: 0 };
    const total = s.campaign + s.organic;
    drawDonut(`ssPie-${ch}`, [s.campaign, s.organic], [ssRust, ssSage], ['Campanha','Orgânico']);
    const campPct = total > 0 ? Math.round(s.campaign / total * 100) : 0;
    const orgPct  = total > 0 ? 100 - campPct : 100;
    document.getElementById(`ssLeg-${ch}`).innerHTML = total > 0
      ? `<div class="ss-leg-item"><span class="ss-leg-dot" style="background:${ssRust}"></span>Campanha ${campPct}%</div>` +
        `<div class="ss-leg-item"><span class="ss-leg-dot" style="background:${ssSage}"></span>Orgânico ${orgPct}%</div>`
      : `<div class="ss-leg-item">Sem dados</div>`;
    document.getElementById(`ssTotal-${ch}`).textContent = fmtMoney(total);
  });

  // Traffic — Yucaloo tem loja Shopify própria (ver aggregateSessions em metrics.js), então
  // entra no mesmo card com logo própria pra deixar claro de qual loja é o dado.
  const tf = d.traffic;
  const hasTraffic =
    (d.market === 'br' && (d.channel === 'todos' || d.channel === 'shopify' || d.channel === 'yucaloo_br')) ||
    (d.market === 'us' && (d.channel === 'todos' || d.channel === 'shopify_us' || d.channel === 'yucaloo_us'));
  const trafficSubEl = document.getElementById('trafficSub');
  const mktLabel = d.market === 'us' ? 'EUA' : 'BR';
  const brandLogo = b => `<img class="ct-sub-logo" src="img/integracoes/${b === 'coco' ? 'cocoandluna.webp' : 'Yucaloo1.png'}" alt="">`;
  // A logo já entrega qual marca é — repetir "Coco and Luna"/"Yucaloo" no texto ao lado é
  // redundante, o texto fica só com Shopify + mercado + período.
  if (d.channel === 'shopify' || d.channel === 'shopify_us') {
    trafficSubEl.innerHTML = brandLogo('coco') + `Shopify - ${mktLabel} · período selecionado`;
  } else if (d.channel === 'yucaloo_br' || d.channel === 'yucaloo_us') {
    trafficSubEl.innerHTML = brandLogo('yucaloo') + `Shopify - ${mktLabel} · período selecionado`;
  } else if (d.channel === 'todos') {
    trafficSubEl.innerHTML = brandLogo('coco') + brandLogo('yucaloo') + `Shopify - ${mktLabel} · período selecionado`;
  } else {
    trafficSubEl.textContent = `Dados de sessão disponíveis apenas para Shopify (Coco and Luna ou Yucaloo) ${mktLabel}`;
  }
  document.getElementById('mSessions').textContent = fmtInt(tf.sessions);
  document.getElementById('mSessionsMeta').textContent = tf.visitors?(tf.sessions/tf.visitors).toLocaleString('pt-BR',{maximumFractionDigits:1})+' por visitante':' ';
  document.getElementById('mVisitors').textContent = fmtInt(tf.visitors);
  document.getElementById('mCart').textContent = fmtInt(tf.cart);
  document.getElementById('mCartMeta').textContent = tf.sessions?pctStr(tf.cart/tf.sessions*100)+' das sessões':' ';
  document.getElementById('mConv').textContent = (tf.conversion*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
  document.getElementById('trafficVal').textContent = fmtInt(tf.sessions)+' SESSÕES';
  // "Por canal" aqui é sempre Coco and Luna × Yucaloo (as duas únicas marcas com sessão) — só faz
  // sentido com canal="todos" selecionado, igual ao toggle da Tendência. Um canal específico já
  // filtrado (ex.: "shopify") não tem o que separar (a outra marca ficaria zerada o tempo todo).
  const canTrafficChanView = d.channel === 'todos';
  const trafficToggleEl = document.getElementById('trafficViewToggle');
  if (trafficToggleEl) trafficToggleEl.style.display = canTrafficChanView ? '' : 'none';
  const useTrafficChanView = canTrafficChanView && trafficView === 'canal';

  let trafficSeries, trafficLegendItems, trafficYAxis;
  if (useTrafficChanView) {
    // Só sessões (sem Conversão) nesse modo — duas linhas de mais um eixo secundário viraria
    // poluição visual, mesma decisão já tomada pro card Tendência. Cores reaproveitadas do
    // mapeamento por canal (mesmas usadas no card "Canais"/donut), nada novo pra manter.
    const cocoCh = d.market === 'us' ? 'shopify_us' : 'shopify';
    const yucalooCh = d.market === 'us' ? 'yucaloo_us' : 'yucaloo_br';
    const cocoColor = CocoColors.ch[cocoCh]?.bg || '#888', yucalooColor = CocoColors.ch[yucalooCh]?.bg || '#888';
    trafficYAxis = [{ type:'value', position:'left', axisLine:{show:false}, axisTick:{show:false}, splitLine:{lineStyle:{color:'rgba(30,28,24,0.06)'}}, axisLabel:AXIS_FONT }];
    trafficSeries = [
      { name:'Coco and Luna', type:'line', data:(tf.seriesCoco||[]).map(p=>p.sessions), smooth:.3, symbol:'circle', symbolSize:5, itemStyle:{ color:cocoColor }, lineStyle:{ color:cocoColor, width:2 } },
      { name:'Yucaloo', type:'line', data:(tf.seriesYucaloo||[]).map(p=>p.sessions), smooth:.3, symbol:'circle', symbolSize:5, itemStyle:{ color:yucalooColor }, lineStyle:{ color:yucalooColor, width:2 } },
    ];
    trafficLegendItems = [{ label:'Coco and Luna', color:cocoColor }, { label:'Yucaloo', color:yucalooColor }];
  } else {
    trafficYAxis = [
      { type:'value', position:'left', axisLine:{show:false}, axisTick:{show:false}, splitLine:{lineStyle:{color:'rgba(30,28,24,0.06)'}}, axisLabel:AXIS_FONT },
      { type:'value', position:'right', axisLine:{show:false}, axisTick:{show:false}, splitLine:{show:false}, axisLabel:{ ...AXIS_FONT, formatter:'{value}%' } },
    ];
    trafficSeries = [
      { name:'Sessões', type:'bar', data:tf.series.map(p=>p.sessions), yAxisIndex:0, barMaxWidth:26, itemStyle:{ color:'rgba(176,168,152,.55)', borderRadius:[4,4,0,0] }, emphasis:{ itemStyle:{ color:'rgba(176,168,152,.8)' } } },
      { name:'Conversão', type:'line', data:tf.series.map(p=>p.conv*100), yAxisIndex:1, smooth:.3, symbol:'circle', symbolSize:6, lineStyle:{ color:cssVar('--line1'), width:2 }, itemStyle:{ color:cssVar('--line1') } },
    ];
    trafficLegendItems = [{ label:'Sessões', color:'rgba(176,168,152,.55)', sq:true }, { label:'Conversão (%)', color:'var(--line1)' }];
  }
  setEChart('trafficChart', {
    grid:{ left:8, right:8, top:12, bottom:22, containLabel:true },
    xAxis:{ type:'category', data:tf.series.map(p=>p.label), axisLine:{show:false}, axisTick:{show:false}, axisLabel:AXIS_FONT, splitLine:{show:false} },
    yAxis:trafficYAxis,
    tooltip:{ trigger:'axis', axisPointer:{ type: useTrafficChanView ? 'line' : 'shadow', shadowStyle:{ color:'rgba(30,28,24,0.05)' } }, ...EC_TOOLTIP, formatter: params => {
      if (!params.length) return '';
      const head = `<div style="font-weight:700;color:${cssVar('--text')};margin-bottom:4px">${params[0].axisValueLabel}</div>`;
      return head + params.map(p => `<div>${p.marker} ${p.seriesName==='Conversão' ? 'Conversão: '+p.value.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%' : p.seriesName+': '+fmtInt(p.value)+(useTrafficChanView?' sessões':'')}</div>`).join('');
    } },
    series: trafficSeries,
  });
  renderLegend('trafficLegend', trafficLegendItems);

  // Funnel — mostra % do total de sessões e queda vs. a etapa anterior em cada degrau, além da
  // barra (antes só tinha rótulo+barra+valor bruto, ficava curto demais ao lado de "Tráfego &
  // conversão" no grid de 12 colunas, sobrando espaço vazio; isso resolve preenchendo com dado
  // de verdade — % e queda — em vez de só esticar o card).
  const fn = d.funnel, hasSessions = fn.sessions>0, fmax = fn.sessions||1;
  const steps = [['Sessões',fn.sessions,'var(--ink)'],['Adicionou carrinho',fn.cart,'var(--ink)'],['Iniciou checkout',fn.checkout,'var(--tan)'],['Concluiu compra',fn.completed,'var(--sage)']];
  document.getElementById('funnelList').innerHTML = steps.map(([l,v,c],i)=>{
    const w = Math.max((v/fmax)*100, v>0?1.5:0);
    const ofTotal = hasSessions ? pctStr(v/fmax*100) + ' do total' : '—';
    const prev = i>0 ? steps[i-1][1] : null;
    const drop = (hasSessions && prev>0) ? '· queda de ' + pctStr(Math.max(0,(1-v/prev)*100)) + ' vs. etapa anterior' : '';
    return `<div class="fl-row"><div class="fl-row-top"><span class="fl-label">${l}</span><span class="fl-val">${fmtInt(v)}</span></div><div class="fl-track"><div class="fl-fill" style="width:${w}%;background:${c}"></div></div><div class="fl-meta">${ofTotal}${drop ? ' '+drop : ''}</div></div>`;
  }).join('');

  renderInsights(d.insights || [], {
    pedidos: d.kpis?.orders, historyStart: d.historyStart,
    since: d.period?.since, until: d.period?.until,
  });

  // Top products
  const isAllCh = d.channel === 'todos';
  const allProds = d.topProductsAll || d.topProducts;
  const prodList = topProductsExpanded ? allProds : d.topProducts;
  if (prodList.length) {
    const prodRows = prodList.map((p,i) => {
      const {title:name, revenue:v, avulsoQty:avQty, comboBySize} = p;
      // Linha unificada pelo Unificador (Configurações): pode juntar o mesmo produto vendido em
      // canais diferentes — mostra um badge por canal presente, em vez de um único canal.
      const badge = isAllCh ? ' '+(p.channels||[p.channel]).map(c=>CocoColors.chBadgeHTML(c)).join(' ') : '';
      const groupBadge = p._grouped ? ` <span class="tp-group-badge" title="${escapeHtml(p._members.join(' + '))}"><i class="bi bi-link-45deg"></i>${p._members.length}</span>` : '';
      const comboParts = Object.entries(comboBySize||{})
        .sort((a,b)=>Number(a[0])-Number(b[0]))
        .map(([size,n])=>`${fmtInt(n)} combo de ${size}`);
      const bits = [];
      if (avQty > 0) bits.push(`${fmtInt(avQty)} avulso`);
      bits.push(...comboParts);
      const total = avQty + (p.comboQty || 0);
      // O detalhamento só aparece quando ele soma o total: senão a linha dizia "6 un total ·
      // 3 avulso, 1 combo de 2" (que dá 5) ou, pior, "0 un" pra um produto que vendeu — bastava a
      // unidade estar num combo cujo título não diz "combo de N". O total é o número que importa
      // e agora ele é sempre o que aparece.
      const somaBits = avQty + Object.entries(comboBySize||{}).reduce((a,[size,n]) => a + Number(size)*n, 0);
      const qtyLine = (bits.length && somaBits === total)
        ? `${fmtInt(total)} un total · ${bits.join(', ')}`
        : `${fmtInt(total)} un`;
      return `<div class="tp-row"><div class="tp-info"><div class="tp-name-row"><span>${i+1} · ${name}</span>${groupBadge}${badge}</div><div class="tp-qty">${qtyLine}</div></div><span class="tp-val">${fmtMoney(v)}</span></div>`;
    }).join('');
    const prodTotal = prodList.reduce((a,p)=>a+p.revenue, 0);
    const totalLabel = topProductsExpanded ? `Total geral (${prodList.length})` : `Total top ${prodList.length}`;
    const toggleLabel = topProductsExpanded ? 'Mostrar top 5' : `Ver todos (${allProds.length})`;
    const showToggle = allProds.length > d.topProducts.length;
    const totalRow = `<div class="tp-summary"><span class="tp-summary-label">${totalLabel}</span><span class="tp-summary-val">${fmtMoney(prodTotal)}</span></div>${showToggle?`<div class="tp-toggle-wrap"><button onclick="toggleTopProducts()" class="tp-toggle-btn">${toggleLabel}</button></div>`:''}`;
    const listWrap = topProductsExpanded ? `<div class="tp-list-scroll">${prodRows}</div>` : prodRows;
    document.getElementById('topProducts').innerHTML = listWrap + totalRow;
  } else if (d.kpis.revenue > 0) {
    // Existe receita real no período (KPI "Receita Total" > 0), mas nenhum item tem título pra
    // agrupar por produto — hoje só acontece com Amazon BR (nome de item bloqueado, ver CLAUDE.md
    // 4.7.9/backlog aberto 2). "Sem vendas no período" seria enganoso aqui: a venda existe, só
    // falta o nome do produto pra quebrar por item.
    document.getElementById('topProducts').innerHTML = `<div class="muted-state">${fmtMoney(d.kpis.revenue)} em vendas no período, mas sem nome de produto disponível ainda pra este canal.</div>`;
  } else {
    document.getElementById('topProducts').innerHTML = '<div class="muted-state">Sem vendas no período.</div>';
  }

  // Recent orders (paginado — RO_PAGE_SIZE por página; backend devolve até 100)
  _roAll = d.recentOrders || [];
  _roIsAllCh = isAllCh;
  if (_roFilter.trim()) doSearch();  // busca ativa: re-consulta o histórico do mercado atual
  else renderOrdersPage();

  const now=new Date(), hh=String(now.getHours()).padStart(2,'0'), mm=String(now.getMinutes()).padStart(2,'0');
  setLive('ok',`Ao vivo · ${hh}:${mm}`);
  const up = d.updatedAt?new Date(d.updatedAt).toLocaleString('pt-BR'):'—';
  document.getElementById('footerDate').textContent = `Vita Pet Life · ${CocoColors.chLabel(d.channel)} · período ${label} · última sincronização: ${up}`;
  updateCardVisibility();
}

// ── Pedidos recentes: paginação + busca GERAL (histórico inteiro via backend) ──
const RO_PAGE_SIZE = 10;
let _roAll = [];        // pedidos recentes do período (do /api/dashboard)
let _roSearch = [];     // resultados da busca geral (do /api/orders/search)
let _roPage = 0;
let _roIsAllCh = true;
let _roFilter = '';
let _roMode = 'recent'; // 'recent' | 'search'
let _roSearchTotal = 0;
let _roLimited = false;
let _roLoading = false;
let _roSeq = 0;         // descarta respostas de busca fora de ordem
let _roExportStatus = 'todos';
let _roStatusFilter = 'todos'; // botões do card em si (#roStatusRow) — mesmo vocabulário/valores do filtro de exportar

// Lista atualmente exibida no card (recentes ou resultado da busca geral), já filtrada por
// status (EXPORT_STATUS_CLS mapeia o valor do botão pra classe de statusTag() — definido mais
// abaixo, mas função só roda depois do script inteiro já ter carregado, mesma lógica de sempre).
function activeOrders() {
  const list = _roMode === 'search' ? _roSearch : _roAll;
  if (_roStatusFilter === 'todos') return list;
  return list.filter(o => statusTag(o).cls === EXPORT_STATUS_CLS[_roStatusFilter]);
}

// Busca geral no backend: varre TODO o histórico do mercado atual (todos os canais, sem janela
// de data). Escopo por mercado para não misturar BRL/USD. Chamada com debounce pelo input.
async function doSearch() {
  const q = _roFilter.trim();
  if (!q) { _roMode = 'recent'; _roLoading = false; _roPage = 0; renderOrdersPage(); return; }
  const seq = ++_roSeq;
  _roMode = 'search'; _roLoading = true; renderOrdersPage();
  try {
    const r = await fetch(`/api/orders/search?market=${market}&q=${encodeURIComponent(q)}`, { credentials: 'same-origin' });
    const data = await r.json();
    if (seq !== _roSeq) return;   // uma busca mais nova já disparou; descarta esta resposta
    _roSearch = data.results || [];
    _roSearchTotal = data.total || 0;
    _roLimited = !!data.limited;
  } catch (e) {
    if (seq !== _roSeq) return;
    _roSearch = []; _roSearchTotal = 0; _roLimited = false;
  }
  _roLoading = false; _roPage = 0; renderOrdersPage();
}
let _roDebounce = null;
function scheduleSearch() {
  clearTimeout(_roDebounce);
  if (!_roFilter.trim()) { doSearch(); return; }  // limpar volta pros recentes na hora
  _roDebounce = setTimeout(doSearch, 300);
}

// ── Colunas do card "Pedidos recentes" ──
// A tabela é MONTADA a partir desta lista, em vez de escrita à mão no markup: no modo de edição a
// ordem é arrastável e cada coluna pode ser ocultada. Escritos à mão, cabeçalho, células e linha
// de total divergem na primeira vez que alguém mexe na ordem — e divergem em silêncio, porque a
// tabela continua desenhando (o cabeçalho diria "Cliente" com o canal embaixo).
// O RÓTULO vem do EXPORT_COLUMN_DEFS, o mesmo do modal de exportar: a mesma coluna com nomes
// diferentes nas duas telas é o tipo de divergência que ninguém percebe.
const RO_COLUMNS = {
  name:        { cls: 'mono', html: o => escapeHtml(o.name || '') },
  createdAt:   { cls: 'dim',  html: o => new Date(o.createdAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) },
  customer:    { cls: 'dim',  html: o => escapeHtml(o.customer || '—') },
  statusLabel: { cls: '',     html: o => { const st = statusTag(o); return `<span class="st-tag ${st.cls}">${st.label}</span>`; } },
  itemsQty:    { cls: 'dim',  html: o => o.itemsQty ?? o.items ?? '—' },
  total:       { cls: 'bold', html: o => fmtMoney(o.total, 2) },
  channel:     { cls: '',     html: o => (_roMode === 'search' || _roIsAllCh) ? CocoColors.chBadgeHTML(o.channel) : `<span class="mc-meta">${escapeHtml(CocoColors.ch[o.channel]?.label || o.channel)}</span>` },
};
const RO_DEFAULT_COLS = ['name','createdAt','customer','statusLabel','itemsQty','total','channel'];
let roColOrder = [...RO_DEFAULT_COLS];
let roHiddenCols = new Set();
let roDragKey = null;      // coluna sendo arrastada agora (vira a coluna tracejada na tabela)

function emEdicao() { return document.body.classList.contains('edit-mode'); }

// A ordem salva no navegador pode estar velha: uma coluna que deixou de existir, ou uma que nasceu
// depois. Descarta o que não existe mais e acrescenta no fim o que apareceu depois, em vez de
// jogar a ordem inteira fora ou deixar a tabela sem a coluna nova pra sempre.
function roCols() {
  const validas = roColOrder.filter(k => RO_COLUMNS[k]);
  return [...validas, ...RO_DEFAULT_COLS.filter(k => !validas.includes(k))];
}
// No modo de edição a coluna oculta CONTINUA na tela, apagada: é o que permite trazer ela de volta.
// Fora dele, ela some de verdade. Mesma ideia do card removido, que só existe enquanto se edita.
function roVisibleCols() {
  const todas = roCols();
  return emEdicao() ? todas : todas.filter(k => !roHiddenCols.has(k));
}
function roCell(k, o) {
  if (k === roDragKey) return `<td class="ro-col-ghost" data-col="${k}"></td>`;
  const classes = [RO_COLUMNS[k].cls, roHiddenCols.has(k) ? 'ro-col-off' : ''].filter(Boolean).join(' ');
  return `<td${classes ? ` class="${classes}"` : ''} data-col="${k}">${RO_COLUMNS[k].html(o)}</td>`;
}
// Linha de total: uma célula por coluna, sem colspan. O valor cai embaixo da coluna "Valor" onde
// quer que ela esteja, e cada célula carrega o `data-col` que o celular usa pra esconder as mesmas
// colunas do cabeçalho. Com colspan fixo, arrastar a coluna deixava o total embaixo da coluna
// errada, e no celular a linha ficava com mais células do que a tabela tem colunas.
function roSummaryRow(cols, validos, total) {
  const rotulo = `Total (${validos} válidos)`;
  const iRotulo = cols.findIndex(k => k !== 'total');   // "Valor" na 1ª coluna: o rótulo vai pra seguinte em vez de sumir
  return '<tr class="ro-summary-row">' + cols.map((k, i) =>
      k === roDragKey ? `<td class="ro-col-ghost" data-col="${k}"></td>`
    : k === 'total'   ? `<td class="ro-summary-val" data-col="total">${fmtMoney(total, 2)}</td>`
    : i === iRotulo   ? `<td class="ro-summary-label" data-col="${k}">${rotulo}</td>`
    : `<td data-col="${k}"></td>`
  ).join('') + '</tr>';
}
function renderOrdersHead() {
  const cabecalho = document.getElementById('ordersHead');
  if (!cabecalho) return;
  cabecalho.innerHTML = '<tr>' + roVisibleCols().map(k => {
    if (k === roDragKey) return `<th class="ro-th ro-col-ghost" data-col="${k}"></th>`;
    const oculta = roHiddenCols.has(k);
    const olho = `<button type="button" class="ro-th-eye" data-eye="${k}" title="${oculta ? 'Mostrar esta coluna' : 'Ocultar esta coluna'}"><i class="bi bi-eye${oculta ? '' : '-slash'}"></i></button>`;
    return `<th class="ro-th${oculta ? ' ro-col-off' : ''}" data-col="${k}">`
      + `<span class="ro-th-grip" title="Arrastar para reordenar"><i class="bi bi-grip-vertical"></i></span>`
      + escapeHtml(EXPORT_COLUMN_DEFS[k] || k) + olho + '</th>';
  }).join('') + '</tr>';
}

// ── Arrastar coluna ──
// Mesmo arraste por ponteiro dos cards de Produtos/Estoque (nunca a API nativa de drag do HTML5):
// um clone em position:fixed segue o cursor e o lugar de onde ele saiu fica tracejado.
// A diferença é que aqui NÃO dá pra só mover o <th>: numa <table>, cabeçalho e corpo dividem as
// mesmas colunas, então mexer só no cabeçalho não abre espaço nenhum — o corpo continua na ordem
// antiga e a tabela fica com uma coluna a mais que ninguém preencheu (foi o que aconteceu na
// primeira versão: o clone flutuava e nada se reorganizava). Por isso a ordem provisória vive numa
// variável e a tabela INTEIRA é remontada a cada troca de posição: a coluna se move de verdade,
// com os dados dela junto.
let roDragClone = null, roDragX = 0, roDragY = 0, roDragGrab = 0, roDragOn = false;
const RO_DRAG_LIMIAR = 4;

function roDragMove(e) {
  if (!roDragOn) {
    if (Math.abs(e.clientX - roDragX) < RO_DRAG_LIMIAR && Math.abs(e.clientY - roDragY) < RO_DRAG_LIMIAR) return;
    roDragOn = true;
    document.body.classList.add('dragging-active');
    renderOrdersPage();   // a coluna vira o rastro tracejado
  }
  roDragClone.style.left = (e.clientX - roDragGrab) + 'px';
  roDragClone.style.top = (e.clientY - 14) + 'px';

  // O <th> tracejado ocupa o lugar da coluna arrastada, então a lista de células do cabeçalho e a
  // ordem provisória andam lado a lado: o índice de uma é o índice da outra.
  const ths = [...document.querySelectorAll('#ordersHead th[data-col]')];
  const cols = ths.map(th => th.dataset.col);
  let alvo = ths.length - 1;
  for (let i = 0; i < ths.length; i++) {
    const box = ths[i].getBoundingClientRect();
    if (e.clientX < box.left + box.width / 2) { alvo = i; break; }
  }
  if (cols.indexOf(roDragKey) === alvo) return;
  roColOrder = roOrdemCompleta(roReordenar(cols, roDragKey, alvo));
  renderOrdersPage();
}
// Move `k` pro lugar `alvo` da lista. A célula tracejada ocupa o lugar da coluna arrastada, então
// a lista de células do cabeçalho e esta lista andam lado a lado e o índice de uma é o da outra.
function roReordenar(cols, k, alvo) {
  const atual = cols.indexOf(k);
  if (atual < 0) return [...cols];
  const nova = [...cols];
  nova.splice(atual, 1);
  nova.splice(Math.max(0, Math.min(alvo, nova.length)), 0, k);
  return nova;
}
// Recoloca as colunas que não estão na tela (ocultas) nas posições relativas que já tinham, pra
// arrastar uma coluna visível não embaralhar a ordem das escondidas.
function roOrdemCompleta(visivel) {
  const nova = [...visivel];
  roCols().forEach((k, i) => {
    if (nova.includes(k)) return;
    const anterior = roCols().slice(0, i).reverse().find(x => nova.includes(x));
    nova.splice(anterior ? nova.indexOf(anterior) + 1 : 0, 0, k);
  });
  return nova;
}
function roDragUp() {
  document.removeEventListener('mousemove', roDragMove);
  document.removeEventListener('mouseup', roDragUp);
  if (roDragClone) { roDragClone.remove(); roDragClone = null; }
  document.body.classList.remove('dragging-active');
  const arrastou = roDragOn;
  roDragKey = null;
  roDragOn = false;
  if (arrastou) persistLayout();
  renderOrdersPage();
}
document.getElementById('ordersHead').addEventListener('mousedown', e => {
  if (e.button !== 0 || !emEdicao()) return;
  const alca = e.target.closest('.ro-th-grip');
  if (!alca) return;
  const th = alca.closest('th[data-col]');
  if (!th) return;
  e.preventDefault();
  const rect = th.getBoundingClientRect();
  roDragKey = th.dataset.col;
  roDragX = e.clientX; roDragY = e.clientY; roDragGrab = e.clientX - rect.left;
  roDragOn = false;
  roDragClone = document.createElement('div');
  roDragClone.className = 'ro-col-floating';
  roDragClone.textContent = EXPORT_COLUMN_DEFS[roDragKey] || roDragKey;
  roDragClone.style.width = rect.width + 'px';
  roDragClone.style.left = rect.left + 'px';
  roDragClone.style.top = (rect.top - 4) + 'px';
  document.body.appendChild(roDragClone);
  document.addEventListener('mousemove', roDragMove);
  document.addEventListener('mouseup', roDragUp);
});
// Ocultar/mostrar. A última coluna visível não pode sumir: fora do modo de edição a tabela ficaria
// sem coluna nenhuma, e quem visse isso não teria como adivinhar que o conserto está em "Editar".
document.getElementById('ordersHead').addEventListener('click', e => {
  const botao = e.target.closest('.ro-th-eye');
  if (!botao) return;
  const k = botao.dataset.eye;
  if (!roHiddenCols.has(k) && roCols().filter(c => !roHiddenCols.has(c)).length <= 1) return;
  roHiddenCols.has(k) ? roHiddenCols.delete(k) : roHiddenCols.add(k);
  persistLayout();
  renderOrdersPage();
});

function renderOrdersPage() {
  const body = document.getElementById('ordersBody');
  const pager = document.getElementById('ordersPager');
  const cols = roVisibleCols();
  renderOrdersHead();   // antes das saídas antecipadas: o cabeçalho depende da ordem, não dos dados
  const meta = document.getElementById('ordersMeta');
  const searching = _roMode === 'search';
  const filtered = _roStatusFilter !== 'todos';
  const ro = activeOrders();
  if (meta) {
    // Com filtro de status ativo, _roSearchTotal/_roAll.length não valem mais — são a contagem
    // ANTES do filtro (vêm do backend/período, não sabem de statusTag()) — usa ro.length (já
    // filtrado) pro texto não ficar dizendo "12 pedidos" com só 3 linhas na tabela.
    const total = filtered ? ro.length : (searching ? _roSearchTotal : _roAll.length);
    meta.textContent = _roLoading ? 'Buscando…'
      : searching ? `${total} resultado${total === 1 ? '' : 's'}${(!filtered && _roLimited) ? ` (mostrando ${ro.length})` : ''}`
      : (total ? `${total} pedidos` : '0 pedidos');
  }
  if (_roLoading && !ro.length) {
    body.innerHTML = `<tr><td colspan="${cols.length}" class="muted-state">Buscando…</td></tr>`;
    pager.innerHTML = '';
    return;
  }
  if (!ro.length) {
    body.innerHTML = `<tr><td colspan="${cols.length}" class="muted-state">${searching ? 'Nenhum pedido encontrado para a busca.' : 'Nenhum pedido.'}</td></tr>`;
    pager.innerHTML = '';
    return;
  }
  const pages = Math.max(1, Math.ceil(ro.length / RO_PAGE_SIZE));
  if (_roPage >= pages) _roPage = pages - 1;
  if (_roPage < 0) _roPage = 0;
  const start = _roPage * RO_PAGE_SIZE;
  const pageItems = ro.slice(start, start + RO_PAGE_SIZE);

  const orderRows = pageItems.map(o => '<tr>' + cols.map(k => roCell(k, o)).join('') + '</tr>').join('');
  // Total de válidos considera TODOS os pedidos retornados (não só a página atual).
  const roValidCount = ro.filter(o=>!o.cancelled).length;
  const roValidTotal = ro.filter(o=>!o.cancelled).reduce((a,o)=>a+o.total, 0);
  body.innerHTML = orderRows + roSummaryRow(cols, roValidCount, roValidTotal);

  if (pages > 1) {
    pager.innerHTML = `<button class="ro-pg-btn" id="roPrev" ${_roPage===0?'disabled':''}>‹ Anterior</button>`
      + `<span class="ro-pg-info">Página ${_roPage+1} de ${pages} · ${start+1}–${start+pageItems.length} de ${ro.length}</span>`
      + `<button class="ro-pg-btn" id="roNext" ${_roPage>=pages-1?'disabled':''}>Próxima ›</button>`;
    document.getElementById('roPrev').onclick = ()=>{ if(_roPage>0){ _roPage--; renderOrdersPage(); } };
    document.getElementById('roNext').onclick = ()=>{ if(_roPage<pages-1){ _roPage++; renderOrdersPage(); } };
  } else {
    pager.innerHTML = '';
  }
}

// Mesma lista de status "não pago" usada em store.js (UNPAID_STATUS_BY_CHANNEL/
// fixUnpaidOrders) — pedido nesse status ainda pode virar venda (a Amazon demora a
// capturar pagamento, ver CLAUDE.md 4.7.2/4.7.10); não é cancelamento de verdade, então
// merece um rótulo diferente de "Cancelado" pra não parecer que a venda foi perdida.
const UNPAID_STATUS_BY_CHANNEL = {
  amazon:        ['Pending', 'PendingAvailability'],
  amazon_us:     ['Pending', 'PendingAvailability'],
  shopify:       ['PENDING', 'AUTHORIZED'],
  shopify_us:    ['PENDING', 'AUTHORIZED'],
  mercadolivre:  ['confirmed', 'payment_required', 'payment_in_process'],
};
// Vocabulário de status inspirado no Bling (Autorizada/Em aberto/Cancelada) — em vez do genérico
// "OK", os pedidos válidos aparecem como "Autorizado" e qualquer coisa ainda não concluída (inclusive
// o caso "Não pago" da Amazon, ver UNPAID_STATUS_BY_CHANNEL) cai em "Em aberto". Rótulo, não muda
// nada do cálculo de receita/cancelamento — `o.cancelled` continua a mesma fonte de verdade de sempre.
function statusTag(o) {
  if (o.cancelled) {
    const unpaid = UNPAID_STATUS_BY_CHANNEL[o.channel];
    if (unpaid && unpaid.includes(o.status)) return { cls:'pend', label:'Em aberto' };
    return { cls:'canc', label:'Cancelado' };
  }
  // Amazon: marcado pelo relatório de devoluções (campo `refunded`, ver src/sync.js).
  if (o.refunded === 'total')   return { cls:'ref', label:'Reembolsado' };
  if (o.refunded === 'parcial') return { cls:'ref', label:'Reembolso parcial' };
  const s = (o.status||'').toUpperCase();
  // Cor própria, nem verde nem vermelha: o pedido não está saudável, mas também não foi
  // cancelado — a venda existiu e foi desfeita.
  if (s === 'REFUNDED') return { cls:'ref', label:'Reembolsado' };
  if (s === 'PARTIALLY_REFUNDED') return { cls:'ref', label:'Reembolso parcial' };
  if (['PAID','COMPLETED','SHIPPED','TO_CONFIRM_RECEIVE','READY_TO_SHIP'].includes(s)) return { cls:'ok', label:'Autorizado' };
  return { cls:'pend', label:'Em aberto' };
}

// Cards sem regra de visibilidade por canal (sempre visíveis, exceto se removidos no modo de edição)
// Insights entra aqui: as regras dele já se adaptam ao canal selecionado (as de canal não rodam
// fora de "todos", ver src/insights.js), então o card nunca fica sem sentido — no pior caso mostra
// o estado vazio "nada fora do normal". Esconder por canal seria pior: o usuário perderia
// justamente o aviso de "esse canal parou de vender".
const ALWAYS_VISIBLE_CARD_IDS = ['kpiStrip','insights','trend','topProducts','recentOrders'];

function updateCardVisibility() {
  const isTodos = channel === 'todos';
  const isShopify = channel === 'shopify' || channel === 'shopify_us';
  const isYucaloo = channel === 'yucaloo_br' || channel === 'yucaloo_us';
  const setWrap = (wrap, visible) => {
    if (!wrap) return false;
    const userHidden = hiddenByUser.has(wrap.dataset.cardId);
    const finalVisible = visible && !userHidden;
    wrap.style.display = finalVisible ? '' : 'none';
    return finalVisible;
  };
  const show = (innerId, visible) => {
    const inner = document.getElementById(innerId);
    return setWrap(inner ? inner.closest('.edit-card') : null, visible);
  };

  const channelSplitVisible = show('cardChannelSplit', isTodos);
  const marketingVisible    = show('cardMarketing',    isTodos || isShopify);
  show('cardSalesSplit',   true);
  // Yucaloo tem loja Shopify própria (ver aggregateSessions em metrics.js) — mesma dados de
  // sessão que Coco and Luna, então os dois cards que dependem disso acompanham.
  show('cardTraffic',      isTodos || isShopify || isYucaloo);
  show('cardFunnel',       isTodos || isShopify || isYucaloo);
  show('cardMlBreakdown',  channel === 'mercadolivre');

  ALWAYS_VISIBLE_CARD_IDS.forEach(id => {
    setWrap(editGrid.querySelector(`.edit-card[data-card-id="${id}"]`), true);
  });

  // Quando o card vizinho (Canais/Marketing) fica escondido pelo canal selecionado, Tendência e
  // Top produtos passam a ocupar a linha inteira em vez de deixar metade em branco do lado
  // (mesmo espaço branco "sobrando" reportado em produção). Escopado em editGrid (não document)
  // — uma prévia do card no banco de cards (ver capturePreview/renderCardBank) é um clone com o
  // mesmo data-card-id, só que vive dentro de #cardBank, que aparece ANTES de #editGrid no DOM;
  // um document.querySelector pegaria essa cópia inerte em vez do card de verdade sempre que o
  // card estivesse oculto.
  const trendWrap = editGrid.querySelector('.edit-card[data-card-id="trend"]');
  // trendExpanded (botão de expandir do card, ver applyTrendExpanded) força span 12 mesmo com o
  // card de Canais visível — senão essa função (chamada de novo em todo refresh) desfazia o
  // expandido no próximo ciclo de dados.
  if (trendWrap) trendWrap.style.gridColumn = (trendExpanded || !channelSplitVisible) ? 'span 12' : 'span 7';
  const topProdWrap = editGrid.querySelector('.edit-card[data-card-id="topProducts"]');
  if (topProdWrap) topProdWrap.style.gridColumn = marketingVisible ? 'span 8' : 'span 12';
}

// ── Modo de edição: reordenar / remover / banco de cards ──
// Dois níveis de grid editável: o grid principal (#editGrid, cards inteiros) e, dentro do
// card fixo "Indicadores" (kpiStrip, nunca arrastável nem removível), a faixa interna de KPIs
// (#kpiStripGrid) — mesmos mecanismos de drag/remoção, containers diferentes.
const editGrid = document.getElementById('editGrid');
const kpiStripGrid = document.getElementById('kpiStripGrid');
let hiddenByUser = new Set();
let hiddenKpis = new Set();

// Ordem padrão de fábrica (capturada antes de qualquer reordenação salva ser aplicada) — usada
// pelo botão "Redefinir".
const DEFAULT_ORDER = [...editGrid.querySelectorAll('.edit-card')].map(c => c.dataset.cardId);
const DEFAULT_KPI_ORDER = [...kpiStripGrid.querySelectorAll('.kpi-mini')].map(c => c.dataset.kpiId);

function layoutKey() { return `coco_layout_${market}`; }
function loadLayout() {
  try { return JSON.parse(localStorage.getItem(layoutKey()) || 'null') || { order: [], hidden: [], kpiOrder: [], kpiHidden: [] }; }
  catch { return { order: [], hidden: [], kpiOrder: [], kpiHidden: [] }; }
}
function persistLayout() {
  const order = [...editGrid.querySelectorAll('.edit-card')].map(c => c.dataset.cardId);
  const kpiOrder = [...kpiStripGrid.querySelectorAll('.kpi-mini')].map(c => c.dataset.kpiId);
  // A ordem das colunas entra AQUI, no layout da página, e não numa chave própria: é parte do que
  // o modo de edição arruma, então o botão "Redefinir" tem que desfazer ela junto com o resto.
  localStorage.setItem(layoutKey(), JSON.stringify({ order, hidden: [...hiddenByUser], kpiOrder, kpiHidden: [...hiddenKpis], colOrder: roColOrder, colHidden: [...roHiddenCols] }));
}
function applyLayout() {
  const saved = loadLayout();
  hiddenByUser = new Set(saved.hidden || []);
  hiddenKpis = new Set(saved.kpiHidden || []);
  if (Array.isArray(saved.colOrder) && saved.colOrder.length) roColOrder = saved.colOrder;
  roHiddenCols = new Set((saved.colHidden || []).filter(k => RO_COLUMNS[k]));
  renderOrdersHead();
  (saved.order || []).forEach(id => {
    const card = editGrid.querySelector(`.edit-card[data-card-id="${id}"]`);
    if (card) editGrid.appendChild(card);
  });
  (saved.kpiOrder || []).forEach(id => {
    const mini = kpiStripGrid.querySelector(`.kpi-mini[data-kpi-id="${id}"]`);
    if (mini) kpiStripGrid.appendChild(mini);
  });
  editGrid.querySelectorAll('.edit-card').forEach(card => {
    if (hiddenByUser.has(card.dataset.cardId)) card.style.display = 'none';
  });
  kpiStripGrid.querySelectorAll('.kpi-mini').forEach(mini => {
    if (hiddenKpis.has(mini.dataset.kpiId)) mini.style.display = 'none';
  });
  renderCardBank();
}
function resetLayout() {
  localStorage.removeItem(layoutKey());
  hiddenByUser = new Set();
  hiddenKpis = new Set();
  roColOrder = [...RO_DEFAULT_COLS];
  roHiddenCols = new Set();
  renderOrdersPage();
  DEFAULT_ORDER.forEach(id => {
    const card = editGrid.querySelector(`.edit-card[data-card-id="${id}"]`);
    if (card) { editGrid.appendChild(card); card.style.display = ''; }
  });
  DEFAULT_KPI_ORDER.forEach(id => {
    const mini = kpiStripGrid.querySelector(`.kpi-mini[data-kpi-id="${id}"]`);
    if (mini) { kpiStripGrid.appendChild(mini); mini.style.display = ''; }
  });
  renderCardBank();
  updateCardVisibility();
}

// Prévia de cada card no banco: clone real do elemento (com qualquer <canvas> de gráfico virado
// <img> via toDataURL, já que cloneNode não copia o bitmap desenhado) capturado no instante em
// que o card é ocultado — reflete o último estado renderizado de verdade, sem precisar recriar
// em miniatura na mão. Card que já veio oculto de uma sessão anterior (nunca esteve visível
// nesta carga de página) não tem captura disponível: cai no ícone genérico
// (CB_ICON_BY_ID/CB_ICON_KPI) até ser mostrado e ocultado de novo uma vez. Decisão de produto:
// o banco só mostrava o nome, sem dar nenhuma pista visual do que era cada card.
const CB_PREVIEW_W = 190;
const CB_ICON_BY_ID = {
  insights: 'bi-lightbulb',
  trend: 'bi-graph-up', channelSplit: 'bi-pie-chart', traffic: 'bi-signpost-split',
  funnel: 'bi-filter-circle', mlBreakdown: 'bi-basket', topProducts: 'bi-box-seam',
  marketing: 'bi-megaphone', salesSplit: 'bi-bullseye', recentOrders: 'bi-receipt',
};
const CB_ICON_KPI = {
  revenue: 'bi-cash-stack', orders: 'bi-bag-check', aov: 'bi-tag',
  roas: 'bi-graph-up-arrow', acos: 'bi-percent',
};
let cardPreviews = {};
function capturePreview(el, kind, id) {
  if (!el || el.style.display === 'none') return;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.edit-card-tools, .kpi-mini-tools').forEach(t => t.remove());
  // Tira todo id do clone — ele fica inserido no DOM real (dentro do banco de cards), e um id
  // duplicado faria getElementById('trendChart') etc. arriscar pegar essa cópia inerte em vez
  // do card de verdade na próxima atualização de dado.
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  const origCanvases = el.querySelectorAll('canvas');
  clone.querySelectorAll('canvas').forEach((c, i) => {
    const src = origCanvases[i];
    if (!src) return;
    let dataUrl = '';
    try { dataUrl = src.toDataURL(); } catch { /* canvas contaminado por CORS, sem prévia possível pra esse elemento */ }
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.cssText = c.style.cssText || `width:${src.width}px;height:${src.height}px`;
    c.replaceWith(img);
  });
  cardPreviews[`${kind}:${id}`] = { html: clone.outerHTML, width: rect.width, height: rect.height };
}

function renderCardBank() {
  const list = document.getElementById('cardBankList');
  const badge = document.getElementById('cardBankBadge');
  const items = [
    ...[...hiddenByUser].map(id => ({ id, kind: 'card' })),
    ...[...hiddenKpis].map(id => ({ id, kind: 'kpi' })),
  ];
  badge.textContent = items.length;
  if (!items.length) { list.innerHTML = '<div class="cb-empty">Nenhum card oculto.</div>'; return; }
  list.innerHTML = items.map(({ id, kind }) => {
    const el = kind === 'card'
      ? editGrid.querySelector(`.edit-card[data-card-id="${id}"]`)
      : kpiStripGrid.querySelector(`.kpi-mini[data-kpi-id="${id}"]`);
    const title = el ? el.dataset.title : id;
    const preview = cardPreviews[`${kind}:${id}`];
    const scale = preview && preview.width > 0 ? CB_PREVIEW_W / preview.width : 0;
    const previewHtml = preview && isFinite(scale) && scale > 0
      ? `<div class="cb-preview-stage" style="width:${preview.width}px;height:${preview.height}px;transform:scale(${scale.toFixed(4)})">${preview.html}</div>`
      : `<div class="cb-preview-empty"><i class="bi ${(kind === 'kpi' ? CB_ICON_KPI : CB_ICON_BY_ID)[id] || 'bi-grid-1x2'}"></i></div>`;
    return `<button type="button" class="cb-item" data-kind="${kind}" data-id="${id}">
      <div class="cb-item-head"><i class="bi bi-plus-lg"></i> ${title}</div>
      <div class="cb-item-preview">${previewHtml}</div>
    </button>`;
  }).join('');
}
document.getElementById('cardBankList').addEventListener('click', e => {
  const btn = e.target.closest('.cb-item');
  if (!btn) return;
  const { kind, id } = btn.dataset;
  if (kind === 'card') {
    hiddenByUser.delete(id);
    const card = editGrid.querySelector(`.edit-card[data-card-id="${id}"]`);
    if (card) editGrid.appendChild(card);
  } else {
    hiddenKpis.delete(id);
    const mini = kpiStripGrid.querySelector(`.kpi-mini[data-kpi-id="${id}"]`);
    if (mini) kpiStripGrid.appendChild(mini);
  }
  persistLayout();
  renderCardBank();
  updateCardVisibility();
});
editGrid.addEventListener('click', e => {
  const removeBtn = e.target.closest('.ec-remove');
  if (!removeBtn || kpiStripGrid.contains(removeBtn)) return;
  const card = removeBtn.closest('.edit-card');
  if (!card) return;
  capturePreview(card, 'card', card.dataset.cardId);
  hiddenByUser.add(card.dataset.cardId);
  card.style.display = 'none';
  persistLayout();
  renderCardBank();
});
kpiStripGrid.addEventListener('click', e => {
  const removeBtn = e.target.closest('.ec-remove');
  if (!removeBtn) return;
  e.stopPropagation();
  const mini = removeBtn.closest('.kpi-mini');
  if (!mini) return;
  capturePreview(mini, 'kpi', mini.dataset.kpiId);
  hiddenKpis.add(mini.dataset.kpiId);
  mini.style.display = 'none';
  persistLayout();
  renderCardBank();
});

// Drag-and-drop genérico (reutilizado pro grid principal e pra faixa interna de KPIs) — arraste
// customizado por ponteiro, não a Drag and Drop API nativa do HTML5 (deixava o elemento de
// origem no DOM, o navegador tirava dele uma "imagem fantasma" fora do nosso controle, e o
// espaço vago dinâmico esperado não acontecia — reportado em produção). Mesmo mecanismo já
// validado em produtos.html/estoque.html: o item real some do grid assim que o arraste começa
// (só sobra o placeholder tracejado indicando onde ele vai cair) e um clone dele, em
// position:fixed, segue o cursor de verdade a cada mousemove. excludeSelector impede que o card
// fixo "Indicadores" seja arrastado ou usado como referência de posição.
const EC_DRAG_THRESHOLD = 4;
let ecDragItem = null, ecDragGhost = null, ecDragClone = null, ecDragContainer = null;
let ecDragItemClass = null, ecDragExclude = null;
let ecDragGrabX = 0, ecDragGrabY = 0, ecDragStartX = 0, ecDragStartY = 0, ecDragStarted = false;

function getEcDragAfterElement(container, itemClass, excludeSelector, x, y) {
  let els = [...container.querySelectorAll(`.${itemClass}`)];
  if (excludeSelector) els = els.filter(el => !el.matches(excludeSelector));
  let closest = null, closestDist = Infinity;
  for (const el of els) {
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < closestDist) closestDist = dist, closest = { el, box };
  }
  if (!closest) return null;
  const cy = closest.box.top + closest.box.height / 2;
  return (y > cy) ? closest.el.nextElementSibling : closest.el;
}
function ecBeginDrag() {
  ecDragStarted = true;
  const item = ecDragItem;
  const rect = item.getBoundingClientRect();
  ecDragGrabX = ecDragStartX - rect.left;
  ecDragGrabY = ecDragStartY - rect.top;

  ecDragGhost = document.createElement('div');
  ecDragGhost.className = ecDragItemClass + '-ghost';
  ecDragGhost.style.height = rect.height + 'px';
  if (ecDragItemClass === 'edit-card') ecDragGhost.style.gridColumn = item.style.gridColumn;
  item.after(ecDragGhost);

  ecDragClone = item.cloneNode(true);
  ecDragClone.classList.add('ec-drag-floating');
  ecDragClone.style.width = rect.width + 'px';
  ecDragClone.style.left = rect.left + 'px';
  ecDragClone.style.top = rect.top + 'px';
  document.body.appendChild(ecDragClone);

  item.remove();
  document.body.classList.add('dragging-active');
}
function ecDragPointerMove(e) {
  if (!ecDragStarted) {
    if (Math.hypot(e.clientX - ecDragStartX, e.clientY - ecDragStartY) < EC_DRAG_THRESHOLD) return;
    ecBeginDrag();
  }
  ecDragClone.style.left = (e.clientX - ecDragGrabX) + 'px';
  ecDragClone.style.top = (e.clientY - ecDragGrabY) + 'px';
  const afterEl = getEcDragAfterElement(ecDragContainer, ecDragItemClass, ecDragExclude, e.clientX, e.clientY);
  if (afterEl == null) ecDragContainer.appendChild(ecDragGhost);
  else if (afterEl !== ecDragGhost) ecDragContainer.insertBefore(ecDragGhost, afterEl);
}
function ecDragPointerUp() {
  document.removeEventListener('mousemove', ecDragPointerMove);
  document.removeEventListener('mouseup', ecDragPointerUp);
  const item = ecDragItem;
  if (ecDragStarted && item) {
    ecDragContainer.insertBefore(item, ecDragGhost);
    item.classList.add('drop-bounce');
    setTimeout(() => item.classList.remove('drop-bounce'), 320);
    persistLayout();
  }
  if (ecDragGhost) { ecDragGhost.remove(); ecDragGhost = null; }
  if (ecDragClone) { ecDragClone.remove(); ecDragClone = null; }
  document.body.classList.remove('dragging-active');
  ecDragItem = null;
  ecDragContainer = null;
  ecDragStarted = false;
}
function makeDragController(container, itemClass, excludeSelector) {
  container.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const handle = e.target.closest('.ec-handle');
    if (!handle) return;
    const item = handle.closest(`.${itemClass}`);
    if (!item || (excludeSelector && item.matches(excludeSelector))) return;
    e.preventDefault();
    e.stopPropagation();
    ecDragItem = item;
    ecDragContainer = container;
    ecDragItemClass = itemClass;
    ecDragExclude = excludeSelector;
    ecDragStartX = e.clientX;
    ecDragStartY = e.clientY;
    ecDragStarted = false;
    document.addEventListener('mousemove', ecDragPointerMove);
    document.addEventListener('mouseup', ecDragPointerUp);
  });
}
makeDragController(editGrid, 'edit-card', '[data-card-id="kpiStrip"]');
makeDragController(kpiStripGrid, 'kpi-mini');

function setEditMode(on) {
  document.body.classList.toggle('edit-mode', on);
  // A tabela muda de conteúdo entre os dois modos: editando, a coluna oculta aparece apagada pra
  // poder voltar; fora daí, ela some. Sem remontar aqui, a alça e o olho ficariam pra trás.
  renderOrdersPage();
  document.getElementById('editModeBtn').classList.toggle('period-pill-active', on);
  document.getElementById('cardBank').classList.remove('open');
  if (on) renderCardBank();
}
document.getElementById('editModeBtn').addEventListener('click', () => setEditMode(!document.body.classList.contains('edit-mode')));
document.getElementById('editModeDone').addEventListener('click', () => setEditMode(false));
document.getElementById('cardBankToggle').addEventListener('click', () => document.getElementById('cardBank').classList.toggle('open'));
document.getElementById('layoutResetBtn').addEventListener('click', resetLayout);

// ── Refresh interval ──
let refreshTimer = null;
function applyRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (refreshMin > 0) refreshTimer = setInterval(loadData, refreshMin * 60 * 1000);
}

// ── Channel dropdown dinâmico ──
function buildChannelDropdown() {
  const channels = CocoColors.channelsFor(market, { comTodos: true });
  // Canal salvo que não existe neste mercado (veio da outra bandeira) volta pra "todos",
  // senão o seletor mostraria um item que não está na lista.
  if (!channels.includes(channel)) {
    channel = 'todos';
    localStorage.setItem('coco_channel', channel);
  }
  document.getElementById('channelPop').innerHTML = channels
    .map(k => `<div class="csel-opt${k===channel?' active':''}" data-value="${k}">${CocoColors.chLabel(k)}</div>`)
    .join('');
}

// ── UI state sync ──
function syncControls() {
  document.querySelectorAll('.mkt-btn').forEach(b => b.classList.toggle('active', b.dataset.market === market));
  document.getElementById('metricVal').textContent = METRIC_LABEL[metric];
  document.querySelectorAll('#cselMetric .csel-opt').forEach(o => o.classList.toggle('active', o.dataset.value === metric));
  buildChannelDropdown();
  document.getElementById('channelVal').textContent = CocoColors.chLabel(channel);
  document.getElementById('refreshVal').textContent = refreshMin===0?'Desligar':`${refreshMin} min`;
  document.querySelectorAll('#cselRefresh .csel-opt').forEach(o => o.classList.toggle('active', Number(o.dataset.value) === refreshMin));
  document.getElementById('periodValue').textContent = rangeLabel(sinceDate, untilDate);
}

async function loadData() {
  setLive('loading','Atualizando…');
  try {
    const p = new URLSearchParams({ channel, metric, since:sinceDate, until:untilDate, market, amazonRevenueMode: isAmazonProductRev() ? 'product' : 'total' });
    const r = await fetch('/api/dashboard?'+p);
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    render(d);
  } catch(e) {
    setLive('error','Erro');
    document.getElementById('footerDate').textContent = 'Erro: '+e.message;
  }
}

// ── Custom dropdown logic ──
function setupCsel(el) {
  el.addEventListener('click', e => {
    e.stopPropagation();
    const wasOpen = el.classList.contains('open');
    closeAllDropdowns();
    if (!wasOpen) el.classList.add('open');
  });
  // cselChannel é gerenciado por delegação em channelPop (buildChannelDropdown)
  if (el.id !== 'cselChannel') {
    el.querySelectorAll('.csel-opt').forEach(opt => {
      opt.addEventListener('click', e => {
        e.stopPropagation();
        const field = el.id;
        const val = opt.dataset.value;
        if (field==='cselMetric')  { metric=val; localStorage.setItem('coco_metric',metric); }
        if (field==='cselRefresh') { refreshMin=Number(val); localStorage.setItem('coco_refresh',refreshMin); applyRefresh(); }
        el.classList.remove('open');
        syncControls();
        if (field!=='cselRefresh') loadData();
      });
    });
  }
}

// Delegação de clique para o dropdown de canal (construído dinamicamente)
document.getElementById('channelPop').addEventListener('click', e => {
  const opt = e.target.closest('.csel-opt');
  if (!opt) return;
  e.stopPropagation();
  channel = opt.dataset.value;
  localStorage.setItem('coco_channel', channel);
  document.getElementById('cselChannel').classList.remove('open');
  syncControls();
  updateCardVisibility();
  loadData();
});
function closeAllDropdowns() {
  document.querySelectorAll('.csel.open').forEach(el => el.classList.remove('open'));
}

document.addEventListener('click', () => {
  closeAllDropdowns();
  document.getElementById('periodPop').classList.remove('open');
});

// ── Period picker ──
const pop = document.getElementById('periodPop');
const fromInp = document.getElementById('dateFrom');
const toInp   = document.getElementById('dateTo');
const ppErr   = document.getElementById('ppErr');

document.getElementById('periodPill').addEventListener('click', e => {
  e.stopPropagation();
  closeAllDropdowns();
  const wasOpen = pop.classList.contains('open');
  pop.classList.toggle('open', !wasOpen);
  if (!wasOpen) {
    ppErr.textContent='';
    fromInp.value=sinceDate; toInp.value=untilDate;
    fromInp.max=todayISO; toInp.max=todayISO;
    document.querySelectorAll('.pp-presets button').forEach(b=>{ const[s,u]=presetRange(b.dataset.preset); b.classList.toggle('active',s===sinceDate&&u===untilDate); });
    // Clamping de viewport (mesma ideia do CocoColors.openPicker em colors.js): em telas estreitas
    // o popover (270px) pode vazar pra fora da tela se ancorado só via CSS right:0. Calcula a
    // posição alvo em coordenadas de viewport, clampa com margem de 8px e converte pra um `left`
    // relativo ao periodWrap (containing block do position:absolute).
    const wrapRect = document.getElementById('periodWrap').getBoundingClientRect();
    const popW = 270;
    let targetLeft = wrapRect.right - popW;
    targetLeft = Math.max(8, Math.min(targetLeft, window.innerWidth - popW - 8));
    pop.style.right = 'auto';
    pop.style.left = (targetLeft - wrapRect.left) + 'px';
  }
});
pop.addEventListener('click', e=>e.stopPropagation());

document.querySelectorAll('.pp-presets button').forEach(b=>b.addEventListener('click',()=>{
  const[s,u]=presetRange(b.dataset.preset);
  sinceDate=s; untilDate=u;
  localStorage.setItem('coco_since',s); localStorage.setItem('coco_until',u);
  pop.classList.remove('open');
  syncControls(); loadData();
}));

document.getElementById('applyRange').addEventListener('click',()=>{
  const s=fromInp.value, u=toInp.value;
  if(!s||!u){ppErr.textContent='Selecione as duas datas.';return}
  if(parseISO(s)>parseISO(u)){ppErr.textContent='A data inicial deve ser anterior à final.';return}
  ppErr.textContent='';
  sinceDate=s; untilDate=u;
  localStorage.setItem('coco_since',s); localStorage.setItem('coco_until',u);
  pop.classList.remove('open');
  syncControls(); loadData();
});

document.getElementById('mktToggleWrap').addEventListener('click', e => {
  const btn = e.target.closest('.mkt-btn');
  if (!btn || btn.dataset.market === market) return;
  market = btn.dataset.market;
  localStorage.setItem('coco_market', market);
  channel = 'todos';
  localStorage.setItem('coco_channel', channel);
  applyLayout();
  syncControls();
  updateCardVisibility();
  loadData();
});

document.getElementById('syncBtn').addEventListener('click',async()=>{
  setLive('loading','Sincronizando…');
  try { await fetch('/api/sync',{method:'POST'}); } catch(e){}
  loadData();
});

// ── Busca de pedidos recentes ──
document.getElementById('ordersSearch').addEventListener('input', e => {
  _roFilter = e.target.value;
  scheduleSearch();       // busca geral no backend (debounce); vazio volta pros recentes
});

// ── Exportar pedidos para planilha (CSV) — colunas dinâmicas (reordenar/adicionar/tirar) ──
// Colunas disponíveis pro export — mesmas chaves que o backend entende (ver server.js
// EXPORT_COLUMNS). "Produto(s) da compra"/"Nº de produtos"/"Qtd. de itens" ficam disponíveis
// aqui mas fora da tabela principal (que só mostra as 6 colunas padrão).
const EXPORT_COLUMN_DEFS = {
  name:        'Pedido',
  createdAt:   'Data/Hora da compra',
  customer:    'Cliente',
  statusLabel: 'Situação',
  total:       'Valor',
  channel:     'Canal',
  products:    'Produto(s) da compra',
  itemsCount:  'Nº de produtos',
  itemsQty:    'Qtd. de itens',
};
const DEFAULT_EXPORT_ORDER = ['name','createdAt','customer','statusLabel','total','channel'];
const ALL_EXPORT_KEYS = Object.keys(EXPORT_COLUMN_DEFS);
const EXPORT_VALUE_GETTERS = {
  name:        o => o.name || '',
  createdAt:   o => new Date(o.createdAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }),
  customer:    o => o.customer || '',
  statusLabel: o => statusTag(o).label,
  total:       o => fmtMoney(o.total, 2),
  channel:     o => CocoColors.chLabel(o.channel),
  products:    o => (o.products || []).join(', '),
  itemsCount:  o => o.items,
  itemsQty:    o => o.itemsQty ?? o.items,
};

function loadExportColState() {
  try {
    const saved = JSON.parse(localStorage.getItem('coco_export_cols') || 'null');
    if (Array.isArray(saved) && saved.length) {
      const known = new Set(saved.map(c => c.key));
      const extra = ALL_EXPORT_KEYS.filter(k => !known.has(k)).map(k => ({ key: k, on: false }));
      return [...saved.filter(c => EXPORT_COLUMN_DEFS[c.key]), ...extra];
    }
  } catch (e) {}
  // Padrão: as 6 colunas da tabela, na mesma ordem, seguidas das opcionais desmarcadas.
  return [...DEFAULT_EXPORT_ORDER, ...ALL_EXPORT_KEYS.filter(k => !DEFAULT_EXPORT_ORDER.includes(k))]
    .map(k => ({ key: k, on: DEFAULT_EXPORT_ORDER.includes(k) }));
}
let exportCols = loadExportColState();
function saveExportColState() { localStorage.setItem('coco_export_cols', JSON.stringify(exportCols)); }

function renderExportCols() {
  const wrap = document.getElementById('expColsList');
  wrap.innerHTML = exportCols.map(c => `
    <div class="exp-col-row${c.on ? '' : ' off'}" data-key="${c.key}">
      <button type="button" class="exp-col-drag-handle" title="Arrastar para reordenar"><i class="bi bi-grip-vertical"></i></button>
      <label><input type="checkbox" data-toggle-col="${c.key}" ${c.on?'checked':''}> ${EXPORT_COLUMN_DEFS[c.key]}</label>
    </div>`).join('');
  attachExportColDrag();
  renderExportPreview();
}
// Mapeia cada opção da fileira de status (mesmo vocabulário de statusTag(), ver
// UNPAID_STATUS_BY_CHANNEL acima) pra classe interna. Serve os dois filtros do cliente: o do card
// "Pedidos recentes" (activeOrders) e a amostra da pré-visualização do export. O CSV de verdade
// sempre filtra no backend (ver expDownloadBtn), aqui é só pra a prévia bater com o escolhido.
// "Reembolsado" cobre o parcial junto (statusTag devolve a classe `ref` pros dois): separar em
// dois botões deixaria a fileira longa por uma distinção que quase nunca importa na hora de
// filtrar. O EXPORT_STATUS_LABELS do metrics.js precisa agrupar igual, senão o CSV vem menor que
// a tela sem erro nenhum.
const EXPORT_STATUS_CLS = { autorizado: 'ok', em_aberto: 'pend', cancelado: 'canc', reembolsado: 'ref' };
function renderExportPreview() {
  const onCols = exportCols.filter(c => c.on);
  const tbl = document.getElementById('expPreviewTbl');
  if (!onCols.length) { tbl.innerHTML = '<thead></thead><tbody><tr><td class="muted-state">Selecione ao menos uma coluna.</td></tr></tbody>'; return; }
  const wantCls = EXPORT_STATUS_CLS[_roExportStatus];
  const pool = wantCls ? (_roAll || []).filter(o => statusTag(o).cls === wantCls) : (_roAll || []);
  const sample = pool.slice(0, 5);
  const headHtml = '<tr>' + onCols.map(c => `<th>${EXPORT_COLUMN_DEFS[c.key]}</th>`).join('') + '</tr>';
  const bodyHtml = sample.length
    ? sample.map(o => '<tr>' + onCols.map(c => `<td>${escapeHtml(String(EXPORT_VALUE_GETTERS[c.key](o)))}</td>`).join('') + '</tr>').join('')
    : `<tr><td colspan="${onCols.length}" class="muted-state">${(_roAll||[]).length ? 'Nenhum pedido carregado bate com esse status, pra pré-visualizar.' : 'Sem pedidos carregados pra pré-visualizar.'}</td></tr>`;
  tbl.innerHTML = `<thead>${headHtml}</thead><tbody>${bodyHtml}</tbody>`;
}

// ── Arrastar pra reordenar as colunas do export (mesmo padrão pointer-based de produtos.html/
// estoque.html — ver CLAUDE.md 4.13: DnD nativo do HTML5 já deu bug nesse projeto quando a alça fica
// dentro de um ancestral draggable, então o arraste é rastreado via mousedown/mousemove/mouseup). ──
let expDragRow = null, expDragGhost = null, expDragClone = null;
let expDragGrabX = 0, expDragGrabY = 0, expDragStartX = 0, expDragStartY = 0, expDragStarted = false;
const EXP_DRAG_THRESHOLD = 4;
function getExpColAfterElement(container, y) {
  const els = [...container.querySelectorAll('.exp-col-row')].filter(el => el !== expDragGhost);
  let closest = null, closestDist = Infinity;
  for (const el of els) {
    const box = el.getBoundingClientRect();
    const cy = box.top + box.height / 2;
    const dist = Math.abs(y - cy);
    if (dist < closestDist) { closestDist = dist; closest = { el, box }; }
  }
  if (!closest) return null;
  const cy = closest.box.top + closest.box.height / 2;
  return (y > cy) ? closest.el.nextElementSibling : closest.el;
}
function expColBeginDrag() {
  expDragStarted = true;
  const row = expDragRow;
  const rect = row.getBoundingClientRect();
  expDragGrabX = expDragStartX - rect.left;
  expDragGrabY = expDragStartY - rect.top;

  expDragGhost = document.createElement('div');
  expDragGhost.className = 'exp-col-ghost';
  expDragGhost.style.height = rect.height + 'px';
  row.after(expDragGhost);

  expDragClone = row.cloneNode(true);
  expDragClone.classList.add('exp-col-row-floating');
  expDragClone.style.width = rect.width + 'px';
  expDragClone.style.left = rect.left + 'px';
  expDragClone.style.top = rect.top + 'px';
  document.body.appendChild(expDragClone);

  row.remove();
  document.body.classList.add('exp-col-dragging-active');
}
function expColPointerMove(e) {
  if (!expDragStarted) {
    if (Math.hypot(e.clientX - expDragStartX, e.clientY - expDragStartY) < EXP_DRAG_THRESHOLD) return;
    expColBeginDrag();
  }
  expDragClone.style.left = (e.clientX - expDragGrabX) + 'px';
  expDragClone.style.top = (e.clientY - expDragGrabY) + 'px';
  const list = document.getElementById('expColsList');
  const afterEl = getExpColAfterElement(list, e.clientY);
  if (afterEl == null) list.appendChild(expDragGhost);
  else if (afterEl !== expDragGhost) list.insertBefore(expDragGhost, afterEl);
}
function expColPointerUp() {
  document.removeEventListener('mousemove', expColPointerMove);
  document.removeEventListener('mouseup', expColPointerUp);
  const row = expDragRow;
  if (expDragStarted && row) {
    const list = document.getElementById('expColsList');
    list.insertBefore(row, expDragGhost);
    const order = [...list.querySelectorAll('.exp-col-row')].map(r => r.dataset.key);
    exportCols.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    saveExportColState();
    renderExportPreview();
  }
  if (expDragGhost) { expDragGhost.remove(); expDragGhost = null; }
  if (expDragClone) { expDragClone.remove(); expDragClone = null; }
  document.body.classList.remove('exp-col-dragging-active');
  expDragRow = null;
  expDragStarted = false;
}
function attachExportColDrag() {
  const list = document.getElementById('expColsList');
  list.querySelectorAll('.exp-col-row').forEach(row => {
    row.querySelector('.exp-col-drag-handle')?.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      expDragRow = row;
      expDragStartX = e.clientX;
      expDragStartY = e.clientY;
      expDragStarted = false;
      document.addEventListener('mousemove', expColPointerMove);
      document.addEventListener('mouseup', expColPointerUp);
    });
  });
}

function openExportModal() {
  document.getElementById('expModalOverlay').classList.add('open');
  document.getElementById('expModal').classList.add('open');
  renderExportCols();
}
function closeExportModal() {
  document.getElementById('expModalOverlay').classList.remove('open');
  document.getElementById('expModal').classList.remove('open');
}
document.getElementById('roExportBtn').addEventListener('click', openExportModal);
document.getElementById('expModalClose').addEventListener('click', closeExportModal);
document.getElementById('expCancelBtn').addEventListener('click', closeExportModal);
document.getElementById('expModalOverlay').addEventListener('click', closeExportModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeExportModal(); closeSettings(); } });

document.getElementById('expStatusRow').addEventListener('click', e => {
  const btn = e.target.closest('.exp-status-opt');
  if (!btn) return;
  document.querySelectorAll('#expStatusRow .exp-status-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _roExportStatus = btn.dataset.status;
  renderExportPreview();
});
document.getElementById('roStatusRow').addEventListener('click', e => {
  const btn = e.target.closest('.exp-status-opt');
  if (!btn) return;
  document.querySelectorAll('#roStatusRow .exp-status-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _roStatusFilter = btn.dataset.status;
  _roPage = 0;
  renderOrdersPage();
});

document.getElementById('expColsList').addEventListener('change', e => {
  const cb = e.target.closest('[data-toggle-col]');
  if (!cb) return;
  const col = exportCols.find(c => c.key === cb.dataset.toggleCol);
  if (col) col.on = cb.checked;
  saveExportColState();
  renderExportCols();
});

document.getElementById('expDownloadBtn').addEventListener('click', () => {
  const onKeys = exportCols.filter(c => c.on).map(c => c.key);
  if (!onKeys.length) return;
  const p = new URLSearchParams({ market, channel, since: sinceDate, until: untilDate, status: _roExportStatus, cols: onKeys.join(',') });
  window.location.href = '/api/orders/export?' + p.toString();
  closeExportModal();
});

// ── Init ──
document.querySelectorAll('.csel').forEach(setupCsel);
CocoColors.load();
applyLayout();
syncControls();
updateCardVisibility();
applyRefresh();
loadData();
