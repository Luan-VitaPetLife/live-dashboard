// ── Tela de Campanhas — dados REAIS via /api/dashboard ─────
// Gasto de Ads real: Meta BR e US. ML Ads aparece quando o app for autorizado
// para Mercado Ads. Shopee/Amazon Ads não têm API pública de gasto (mostram —).
const fmtInt = v => Math.round(v || 0).toLocaleString('pt-BR');
// Delega pro CocoMoeda (js/moeda.js), fonte única do formato de dinheiro. O segundo parâmetro
// continua existindo só pra não mexer nas chamadas que já passam ele; as casas decimais não são
// mais escolha de quem chama — valor SEMPRE sai com centavos (decisão do Luan, 03/09/2026).
function fmtMoney(v, mkt = market) { return CocoMoeda.fmt(v, mkt); }

// ── State ─────────────────────────────────────────────────
let market = localStorage.getItem('coco_market') || 'br';
let current = null;            // último payload da API
const miniCharts = {};
const EC_FONT_FAMILY = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif";
// ResizeObserver único cobre todos os mini-gráficos: o ECharts não se redimensiona sozinho.
// Reage tanto a resize de janela quanto a mudanças de layout do card.
const echartsRO = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(entries => {
  for (const entry of entries) {
    const inst = miniCharts[entry.target.id];
    if (inst && !inst.isDisposed()) inst.resize();
  }
}) : null;
function setEChart(id, option) {
  const dom = document.getElementById(id);
  if (!dom) return null;
  const prev = miniCharts[id];
  if (prev && !prev.isDisposed() && prev.getDom() !== dom) prev.dispose();
  const inst = (prev && !prev.isDisposed() && prev.getDom() === dom) ? prev : echarts.init(dom);
  if (inst !== prev) { miniCharts[id] = inst; echartsRO?.observe(dom); }
  inst.setOption(option, true);
  return inst;
}
const campCache = {}; // cache de campanhas por market|since|until

// Dado diário de gasto/receita por canal costuma ser bem espinhoso (dia sem campanha ativa = 0,
// vizinho de um pico) — em barra fica "estranho" com pouco espaço entre elas. Linha suavizada com
// área em degradê (mesmo tratamento da Tendência na Visão geral) lê melhor esse tipo de série.
let campChartType = localStorage.getItem('coco_camp_charttype') || 'bar';
function setCampChartType(t) {
  campChartType = t;
  localStorage.setItem('coco_camp_charttype', t);
  document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === t));
  if (current) render();
}
// hexToRgba vive em js/colors.js, junto dos outros utilitários de cor.
const hexToRgba = (hex, a) => CocoColors.hexToRgba(hex, a);
function areaGradient(color) {
  return { type:'linear', x:0, y:0, x2:0, y2:1, colorStops:[
    { offset:0, color:hexToRgba(color, 0.28) },
    { offset:1, color:hexToRgba(color, 0) },
  ] };
}
// Monta a série do mini-gráfico conforme o tipo escolhido (barra x linha) — reaproveitado por
// drawMini() e pelo card do Google Ads.
function miniSeries(data, color, hoverColor) {
  return campChartType === 'line'
    ? { type:'line', data, smooth:.3, symbol:'circle', symbolSize:4, lineStyle:{ color, width:2 }, itemStyle:{ color }, areaStyle:{ color:areaGradient(color) } }
    : { type:'bar', data, barMaxWidth:22, itemStyle:{ color, borderRadius:[3,3,0,0] }, emphasis:{ itemStyle:{ color:hoverColor||color } } };
}

function rangeForPreset(p) {
  const today = new Date(); const iso = d => d.toISOString().slice(0, 10);
  if (p === 'today') return { since: iso(today), until: iso(today), label: 'Hoje' };
  if (p === '7d')   { const s = new Date(today); s.setDate(s.getDate() - 6); return { since: iso(s), until: iso(today), label: '7 dias' }; }
  if (p === 'month'){ const s = new Date(today.getFullYear(), today.getMonth(), 1); return { since: iso(s), until: iso(today), label: 'Este mês' }; }
  const s = new Date(today); s.setDate(s.getDate() - 29); return { since: iso(s), until: iso(today), label: '30 dias' };
}
let state = rangeForPreset('30d');

// ── Refresh interval ──
let refreshMin = Number(localStorage.getItem('coco_refresh') ?? 5);
let refreshTimer = null;
function applyRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (refreshMin > 0) refreshTimer = setInterval(load, refreshMin * 60 * 1000);
}

// ── Market ────────────────────────────────────────────────
function setMarket(m) {
  market = m;
  localStorage.setItem('coco_market', m);
  document.getElementById('mktBtnBr').classList.toggle('active', m === 'br');
  document.getElementById('mktBtnUs').classList.toggle('active', m === 'us');
  document.body.classList.toggle('market-us', m === 'us');
  load();
}

// ── Period picker ─────────────────────────────────────────
function togglePeriodPop() {
  document.getElementById('periodPop').classList.toggle('open');
  document.getElementById('periodPill').classList.toggle('open');
}
function selectPreset(btn, label) {
  document.querySelectorAll('.pp-presets button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state = rangeForPreset(btn.dataset.preset);
  document.getElementById('periodValue').textContent = label;
  document.getElementById('periodPop').classList.remove('open');
  document.getElementById('periodPill').classList.remove('open');
  load();
}
function applyRange() {
  const from = document.getElementById('dateFrom').value;
  const to = document.getElementById('dateTo').value;
  const err = document.getElementById('ppErr');
  if (!from || !to) { err.textContent = 'Preencha as duas datas'; return; }
  if (from > to) { err.textContent = 'A data inicial deve ser anterior à final'; return; }
  err.textContent = '';
  state = { since: from, until: to, label: CocoPeriodo.rotulo(from, to) };
  document.getElementById('periodValue').textContent = state.label;
  document.getElementById('periodPop').classList.remove('open');
  document.getElementById('periodPill').classList.remove('open');
  load();
}
document.addEventListener('click', e => {
  const wrap = document.getElementById('periodWrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('periodPop').classList.remove('open');
    document.getElementById('periodPill').classList.remove('open');
  }
});

// ── Carregamento ──────────────────────────────────────────
async function load() {
  try {
    const r = await fetch(`/api/dashboard?market=${market}&since=${state.since}&until=${state.until}&metric=receita`);
    current = await r.json();
  } catch (e) { console.warn('Campanhas: falha ao carregar', e); return; }
  render();
}

const setText  = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };

// ── Card padrão dos canais ──────────────────────────────────
// Um único template para os 6 canais de campanha em vez de blocos de HTML repetidos com rótulos e
// ordem de coluna diferentes entre si (era a causa dos cards "mostrarem a mesma informação com
// texto diferente"). As 3 colunas de KPI são sempre, nesta ordem: Gasto Ads → receita → ROAS.
// Nenhum valor começa com número de exemplo no HTML — tudo nasce em "—" e só é preenchido pelo
// render(), então não existe mais texto fixo que não venha da API.
const CAMP_CHANNELS = [
  { key: 'ml',        mkt: 'br', logo: 'img/canais/logo_mercadolivre.png', logoFill: true, name: 'Mercado Livre', type: 'ML Product Ads' },
  { key: 'meta_br',   mkt: 'br', logo: 'img/canais/logo_meta.png',                        name: 'Meta Ads',       type: 'Instagram · Facebook' },
  { key: 'amazon_br', mkt: 'br', logo: 'img/canais/logo_amazon.webp',                     name: 'Amazon BR',      type: 'Amazon Ads' },
  { key: 'meta_us',   mkt: 'us', logo: 'img/canais/logo_meta.png',                        name: 'Meta Ads',       type: 'Instagram · Facebook' },
  { key: 'google_us', mkt: 'us', logo: 'img/canais/logo_google_ads.webp',                 name: 'Google Ads',     type: 'Pesquisa · Display' },
  { key: 'amazon',    mkt: 'us', logo: 'img/canais/logo_amazon.webp',                     name: 'Amazon EUA',     type: 'Sponsored Products' },
];

function campCardTemplate(cfg) {
  const chClass = cfg.mkt === 'br' ? 'ch-br' : 'ch-us';
  const logoClass = 'camp-logo camp-logo-img' + (cfg.logoFill ? ' camp-logo-fill' : '');
  return `
  <div class="camp-card ${chClass}" id="card-${cfg.key}">
    <div class="camp-card-main">
      <div class="camp-ch-id">
        <div class="${logoClass}"><img src="${cfg.logo}" alt="${cfg.name}"></div>
        <div>
          <div class="camp-ch-name">${cfg.name}</div>
          <div class="camp-ch-type">${cfg.type}</div>
        </div>
      </div>
      <div class="camp-kpi-col">
        <div class="camp-kpi-label">Gasto Ads</div>
        <div class="camp-kpi-val" id="${cfg.key}-spend">—</div>
        <div class="camp-kpi-sub" id="${cfg.key}-spend-sub">—</div>
      </div>
      <div class="camp-kpi-col">
        <div class="camp-kpi-label" id="${cfg.key}-rev-label">Faturamento total</div>
        <div class="camp-kpi-val" id="${cfg.key}-revenue">—</div>
        <div class="camp-kpi-sub" id="${cfg.key}-rev-sub">—</div>
      </div>
      <div class="camp-kpi-col">
        <div class="camp-kpi-label">ROAS</div>
        <div class="camp-kpi-val" id="${cfg.key}-roas">—</div>
        <div class="camp-kpi-sub" id="${cfg.key}-roas-sub">retorno sobre gasto</div>
      </div>
      <div class="camp-chart-col">
        <div class="camp-chart-label">
          <span class="camp-chart-label-txt">Receita / dia</span>
          <div class="camp-mini-legend"></div>
        </div>
        <div class="camp-mini-canvas-wrap" id="mini-${cfg.key}"></div>
      </div>
      <div class="camp-expand-col">
        <button class="camp-expand-btn" id="btn-${cfg.key}" onclick="toggleExpand('${cfg.key}')">
          <i class="bi bi-chevron-down"></i> Campanhas
        </button>
      </div>
    </div>
    <div class="camp-expand-panel" id="expand-${cfg.key}">
      <div class="camp-expand-inner">
        <div class="camp-expand-head">
          <div class="camp-expand-title">Campanhas no período</div>
        </div>
        <div class="camp-campaigns" id="camps-${cfg.key}"></div>
      </div>
    </div>
  </div>`;
}
function buildCampGrid() {
  document.getElementById('campGrid').innerHTML = CAMP_CHANNELS.map(campCardTemplate).join('');
}

// ── Render ────────────────────────────────────────────────
async function render() {
  const d = current; if (!d) return;
  const k = d.kpis || {}, ml = d.mlBreakdown || {}, cs = d.channelSplit || {};
  const labels = d.trend?.labels || [], tb = d.trend?.byChannel || [];
  const updated = d.updatedAt ? new Date(d.updatedAt).toLocaleString('pt-BR') : '—';
  // "Ao vivo · HH:MM" — mesmo padrão amigável já usado em index.html/geografia*/segmentos.html; aqui
  // ainda era "sync: DD/MM/AAAA, HH:MM:SS", cru demais pro cabeçalho.
  const updatedDate = d.updatedAt ? new Date(d.updatedAt) : null;
  setText('lastUpdate', updatedDate ? `Ao vivo · ${String(updatedDate.getHours()).padStart(2,'0')}:${String(updatedDate.getMinutes()).padStart(2,'0')}` : 'Sem sincronização ainda');
  setText('pageSub', 'Vita Pet Life · ' + state.label);
  setText('footerDate', `Vita Pet Life · período ${state.label} · última sincronização: ${updated}`);

  // Gasto/vendas/cliques por canal de Ads vêm SEMPRE de /api/campaigns (a mesma fonte ao vivo,
  // filtrada pelo período certo, que já alimenta os cards de campanha individuais logo abaixo) —
  // nunca mais de /api/dashboard pra essa tela. Antes, o card do Mercado Livre e o "Gasto Total"
  // geral liam mlBreakdown.adCost, um valor ÚNICO gravado pelo sync periódico numa janela fixa de
  // 60 dias (mesmo bug já corrigido pro dashboard principal com kv.mlAdCostsDaily, ver sync.js/
  // metrics.js/CLAUDE.md) — por isso o "Gasto Ads" do ML nunca mudava com o período escolhido na
  // tela, e o card resumo (ex: R$2.588) não batia com a soma das campanhas
  // mostradas embaixo dele (ex: R$290). O Meta tinha uma incoerência parecida, de origem diferente:
  // "Vendas atribuídas" vinha de kpis.metaRevenue (atribuição por origem do pedido no Shopify —
  // ver CLAUDE.md 4.4), um número bem menor que a soma da "Receita" que a própria Meta reporta
  // campanha a campanha (action_values) — duas metodologias diferentes lado a lado, sem nenhuma
  // explicação na tela. Buscando gasto E vendas sempre da mesma lista de campanhas já exibida, o
  // resumo do canal nunca pode divergir do que está listado embaixo — por construção. Os campos
  // kpis.adCost/metaRevenue/mlBreakdown.adCost continuam existindo em /api/dashboard e alimentando
  // o dashboard principal (index.html: ROAS/ACOS do topo e o toggle "Incluir Mercado Ads") — não
  // foram tocados, essa mudança é só desta tela.
  let camps = null;
  try { camps = await loadCampaigns(); } catch (e) { /* cards de canal ficam em estado indisponível */ }
  const sumField = (arr, f) => (arr || []).reduce((a, c) => a + (c[f] || 0), 0);
  const metaCamps    = camps?.channels?.meta;
  const mlCamps       = market === 'br' ? camps?.channels?.mercadolivre : null;
  const googleCamps   = market === 'us' ? camps?.channels?.google       : null;

  const metaAvail  = !!metaCamps?.available;
  const metaSpend  = sumField(metaCamps?.campaigns, 'spend');
  const metaRev    = sumField(metaCamps?.campaigns, 'revenue');
  const metaClicks = sumField(metaCamps?.campaigns, 'clicks');
  const metaRoas   = metaSpend > 0 ? metaRev / metaSpend : 0;

  const mlAvail          = !!mlCamps?.available;
  const mlSpend          = sumField(mlCamps?.campaigns, 'spend');
  const mlClicks         = sumField(mlCamps?.campaigns, 'clicks');
  // Faturamento total do canal ML (todas as vendas, não só as atribuídas a Ads) — vem do
  // /api/dashboard normalmente, já período-correto (soma de pedidos reais, sem mudança aqui).
  const mlChannelRevenue = cs.mercadolivre || 0;
  const mlRoas           = mlSpend > 0 ? mlChannelRevenue / mlSpend : 0;
  // "ML Destaque" continua vindo de mlBreakdown.premium (pedido com listagem paga/Destaque, tag do
  // próprio pedido) — metodologia deliberadamente diferente de Ads, documentada em CLAUDE.md 4.11,
  // não mexida nesta correção.
  const mlPremiumRev = market === 'br' ? (ml.premium || 0) : 0;

  const googleSpend   = sumField(googleCamps?.campaigns, 'spend');
  const googleRevenue = sumField(googleCamps?.campaigns, 'revenue');

  const gastoGeral       = metaSpend + mlSpend + googleSpend;
  const vendasGeral      = metaRev + mlPremiumRev + googleRevenue;
  const faturamentoGeral = k.revenue || 0;

  // ── KPI strip (geral = soma de todos os canais de ads ativos no mercado atual) ──
  // Subtexto objetivo em vez de listar os nomes dos canais que contribuíram (ex: "Meta + Mercado
  // Ads") — a lista de canais muda dependendo de quem tem gasto/venda no período, então virava um
  // texto genérico e um pouco confuso; os cards de canal logo abaixo já mostram a quebra de verdade.
  setText('kpiSpend', fmtMoney(gastoGeral));
  setText('kpiSpendSub', gastoGeral > 0 ? 'de todos os canais' : 'sem gasto no período');
  setText('kpiOrders', fmtInt(k.orders || 0));
  setText('kpiSales', fmtMoney(vendasGeral));
  setText('kpiSalesSub', vendasGeral > 0 ? 'de todos os canais' : 'sem vendas atribuídas no período');
  setText('kpiRevenue', fmtMoney(faturamentoGeral));
  setText('kpiRoas', gastoGeral > 0 ? (vendasGeral / gastoGeral).toFixed(2).replace('.', ',') + '×' : '—');

  // ── Meta (BR/US) ── canal só de Ads, não tem "faturamento próprio": a receita mostrada é sempre
  // a atribuída às campanhas, nunca um total de vendas do canal (Meta não vende nada sozinho).
  const metaKey = market === 'br' ? 'meta_br' : 'meta_us';
  setText(`${metaKey}-spend`, metaAvail ? fmtMoney(metaSpend) : '—');
  setText(`${metaKey}-spend-sub`, metaAvail ? `${fmtInt(metaClicks)} cliques` : 'Meta Ads não conectado');
  setText(`${metaKey}-rev-label`, 'Vendas atribuídas');
  setText(`${metaKey}-revenue`, metaAvail ? fmtMoney(metaRev) : '—');
  setText(`${metaKey}-rev-sub`, 'receita das campanhas no período');
  setText(`${metaKey}-roas`, metaAvail && metaRoas > 0 ? metaRoas.toFixed(1).replace('.', ',') + '×' : '—');
  setText(`${metaKey}-roas-sub`, metaAvail ? 'vendas atribuídas ÷ gasto' : 'retorno sobre gasto');

  if (market === 'br') {
    // ── Mercado Livre ── canal de vendas de verdade: "Faturamento total" é a receita do canal
    // inteiro (todos os pedidos), não só a atribuída a Ads.
    setText('ml-spend', mlAvail ? fmtMoney(mlSpend) : '—');
    setText('ml-spend-sub', mlAvail ? `${fmtInt(mlClicks)} cliques` : 'Mercado Ads não conectado');
    setText('ml-rev-label', 'Faturamento total');
    setText('ml-revenue', fmtMoney(mlChannelRevenue));
    setText('ml-rev-sub', 'receita total do canal');
    setText('ml-roas', mlAvail && mlRoas > 0 ? mlRoas.toFixed(1).replace('.', ',') + '×' : '—');
    setText('ml-roas-sub', mlAvail ? 'receita total ÷ gasto' : 'reautorize com escopo de Ads');
    // ── Amazon BR ── sem API de Ads própria, mostra só o faturamento real do canal.
    setText('amazon_br-spend', '—');
    setText('amazon_br-spend-sub', 'Ads indisponível via API');
    setText('amazon_br-rev-label', 'Faturamento total');
    setText('amazon_br-revenue', fmtMoney(cs.amazon || 0));
    setText('amazon_br-rev-sub', 'receita total do canal');
    setText('amazon_br-roas', '—');
    setText('amazon_br-roas-sub', 'requer Amazon Ads API');
  } else {
    // ── Amazon US ──
    setText('amazon-spend', '—');
    setText('amazon-spend-sub', 'Ads indisponível via API');
    setText('amazon-rev-label', 'Faturamento total');
    setText('amazon-revenue', fmtMoney(cs.amazon_us || 0));
    setText('amazon-rev-sub', 'receita total do canal');
    setText('amazon-roas', '—');
    setText('amazon-roas-sub', 'requer Amazon Ads API');
    // ── Google Ads (EUA) ──
    loadGoogleCard();
  }

  // ── Mini charts (séries reais) ──
  const metaSeries = d.trend?.metaSpendDaily || labels.map(() => 0);
  drawMini(metaKey, labels, metaSeries, '#1877F2', 'Gasto Meta / dia', 'Gasto');
  // Cor de canal sempre do catálogo (js/colors.js), nunca escrita aqui: estes três gráficos
  // eram os últimos lugares onde o hex de um canal ficava solto numa página, e já discordavam
  // do resto do app — a Amazon BR era laranja aqui e preta em todas as outras telas.
  const corCanal = k => CocoColors.ch[k]?.bg || '#888';
  if (market === 'br') {
    drawMini('ml',        labels, tb.map(b => b.mercadolivre || 0), corCanal('mercadolivre'), 'Receita / dia', 'Receita');
    drawMini('amazon_br', labels, tb.map(b => b.amazon       || 0), corCanal('amazon'),       'Receita / dia', 'Receita');
  } else {
    drawMini('amazon', labels, tb.map(b => b.amazon_us || 0), corCanal('amazon_us'), 'Receita / dia', 'Receita');
  }

  // re-renderiza painéis de campanha abertos (mercado/período mudou)
  CAMP_CHANNELS.forEach(({ key }) => {
    if (document.getElementById('expand-' + key)?.dataset.open === '1') renderCampaigns(key);
  });
}

// ── Google Ads (EUA) — card próprio, alimentado por /api/campaigns ──
// Assim como Meta, é canal só de Ads: a receita é sempre a atribuída às campanhas.
async function loadGoogleCard() {
  // Gráfico do Google é gasto por campanha (barras nomeadas), não uma série diária, então não
  // passa por drawMini/setCardHeader como os outros cards — o rótulo é fixado aqui.
  const chartLabel = document.querySelector('#card-google_us .camp-chart-label-txt');
  if (chartLabel) chartLabel.textContent = 'Gasto por campanha';
  setText('google_us-rev-label', 'Vendas atribuídas');
  setText('google_us-spend-sub', 'carregando…');
  let data;
  try { data = await loadCampaigns(); }
  catch (e) { setText('google_us-spend-sub', 'falha ao carregar'); return; }

  const g = data.channels?.google;
  if (!g?.available) {
    setText('google_us-spend', '—');
    setText('google_us-spend-sub', 'Google Ads não conectado');
    setText('google_us-revenue', '—');
    setText('google_us-rev-sub', 'receita das campanhas no período');
    setText('google_us-roas', '—');
    setText('google_us-roas-sub', 'retorno sobre gasto');
    return;
  }

  const camps = g.campaigns || [];
  const spend   = camps.reduce((s, c) => s + (c.spend   || 0), 0);
  const revenue = camps.reduce((s, c) => s + (c.revenue || 0), 0);
  const clicks  = camps.reduce((s, c) => s + (c.clicks  || 0), 0);
  const roas    = spend > 0 ? revenue / spend : 0;

  setText('google_us-spend', fmtMoney(spend));
  setText('google_us-spend-sub', camps.length ? `${fmtInt(clicks)} cliques` : 'sem campanhas no período');
  setText('google_us-revenue', fmtMoney(revenue));
  setText('google_us-rev-sub', 'receita das campanhas no período');
  setText('google_us-roas', roas > 0 ? roas.toFixed(1).replace('.', ',') + '×' : '—');
  setText('google_us-roas-sub', 'vendas atribuídas ÷ gasto');

  if (!document.getElementById('mini-google_us')) return;
  const labels = camps.map(c => (c.name.length > 14 ? c.name.slice(0, 14) + '…' : c.name));
  setEChart('mini-google_us', {
    grid: { left:0, right:0, top:2, bottom:0 },
    xAxis: { type:'category', data:labels, show:false, boundaryGap: campChartType !== 'line' },
    yAxis: { type:'value', show:false },
    tooltip: { trigger:'axis', axisPointer: campChartType === 'line' ? { type:'line', lineStyle:{ color:'rgba(30,28,24,0.15)' } } : { type:'shadow', shadowStyle:{ color:'rgba(30,28,24,0.05)' } },
      backgroundColor:'#faf8f4', borderColor:'rgba(30,28,24,0.12)', borderWidth:1, padding:10,
      extraCssText:'border-radius:8px;box-shadow:0 8px 20px rgba(30,28,24,.14);', appendToBody:true, confine:true,
      textStyle:{ fontFamily:EC_FONT_FAMILY, fontSize:11 },
      formatter: params => params.length ? `${params[0].axisValueLabel}<br>${params[0].marker} ${fmtMoney(params[0].value)}` : '' },
    series: [miniSeries(camps.map(c => c.spend || 0), '#4285F4', '#5b95f5')],
  });
}

// ── Mini charts ───────────────────────────────────────────
function setCardHeader(key, headerTxt, color, legendTxt) {
  const card = document.getElementById('card-' + key); if (!card) return;
  const h = card.querySelector('.camp-chart-label-txt'); if (h) h.textContent = headerTxt;
  const lg = card.querySelector('.camp-mini-legend');
  if (lg) lg.innerHTML = `<span class="camp-leg-item"><span class="camp-leg-sq" style="background:${color}"></span>${legendTxt}</span>`;
}
function drawMini(key, labels, data, color, headerTxt, legendTxt) {
  setCardHeader(key, headerTxt, color, legendTxt);
  if (!document.getElementById('mini-' + key)) return;
  setEChart('mini-' + key, {
    grid: { left:0, right:0, top:2, bottom:0 },
    xAxis: { type:'category', data:labels, show:false, boundaryGap: campChartType !== 'line' },
    yAxis: { type:'value', show:false },
    tooltip: { trigger:'axis', axisPointer: campChartType === 'line' ? { type:'line', lineStyle:{ color:'rgba(30,28,24,0.15)' } } : { type:'shadow', shadowStyle:{ color:'rgba(30,28,24,0.05)' } },
      backgroundColor:'#faf8f4', borderColor:'rgba(30,28,24,0.12)', borderWidth:1, padding:10,
      extraCssText:'border-radius:8px;box-shadow:0 8px 20px rgba(30,28,24,.14);', appendToBody:true, confine:true,
      textStyle:{ fontFamily:EC_FONT_FAMILY, fontSize:11 },
      // key===valor monetário em todo card de canal (Gasto Meta, Receita ML/Amazon) — sempre com
      // R$/US$ no tooltip, nunca número cru.
      formatter: params => params.length ? `${params[0].axisValueLabel}<br>${params[0].marker} ${fmtMoney(params[0].value)}` : '' },
    series: [miniSeries(data, color)],
  });
}

// ── Cards de campanha (painel "Gastos") ───────────────────
const CH_OF_KEY = { ml:'mercadolivre', meta_br:'meta', meta_us:'meta', amazon_br:null, amazon:null, google_us:'google' };

async function loadCampaigns() {
  const ck = `${market}|${state.since}|${state.until}`;
  if (campCache[ck]) return campCache[ck];
  const r = await fetch(`/api/campaigns?market=${market}&since=${state.since}&until=${state.until}`);
  const data = await r.json();
  campCache[ck] = data;
  return data;
}

// escapeHtml agora vem de sidebar.js (window.escapeHtml, carregado antes deste script) —
// definição local removida porque colidia com a global (SyntaxError: identificador já
// declarado, já que scripts clássicos no mesmo documento compartilham o mesmo escopo léxico
// de top-level para const/function). Comportamento idêntico (a global também escapa aspas
// simples, um superconjunto seguro do que já era feito aqui).
const pct = (v, dec = 1) => (v || 0).toFixed(dec).replace('.', ',') + '%';

function campaignCardHTML(c, chKey) {
  const money = v => fmtMoney(v, market);
  const roas = c.roas > 0 ? c.roas.toFixed(2).replace('.', ',') + '×' : '—';
  const m = [['Gasto', money(c.spend)]];
  if (chKey === 'meta') {
    m.push(['Receita', money(c.revenue), c.revenue > 0], ['ROAS', roas, c.roas >= 1], ['Pedidos', fmtInt(c.orders)],
           ['Cliques', fmtInt(c.clicks)], ['Impressões', fmtInt(c.impressions)], ['Alcance', fmtInt(c.reach)],
           ['CTR', pct(c.ctr, 2)], ['CPC', money(c.cpc)]);
  } else if (chKey === 'google') {
    m.push(['Vendas', money(c.revenue), c.revenue > 0], ['ROAS', roas, c.roas >= 1], ['Conversões', fmtInt(c.orders)],
           ['Cliques', fmtInt(c.clicks)], ['Impressões', fmtInt(c.impressions)], ['CTR', pct(c.ctr, 2)]);
  } else {
    m.push(['Vendas', money(c.revenue), c.revenue > 0], ['ROAS', roas, c.roas >= 1], ['Unidades', fmtInt(c.orders)],
           ['Cliques', fmtInt(c.clicks)], ['Impressões', fmtInt(c.impressions)], ['ACOS', pct(c.acos)], ['CTR', pct(c.ctr, 2)]);
  }
  const st = c.status ? `<span class="cmp-status ${/activ|enabl|^on$/i.test(c.status) ? 'on' : 'off'}">${escapeHtml(c.status)}</span>` : '';
  return `<div class="cmp-card">
    <div class="cmp-head"><span class="cmp-name">${escapeHtml(c.name)}</span>${st}</div>
    <div class="cmp-metrics">${m.map(([l, v, pos]) => `<div class="cmp-metric"><span class="cmp-m-label">${l}</span><span class="cmp-m-val${pos ? ' pos' : ''}">${v}</span></div>`).join('')}</div>
  </div>`;
}

async function renderCampaigns(key) {
  const box = document.getElementById('camps-' + key); if (!box) return;
  const card = document.getElementById('card-' + key);
  const title = card?.querySelector('.camp-expand-title');
  if (title) title.textContent = 'Campanhas no período';
  const chKey = CH_OF_KEY[key];
  if (!chKey) { box.innerHTML = `<div class="cmp-empty">Este canal não expõe campanhas via API (gasto não disponível).</div>`; return; }

  box.innerHTML = `<div class="cmp-loading">${pageLoaderHtml()}</div>`;
  let data;
  try { data = await loadCampaigns(); }
  catch (e) { box.innerHTML = `<div class="cmp-empty">Falha ao carregar campanhas.</div>`; return; }

  const ch = data.channels?.[chKey];
  if (!ch?.available) { box.innerHTML = `<div class="cmp-empty">Canal de Ads não conectado.</div>`; return; }
  const camps = ch.campaigns || [];
  if (camps.length === 0) { box.innerHTML = `<div class="cmp-empty">Nenhuma campanha com atividade no período.</div>`; return; }
  box.innerHTML = camps.map(c => campaignCardHTML(c, chKey)).join('');
}

// ── Expand toggle ─────────────────────────────────────────
function toggleExpand(key) {
  const panel = document.getElementById(`expand-${key}`);
  const btn   = document.getElementById(`btn-${key}`);
  const isOpen = panel.dataset.open === '1';

  if (isOpen) {
    panel.dataset.open = '0';
    btn.classList.remove('open');
    panel.classList.remove('anim-open');
    panel.classList.add('anim-close');
    panel.addEventListener('animationend', () => {
      panel.style.display = 'none';
      panel.classList.remove('anim-close');
    }, { once: true });
  } else {
    panel.dataset.open = '1';
    panel.style.display = 'block';
    panel.classList.remove('anim-close');
    panel.offsetHeight; // força reflow antes da animação
    panel.classList.add('anim-open');
    btn.classList.add('open');
    renderCampaigns(key);
  }
}

// ── Refresh dropdown ───────────────────────────────────────
document.getElementById('cselRefresh').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('cselRefresh').classList.toggle('open');
});
document.querySelectorAll('#cselRefresh .csel-opt').forEach(opt => {
  opt.addEventListener('click', e => {
    e.stopPropagation();
    refreshMin = Number(opt.dataset.value);
    localStorage.setItem('coco_refresh', refreshMin);
    document.getElementById('refreshVal').textContent = refreshMin === 0 ? 'Desligar' : `${refreshMin} min`;
    document.querySelectorAll('#cselRefresh .csel-opt').forEach(o => o.classList.toggle('active', Number(o.dataset.value) === refreshMin));
    document.getElementById('cselRefresh').classList.remove('open');
    applyRefresh();
  });
});
document.addEventListener('click', () => document.getElementById('cselRefresh')?.classList.remove('open'));

// ── Sincronizar agora ──────────────────────────────────────
document.getElementById('syncBtn').addEventListener('click', async () => {
  try { await fetch('/api/sync', { method: 'POST' }); } catch (e) {}
  load();
});

// ── Painel de configurações (cores) ────────────────────────
function buildSettingsPanel() {
  CocoColors.buildSection('sp-ch-colors', CocoColors.DEFAULT_CH, 'ch', k => CocoColors.ch[k].bg, (k, v) => {
    CocoColors.setChannelColor(k, v);
  });
  CocoColors.buildSection('sp-mkt-colors', CocoColors.DEFAULT_MKT, 'mkt', k => CocoColors.mkt[k], (k, v) => {
    CocoColors.mkt[k] = v;
    CocoColors.save(`mkt.${k}`, v);
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
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });
document.getElementById('spReset').addEventListener('click', () => {
  CocoColors.resetAll();
  buildSettingsPanel();
});

// ── Init ─────────────────────────────────────────────────
(function init(){
  buildCampGrid();
  document.getElementById('mktBtnBr').classList.toggle('active', market === 'br');
  document.getElementById('mktBtnUs').classList.toggle('active', market === 'us');
  document.body.classList.toggle('market-us', market === 'us');
  document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === campChartType));
  document.getElementById('refreshVal').textContent = refreshMin === 0 ? 'Desligar' : `${refreshMin} min`;
  document.querySelectorAll('#cselRefresh .csel-opt').forEach(o => o.classList.toggle('active', Number(o.dataset.value) === refreshMin));
  applyRefresh();
  load();
})();
