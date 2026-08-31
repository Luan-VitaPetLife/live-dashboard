// ── Utils ──
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const isoLocal = d => { const z = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; };
const todayISO = isoLocal(new Date());

let market = localStorage.getItem('coco_market') || 'br';
let sinceDate = localStorage.getItem('coco_since') || isoLocal(addDays(new Date(),-29));
let untilDate = localStorage.getItem('coco_until') || todayISO;

// Canal — dropdown por mercado (mesmos canais do dashboard principal). O backend já
// filtra os segmentos pelo parâmetro `channel` do /api/dashboard.
// Nome e ordem dos canais vêm do catálogo único (js/colors.js), que esta página já carrega
// no <head> por causa das cores de segmento.
let channel = 'todos';
// Estado de expansão dos "top produtos" por segmento (ver mais / ver menos).
const segExpanded = { cat:false, dog:false, other:false, hidden:false };
// Quais grupos de tipo (Areia/Suplementos) estão abertos, por card ('cat'/'dog'/'other') — um
// Set por card. Preenchido preguiçosamente na 1ª renderização com só o maior grupo aberto (mesmo
// princípio de "só o primeiro aberto" já usado em Produtos/Estoque).
const segTypeOpen = {};
let lastSegs = {};

// ── Formatters ──
function fmtMoney(v) {
  if (market === 'us') return '$' + v.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  return v.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
}
function rangeLabel(s, u) { return CocoPeriodo.rotulo(s, u, { hoje: todayISO }); }

// ── Live indicator ──
function setLive(state, msg) {
  const dot = document.getElementById('liveDot');
  document.getElementById('lastUpdate').textContent = msg;
  dot.className = 'ldot' + (state==='loading'?' loading': state==='error'?' error':'');
}

// ── Chart ──
const EC_FONT_FAMILY = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif";
const echartsInst = {};
// ResizeObserver único cobre todos os gráficos: o ECharts não se redimensiona sozinho.
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
  // O anel de Distribuição fica fixo, mas a barra de Geografia recria o <div> via innerHTML toda
  // vez que o painel de produto reabre — a instância antiga fica órfã (dom desconectado) e precisa
  // ser descartada antes de montar uma nova.
  if (prev && !prev.isDisposed() && prev.getDom() !== dom) prev.dispose();
  const inst = (prev && !prev.isDisposed() && prev.getDom() === dom) ? prev : echarts.init(dom);
  if (inst !== prev) { echartsInst[id] = inst; echartsRO?.observe(dom); }
  inst.setOption(option, true);
  return inst;
}

// Cor e rótulo dos segmentos vêm de colors.js (CocoColors.seg) — mesma fonte das variáveis
// CSS --cat/--dog/--other. As cores são as dos mascotes: Luna (gata) #ff002b, Coco (cachorro)
// #0849e9. O fallback existe só pra página não quebrar caso colors.js falhe em carregar.
const SEG_COLORS = Object.fromEntries(
  ['cat','dog','other'].map(k => [k, window.CocoColors?.seg?.[k]?.bg || '#9c9790']));
const SEG_LABELS = Object.fromEntries(
  ['cat','dog','other'].map(k => [k, window.CocoColors?.seg?.[k]?.label || k]));
// Mascote de cada segmento, usado no cabeçalho do card (Segmentos) — 'other' não tem mascote.
const SEG_MASCOTE = { cat:'img/mascotes/luna.svg', dog:'img/mascotes/coco.svg' };

function renderChart(segs) {
  const keys = ['cat','dog'].filter(k => segs[k]?.units > 0);
  if (segs.other?.units > 0) keys.push('other');
  const data  = keys.map(k => segs[k].units);
  const colors = keys.map(k => SEG_COLORS[k]);
  const labels = keys.map(k => SEG_LABELS[k]);
  // raio máximo em 92% (não 100%) pra sobrar espaço pro "grow" do hover (emphasis.scaleSize) sem
  // ser cortado pelo limite do canvas — mesmo ajuste feito no anel de Canais da Visão geral.
  setEChart('segChart', {
    tooltip: { trigger:'item', backgroundColor:'#faf8f4', borderColor:'rgba(30,28,24,0.12)', borderWidth:1,
      padding:12, extraCssText:'border-radius:8px;box-shadow:0 8px 20px rgba(30,28,24,.14);', appendToBody:true, confine:true,
      textStyle:{ fontFamily:EC_FONT_FAMILY, fontSize:11 },
      formatter: p => `${p.marker} ${p.name}: ${p.value.toLocaleString('pt-BR')} un (${p.percent.toFixed(1)}%)` },
    series: [{
      type:'pie', radius:['68%','92%'], avoidLabelOverlap:false, padAngle:2,
      itemStyle:{ borderColor:'#faf8f4', borderWidth:2, borderRadius:4 },
      label:{ show:false }, labelLine:{ show:false },
      emphasis:{ scale:true, scaleSize:6 },
      data: data.map((v,i) => ({ value:v, name:labels[i], itemStyle:{ color:colors[i] } })),
    }],
  });
}

function renderLegend(segs) {
  const total = (segs.cat?.units||0) + (segs.dog?.units||0) + (segs.other?.units||0);
  document.getElementById('totalUnits').textContent = total.toLocaleString('pt-BR');
  const keys = ['cat','dog'];
  if (segs.other?.units > 0) keys.push('other');
  document.getElementById('segLegend').innerHTML = keys.map(k => {
    const s = segs[k] || { units:0, pct:0 };
    return `<div class="seg-legend-item">
      <div class="leg-dot" style="background:${SEG_COLORS[k]}"></div>
      <span class="leg-name">${SEG_LABELS[k]}</span>
      <span class="leg-pct">${(s.pct*100).toFixed(1)}%</span>
      <span class="leg-units">${s.units.toLocaleString('pt-BR')} un</span>
    </div>`;
  }).join('');
}

const TYPE_ORDER = ['Soft Chews','Tablets','Powder','Pó','Liquid'];

function comboBits(p) {
  if (!p.comboQty) return '';
  const parts = Object.entries(p.comboBySize||{})
    .sort((a,b)=>Number(a[0])-Number(b[0]))
    .map(([size,n])=>`${n} combo de ${size}`);
  return `${p.avulsoQty||0} avulso, ${parts.join(', ')}`;
}

// Item de produto (compartilhado entre os cards de segmento e o card "não classificados").
function prodItemHtml(p, i) {
  return `
        <div class="seg-prod-item">
          <span class="seg-prod-rank">${i+1}.</span>
          <div class="seg-prod-main">
            <div class="seg-prod-name" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</div>
            ${comboBits(p) ? `<div class="seg-prod-combo">${comboBits(p)}</div>` : ''}
          </div>
          <span class="seg-prod-qty">${p.qty.toLocaleString('pt-BR')} un</span>
          <span class="seg-prod-rev">${fmtMoney(p.revenue)}</span>
        </div>`;
}
// Lista com "ver mais": mostra 5 e expande para todos. `key` é uma chave única do grupo mostrado
// (ex: 'cat__Suplementos') — cada grupo de tipo tem seu próprio estado de "ver mais" independente.
function prodListHtml(products, key) {
  if (!products || products.length === 0) return '<div class="seg-empty">Sem produtos no período</div>';
  const exp = segExpanded[key];
  const shown = exp ? products : products.slice(0, 5);
  let html = shown.map(prodItemHtml).join('');
  if (products.length > 5) {
    const extra = products.length - 5;
    html += `<button class="seg-more" onclick="toggleSegExpand('${key}')">${exp ? 'Ver menos' : 'Ver mais (' + extra + ')'}</button>`;
  }
  return html;
}
function toggleSegExpand(key) {
  segExpanded[key] = !segExpanded[key];
  renderCards(lastSegs);
  renderOther(lastSegs);
  renderHidden(lastSegs);
}

// Separa os "top produtos" de um card em Areia x Suplementos (classifyTypeGroup no backend, ver
// metrics.js) — decisão de produto: mais organizado que uma lista só misturando os dois.
// `cardKey` é 'cat' | 'dog' | 'other'.
function prodByTypeGroupHtml(products, cardKey) {
  if (!products || !products.length) return '<div class="seg-empty">Sem produtos no período</div>';
  const buckets = {};
  products.forEach(p => {
    const g = p.typeGroup || 'Suplementos';
    (buckets[g] || (buckets[g] = [])).push(p);
  });
  const names = Object.keys(buckets).sort((a, b) =>
    buckets[b].reduce((s, p) => s + p.qty, 0) - buckets[a].reduce((s, p) => s + p.qty, 0));
  // Só o maior grupo aberto por padrão, na 1ª renderização do card — depois disso o usuário controla.
  if (!segTypeOpen[cardKey]) segTypeOpen[cardKey] = new Set(names.slice(0, 1));
  return names.map(name => {
    const items = buckets[name];
    const qty = items.reduce((s, p) => s + p.qty, 0);
    const revenue = items.reduce((s, p) => s + p.revenue, 0);
    const open = segTypeOpen[cardKey].has(name);
    const listKey = `${cardKey}__${name}`;
    return `
      <div class="seg-type-group${open ? ' open' : ''}">
        <button class="seg-type-toggle" onclick="toggleTypeGroup('${cardKey}', '${escJs(name)}')">
          <span class="seg-type-toggle-name">${escapeHtml(name)}</span>
          <span class="seg-type-toggle-stat">${items.length} produto${items.length===1?'':'s'} · ${fmtInt(qty)} un · ${fmtMoney(revenue)}</span>
          <span class="seg-type-toggle-chevron"><i class="bi bi-chevron-${open?'up':'down'}"></i></span>
        </button>
        ${open ? `<div class="seg-prod-list">${prodListHtml(items, listKey)}</div>` : ''}
      </div>`;
  }).join('');
}
function toggleTypeGroup(cardKey, name) {
  if (!segTypeOpen[cardKey]) segTypeOpen[cardKey] = new Set();
  if (segTypeOpen[cardKey].has(name)) segTypeOpen[cardKey].delete(name); else segTypeOpen[cardKey].add(name);
  renderCards(lastSegs);
  renderOther(lastSegs);
  renderHidden(lastSegs);
}
function escJs(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function fmtInt(n) { return Math.round(n || 0).toLocaleString('pt-BR'); }

function renderCards(segs) {
  const totalUnits = (segs.cat?.units||0) + (segs.dog?.units||0);
  const cards = ['cat','dog'].map(k => {
    const s = segs[k] || { revenue:0, units:0, orders:0, pct:0, byType:{}, topProducts:[] };
    const pctW = totalUnits > 0 ? Math.round(s.units / totalUnits * 100) : 0;

    const prods = prodByTypeGroupHtml(s.topProducts, k);

    const byType = s.byType || {};
    const typeEntries = [
      ...TYPE_ORDER.filter(t => byType[t]).map(t => [t, byType[t]]),
      ...Object.entries(byType).filter(([t]) => !TYPE_ORDER.includes(t)),
    ];
    const typesHtml = typeEntries.length > 0
      ? `<div class="seg-types-area">
          <div class="seg-types-title">Por tipo de produto</div>
          <div class="seg-types-list">
            ${typeEntries.map(([t,q]) => `
              <div class="seg-type-pill">
                <span class="seg-type-name">${t}</span>
                <span class="seg-type-qty">${q.toLocaleString('pt-BR')} un</span>
              </div>`).join('')}
          </div>
        </div>` : '';

    return `
      <div class="seg-card">
        <div class="seg-card-header">
          <div class="seg-card-accent ${k}"></div>
          <div class="seg-card-name">
            ${SEG_MASCOTE[k] ? `<img class="seg-card-mascote" src="${SEG_MASCOTE[k]}" alt="">` : ''}
            <span>${SEG_LABELS[k]}</span>
          </div>
          <div class="seg-kpis">
            <div class="seg-kpi">
              <div class="seg-kpi-val">${fmtMoney(s.revenue)}</div>
              <div class="seg-kpi-lbl">Receita</div>
            </div>
            <div class="seg-kpi">
              <div class="seg-kpi-val">${s.units.toLocaleString('pt-BR')}</div>
              <div class="seg-kpi-lbl">Unidades</div>
            </div>
            <div class="seg-kpi">
              <div class="seg-kpi-val">${s.orders.toLocaleString('pt-BR')}</div>
              <div class="seg-kpi-lbl">Pedidos</div>
            </div>
          </div>
          <div class="seg-pct-bar"><div class="seg-pct-fill ${k}" style="width:${pctW}%"></div></div>
        </div>
        <div class="seg-products-area">
          <div class="seg-prod-title">Top produtos · por unidades</div>
          <div class="seg-prod-list">${prods}</div>
        </div>
        ${typesHtml}
      </div>`;
  }).join('');
  document.getElementById('segCards').innerHTML = cards;
}

function renderOther(segs) {
  const other = segs.other;
  const card = document.getElementById('otherCard');
  if (!other || other.units === 0) { card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('otherList').innerHTML = prodByTypeGroupHtml(other.topProducts, 'other');
}

// Esconder/mostrar o card "Ocultos" inteiro (não confundir com o que ele mostra — isso só
// esconde o CARD, o produto continua oculto normalmente). Persistido, sobrevive a reload.
let hiddenCardCollapsed = localStorage.getItem('coco_seg_hiddencard_collapsed') === '1';
function applyHiddenCardCollapse() {
  document.getElementById('hiddenCardBody').style.display = hiddenCardCollapsed ? 'none' : '';
  document.getElementById('hiddenCollapseBtn').innerHTML = `<i class="bi bi-chevron-${hiddenCardCollapsed ? 'down' : 'up'}"></i>`;
}
function toggleHiddenCardCollapse() {
  hiddenCardCollapsed = !hiddenCardCollapsed;
  localStorage.setItem('coco_seg_hiddencard_collapsed', hiddenCardCollapsed ? '1' : '0');
  applyHiddenCardCollapse();
}
document.getElementById('hiddenCollapseBtn').addEventListener('click', toggleHiddenCardCollapse);

function renderHidden(segs) {
  const hidden = segs.hidden;
  const card = document.getElementById('hiddenCard');
  if (!hidden || hidden.units === 0) { card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('hiddenList').innerHTML = prodByTypeGroupHtml(hidden.topProducts, 'hidden');
  applyHiddenCardCollapse();
}

// ── Onde os produtos vendem (mapa + ranking por estado, por produto) ──

const MAP_BOUNDS = {
  br: { fit:[[-33.75,-73.99],[5.26,-28.84]], center:[-15,-52] },
  us: { fit:[[24,-125],[49.5,-66.5]], center:[38,-97] },
};


// Coordenadas pro modo Calor do modal ampliado (mesmas tabelas de geografia.html —
// ver drawModalHeat). CENTROIDS = posição da pill de rótulo; SUB_REGIONS = pontos onde as manchas de
// calor são desenhadas (1º ponto = centróide); estado sem entrada usa só o centróide como mancha única.
// Rampas de cor: interpolação em js/geo.js, as mesmas cores usadas na tela de Geografia.
const geoChoroColor = t => CocoGeo.heatColor(t, ['#e8e3d8', '#c49568', '#8c3a20']);
const geoHeatColor  = t => CocoGeo.heatColor(t);

// Devolve null em vez de propagar o erro: quem chama já trata mapa ausente, e uma falha de
// rede não pode derrubar o resto da tela de Segmentos.
async function loadGeoJSONFor(mkt) {
  try {
    return await CocoGeo.loadGeoJSON(mkt);
  } catch (e) {
    console.error('GeoJSON load failed:', e);
    return null;
  }
}

let lastProductGeo = [];
const geoExpanded = { cat:false, dog:false, other:false };
let openProduct = null;
let geoMapInst = null;
let geoModalMapInst = null;
let geoModalLayerInst = null;    // camada colorida do modal — trocada ao alternar Coroplético/Calor sem recriar o mapa/tile
let geoBarChartInst = null;
let geoModalMode = 'choropleth';                                                // não persistido — sempre abre em Coroplético
let geoViewMode = localStorage.getItem('coco_seg_geoview') || 'ranking';        // 'ranking' | 'table' | 'chart'
let geoMapHidden = localStorage.getItem('coco_seg_geohide') === '1';
let geoLayoutMode = localStorage.getItem('coco_seg_geolayout') || 'rows';       // 'rows' | 'columns'
let geoSearchQuery = '';                                                        // filtro por título, client-side (não persiste entre sessões)

// "Unificar" deixou de ser uma opção local desta tela: agora é global, gerenciado na tela
// Unificador (dentro de Configurações) e já aplicado pelo backend em `productGeo` quando ligado
// — ver metrics.js applyProductGroups. Aqui só exibimos o resultado (badge 🔗 nas linhas já
// agrupadas, ver geoProdRowHtml), sem toggle nem criação de grupo.
const GEO_CHART_MAX = 12; // nº de estados no modo Gráfico (o resto continua em Ranking/Tabela)

function destroyGeoMap() {
  if (geoMapInst) { try { geoMapInst.remove(); } catch(e) {} geoMapInst = null; }
}
function destroyGeoBarChart() {
  if (geoBarChartInst) { try { geoBarChartInst.dispose(); } catch(e) {} geoBarChartInst = null; }
}
function destroyGeoModalMap() {
  if (geoModalMapInst) { try { geoModalMapInst.remove(); } catch(e) {} geoModalMapInst = null; }
  geoModalLayerInst = null;
}

function stateLabel(uf) { return CocoGeo.STATE_NAMES[market][uf] || uf; }

// ── Faixa de estatísticas do produto expandido (pedido do Luan: mais informação por produto) ──
function geoStatsHtml(p) {
  const totalQty = p.qty || 1;
  const stats = [`<div class="geo-stat"><span class="geo-stat-lbl">Estados alcançados</span><span class="geo-stat-val">${p.byState.length}</span></div>`];
  if (p.byChannel.length) {
    const top = p.byChannel[0];
    stats.push(`<div class="geo-stat"><span class="geo-stat-lbl">Canal principal</span><span class="geo-stat-val">${CocoColors.chLabel(top.channel)} · ${(top.qty / totalQty * 100).toFixed(0)}%</span></div>`);
  }
  if (p.byState.length) {
    const top = p.byState[0];
    stats.push(`<div class="geo-stat"><span class="geo-stat-lbl">Maior estado</span><span class="geo-stat-val">${stateLabel(top.state)} · ${(top.qty / totalQty * 100).toFixed(0)}%</span></div>`);
  }
  return `<div class="geo-detail-stats">${stats.join('')}</div>`;
}

// ── Modo Ranking (lista de pills, como antes) ──
function geoRankingHtml(p) {
  const totalQty = p.qty || 1;
  if (!p.byState.length) return '<div class="geo-empty">Sem estado de entrega registrado</div>';
  return `<div class="geo-rank-list">${p.byState.map(s => `
      <div class="geo-rank-item">
        <span class="geo-rank-uf">${s.state}</span>
        <span class="geo-rank-name" title="${stateLabel(s.state)}">${stateLabel(s.state)}</span>
        <span class="geo-rank-qty">${s.qty.toLocaleString('pt-BR')} un</span>
        <span class="geo-rank-pct">${(s.qty / totalQty * 100).toFixed(1)}%</span>
      </div>`).join('')}</div>`;
}

// ── Modo Tabela ──
function geoTableHtml(p) {
  const totalQty = p.qty || 1;
  if (!p.byState.length) return '<div class="geo-empty">Sem estado de entrega registrado</div>';
  const rows = p.byState.map(s => `
      <tr>
        <td>${stateLabel(s.state)}</td>
        <td>${s.state}</td>
        <td class="num">${s.qty.toLocaleString('pt-BR')}</td>
        <td class="num">${fmtMoney(s.revenue)}</td>
        <td class="num">${(s.qty / totalQty * 100).toFixed(1)}%</td>
      </tr>`).join('');
  return `<table class="geo-table">
    <colgroup><col><col style="width:52px"><col style="width:84px"><col style="width:96px"><col style="width:56px"></colgroup>
    <thead><tr><th>Estado</th><th>UF</th><th class="num">Unidades</th><th class="num">Receita</th><th class="num">%</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Modo Gráfico (barra horizontal, ECharts já carregado nesta página) ──
function geoChartHtml(p) {
  if (!p.byState.length) return '<div class="geo-empty">Sem estado de entrega registrado</div>';
  return `<div class="geo-chart-wrap" id="geoBarChart"></div>`;
}
function geoRenderBarChart(p) {
  const dom = document.getElementById('geoBarChart');
  if (!dom) return;
  destroyGeoBarChart();
  const top = p.byState.slice(0, GEO_CHART_MAX);
  dom.style.height = Math.max(120, top.length * 26) + 'px';
  geoBarChartInst = echarts.init(dom);
  geoBarChartInst.setOption({
    grid: { left:8, right:8, top:8, bottom:8, containLabel:true },
    xAxis: { type:'value', axisLine:{show:false}, axisTick:{show:false}, splitLine:{lineStyle:{color:'rgba(30,28,24,.08)'}}, axisLabel:{ fontFamily:EC_FONT_FAMILY, fontSize:11, color:'#9c9790' } },
    yAxis: { type:'category', data: top.map(s => s.state), inverse:true, axisLine:{show:false}, axisTick:{show:false}, splitLine:{show:false}, axisLabel:{ fontFamily:EC_FONT_FAMILY, fontSize:11, color:'#9c9790' } },
    tooltip: { trigger:'item', backgroundColor:'#faf8f4', borderColor:'rgba(30,28,24,0.12)', borderWidth:1, padding:10,
      extraCssText:'border-radius:8px;box-shadow:0 8px 20px rgba(30,28,24,.14);', appendToBody:true, confine:true,
      textStyle:{ fontFamily:EC_FONT_FAMILY, fontSize:11 },
      formatter: tp => `${tp.marker} ${stateLabel(tp.name)}: ${tp.value.toLocaleString('pt-BR')} un` },
    series: [{ type:'bar', data: top.map(s => s.qty), barMaxWidth:18, itemStyle:{ color:'#c4793a', borderRadius:[0,4,4,0] }, emphasis:{ itemStyle:{ color:'#d6884a' } } }],
  });
}

// ── Painel expandido: toolbar (ver mapa/tabela/gráfico + esconder mapa) + estatísticas + corpo ──
function geoDetailHtml(p) {
  const showMap = !geoMapHidden;
  const mapHtml = showMap ? `
      <div class="geo-map" id="geoMap">
        <button class="geo-map-expand" id="geoMapExpandBtn" title="Ampliar mapa"><i class="bi bi-arrows-angle-expand"></i></button>
      </div>` : '';
  const dataHtml = geoViewMode === 'table' ? geoTableHtml(p) : geoViewMode === 'chart' ? geoChartHtml(p) : geoRankingHtml(p);
  const chanItems = p.byChannel.map(c => `
      <div class="geo-chan-pill"><span class="geo-chan-name">${CocoColors.chLabel(c.channel)}</span><span class="geo-chan-qty">${c.qty.toLocaleString('pt-BR')} un</span></div>`).join('');
  // Gerenciar o grupo (adicionar/remover produto, desfazer) agora é só na tela Unificador,
  // dentro de Configurações — aqui é só leitura, pra deixar claro por que os números somam.
  const unifiedSection = p._grouped ? `
    <div class="geo-unified-members">
      <div class="geo-rank-title">Produtos unificados <a href="/unificador" class="geo-unified-manage">gerenciar</a></div>
      <div class="geo-unified-list">
        ${p._members.map(t => `
          <div class="geo-unified-item"><span title="${escapeHtml(t)}">${escapeHtml(t)}</span></div>`).join('')}
      </div>
    </div>` : '';
  return `
    <div class="geo-detail-toolbar">
      <div class="geo-view-toggle" id="geoViewToggle">
        <button data-mode="ranking" class="${geoViewMode === 'ranking' ? 'active' : ''}">Ranking</button>
        <button data-mode="table" class="${geoViewMode === 'table' ? 'active' : ''}">Tabela</button>
        <button data-mode="chart" class="${geoViewMode === 'chart' ? 'active' : ''}">Gráfico</button>
      </div>
      <button class="geo-map-toggle" id="geoMapHideBtn">${showMap ? '🗺 Ocultar mapa' : '🗺 Mostrar mapa'}</button>
    </div>
    ${geoStatsHtml(p)}
    ${unifiedSection}
    <div class="geo-detail-body${showMap ? '' : ' no-map'}">
      ${mapHtml}
      <div class="geo-rank-col">
        <div class="geo-rank-title">Por estado · unidades</div>
        ${dataHtml}
        ${chanItems ? `<div class="geo-rank-title">Por canal</div><div class="geo-chans">${chanItems}</div>` : ''}
      </div>
    </div>`;
}

// Popup padrão ao clicar num estado (polígono, círculo de calor ou pill) — mesmo conteúdo nos 3 lugares.
function geoStatePopupHtml(uf, s, totalQty) {
  return `
    <div style="font-size:13px;font-weight:600;margin-bottom:6px;border-bottom:1px solid rgba(30,28,24,.1);padding-bottom:5px">📍 ${stateLabel(uf)} · ${uf}</div>
    <div style="display:flex;justify-content:space-between;gap:16px;font-size:12px;color:#6b6760"><span>Unidades</span><strong style="color:#1a1916">${s.qty.toLocaleString('pt-BR')}</strong></div>
    <div style="display:flex;justify-content:space-between;gap:16px;font-size:12px;color:#6b6760"><span>Receita</span><strong style="color:#1a1916">${fmtMoney(s.revenue)}</strong></div>
    <div style="display:flex;justify-content:space-between;gap:16px;font-size:12px;color:#6b6760"><span>% do produto</span><strong style="color:#1a1916">${(s.qty / totalQty * 100).toFixed(1)}%</strong></div>`;
}

// Desenha os estados coloridos por unidades vendidas (coroplético — preenchimento sólido do polígono).
// Reaproveitado pelo mini-mapa (sempre coroplético, sem interação) e pelo modal ampliado no modo Coroplético.
function drawGeoPolygons(map, geo, p, interactive) {
  const stateMap = {};
  p.byState.forEach(s => { stateMap[s.state] = s; });
  const maxQty = Math.max(1, ...p.byState.map(s => s.qty));
  const totalQty = p.qty || 1;
  return L.geoJSON(geo, {
    style: feature => {
      const uf = feature.properties._uf;
      const s = uf ? stateMap[uf] : null;
      const t = s ? s.qty / maxQty : 0;
      return { fillColor: s ? geoChoroColor(t) : '#e0dbd2', fillOpacity: s ? 0.82 : 0.3, color: '#bbb5aa', weight: 0.6, opacity: 1 };
    },
    onEachFeature: (feature, layer) => {
      const uf = feature.properties._uf;
      const s = uf ? stateMap[uf] : null;
      if (!s) return;
      layer.bindTooltip(
        `<div style="text-align:center;line-height:1.4"><div style="font-size:10px;font-weight:700">${uf}</div><div style="font-size:9px;opacity:.85">${s.qty.toLocaleString('pt-BR')} un</div></div>`,
        { permanent: true, direction: 'center', className: 'geo-state-tooltip', offset: [0, 0] }
      );
      if (interactive) layer.on('click', () => layer.bindPopup(geoStatePopupHtml(uf, s, totalQty)).openPopup());
    },
  }).addTo(map);
}

// Desenha o modo Calor no MESMO estilo das páginas de Geografia completas (geografia.html/-us.html):
// bordas finas dos estados + manchas de calor (círculos dispersos por sub-região, não o polígono
// inteiro pintado) + pill com UF+unidades no centroide. Usa as mesmas tabelas CENTROIDS/SUB_REGIONS.
const HEAT_PILL_COLOR = '#f97316', HEAT_TEXT_COLOR = '#ffffff', HEAT_BORDER_COLOR = '#555544', HEAT_BORDER_WEIGHT = 1.5;
function drawModalHeat(map, geo, p) {
  const group = L.layerGroup();
  const stateMap = {};
  p.byState.forEach(s => { stateMap[s.state] = s; });
  const maxQty = Math.max(1, ...p.byState.map(s => s.qty));
  const totalQty = p.qty || 1;
  const CENT = CocoGeo.CENTROIDS[market];
  const SUBR = CocoGeo.SUB_REGIONS[market];

  L.geoJSON(geo, { style: { fillOpacity: 0, color: HEAT_BORDER_COLOR, weight: HEAT_BORDER_WEIGHT, opacity: 0.5 }, interactive: false }).addTo(group);

  const MAX_R = 60000, MIN_R = 12000; // metros — mesmo raio base das páginas de Geografia
  for (const [uf, s] of Object.entries(stateMap)) {
    const t = s.qty / maxQty;
    const base = MIN_R + (MAX_R - MIN_R) * Math.sqrt(t);
    const fill = geoHeatColor(t);
    const pts = SUBR[uf] || [CENT[uf]];
    const subR = base / Math.sqrt(pts.length);
    for (const pt of pts) {
      if (!pt) continue;
      L.circle(pt, { radius: subR, fillColor: fill, fillOpacity: 0.30 + t * 0.38, color: 'none', weight: 0 })
        .on('click', function () { L.popup().setLatLng(pt).setContent(geoStatePopupHtml(uf, s, totalQty)).openOn(map); })
        .addTo(group);
    }
  }
  for (const [uf, s] of Object.entries(stateMap)) {
    const centroid = CENT[uf];
    if (!centroid) continue; // território/militar/INTL sem coordenada de centróide — some do calor, aparece no ranking/tabela
    const text = `${uf}: ${s.qty.toLocaleString('pt-BR')} un`;
    const pillW = Math.max(70, text.length * 7 + 24);
    const icon = L.divIcon({
      html: `<div style="width:${pillW}px;text-align:center;background:${HEAT_PILL_COLOR};color:${HEAT_TEXT_COLOR};padding:4px 0;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;font-family:inherit;box-shadow:0 2px 8px rgba(0,0,0,.28);cursor:pointer">${text}</div>`,
      className: '', iconSize: [pillW, 22], iconAnchor: [pillW / 2, 11],
    });
    L.marker(centroid, { icon })
      .on('click', function () { L.popup().setLatLng(centroid).setContent(geoStatePopupHtml(uf, s, totalQty)).openOn(map); })
      .addTo(group);
  }
  return group.addTo(map);
}

async function initGeoMap(p) {
  const geo = await loadGeoJSONFor(market);
  // o usuário pode ter fechado/trocado de produto, mercado ou ocultado o mapa enquanto o GeoJSON carregava
  if (!document.getElementById('geoMap') || openProduct !== p.title || geoMapHidden) return;
  destroyGeoMap();
  const bounds = MAP_BOUNDS[market];
  const map = L.map('geoMap', {
    center: bounds.center, zoom: 3, minZoom: 2, maxZoom: 6,
    zoomControl: false, attributionControl: false,
    dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, touchZoom: false,
  });
  geoMapInst = map;
  map.fitBounds(bounds.fit);
  if (!geo) return; // sem GeoJSON, fica só o fundo — nunca quebra a tela
  drawGeoPolygons(map, geo, p, false);
}

// ── Modal do mapa ampliado (coroplético/calor, com tile de fundo e popup ao clicar) ──
// Mapa + tile são criados UMA vez por abertura; trocar Coroplético/Calor só substitui a camada
// colorida (renderModalLayer), sem recriar mapa/tiles — bem mais leve que recarregar tudo a cada clique.
async function renderModalLayer(p) {
  if (!geoModalMapInst) return;
  const geo = await loadGeoJSONFor(market);
  if (!geoModalMapInst || openProduct !== p.title) return; // fechou/trocou de produto enquanto carregava
  if (geoModalLayerInst) { geoModalMapInst.removeLayer(geoModalLayerInst); geoModalLayerInst = null; }
  if (!geo) return;
  geoModalLayerInst = geoModalMode === 'heat'
    ? drawModalHeat(geoModalMapInst, geo, p)
    : drawGeoPolygons(geoModalMapInst, geo, p, true);
}
function initModalMap(p) {
  destroyGeoModalMap();
  const bounds = MAP_BOUNDS[market];
  const map = L.map('geoModalMap', { center: bounds.center, zoom: 4, minZoom: 3, maxZoom: 8, zoomControl: true, zoomSnap: 0.5 });
  geoModalMapInst = map;
  CocoGeo.addBasemap(map);
  map.fitBounds(bounds.fit);
  // O modal acabou de ficar visível (display:none → flex) — o Leaflet precisa recalcular o
  // tamanho do container depois que o layout se assenta, senão os tiles ficam em branco/cortados.
  requestAnimationFrame(() => { if (geoModalMapInst === map) map.invalidateSize(); });
  renderModalLayer(p);
}
function openMapModal(p) {
  geoModalMode = 'choropleth';
  document.getElementById('geoModalTitle').textContent = p.title;
  document.querySelectorAll('#geoModalModeToggle button').forEach(b => b.classList.toggle('active', b.dataset.mode === geoModalMode));
  document.getElementById('geoModalOverlay').classList.add('open');
  document.getElementById('geoModal').classList.add('open');
  initModalMap(p);
}
function closeMapModal() {
  document.getElementById('geoModalOverlay').classList.remove('open');
  document.getElementById('geoModal').classList.remove('open');
  destroyGeoModalMap();
}
document.getElementById('geoModalOverlay').addEventListener('click', closeMapModal);
document.getElementById('geoModalClose').addEventListener('click', closeMapModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMapModal(); });
document.getElementById('geoModalModeToggle').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]');
  if (!b || !openProduct) return;
  geoModalMode = b.dataset.mode;
  document.querySelectorAll('#geoModalModeToggle button').forEach(x => x.classList.toggle('active', x === b));
  const p = lastProductGeo.find(x => x.title === openProduct);
  if (p) renderModalLayer(p);
});

function geoProdRowHtml(p, i) {
  const isOpen = openProduct === p.title;
  // Amazon não traz imagem (nem Orders API nem relatório) — só via Catalog Items API por ASIN
  // (cache `amazonProductImages`, bloqueado hoje por falta do role "Product Listing", ver 4.13).
  // Shopify/Shopee/ML já vêm com `it.image`. Sem imagem → placeholder, igual a Produtos/Estoque.
  const thumb = p.image
    ? `<img class="geo-prod-thumb" src="${p.image}" alt="" loading="lazy" draggable="false" onerror="this.outerHTML='<div class=&quot;geo-prod-thumb-ph&quot;><i class=&quot;bi bi-image&quot;></i></div>'">`
    : `<div class="geo-prod-thumb-ph"><i class="bi bi-image"></i></div>`;
  const badge = p._grouped
    ? `<span class="geo-unify-badge" title="${escapeHtml(p._members.join(' + '))}"><i class="bi bi-link-45deg"></i>${p._members.length}</span>`
    : '';
  return `
    <div class="geo-prod-card${isOpen ? ' open' : ''}">
      <div class="geo-prod-row" data-title="${encodeURIComponent(p.title)}">
        <span class="geo-prod-rank">${i + 1}.</span>
        ${thumb}
        <span class="geo-prod-name" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span>
        ${badge}
        <span class="geo-prod-qty">${p.qty.toLocaleString('pt-BR')} un</span>
        <span class="geo-prod-rev">${fmtMoney(p.revenue)}</span>
        <span class="geo-prod-chevron">▸</span>
      </div>
      ${isOpen ? `<div class="geo-detail">${geoDetailHtml(p)}</div>` : ''}
    </div>`;
}

function renderGeoBlocks() {
  destroyGeoMap();
  destroyGeoBarChart();
  const container = document.getElementById('geoBlocks');
  // productGeo já vem agrupado do backend quando o Unificador está ligado (ver metrics.js
  // applyProductGroups) — nada a mesclar aqui.
  const base = lastProductGeo;
  const q = geoSearchQuery.trim().toLowerCase();
  const source = q ? base.filter(p => p.title.toLowerCase().includes(q)) : base;
  const segsPresent = ['cat','dog','other'].filter(k => source.some(p => p.seg === k));
  if (!segsPresent.length) {
    container.innerHTML = q
      ? `<div class="geo-empty">Nenhum produto encontrado para "${escapeHtml(geoSearchQuery.trim())}"</div>`
      : '<div class="geo-empty">Sem dados de produto/estado no período</div>';
    return;
  }
  container.innerHTML = segsPresent.map(seg => {
    const prods = source.filter(p => p.seg === seg);
    // com busca ativa mostra todos os resultados (sem o corte de 5 + "ver mais")
    const exp = q || geoExpanded[seg];
    const shown = exp ? prods : prods.slice(0, 5);
    const rows = shown.map((p, i) => geoProdRowHtml(p, i)).join('');
    const moreBtn = !q && prods.length > 5
      ? `<button class="seg-more" onclick="toggleGeoExpand('${seg}')">${exp ? 'Ver menos' : 'Ver mais (' + (prods.length - 5) + ')'}</button>`
      : '';
    return `
      <div class="geo-seg-block">
        <div class="geo-seg-head"><span class="geo-seg-dot" style="background:${SEG_COLORS[seg]}"></span>${SEG_LABELS[seg]}</div>
        <div class="geo-prod-list${geoLayoutMode === 'columns' ? ' cols' : ''}">${rows}</div>
        ${moreBtn}
      </div>`;
  }).join('');
  if (openProduct) {
    const p = base.find(x => x.title === openProduct);
    if (p) {
      if (!geoMapHidden) initGeoMap(p);
      if (geoViewMode === 'chart') geoRenderBarChart(p);
      const expandBtn = document.getElementById('geoMapExpandBtn');
      if (expandBtn) expandBtn.addEventListener('click', e => { e.stopPropagation(); openMapModal(p); });
    }
  }
}
function toggleGeoExpand(seg) {
  geoExpanded[seg] = !geoExpanded[seg];
  openProduct = null;
  renderGeoBlocks();
}
document.getElementById('geoBlocks').addEventListener('click', e => {
  // Toolbar do painel expandido (modo de visualização / esconder mapa) não deve fechar o produto.
  const viewBtn = e.target.closest('.geo-view-toggle button[data-mode]');
  if (viewBtn) { geoViewMode = viewBtn.dataset.mode; localStorage.setItem('coco_seg_geoview', geoViewMode); renderGeoBlocks(); return; }
  if (e.target.closest('#geoMapHideBtn')) {
    geoMapHidden = !geoMapHidden;
    localStorage.setItem('coco_seg_geohide', geoMapHidden ? '1' : '0');
    renderGeoBlocks();
    return;
  }
  const row = e.target.closest('.geo-prod-row');
  if (!row) return;
  const title = decodeURIComponent(row.dataset.title);
  openProduct = openProduct === title ? null : title;
  renderGeoBlocks();
});
document.querySelectorAll('#geoLayoutToggle button').forEach(b => b.classList.toggle('active', b.dataset.layout === geoLayoutMode));
document.getElementById('geoLayoutToggle').addEventListener('click', e => {
  const b = e.target.closest('button[data-layout]');
  if (!b) return;
  geoLayoutMode = b.dataset.layout;
  localStorage.setItem('coco_seg_geolayout', geoLayoutMode);
  document.querySelectorAll('#geoLayoutToggle button').forEach(x => x.classList.toggle('active', x === b));
  renderGeoBlocks();
});
document.getElementById('geoSearchInput').addEventListener('input', e => {
  geoSearchQuery = e.target.value;
  openProduct = null;
  renderGeoBlocks();
});
// ── Render ──
function render(d) {
  const segs = d.segments || {};
  lastSegs = segs;
  renderChart(segs);
  renderLegend(segs);
  renderCards(segs);
  renderOther(segs);
  renderHidden(segs);
  lastProductGeo = d.productGeo || [];
  renderGeoBlocks();
  const up = d.updatedAt ? new Date(d.updatedAt).toLocaleString('pt-BR') : '—';
  const chLbl = CocoColors.chLabel(channel);
  document.getElementById('pageSub').textContent = `Gato vs Cachorro · ${chLbl} · ${rangeLabel(sinceDate, untilDate)} · última sincronização: ${up}`;
  document.getElementById('footerDate').textContent = `Vita Pet Life · Segmentos · ${chLbl} · ${rangeLabel(sinceDate, untilDate)} · receita exclui cancelados · última sincronização: ${up}`;
  setLive('ok', `Ao vivo · ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`);
}

// ── Load ──
async function loadData() {
  setLive('loading','Atualizando…');
  try {
    const p = new URLSearchParams({ channel, metric:'receita', since:sinceDate, until:untilDate, market });
    const r = await fetch('/api/dashboard?' + p);
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    render(d);
  } catch(e) {
    setLive('error', 'Erro ao carregar');
    console.error(e);
  }
}

// ── Market toggle ──
document.querySelectorAll('.mkt-btn').forEach(btn => {
  if (btn.dataset.market === market) btn.classList.add('active');
  else btn.classList.remove('active');
  btn.addEventListener('click', () => {
    market = btn.dataset.market;
    localStorage.setItem('coco_market', market);
    document.querySelectorAll('.mkt-btn').forEach(b => b.classList.toggle('active', b.dataset.market === market));
    channel = 'todos';            // troca de mercado reseta o canal (canais diferem por mercado)
    segExpanded.cat = segExpanded.dog = segExpanded.other = false;
    delete segTypeOpen.cat; delete segTypeOpen.dog; delete segTypeOpen.other;
    geoExpanded.cat = geoExpanded.dog = geoExpanded.other = false;
    openProduct = null;
    geoSearchQuery = '';
    document.getElementById('geoSearchInput').value = '';
    buildChannelDropdown();
    loadData();
  });
});

// ── Channel dropdown ──
function buildChannelDropdown() {
  const chans = CocoColors.channelsFor(market, { comTodos: true });
  if (!chans.includes(channel)) channel = 'todos';
  document.getElementById('channelPop').innerHTML = chans
    .map(c => `<button data-ch="${c}" class="${c===channel?'active':''}">${CocoColors.chLabel(c)}</button>`).join('');
  document.getElementById('channelValue').textContent = CocoColors.chLabel(channel);
}
document.getElementById('channelPill').addEventListener('click', e => {
  e.stopPropagation();
  const pop = document.getElementById('channelPop');
  const pill = document.getElementById('channelPill');
  const open = pop.classList.contains('open');
  document.querySelectorAll('.chan-pop,.period-pop').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('open'));
  if (!open) { pop.classList.add('open'); pill.classList.add('open'); }
});
document.getElementById('channelPop').addEventListener('click', e => {
  const b = e.target.closest('button[data-ch]');
  if (!b) return;
  channel = b.dataset.ch;
  segExpanded.cat = segExpanded.dog = segExpanded.other = false;
  geoExpanded.cat = geoExpanded.dog = geoExpanded.other = false;
  openProduct = null;
  geoSearchQuery = '';
  document.getElementById('geoSearchInput').value = '';
  buildChannelDropdown();
  document.getElementById('channelPop').classList.remove('open');
  document.getElementById('channelPill').classList.remove('open');
  loadData();
});

// ── Period picker ──
function syncPeriodPill() {
  document.getElementById('periodValue').textContent = rangeLabel(sinceDate, untilDate);
  document.getElementById('dateFrom').value = sinceDate;
  document.getElementById('dateTo').value = untilDate;
}
function applyPreset(p) {
  const t = new Date(); t.setHours(0,0,0,0);
  if (p==='today')  { sinceDate = untilDate = todayISO; }
  else if (p==='7d')  { sinceDate = isoLocal(addDays(t,-6)); untilDate = todayISO; }
  else if (p==='30d') { sinceDate = isoLocal(addDays(t,-29)); untilDate = todayISO; }
  else if (p==='month') { const d=new Date(); sinceDate=isoLocal(new Date(d.getFullYear(),d.getMonth(),1)); untilDate=todayISO; }
  localStorage.setItem('coco_since', sinceDate); localStorage.setItem('coco_until', untilDate);
  syncPeriodPill();
  document.querySelectorAll('.pp-presets button').forEach(b => b.classList.toggle('active', b.dataset.preset===p));
  document.getElementById('periodPop').classList.remove('open');
  document.getElementById('periodPill').classList.remove('open');
  loadData();
}
document.getElementById('periodPill').addEventListener('click', e => {
  e.stopPropagation();
  const pop = document.getElementById('periodPop');
  const pill = document.getElementById('periodPill');
  const open = pop.classList.contains('open');
  document.querySelectorAll('.period-pop').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('open'));
  if (!open) { pop.classList.add('open'); pill.classList.add('open'); }
});
document.querySelectorAll('.pp-presets button').forEach(b => {
  b.addEventListener('click', () => applyPreset(b.dataset.preset));
});
document.getElementById('applyRange').addEventListener('click', () => {
  const f = document.getElementById('dateFrom').value;
  const t = document.getElementById('dateTo').value;
  const err = document.getElementById('ppErr');
  if (!f || !t) { err.textContent='Preencha as duas datas.'; return; }
  if (f > t)    { err.textContent='Data inicial deve ser anterior à final.'; return; }
  err.textContent = '';
  sinceDate = f; untilDate = t;
  localStorage.setItem('coco_since', sinceDate); localStorage.setItem('coco_until', untilDate);
  syncPeriodPill();
  document.getElementById('periodPop').classList.remove('open');
  document.getElementById('periodPill').classList.remove('open');
  loadData();
});

// ── Close popups on outside click ──
document.addEventListener('click', e => {
  if (!e.target.closest('#periodPill') && !e.target.closest('#periodPop')) {
    document.getElementById('periodPop').classList.remove('open');
    document.getElementById('periodPill').classList.remove('open');
  }
  if (!e.target.closest('#channelPill') && !e.target.closest('#channelPop')) {
    document.getElementById('channelPop').classList.remove('open');
    document.getElementById('channelPill').classList.remove('open');
  }
});

// ── "Tipos de produto" — cria/edita as regras de palavra-chave (classifyTypeGroup, metrics.js) ──
let trTypes = {}; // { [nome]: [palavraChave,...] } do mercado atual

async function loadTrTypes() {
  try {
    const r = await fetch('/api/product-types?market=' + market, { credentials: 'same-origin' });
    const d = await r.json();
    trTypes = d.types || {};
  } catch (e) { trTypes = {}; }
  renderTrTypes();
}

// Quais tipos estão abertos no modal — some é fechado. Só o 1º vem aberto na 1ª renderização
// (mesmo princípio de "só o primeiro aberto" já usado em Produtos/Estoque/Top produtos — ver 4.13).
let trOpen = new Set();
let trOpenInited = false;

function renderTrTypes() {
  const wrap = document.getElementById('trTypesList');
  const names = Object.keys(trTypes).sort();
  if (!names.length) {
    trOpenInited = false;
    wrap.innerHTML = '<div class="tr-empty">Nenhum tipo criado ainda — tudo aparece em "Outros" até você criar o primeiro.</div>';
    return;
  }
  if (!trOpenInited) { trOpen = new Set(names.slice(0, 1)); trOpenInited = true; }
  wrap.innerHTML = names.map(name => {
    const kws = trTypes[name] || [];
    const open = trOpen.has(name);
    const chips = kws.map(k => `<span class="tr-kw-chip">${escapeHtml(k)}<button data-remove-kw="${escapeHtml(name)}|${escapeHtml(k)}" title="Remover palavra-chave"><i class="bi bi-x"></i></button></span>`).join('');
    const body = open ? `<div class="tr-type-body">
        <div class="tr-kw-list">${chips || '<span class="tr-empty" style="padding:0">Sem palavra-chave — nunca vai bater em nenhum produto.</span>'}</div>
        <div class="tr-kw-add">
          <input type="text" placeholder="Adicionar palavra-chave..." data-kw-input="${escapeHtml(name)}">
          <button data-add-kw="${escapeHtml(name)}">Adicionar</button>
        </div>
      </div>` : '';
    return `<div class="tr-type-row" data-type-row="${escapeHtml(name)}">
      <div class="tr-type-head" data-toggle-type="${escapeHtml(name)}">
        <div class="tr-type-name"><i class="bi bi-tag"></i> ${escapeHtml(name)}</div>
        <span class="tr-type-count">${kws.length} palavra${kws.length===1?'':'s'}-chave</span>
        <button class="tr-type-del" data-delete-type="${escapeHtml(name)}" title="Excluir tipo"><i class="bi bi-trash"></i></button>
        <span class="tr-type-chevron"><i class="bi bi-chevron-${open?'up':'down'}"></i></span>
      </div>
      ${body}
    </div>`;
  }).join('');
}

function openTrModal() {
  document.getElementById('trModalOverlay').classList.add('open');
  document.getElementById('trModal').classList.add('open');
  loadTrTypes();
}
function closeTrModal() {
  document.getElementById('trModalOverlay').classList.remove('open');
  document.getElementById('trModal').classList.remove('open');
  document.getElementById('trNewErr').textContent = '';
  document.getElementById('trNewName').value = '';
  document.getElementById('trNewKeyword').value = '';
}

async function trCreateType(name, keyword) {
  const r = await fetch('/api/product-types', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ market, name, keywords: [keyword] }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Erro ao salvar.');
  trTypes = d.types || {};
  trOpen.add(name); // tipo recém-criado já aparece aberto, como confirmação visual
  renderTrTypes();
  loadData(); // refaz a classificação com a regra nova
}
async function trAddKeyword(name, keyword) {
  const r = await fetch('/api/product-types', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ market, name, keywords: [keyword] }),
  });
  const d = await r.json();
  if (!r.ok) return;
  trTypes = d.types || {};
  renderTrTypes();
  loadData();
}
async function trRemoveKeyword(name, keyword) {
  const r = await fetch('/api/product-types/remove-keyword', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ market, name, keyword }),
  });
  const d = await r.json();
  if (!r.ok) return;
  trTypes = d.types || {};
  renderTrTypes();
  loadData();
}
async function trDeleteType(name) {
  if (!(await cocoConfirm('Os produtos voltam a cair em "Outros".', { title: `Excluir o tipo "${name}"?`, confirmText: 'Excluir', danger: true }))) return;
  const r = await fetch(`/api/product-types?market=${encodeURIComponent(market)}&name=${encodeURIComponent(name)}`, { method: 'DELETE', credentials: 'same-origin' });
  const d = await r.json();
  if (!r.ok) return;
  trTypes = d.types || {};
  renderTrTypes();
  loadData();
}

document.getElementById('manageTypesBtn').addEventListener('click', openTrModal);
document.getElementById('trModalClose').addEventListener('click', closeTrModal);
document.getElementById('trModalOverlay').addEventListener('click', closeTrModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTrModal(); });

document.getElementById('trNewSubmit').addEventListener('click', async () => {
  const name = document.getElementById('trNewName').value.trim();
  const keyword = document.getElementById('trNewKeyword').value.trim();
  const err = document.getElementById('trNewErr');
  if (!name || !keyword) { err.textContent = 'Informe o nome do tipo e a palavra-chave.'; return; }
  err.textContent = '';
  try {
    await trCreateType(name, keyword);
    document.getElementById('trNewName').value = '';
    document.getElementById('trNewKeyword').value = '';
  } catch (e) {
    err.textContent = e.message || 'Falha de rede.';
  }
});

document.getElementById('trTypesList').addEventListener('click', e => {
  const del = e.target.closest('[data-delete-type]');
  if (del) { trDeleteType(del.dataset.deleteType); return; }
  const rm = e.target.closest('[data-remove-kw]');
  if (rm) {
    const [name, keyword] = rm.dataset.removeKw.split('|');
    trRemoveKeyword(name, keyword);
    return;
  }
  const add = e.target.closest('[data-add-kw]');
  if (add) {
    const name = add.dataset.addKw;
    const input = document.querySelector(`[data-kw-input="${CSS.escape(name)}"]`);
    const kw = (input?.value || '').trim();
    if (!kw) return;
    trAddKeyword(name, kw);
    if (input) input.value = '';
    return;
  }
  const toggle = e.target.closest('[data-toggle-type]');
  if (toggle) {
    const name = toggle.dataset.toggleType;
    if (trOpen.has(name)) trOpen.delete(name); else trOpen.add(name);
    renderTrTypes();
  }
});
document.getElementById('trTypesList').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const input = e.target.closest('[data-kw-input]');
  if (!input) return;
  const name = input.dataset.kwInput;
  const kw = input.value.trim();
  if (!kw) return;
  trAddKeyword(name, kw);
  input.value = '';
});

buildChannelDropdown();
syncPeriodPill();
loadData();
