// ── State data — Brasil ──
// IBGE 2-digit code → UF abbreviation
// Centroid coordinates [lat, lng] for labels and heatmap bubbles — Brasil
// Sub-region points for heatmap dispersion [centroid, sub1, sub2, ...] (1st = centroid = label position) — Brasil
// ── State data — EUA ──
// Os 50 estados de fato (para o contador "de 50 estados") — exclui DC, territórios,
// militar e o bucket INTL, que aparecem no ranking mas não contam como estado.
const US_50 = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
  'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
  'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY']);

// FIPS (zero-padded 2-digit) → 2-letter state code

// ── Canais por mercado ──
// Canais por mercado vêm do catálogo único (js/colors.js). Esta tela chegou a ter QUATRO
// tabelas próprias e era a mais divergente de todas: a Shopify saía verde e a Amazon BR
// laranja, enquanto o resto do app usava preto — e nenhuma delas enxergava a cor que o
// usuário salva no seletor de cores.
const METRIC_LABEL = { receita:'Receita', pedidos:'Pedidos' };

// ── Formatting (BRL/pt-BR ou USD/en-US conforme o mercado ativo) ──
function fmtMoney(v, dec=0) {
  return market === 'us'
    ? 'U$ '+(Number(v)||0).toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec})
    : 'R$ '+(Number(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:dec,maximumFractionDigits:dec});
}
function fmtInt(v) {
  return market === 'us' ? (Number(v)||0).toLocaleString('en-US') : (Number(v)||0).toLocaleString('pt-BR');
}
function pctStr(n) {
  return market === 'us'
    ? (Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:1,minimumFractionDigits:1})+'%'
    : (Number(n)||0).toLocaleString('pt-BR',{maximumFractionDigits:1,minimumFractionDigits:1})+'%';
}

// ── Canal breakdown helpers ──
// Cor de canal, sempre a do catálogo — inclusive a que o usuário personalizou.
const chColor = ch => CocoColors.ch[ch]?.bg || '#888';
function isChanMap() { return localStorage.getItem('coco_chan_map') !== '0'; }
function isChanExpand() { return localStorage.getItem('coco_chan_expand') === '1'; }
function togglePopupExpand(uid) {
  const det = document.getElementById('pcd-'+uid);
  const btn = document.getElementById('pcb-'+uid);
  if (!det||!btn) return;
  const open = det.classList.toggle('open');
  btn.textContent = open ? '▴ ocultar canais' : '▾ todos os canais';
  localStorage.setItem('coco_chan_expand', open ? '1' : '0');
}
function popupChanHTML(byChannel) {
  if (!isChanMap() || !byChannel) return '';
  const entries = Object.entries(byChannel).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if (!entries.length) return '';
  const total = entries.reduce((s,[,v])=>s+v,0)||1;
  const [topCh, topVal] = entries[0];
  const topColor = chColor(topCh);
  const topPct = Math.round(topVal/total*100);
  const topLabel = CocoColors.chLabel(topCh);
  const topTxt = topCh === 'mercadolivre' ? '#1a1a1a' : '#fff';
  const uid = Math.random().toString(36).slice(2,8);
  const initOpen = isChanExpand();
  const detailRows = entries.length > 1 ? entries.map(([ch,v])=>{
    const pct=Math.round(v/total*100);
    return `<div class="pop-chan-bar-row">
      <span class="pop-chan-bar-name">${CocoColors.chLabel(ch)}</span>
      <div class="pop-chan-bar"><div class="pop-chan-bar-fill" style="width:${pct}%;background:${chColor(ch)}"></div></div>
      <span class="pop-chan-bar-pct">${pct}%</span>
    </div>`;
  }).join('') : '';
  return `<div class="pop-chan-row">
    <div class="pop-chan-top">
      <span class="pop-chan-label">Canal principal</span>
      <span class="pop-chan-badge" style="background:${topColor};color:${topTxt}">${topLabel} ${topPct}%</span>
    </div>
    ${entries.length>1?`<button id="pcb-${uid}" class="pop-chan-expand" onclick="togglePopupExpand('${uid}')">${initOpen?'▴ ocultar canais':'▾ todos os canais'}</button>
    <div id="pcd-${uid}" class="pop-chan-detail${initOpen?' open':''}">${detailRows}</div>`:''}
  </div>`;
}
function modalChanHTML(byChannel) {
  if (!byChannel) return '';
  const entries = Object.entries(byChannel).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if (!entries.length) return '';
  const total = entries.reduce((s,[,v])=>s+v,0)||1;
  const rows = entries.map(([ch,v])=>{
    const pct=Math.round(v/total*100);
    const color=chColor(ch);
    return `<div class="smd-chan-row">
      <span class="smd-chan-dot" style="background:${color}"></span>
      <span class="smd-chan-name">${CocoColors.chLabel(ch)}</span>
      <div class="smd-chan-bar"><div class="smd-chan-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="smd-chan-val">${fmtMoney(v)}</span>
      <span class="smd-chan-pct">${pct}%</span>
    </div>`;
  }).join('');
  return `<div class="smd-chan"><div class="smd-chan-title">Por canal</div>${rows}</div>`;
}
function isoLocal(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') }
function parseISO(s) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d) }
function addDays(d,n) { const x=new Date(d); x.setDate(x.getDate()+n); return x }

// ── Rampas de cor (interpolação em js/geo.js) ──
const heatGradientColor = t =>
  CocoGeo.heatColor(t, [heatConfig.coldColor, heatConfig.midColor, heatConfig.hotColor]);

// ── Choropleth config (mesmas cores nos dois mercados) ──
const CHORO_DEFAULTS = { lowColor:'#e8e3d8', midColor:'#c49568', highColor:'#8c3a20', borderColor:'#bbb5aa', borderWeight:0.8, fillOpacity:82 };
function loadChoroConfig(m) {
  const cfg = { ...CHORO_DEFAULTS };
  try { const s = localStorage.getItem(m === 'us' ? 'coco_choro_us_cfg' : 'coco_choro_cfg'); if (s) Object.assign(cfg, JSON.parse(s)); } catch {}
  return cfg;
}
function saveChoroConfig() { localStorage.setItem(market === 'us' ? 'coco_choro_us_cfg' : 'coco_choro_cfg', JSON.stringify(choroConfig)); }

const choroColor = t =>
  CocoGeo.heatColor(t, [choroConfig.lowColor, choroConfig.midColor, choroConfig.highColor]);

// ── Heat config (pill laranja no BR, azul no EUA — só essa cor difere por padrão) ──
function HEAT_DEFAULTS(m) {
  return { coldColor:'#22c55e', midColor:'#eab308', hotColor:'#ef4444', pillColor: m === 'us' ? '#3b82f6' : '#f97316', textColor:'#ffffff', radius:38, blur:28, minOpacity:30, borderColor:'#555544', borderWeight:1.5 };
}
function loadHeatConfig(m) {
  const cfg = { ...HEAT_DEFAULTS(m) };
  try { const s = localStorage.getItem(m === 'us' ? 'coco_heat_us_cfg' : 'coco_heat_cfg'); if (s) Object.assign(cfg, JSON.parse(s)); } catch {}
  return cfg;
}
function saveHeatConfig() { localStorage.setItem(market === 'us' ? 'coco_heat_us_cfg' : 'coco_heat_cfg', JSON.stringify(heatConfig)); }

// ── App state ──
const todayISO = isoLocal(new Date());
let sinceDate = localStorage.getItem('coco_since') || isoLocal(addDays(new Date(),-29));
let untilDate = localStorage.getItem('coco_until') || todayISO;
let market    = localStorage.getItem('coco_market') || 'br';
if (market !== 'us') market = 'br';
// Link antigo /geografia-us redireciona pra cá com ?market=us — respeita e já
// deixa gravado, senão o toggle voltaria pro último mercado usado no resto do app.
const urlMarket = new URLSearchParams(location.search).get('market');
if (urlMarket === 'us' || urlMarket === 'br') {
  market = urlMarket;
  localStorage.setItem('coco_market', market);
}
let metric    = localStorage.getItem('coco_metric_geo') || 'receita';
if (!METRIC_LABEL[metric]) metric = 'receita';
let vizMode   = 'choropleth'; // 'choropleth' | 'heat'

function loadChannel(m) {
  const key = m === 'us' ? 'coco_ch_us' : 'coco_channel';
  const val = localStorage.getItem(key) || 'todos';
  // Canal salvo que não existe neste mercado (veio da outra bandeira) volta pra "todos".
  return CocoColors.channelsFor(m, { comTodos: true }).includes(val) ? val : 'todos';
}

let CHAN         = CocoColors.channelsFor(market, { comTodos: true });
let STATE_NAMES  = CocoGeo.STATE_NAMES[market];
let CENTROIDS    = CocoGeo.CENTROIDS[market];
let SUB_REGIONS  = CocoGeo.SUB_REGIONS[market];
let channel      = loadChannel(market);
let choroConfig  = loadChoroConfig(market);
let heatConfig   = loadHeatConfig(market);

function rangeLabel(s,u) { return CocoPeriodo.rotulo(s, u, { hoje: todayISO, mercado: market }); }
function presetRange(p) {
  const n=new Date();
  if(p==='today')return[todayISO,todayISO]; if(p==='7d')return[isoLocal(addDays(n,-6)),todayISO];
  if(p==='30d')return[isoLocal(addDays(n,-29)),todayISO]; if(p==='month')return[isoLocal(new Date(n.getFullYear(),n.getMonth(),1)),todayISO];
  return[todayISO,todayISO];
}
function setLive(s,t) {
  const d=document.getElementById('liveDot');
  d.className='ldot'+(s==='loading'?' loading':s==='error'?' error':'');
  if(t)document.getElementById('lastUpdate').textContent=t;
}

// ── Leaflet map ──
// Sem maxBounds de propósito — só usado pra enquadrar a vista inicial de cada mercado
// (fitBounds), não pra travar o arraste. Decisão de produto: tirar a trava de arrastar o mapa
// (tanto BR quanto EUA ficavam presos numa caixa ao redor do país).
const MAP_VIEW = {
  br: { center:[-15,-52], bounds:[[-33.75,-73.99],[5.26,-28.84]] },
  us: { center:[38,-97],  bounds:[[24.0,-125.0],[49.5,-66.5]] },
};
const map = L.map('map', { center: MAP_VIEW[market].center, zoom:4, minZoom:4, maxZoom:8, zoomControl:true, zoomSnap:0.5 });
function applyMapView(m) {
  map.fitBounds(MAP_VIEW[m].bounds);
}
applyMapView(market);

// ── Fundo do mapa: Esri "Light Gray Canvas" ──
// A CartoDB Voyager, usada até então, passou a exigir chave de API e começou a devolver o tile
// com "API KEY REQUIRED" carimbado por cima do mapa. O tile chega com HTTP 200 e imagem válida,
// então nada falha: a marca d'água simplesmente aparece na tela do usuário. Trocado por um
// provedor sem chave. Cinza claro combina melhor com o coroplético do que o Voyager colorido: o
// mapa aqui é fundo, não pode disputar cor com o dado desenhado por cima. São DUAS camadas de
// propósito — a base do Esri não traz nome de cidade nenhum, os rótulos vêm separados. Ordem
// importa: rótulo depois da base.
let tileAtual = null;
function setTileLayer() {
  if (tileAtual) { map.removeLayer(tileAtual.base); map.removeLayer(tileAtual.rotulos); }
  tileAtual = CocoGeo.addBasemap(map);
}
setTileLayer();

let geojsonData   = null;  // GeoJSON do mercado ativo (o cache por mercado é do CocoGeo)
let stateData     = {};    // { UF: { revenue, orders } }
let mapLayers     = [];    // active Leaflet layers
let lastApiData   = null;  // last /api/dashboard response for local re-renders

// ── Overlay helpers ──
function showMapOverlay(icon, html, btnLabel, btnFn) {
  removeMapOverlay();
  const d = document.createElement('div');
  d.className = 'map-overlay'; d.id = 'mapOverlay';
  d.innerHTML = `<div class="map-overlay-icon">${icon}</div><div class="map-overlay-text">${html}</div>${btnLabel ? `<button class="map-overlay-btn" id="moBtn">${btnLabel}</button>` : ''}`;
  document.getElementById('map').appendChild(d);
  if (btnLabel && btnFn) document.getElementById('moBtn').addEventListener('click', btnFn);
}
function removeMapOverlay() { document.getElementById('mapOverlay')?.remove(); }

// ── Contorno dos estados (tabelas, cache e origem em js/geo.js) ──
// Devolve true/false em vez de propagar o erro: quem chama desenha um aviso na tela com botão
// de tentar de novo, e um mapa que não carregou não pode derrubar o resto da página.
async function loadGeoJSONFor(m) {
  try {
    geojsonData = await CocoGeo.loadGeoJSON(m);
    return true;
  } catch (e) {
    console.error('GeoJSON load failed:', e);
    geojsonData = null;
    return false;
  }
}

// ── Draw map ──
function clearLayers() {
  mapLayers.forEach(l => map.removeLayer(l));
  mapLayers = [];
}

function drawMap() {
  clearLayers();
  removeMapOverlay();

  if (!geojsonData) {
    showMapOverlay('🗺', `Não foi possível carregar o mapa ${market==='us'?'dos EUA':'do Brasil'}.<br>Verifique sua conexão e tente novamente.`, '↺ Tentar novamente', async () => {
      const ok = await loadGeoJSONFor(market);
      if (ok) drawMap();
      else showMapOverlay('🗺', 'Falha ao carregar mapa. Tente recarregar a página.', null, null);
    });
    return;
  }

  const isMoney  = metric === 'receita';
  const getValue = s => isMoney ? s.revenue : s.orders;
  const entries  = Object.keys(stateData);
  const allVals  = Object.values(stateData).map(getValue);
  const maxVal   = Math.max(1, ...allVals);

  if (vizMode === 'choropleth') {
    drawChoropleth(isMoney, getValue, maxVal);
  } else {
    drawHeatmap(isMoney, getValue, maxVal);
  }

  // Overlay when no state data (draw gray map behind it)
  if (entries.length === 0) {
    showMapOverlay('📍',
      'Nenhum pedido com estado de entrega encontrado neste período.<br>' +
      'Clique em <strong>↻ Sincronizar</strong> na barra superior para buscar os dados mais recentes.',
      null, null);
  }
}

function drawChoropleth(isMoney, getValue, maxVal) {
  setTileLayer();
  const layer = L.geoJSON(geojsonData, {
    filter: f => !!f.properties._uf, // pula territórios/regiões sem UF conhecida
    style: feature => {
      const uf = feature.properties._uf;
      const s  = stateData[uf];
      const t  = s ? getValue(s) / maxVal : 0;
      return {
        fillColor:   s ? choroColor(t) : '#e0dbd2',
        fillOpacity: s ? choroConfig.fillOpacity / 100 : 0.35,
        color:       choroConfig.borderColor,
        weight:      choroConfig.borderWeight,
        opacity:     1,
      };
    },
    onEachFeature: (feature, layer) => {
      const uf   = feature.properties._uf;
      const name = uf ? (STATE_NAMES[uf] || uf) : '?';
      const s    = uf ? stateData[uf] : null;

      // Permanent label on each state with data
      if (s) {
        const val   = getValue(s);
        const label = isMoney ? fmtMoney(val) : fmtInt(val) + (s.orders === 1 ? ' pedido' : ' pedidos');
        layer.bindTooltip(
          `<div style="text-align:center;line-height:1.5"><div style="font-size:11px;font-weight:700;letter-spacing:.3px">${uf}</div><div style="font-size:10px;opacity:.85">${label}</div></div>`,
          { permanent: true, direction: 'center', className: 'state-tooltip', offset: [0, 0] }
        );
      }

      // Click popup
      layer.on('click', () => {
        const val    = s ? getValue(s) : 0;
        const pct    = s && Object.values(stateData).length
          ? pctStr(val / Math.max(1, Object.values(stateData).reduce((a, x) => a + getValue(x), 0)) * 100)
          : '—';
        layer.bindPopup(`
          <div class="pop-title">📍 ${name}${uf ? ' · '+uf : ''}</div>
          ${s ? `
            <div class="pop-row"><span>Receita</span><strong>${fmtMoney(s.revenue, 2)}</strong></div>
            <div class="pop-row"><span>Pedidos</span><strong>${fmtInt(s.orders)}</strong></div>
            <div class="pop-row"><span>Ticket médio</span><strong>${s.orders ? fmtMoney(s.revenue/s.orders,2) : '—'}</strong></div>
            <div class="pop-row"><span>% do total</span><strong>${pct}</strong></div>
            ${popupChanHTML(s.byChannel)}
          ` : '<div style="color:#9c9790;font-size:12px">Sem vendas neste estado no período.</div>'}
        `).openPopup();
      });

      // Hover effect
      layer.on('mouseover', () => { if(!stateData[uf]) return; layer.setStyle({ weight: Math.max(choroConfig.borderWeight+1,2), color:'#2d2a26' }); });
      layer.on('mouseout',  () => { if(!stateData[uf]) return; layer.setStyle({ weight:choroConfig.borderWeight, color:choroConfig.borderColor }); });
    }
  }).addTo(map);

  mapLayers.push(layer);

  // Legend — dynamic colors from choroConfig
  const grad = document.getElementById('legendGrad');
  grad.className = '';
  grad.style.cssText = `width:100px;height:7px;border-radius:4px;background:linear-gradient(to right,${choroConfig.lowColor},${choroConfig.midColor},${choroConfig.highColor})`;
}

function drawHeatmap(isMoney, getValue, maxVal) {
  setTileLayer();
  const totalAll = Object.values(stateData).reduce((a, x) => a + getValue(x), 0);

  // Bordas finas dos estados sobre o tile
  const borders = L.geoJSON(geojsonData, {
    filter: f => !!f.properties._uf,
    style: { fillOpacity: 0, color: heatConfig.borderColor, weight: heatConfig.borderWeight, opacity: 0.5 },
    interactive: false,
  }).addTo(map);
  mapLayers.push(borders);

  // Manchas de calor: múltiplos círculos por estado usando SUB_REGIONS,
  // raio base pequeno dividido por √(nº de pontos) → manchas dispersas pelo estado.
  const MAX_R = market === 'us' ? 70000 : 60000, MIN_R = 12000; // metros — base total por estado
  for (const [uf, s] of Object.entries(stateData)) {
    const val  = getValue(s);
    const t    = val / maxVal;
    const base = MIN_R + (MAX_R - MIN_R) * Math.sqrt(t);
    const fill = heatGradientColor(t);
    const pts  = SUB_REGIONS[uf] || [CENTROIDS[uf]];
    const subR = base / Math.sqrt(pts.length); // cada ponto fica menor quando há mais pontos
    for (const pt of pts) {
      if (!pt) continue;
      const circle = L.circle([pt[0], pt[1]], {
        radius: subR,
        fillColor: fill, fillOpacity: 0.30 + t * 0.38,
        color: 'none', weight: 0,
      }).addTo(map);
      circle.on('click', () => {
        L.popup().setLatLng([pts[0][0], pts[0][1]]).setContent(`
          <div class="pop-title">📍 ${STATE_NAMES[uf] || uf} · ${uf}</div>
          <div class="pop-row"><span>Receita</span><strong>${fmtMoney(s.revenue, 2)}</strong></div>
          <div class="pop-row"><span>Pedidos</span><strong>${fmtInt(s.orders)}</strong></div>
          <div class="pop-row"><span>Ticket médio</span><strong>${s.orders ? fmtMoney(s.revenue / s.orders, 2) : '—'}</strong></div>
          <div class="pop-row"><span>% do total</span><strong>${pctStr(val / Math.max(1, totalAll) * 100)}</strong></div>
          ${popupChanHTML(s.byChannel)}
        `).openOn(map);
      });
      mapLayers.push(circle);
    }
  }

  // Pill labels no centroide de cada estado
  for (const [uf, s] of Object.entries(stateData)) {
    const centroid = CENTROIDS[uf]; if (!centroid) continue;
    const val   = getValue(s);
    const label = isMoney ? fmtMoney(val) : fmtInt(val) + ' ped.';
    const text  = `${uf}: ${label}`;
    const pillW = Math.max(80, text.length * 7 + 28);
    const icon  = L.divIcon({
      html: `<div style="width:${pillW}px;text-align:center;background:${heatConfig.pillColor};color:${heatConfig.textColor};padding:5px 0;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;font-family:inherit;box-shadow:0 2px 8px rgba(0,0,0,.28);cursor:pointer">${text}</div>`,
      className: '', iconSize: [pillW, 26], iconAnchor: [pillW / 2, 13],
    });
    const marker = L.marker(centroid, { icon }).addTo(map);
    marker.on('click', () => {
      L.popup().setLatLng(centroid).setContent(`
        <div class="pop-title">📍 ${STATE_NAMES[uf] || uf} · ${uf}</div>
        <div class="pop-row"><span>Receita</span><strong>${fmtMoney(s.revenue, 2)}</strong></div>
        <div class="pop-row"><span>Pedidos</span><strong>${fmtInt(s.orders)}</strong></div>
        <div class="pop-row"><span>Ticket médio</span><strong>${s.orders ? fmtMoney(s.revenue / s.orders, 2) : '—'}</strong></div>
        <div class="pop-row"><span>% do total</span><strong>${pctStr(val / Math.max(1, totalAll) * 100)}</strong></div>
        ${popupChanHTML(s.byChannel)}
      `).openOn(map);
    });
    mapLayers.push(marker);
  }

  const grad = document.getElementById('legendGrad');
  grad.className = '';
  grad.style.cssText = `width:100px;height:7px;border-radius:4px;background:linear-gradient(to right,${heatConfig.coldColor},${heatConfig.midColor},${heatConfig.hotColor})`;
}

// ── Render ──
function render(d) {
  lastApiData = d;
  stateData = d.byState || {};
  const isMoney = metric === 'receita';
  const label   = rangeLabel(d.period.since, d.period.until);
  const marketLabel = market === 'us' ? 'EUA' : 'Brasil';

  document.getElementById('pageSub').textContent =
    `Vita Pet Life · ${marketLabel} · ${CocoColors.chLabel(d.channel)} · ${label}`;
  document.getElementById('mapTitle').textContent =
    `${vizMode === 'choropleth' ? 'Coropleto' : 'Mapa de calor'} · ${METRIC_LABEL[metric]} por estado`;
  document.getElementById('rankTitle').textContent =
    `Ranking de estados · ${METRIC_LABEL[metric]}`;

  const sorted = Object.entries(stateData)
    .map(([code, s]) => ({ code, ...s, val: isMoney ? s.revenue : s.orders }))
    .sort((a, b) => b.val - a.val);

  const total = sorted.reduce((a, s) => a + s.val, 0);
  document.getElementById('rankTotal').textContent = sorted.length
    ? `Total: ${isMoney ? fmtMoney(total) : fmtInt(total) + ' pedidos'}`
    : '';

  // KPIs
  const stateCount = market === 'us' ? sorted.filter(s => US_50.has(s.code)).length : sorted.length;
  document.getElementById('kpiStates').textContent = sorted.length ? stateCount : '—';
  document.getElementById('kpiStatesSub').textContent = sorted.length
    ? (market === 'us' ? 'de 50 estados dos EUA' : 'de 27 estados do Brasil')
    : 'sincronize para carregar';

  if (sorted.length) {
    document.getElementById('kpiLeader').textContent = STATE_NAMES[sorted[0].code] || sorted[0].code;
    document.getElementById('kpiLeaderSub').textContent = isMoney
      ? fmtMoney(sorted[0].val)
      : fmtInt(sorted[0].val) + ' pedidos';
  } else {
    document.getElementById('kpiLeader').textContent = '—';
    document.getElementById('kpiLeaderSub').textContent = '—';
  }

  if (sorted.length >= 3 && total > 0) {
    const top3sum = sorted.slice(0,3).reduce((a,s)=>a+s.val,0);
    document.getElementById('kpiTop3').textContent = pctStr(top3sum/total*100);
  } else {
    document.getElementById('kpiTop3').textContent = '—';
  }

  // Ranking grid
  const maxVal = sorted[0]?.val || 1;
  if (sorted.length) {
    document.getElementById('stateGrid').innerHTML = sorted.map((s, i) => {
      const name   = STATE_NAMES[s.code] || s.code;
      const barW   = Math.max((s.val / maxVal) * 100, 1).toFixed(1);
      const valTxt = isMoney ? fmtMoney(s.val) : fmtInt(s.val) + ' ped.';
      const subTxt = isMoney
        ? `${fmtInt(s.orders)} pedido${s.orders!==1?'s':''} · ${pctStr(s.val/total*100)}`
        : `${fmtMoney(s.revenue)} · ${pctStr(s.val/total*100)}`;
      const barCol = choroColor(s.val / maxVal);
      return `<div class="state-card" onclick="openStateModal('${s.code}')">
        <div class="sc-head">
          <span class="sc-rank">${i+1}</span>
          <span class="sc-name">${name}</span>
          <span class="sc-code">${s.code}</span>
        </div>
        <div class="sc-bar-track"><div class="sc-bar-fill" style="width:${barW}%;background:${barCol}"></div></div>
        <div class="sc-foot"><span class="sc-val">${valTxt}</span><span class="sc-sub">${subTxt}</span></div>
      </div>`;
    }).join('');
  } else {
    document.getElementById('stateGrid').innerHTML =
      '<div class="muted-state" style="grid-column:1/-1">Nenhum dado de estado. Clique em ↻ Sincronizar para atualizar os pedidos com endereço de entrega.</div>';
  }

  const now = new Date();
  setLive('ok', `Ao vivo · ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`);
  const up = d.updatedAt ? new Date(d.updatedAt).toLocaleString('pt-BR') : '—';
  document.getElementById('footerDate').textContent =
    `Vita Pet Life · ${marketLabel} · ${CocoColors.chLabel(d.channel)} · ${label} · última sincronização: ${up}`;

  drawMap();
}

// ── Load dashboard data ──
async function loadData() {
  setLive('loading','Atualizando…');
  try {
    const p = new URLSearchParams({ channel, metric:'receita', since:sinceDate, until:untilDate, market });
    const r = await fetch('/api/dashboard?'+p);
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    render(d);
  } catch(e) {
    setLive('error','Erro');
    document.getElementById('footerDate').textContent = 'Erro: '+e.message;
  }
}

// ── Viz mode buttons ──
function syncVizMode() {
  const isHeat = vizMode === 'heat';
  document.getElementById('btnChoropleth').classList.toggle('active', !isHeat);
  document.getElementById('btnHeat').classList.toggle('active', isHeat);
}
document.getElementById('btnChoropleth').addEventListener('click', () => { vizMode = 'choropleth'; syncVizMode(); drawMap(); });
document.getElementById('btnHeat').addEventListener('click', () => { vizMode = 'heat'; syncVizMode(); drawMap(); });

// ── Settings panel (padrão Revenue) ──
// Botões .ccp-trigger (colors.js) guardam a cor atual em data-hex — substitui
// o antigo <input type="color">.value.
function setColorBtn(id, hex) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.dataset.hex = hex;
  btn.style.background = hex;
}
function syncHeatCfgUI() {
  setColorBtn('hcCold',   heatConfig.coldColor);
  setColorBtn('hcMid',    heatConfig.midColor);
  setColorBtn('hcHot',    heatConfig.hotColor);
  setColorBtn('hcPill',   heatConfig.pillColor);
  setColorBtn('hcText',   heatConfig.textColor);
  setColorBtn('hcBorder', heatConfig.borderColor);
  document.getElementById('hcBorderW').value   = heatConfig.borderWeight;
  document.getElementById('hcRadius').value    = heatConfig.radius;
  document.getElementById('hcBlur').value      = heatConfig.blur;
  document.getElementById('hcMinOp').value     = heatConfig.minOpacity;
  document.getElementById('hcBorderWVal').textContent = heatConfig.borderWeight;
  document.getElementById('hcRadiusVal').textContent  = heatConfig.radius;
  document.getElementById('hcBlurVal').textContent    = heatConfig.blur;
  document.getElementById('hcMinOpVal').textContent   = heatConfig.minOpacity + '%';
}

function syncChoroUI() {
  setColorBtn('chCold',   choroConfig.lowColor);
  setColorBtn('chMid',    choroConfig.midColor);
  setColorBtn('chHigh',   choroConfig.highColor);
  setColorBtn('chBorder', choroConfig.borderColor);
  document.getElementById('chBorderW').value    = choroConfig.borderWeight;
  document.getElementById('chOpacity').value    = choroConfig.fillOpacity;
  document.getElementById('chBorderWVal').textContent = choroConfig.borderWeight;
  document.getElementById('chOpacityVal').textContent = choroConfig.fillOpacity + '%';
}

// Troca os <input type="color"> do painel de mapa pelo novo picker (colors.js) —
// mantém o mesmo id/valor, só muda o widget de seleção.
['chCold','chMid','chHigh','chBorder','hcCold','hcMid','hcHot','hcPill','hcText','hcBorder'].forEach(id => {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    CocoColors.openPicker(btn, btn.dataset.hex, hex => {
      btn.dataset.hex = hex;
      btn.style.background = hex;
    });
  });
});

document.getElementById('chBorderW').addEventListener('input', e => { document.getElementById('chBorderWVal').textContent = e.target.value; });
document.getElementById('chOpacity').addEventListener('input', e => { document.getElementById('chOpacityVal').textContent = e.target.value + '%'; });

function openSettings() { syncHeatCfgUI(); syncChoroUI(); document.getElementById('spOverlay').classList.add('open'); document.getElementById('spPanel').classList.add('open'); }
function closeSettings() { document.getElementById('spOverlay').classList.remove('open'); document.getElementById('spPanel').classList.remove('open'); }

document.getElementById('settingsBtn').addEventListener('click', e => { e.stopPropagation(); openSettings(); });
document.getElementById('spClose').addEventListener('click', closeSettings);
document.getElementById('spOverlay').addEventListener('click', closeSettings);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

document.getElementById('hcBorderW').addEventListener('input', e => { document.getElementById('hcBorderWVal').textContent = e.target.value; });
document.getElementById('hcRadius').addEventListener('input', e => { document.getElementById('hcRadiusVal').textContent = e.target.value; });
document.getElementById('hcBlur').addEventListener('input', e => { document.getElementById('hcBlurVal').textContent = e.target.value; });
document.getElementById('hcMinOp').addEventListener('input', e => { document.getElementById('hcMinOpVal').textContent = e.target.value + '%'; });

document.getElementById('hcApply').addEventListener('click', () => {
  heatConfig = {
    coldColor:    document.getElementById('hcCold').dataset.hex,
    midColor:     document.getElementById('hcMid').dataset.hex,
    hotColor:     document.getElementById('hcHot').dataset.hex,
    pillColor:    document.getElementById('hcPill').dataset.hex,
    textColor:    document.getElementById('hcText').dataset.hex,
    borderColor:  document.getElementById('hcBorder').dataset.hex,
    borderWeight: Number(document.getElementById('hcBorderW').value),
    radius:       Number(document.getElementById('hcRadius').value),
    blur:         Number(document.getElementById('hcBlur').value),
    minOpacity:   Number(document.getElementById('hcMinOp').value),
  };
  choroConfig = {
    lowColor:     document.getElementById('chCold').dataset.hex,
    midColor:     document.getElementById('chMid').dataset.hex,
    highColor:    document.getElementById('chHigh').dataset.hex,
    borderColor:  document.getElementById('chBorder').dataset.hex,
    borderWeight: Number(document.getElementById('chBorderW').value),
    fillOpacity:  Number(document.getElementById('chOpacity').value),
  };
  saveHeatConfig();
  saveChoroConfig();
  closeSettings();
  drawMap();
});
document.getElementById('hcReset').addEventListener('click', () => {
  heatConfig = { ...HEAT_DEFAULTS(market) };
  choroConfig = { ...CHORO_DEFAULTS };
  saveHeatConfig();
  saveChoroConfig();
  syncHeatCfgUI();
  syncChoroUI();
  drawMap();
});

// ── State detail modal ──
function openStateModal(uf) {
  const s = stateData[uf];
  if (!s) return;
  const isMoney = metric === 'receita';
  const sorted = Object.entries(stateData)
    .map(([c, d]) => ({ code: c, val: isMoney ? d.revenue : d.orders, revenue: d.revenue, orders: d.orders }))
    .sort((a, b) => b.val - a.val);
  const totalAll = sorted.reduce((a, x) => a + x.val, 0);
  const val = isMoney ? s.revenue : s.orders;
  const pct = totalAll > 0 ? val / totalAll * 100 : 0;
  const rank = sorted.findIndex(x => x.code === uf) + 1;
  const maxVal = sorted[0]?.val || 1;
  const ticket = s.orders > 0 ? s.revenue / s.orders : 0;

  document.getElementById('smdTitle').textContent = `${STATE_NAMES[uf] || uf} · ${uf}`;
  document.getElementById('smdSub').textContent = `#${rank} de ${sorted.length} estados · ${pctStr(pct)} do total`;

  document.getElementById('smdKpis').innerHTML = `
    <div class="smd-kpi"><div class="smd-kpi-label">Receita</div><div class="smd-kpi-value">${fmtMoney(s.revenue)}</div></div>
    <div class="smd-kpi"><div class="smd-kpi-label">Pedidos</div><div class="smd-kpi-value">${fmtInt(s.orders)}</div></div>
    <div class="smd-kpi"><div class="smd-kpi-label">Ticket médio</div><div class="smd-kpi-value">${ticket > 0 ? fmtMoney(ticket) : '—'}</div></div>
    <div class="smd-kpi"><div class="smd-kpi-label">Participação</div><div class="smd-kpi-value">${pctStr(pct)}</div></div>
  `;
  document.getElementById('smdChan').innerHTML = modalChanHTML(s.byChannel);

  const top8 = sorted.slice(0, 8);
  document.getElementById('smdChart').innerHTML = top8.map(x => {
    const barW = ((x.val / maxVal) * 100).toFixed(1);
    const valTxt = isMoney ? fmtMoney(x.val) : fmtInt(x.val) + ' ped.';
    const isThis = x.code === uf;
    const barColor = isThis ? choroColor(x.val / maxVal) : 'var(--border2)';
    return `<div class="smd-bar-row${isThis ? ' smd-highlight' : ''}">
      <span class="smd-bar-uf">${x.code}</span>
      <div class="smd-bar-track"><div class="smd-bar-fill" style="width:${barW}%;background:${barColor}"></div></div>
      <span class="smd-bar-val">${valTxt}</span>
    </div>`;
  }).join('');

  document.getElementById('smdOverlay').classList.add('open');
  document.getElementById('smdModal').classList.add('open');
}
function closeStateModal() {
  document.getElementById('smdOverlay').classList.remove('open');
  document.getElementById('smdModal').classList.remove('open');
}
document.getElementById('smdClose').addEventListener('click', closeStateModal);
document.getElementById('smdOverlay').addEventListener('click', closeStateModal);

// ── Filter controls ──
function renderChannelOptions() {
  const wrap = document.getElementById('cselChannel');
  const pop = document.getElementById('channelPop');
  pop.innerHTML = CHAN.map(k =>
    `<div class="csel-opt${k===channel?' active':''}" data-value="${k}">${CocoColors.chLabel(k)}</div>`
  ).join('');
  pop.querySelectorAll('.csel-opt').forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      channel = opt.dataset.value;
      localStorage.setItem(market === 'us' ? 'coco_ch_us' : 'coco_channel', channel);
      wrap.classList.remove('open');
      syncControls();
      loadData();
    });
  });
}

function syncControls() {
  document.getElementById('metricVal').textContent = METRIC_LABEL[metric];
  document.querySelectorAll('#cselMetric .csel-opt').forEach(o=>o.classList.toggle('active',o.dataset.value===metric));
  document.getElementById('channelVal').textContent = CocoColors.chLabel(channel);
  document.querySelectorAll('#cselChannel .csel-opt').forEach(o=>o.classList.toggle('active',o.dataset.value===channel));
  document.getElementById('periodValue').textContent = rangeLabel(sinceDate,untilDate);
}

function closeAllDropdowns() { document.querySelectorAll('.csel.open').forEach(el=>el.classList.remove('open')); }

document.addEventListener('click', () => {
  closeAllDropdowns();
  document.getElementById('periodPop').classList.remove('open');
});

document.querySelectorAll('.csel').forEach(el => {
  el.addEventListener('click', e => {
    e.stopPropagation();
    const wasOpen = el.classList.contains('open');
    closeAllDropdowns();
    if (!wasOpen) el.classList.add('open');
  });
});

document.querySelectorAll('#cselMetric .csel-opt').forEach(opt => {
  opt.addEventListener('click', e => {
    e.stopPropagation();
    metric = opt.dataset.value;
    localStorage.setItem('coco_metric_geo', metric);
    document.getElementById('cselMetric').classList.remove('open');
    syncControls();
    // Métrica só muda a exibição local; canal requer nova busca na API
    if (lastApiData) render(lastApiData);
    else loadData();
  });
});

const pop=document.getElementById('periodPop'),fromInp=document.getElementById('dateFrom'),toInp=document.getElementById('dateTo'),ppErr=document.getElementById('ppErr');
document.getElementById('periodPill').addEventListener('click', e => {
  e.stopPropagation(); closeAllDropdowns();
  const wasOpen=pop.classList.contains('open');
  pop.classList.toggle('open',!wasOpen);
  if(!wasOpen){ppErr.textContent='';fromInp.value=sinceDate;toInp.value=untilDate;fromInp.max=todayISO;toInp.max=todayISO;document.querySelectorAll('.pp-presets button').forEach(b=>{const[s,u]=presetRange(b.dataset.preset);b.classList.toggle('active',s===sinceDate&&u===untilDate)});}
});
pop.addEventListener('click',e=>e.stopPropagation());
document.querySelectorAll('.pp-presets button').forEach(b=>b.addEventListener('click',()=>{
  const[s,u]=presetRange(b.dataset.preset);sinceDate=s;untilDate=u;
  localStorage.setItem('coco_since',s);localStorage.setItem('coco_until',u);
  pop.classList.remove('open');syncControls();loadData();
}));
document.getElementById('applyRange').addEventListener('click',()=>{
  const s=fromInp.value,u=toInp.value;
  if(!s||!u){ppErr.textContent='Selecione as duas datas.';return}
  if(parseISO(s)>parseISO(u)){ppErr.textContent='Data inicial deve ser anterior à final.';return}
  ppErr.textContent='';sinceDate=s;untilDate=u;
  localStorage.setItem('coco_since',s);localStorage.setItem('coco_until',u);
  pop.classList.remove('open');syncControls();loadData();
});
document.getElementById('syncBtn').addEventListener('click',async()=>{
  setLive('loading','Sincronizando…');
  try{await fetch('/api/sync',{method:'POST'});}catch(e){}
  loadData();
});

// ── Refresh pill ──
let refreshMin = Number(localStorage.getItem('coco_refresh') ?? 5);
let refreshTimer = null;
function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (refreshMin > 0) refreshTimer = setInterval(loadData, refreshMin * 60000);
}
function syncRefreshUI() {
  const labels = { '0':'Desligar','1':'1 min','5':'5 min','15':'15 min','30':'30 min' };
  document.getElementById('refreshVal').textContent = labels[String(refreshMin)] || refreshMin + ' min';
  document.querySelectorAll('#cselRefresh .csel-opt').forEach(o => o.classList.toggle('active', o.dataset.value === String(refreshMin)));
}
document.querySelectorAll('#cselRefresh .csel-opt').forEach(o => {
  o.addEventListener('click', e => {
    e.stopPropagation();
    refreshMin = Number(o.dataset.value);
    localStorage.setItem('coco_refresh', String(refreshMin));
    syncRefreshUI();
    scheduleRefresh();
    document.getElementById('cselRefresh').classList.remove('open');
  });
});
syncRefreshUI();

// ── Market toggle ──
async function setMarket(m) {
  if (m === market) return;
  market = m;
  localStorage.setItem('coco_market', m);
  document.getElementById('mktBtnBr').classList.toggle('active', m === 'br');
  document.getElementById('mktBtnUs').classList.toggle('active', m === 'us');
  document.body.classList.toggle('market-us', m === 'us');

  CHAN        = CocoColors.channelsFor(m, { comTodos: true });
  STATE_NAMES = CocoGeo.STATE_NAMES[m];
  CENTROIDS   = CocoGeo.CENTROIDS[m];
  SUB_REGIONS = CocoGeo.SUB_REGIONS[m];
  channel     = loadChannel(m);
  choroConfig = loadChoroConfig(m);
  heatConfig  = loadHeatConfig(m);
  syncChoroUI();
  syncHeatCfgUI();
  renderChannelOptions();
  syncControls();

  applyMapView(m);
  setLive('loading', 'Atualizando…');
  await loadGeoJSONFor(m);
  await loadData();
}

// ── Init ──
document.getElementById('mktBtnBr').classList.toggle('active', market === 'br');
document.getElementById('mktBtnUs').classList.toggle('active', market === 'us');
document.body.classList.toggle('market-us', market === 'us');
syncChoroUI();
syncHeatCfgUI();
renderChannelOptions();
syncControls();
(async () => {
  await loadGeoJSONFor(market);
  await loadData();
  scheduleRefresh();
})();

// ── Init toggles de canal ──
(function() {
  const togMap    = document.getElementById('toggleChanMap');
  const togExpand = document.getElementById('toggleChanExpand');
  if (togMap) {
    togMap.checked = isChanMap();
    togMap.addEventListener('change', () => localStorage.setItem('coco_chan_map', togMap.checked ? '1' : '0'));
  }
  if (togExpand) {
    togExpand.checked = isChanExpand();
    togExpand.addEventListener('change', () => localStorage.setItem('coco_chan_expand', togExpand.checked ? '1' : '0'));
  }
})();

