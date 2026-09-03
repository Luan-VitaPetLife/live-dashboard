const fmtInt = v => Math.round(v || 0).toLocaleString('pt-BR');
// Delega pro CocoMoeda (js/moeda.js), fonte única do formato de dinheiro. O segundo parâmetro
// continua existindo só pra não mexer nas chamadas que já passam ele; as casas decimais não são
// mais escolha de quem chama — valor SEMPRE sai com centavos (decisão do Luan, 03/09/2026).
function fmtMoney(v, mkt = market) { return CocoMoeda.fmt(v, mkt); }

// ── Metadados de canal (mesmas cores de index.html/DEFAULT_CH) ──
// Nome, cor, logo e mercado de cada canal vêm do catálogo único em js/colors.js — antes esta
// tabela existia igualzinha aqui e em outras quatro telas, e as cópias já discordavam entre si.
// Lendo de lá, a página também passa a respeitar a cor que o usuário salva em Configurações.
const chMeta = ch => CocoColors.ch[ch] || { label: ch, bg: '#999', text: '#fff' };
// Exportar quantidade vendida pra planilha: por enquanto só Shopify US (mesmo escopo do backend,
// ver GET /api/products/export em server.js). Outros canais ganham o botão quando o backend abrir.
const EXPORTABLE_PRODUCT_CHANNELS = new Set(['shopify_us']);
function exportProductsCsv(ch) {
  const p = new URLSearchParams({ market, channel: ch, since: state.since, until: state.until });
  window.location.href = '/api/products/export?' + p.toString();
}

function contrastText(hex) {
  const h = (hex || '#000').replace('#', '');
  if (h.length !== 6) return '#fff';
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.55 ? '#333' : '#fff';
}

// ── State ─────────────────────────────────────────────────
let market = localStorage.getItem('coco_market') || 'br';
let current = null;
// Cards sempre abrem só com o primeiro expandido — não persiste entre recarregamentos (proposital).
let collapsedState = {};
const expandedState = JSON.parse(localStorage.getItem('coco_produtos_expanded') || '{}');
let layout = localStorage.getItem('coco_produtos_layout') || 'row';

// ── Refresh automático (mesmo padrão de index.html) ────────
let refreshMin = Number(localStorage.getItem('coco_refresh') ?? 5);
let refreshTimer = null;
function applyRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (refreshMin > 0) refreshTimer = setInterval(load, refreshMin * 60 * 1000);
}

// ── Ordem dos canais (drag and drop) ───────────────────────
let channelOrder = JSON.parse(localStorage.getItem('coco_produtos_order') || '{}');
function getOrderedChannels(m) {
  const base = CocoColors.channelsFor(m);
  const saved = channelOrder[m];
  if (!saved || !saved.length) return base.slice();
  const ordered = saved.filter(ch => base.includes(ch));
  base.forEach(ch => { if (!ordered.includes(ch)) ordered.push(ch); });
  return ordered;
}
function applyDefaultCollapse(orderedChannels) {
  collapsedState = {};
  orderedChannels.forEach((ch, i) => { collapsedState[ch] = i !== 0; });
}

function setLayout(mode) {
  layout = mode;
  localStorage.setItem('coco_produtos_layout', mode);
  applyLayout();
}
function applyLayout() {
  document.getElementById('prodGrid').classList.toggle('layout-col', layout === 'col');
  document.querySelectorAll('.layout-btn').forEach(b => b.classList.toggle('active', b.dataset.layout === layout));
}

function toggleCollapse(ch) {
  collapsedState[ch] = !collapsedState[ch];
  document.getElementById(`prod-card-${ch}`)?.classList.toggle('collapsed', collapsedState[ch]);
}

// ── Drag and drop (reordenar cards de canal) — arraste customizado por ponteiro,
// não usa a Drag and Drop API nativa do HTML5. A API nativa deixa o elemento de
// origem no DOM (é dele que o navegador tira a "imagem fantasma" que acompanha o
// cursor, fora do nosso controle) — na prática dava a sensação de duas cópias do
// card: uma parada no lugar original e outra "puxando" em outro ponto da lista.
// Aqui o card real é removido da grade assim que o arraste começa (só sobra o
// placeholder tracejado indicando onde ele vai cair) e um clone dele, em
// position:fixed, segue o cursor de verdade a cada mousemove — só uma cópia
// visível a qualquer momento, sempre grudada no mouse.
let dragCard = null;
let dragGhost = null;
let dragClone = null;
let dragGrabX = 0, dragGrabY = 0;
let dragStartX = 0, dragStartY = 0;
let dragStarted = false;
const DRAG_MOVE_THRESHOLD = 4; // px — evita iniciar o arraste num simples clique na alça

function getDragAfterElement(container, x, y) {
  const els = [...container.querySelectorAll('.prod-card')];
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
function persistOrder() {
  const grid = document.getElementById('prodGrid');
  channelOrder[market] = [...grid.querySelectorAll('.prod-card')].map(c => c.dataset.ch);
  localStorage.setItem('coco_produtos_order', JSON.stringify(channelOrder));
  applyDefaultCollapse(channelOrder[market]);
  document.querySelectorAll('.prod-card').forEach(c => c.classList.toggle('collapsed', collapsedState[c.dataset.ch]));
}
function beginDrag() {
  dragStarted = true;
  const card = dragCard;
  const rect = card.getBoundingClientRect();
  dragGrabX = dragStartX - rect.left;
  dragGrabY = dragStartY - rect.top;

  dragGhost = document.createElement('div');
  dragGhost.className = 'prod-card-ghost';
  dragGhost.style.height = rect.height + 'px';
  card.after(dragGhost);

  dragClone = card.cloneNode(true);
  dragClone.classList.add('prod-card-floating');
  dragClone.style.width = rect.width + 'px';
  dragClone.style.left = rect.left + 'px';
  dragClone.style.top = rect.top + 'px';
  document.body.appendChild(dragClone);

  card.remove();
  document.body.classList.add('dragging-active');
}
function dragPointerMove(e) {
  if (!dragStarted) {
    if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) < DRAG_MOVE_THRESHOLD) return;
    beginDrag();
  }
  dragClone.style.left = (e.clientX - dragGrabX) + 'px';
  dragClone.style.top = (e.clientY - dragGrabY) + 'px';
  const grid = document.getElementById('prodGrid');
  const afterEl = getDragAfterElement(grid, e.clientX, e.clientY);
  if (afterEl == null) grid.appendChild(dragGhost);
  else if (afterEl !== dragGhost) grid.insertBefore(dragGhost, afterEl);
}
function dragPointerUp() {
  document.removeEventListener('mousemove', dragPointerMove);
  document.removeEventListener('mouseup', dragPointerUp);
  const card = dragCard;
  if (dragStarted && card) {
    const grid = document.getElementById('prodGrid');
    grid.insertBefore(card, dragGhost);
    card.classList.add('drop-bounce');
    setTimeout(() => card.classList.remove('drop-bounce'), 320);
    persistOrder();
  }
  if (dragGhost) { dragGhost.remove(); dragGhost = null; }
  if (dragClone) { dragClone.remove(); dragClone = null; }
  document.body.classList.remove('dragging-active');
  dragCard = null;
  dragStarted = false;
}
function attachDragHandlers() {
  const grid = document.getElementById('prodGrid');
  grid.querySelectorAll('.prod-card').forEach(card => {
    card.querySelector('.drag-handle')?.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragCard = card;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStarted = false;
      document.addEventListener('mousemove', dragPointerMove);
      document.addEventListener('mouseup', dragPointerUp);
    });
  });
}

function toggleExpand(ch) {
  expandedState[ch] = !expandedState[ch];
  localStorage.setItem('coco_produtos_expanded', JSON.stringify(expandedState));
  const card = document.getElementById(`prod-card-${ch}`);
  card?.classList.toggle('expanded', expandedState[ch]);
  const icon = card?.querySelector('.prod-expand-btn i');
  if (icon) icon.className = expandedState[ch] ? 'bi bi-arrows-angle-contract' : 'bi bi-arrows-angle-expand';
}

// ── Edição em massa (aplicar valor a todos os produtos de um canal) ──
let bulkTarget = null;
function openBulkPop(e, field, ch, label) {
  e.stopPropagation();
  bulkTarget = { field, ch };
  const pop = document.getElementById('bulkPop');
  document.getElementById('bulkPopLabel').textContent = `${label} — ${CocoColors.chLabel(ch)}`;
  const input = document.getElementById('bulkPopInput');
  input.value = '';
  const rect = e.currentTarget.getBoundingClientRect();
  pop.style.top = (rect.bottom + 6) + 'px';
  pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 206)) + 'px';
  pop.classList.add('open');
  input.focus();
}
function closeBulkPop() {
  document.getElementById('bulkPop').classList.remove('open');
  bulkTarget = null;
}
async function applyBulk() {
  if (!bulkTarget) return;
  const { field, ch } = bulkTarget;
  const input = document.getElementById('bulkPopInput');
  const value = input.value === '' ? null : Number(input.value);
  const products = current?.channels?.[ch]?.products || [];
  closeBulkPop();
  if (!products.length) return;
  await Promise.all(products.map(p => fetch('/api/products/finance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: ch, title: p.title, [field]: value }),
  })));
  await load();
}
document.addEventListener('click', e => {
  const pop = document.getElementById('bulkPop');
  if (pop.classList.contains('open') && !pop.contains(e.target) && !e.target.closest('.th-bulk-btn')) closeBulkPop();
});

function rangeForPreset(p) {
  const today = new Date(); const iso = d => d.toISOString().slice(0, 10);
  if (p === 'today') return { since: iso(today), until: iso(today), label: 'Hoje' };
  if (p === '7d')   { const s = new Date(today); s.setDate(s.getDate() - 6); return { since: iso(s), until: iso(today), label: '7 dias' }; }
  if (p === 'month'){ const s = new Date(today.getFullYear(), today.getMonth(), 1); return { since: iso(s), until: iso(today), label: 'Este mês' }; }
  const s = new Date(today); s.setDate(s.getDate() - 29); return { since: iso(s), until: iso(today), label: '30 dias' };
}
let state = rangeForPreset('30d');

// ── Market ────────────────────────────────────────────────
function setMarket(m) {
  market = m;
  localStorage.setItem('coco_market', m);
  document.getElementById('mktBtnBr').classList.toggle('active', m === 'br');
  document.getElementById('mktBtnUs').classList.toggle('active', m === 'us');
  document.body.classList.toggle('market-us', m === 'us');
  applyDefaultCollapse(getOrderedChannels(m));
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

// ── Refresh rate dropdown ───────────────────────────────────
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

// ── Sincronizar agora ────────────────────────────────────────
// Comportamento compartilhado (js/sync-btn.js): desabilita, mostra que está rodando e mostra o
// erro no próprio botão quando falha. Antes cada tela tinha a sua cópia, três delas sem retorno
// nenhum, e todas engoliam o erro.
CocoSync.ligar(load);

// ── Painel de Configurações (cores, via colors.js) ──────────
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

const setText = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };

// ── Render ────────────────────────────────────────────────
function logoHTML(meta) {
  if (meta.logo) {
    const cls = meta.logoFill ? 'camp-logo camp-logo-img camp-logo-fill' : 'camp-logo camp-logo-img';
    return `<div class="${cls}"><img src="${meta.logo}" alt="${meta.label}" draggable="false"></div>`;
  }
  // Canal sem logo cadastrada: quadro na cor do canal com a inicial. `text` já vem do catálogo
  // com o contraste calculado, então a letra nunca some no fundo.
  return `<div class="camp-logo" style="background:${meta.bg};color:${meta.text}">${(meta.label || '?')[0]}</div>`;
}

function comboBits(p) {
  if (!p.comboQty) return '';
  const parts = Object.entries(p.comboBySize || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([size, n]) => `${n} combo de ${size}`);
  return `${p.avulsoQty || 0} avulso, ${parts.join(', ')}`;
}

const fmtPct = v => (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

function rowHTML(p, ch) {
  const combo = comboBits(p);
  const thumb = p.image
    ? `<img class="prod-thumb" src="${p.image}" alt="" loading="lazy" draggable="false" onerror="this.outerHTML='<div class=&quot;prod-thumb-ph&quot;><i class=&quot;bi bi-image&quot;></i></div>'">`
    : `<div class="prod-thumb-ph"><i class="bi bi-image"></i></div>`;
  const typeTag = p.type ? `<span class="prod-type-tag">${p.type}</span>` : '';
  const dataAttrs = `data-channel="${escapeHtml(ch)}" data-title="${escapeHtml(p.title)}"`;
  const profitCells = p.profit != null
    ? `<td class="prod-num ${p.profit >= 0 ? 'prod-profit-pos' : 'prod-profit-neg'}">${fmtMoney(p.profit)}</td>
       <td class="prod-num ${p.profit >= 0 ? 'prod-profit-pos' : 'prod-profit-neg'}">${fmtPct(p.profitPct)}</td>`
    : `<td class="prod-num prod-muted">—</td><td class="prod-num prod-muted">—</td>`;
  // Linha unificada (Unificador, ver Configurações): qty/receita/lucro são a soma dos produtos do
  // grupo, mas COG/frete/%impostos/%comissão são valores POR PRODUTO — não dá pra mostrar UM valor
  // (os membros podem ter overrides diferentes), então o campo nasce vazio aqui, igual a uma linha
  // nova. Mas o input FICA editável: como o grupo é sempre dentro do mesmo canal (ver
  // mergeProductRows), aplicar o mesmo valor a todos os membros é uma leitura razoável, e evita o
  // beco sem saída de antes ("edite no produto individual" sem nenhum jeito de chegar nele, já que
  // o título individual não aparece mais em lugar nenhum uma vez agrupado — reportado em
  // produção). data-grouped/data-members fazem onFinanceEdit gravar o valor em cada membro.
  const groupAttrs = p._grouped ? ` data-grouped="1" data-members="${escapeHtml(JSON.stringify(p._members))}"` : '';
  const groupHint = p._grouped ? ` Aplica a todos os ${p._members.length} produtos do grupo, dentro deste canal.` : '';
  const financeCells = `<td class="prod-num"><input class="prod-input" type="number" step="0.01" placeholder="—" value="${p._grouped ? '' : (p.cog ?? '')}" ${dataAttrs}${groupAttrs} data-field="cog" title="Custo do produto (COG), por unidade.${groupHint} Vazio = usa o padrão; 0 é um valor válido e fica salvo."></td>
    <td class="prod-num"><input class="prod-input" type="number" step="0.01" placeholder="—" value="${p._grouped ? '' : (p.shipping ?? '')}" ${dataAttrs}${groupAttrs} data-field="shipping" title="Custo de frete, por unidade.${groupHint} Vazio = considera 0; 0 é um valor válido e fica salvo."></td>
    <td class="prod-num"><input class="prod-input prod-input-pct" type="number" step="0.01" placeholder="—" value="${p._grouped ? '' : (p.taxPct ?? '')}" ${dataAttrs}${groupAttrs} data-field="taxPct" title="% de imposto sobre a venda.${groupHint} Vazio = usa o padrão; 0 é um valor válido e fica salvo."></td>
    <td class="prod-num"><input class="prod-input prod-input-pct" type="number" step="0.01" placeholder="—" value="${p._grouped ? '' : (p.commissionPct ?? '')}" ${dataAttrs}${groupAttrs} data-field="commissionPct" title="% de comissão do marketplace.${groupHint} Vazio = usa o padrão; 0 é um valor válido e fica salvo."></td>`;
  const badge = p._grouped
    ? `<span class="stk-unify-badge" title="${escapeHtml(p._members.join(' + '))}"><i class="bi bi-link-45deg"></i>${p._members.length}</span>`
    : '';
  return `<tr>
    <td>
      <div class="prod-name-wrap">
        ${thumb}
        <div class="prod-name-col">
          <div class="prod-name-line"><span class="prod-name" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span>${typeTag}${badge}</div>
          ${combo ? `<div class="prod-combo">${combo}</div>` : ''}
        </div>
      </div>
    </td>
    <td class="prod-num">${fmtInt(p.qty)}</td>
    <td class="prod-num">${fmtMoney(p.revenue)}</td>
    <td class="prod-num">${fmtMoney(p.avgTicket)}</td>
    ${financeCells}
    ${profitCells}
  </tr>`;
}

function cardHTML(ch) {
  const meta = chMeta(ch);
  const chClass = meta.market === 'us' ? 'ch-us' : 'ch-br';
  const data = current?.channels?.[ch];
  const products = data?.products || [];
  const rows = products.length
    ? products.map(p => rowHTML(p, ch)).join('')
    : '<tr><td colspan="10" class="prod-empty">Nenhum produto encontrado</td></tr>';
  const collapsed = collapsedState[ch] ? ' collapsed' : '';
  const expanded = expandedState[ch] ? ' expanded' : '';
  const expandIcon = expandedState[ch] ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand';
  const totalQty = products.reduce((a, p) => a + p.qty, 0);
  const totalShipping = products.reduce((a, p) => a + (p.shippingTotal || 0), 0);
  const profitClass = data?.totalProfit != null ? (data.totalProfit >= 0 ? 'prod-profit-pos' : 'prod-profit-neg') : 'prod-muted';
  const footRow = products.length ? `<tfoot><tr class="prod-total-row">
    <td>Total</td>
    <td class="prod-num">${fmtInt(totalQty)}</td>
    <td class="prod-num">${fmtMoney(data.revenue)}</td>
    <td class="prod-num prod-muted">—</td>
    <td class="prod-num prod-muted">—</td>
    <td class="prod-num">${fmtMoney(totalShipping)}</td>
    <td class="prod-num prod-muted">—</td>
    <td class="prod-num prod-muted">—</td>
    <td class="prod-num ${profitClass}">
      <div class="prod-total-stack">
        <span>${data.totalProfit != null ? fmtMoney(data.totalProfit) : '—'}</span>
        <span class="prod-total-note">${data.profitProductsCount || 0}/${products.length} c/ custo</span>
      </div>
    </td>
    <td class="prod-num ${profitClass}">${data.profitPct != null ? fmtPct(data.profitPct) : '—'}</td>
  </tr></tfoot>` : '';
  return `
    <div class="prod-card ${chClass}${collapsed}${expanded}" id="prod-card-${ch}" data-ch="${ch}">
      <div class="prod-card-head">
        <span class="drag-handle" title="Arrastar para reordenar"><i class="bi bi-grip-vertical"></i></span>
        <button class="prod-expand-btn" onclick="toggleExpand('${ch}')" title="Expandir/recolher altura da tabela"><i class="bi ${expandIcon}"></i></button>
        <button class="prod-collapse-btn" onclick="toggleCollapse('${ch}')" title="Minimizar/expandir"><i class="bi bi-chevron-down"></i></button>
        ${logoHTML(meta)}
        <div>
          <div class="camp-ch-name">${meta.label}</div>
          <div class="camp-ch-type">${products.length} produto${products.length === 1 ? '' : 's'}</div>
        </div>
        ${EXPORTABLE_PRODUCT_CHANNELS.has(ch) ? `<button type="button" class="prod-export-btn" onclick="event.stopPropagation();exportProductsCsv('${ch}')" title="Exportar quantidade vendida de cada produto"><i class="bi bi-download"></i> Exportar</button>` : ''}
        <div class="prod-head-stats">
          <div>
            <div class="prod-stat-lbl">Receita</div>
            <div class="prod-stat-val">${fmtMoney(data?.revenue || 0)}</div>
          </div>
          <div>
            <div class="prod-stat-lbl">Pedidos</div>
            <div class="prod-stat-val">${fmtInt(data?.orders || 0)}</div>
          </div>
        </div>
      </div>
      <div class="prod-table-wrap">
        <table class="prod-table">
          <thead><tr>
            <th>Produto</th><th class="num">Qtd</th><th class="num">Receita</th><th class="num">Ticket médio</th>
            <th class="num"><span class="th-label">COG (un.)<button class="th-bulk-btn" onclick="openBulkPop(event,'cog','${ch}','COG (un.)')" title="Definir para todos os produtos deste canal"><i class="bi bi-pencil-fill"></i></button></span></th>
            <th class="num"><span class="th-label">Frete (un.)<button class="th-bulk-btn" onclick="openBulkPop(event,'shipping','${ch}','Frete (un.)')" title="Definir para todos os produtos deste canal"><i class="bi bi-pencil-fill"></i></button></span></th>
            <th class="num"><span class="th-label">Impostos %<button class="th-bulk-btn" onclick="openBulkPop(event,'taxPct','${ch}','Impostos %')" title="Definir para todos os produtos deste canal"><i class="bi bi-pencil-fill"></i></button></span></th>
            <th class="num"><span class="th-label">Comissão %<button class="th-bulk-btn" onclick="openBulkPop(event,'commissionPct','${ch}','Comissão %')" title="Definir para todos os produtos deste canal"><i class="bi bi-pencil-fill"></i></button></span></th>
            <th class="num">Lucro</th><th class="num">Lucro %</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          ${footRow}
        </table>
      </div>
    </div>`;
}

async function onFinanceEdit(e) {
  const inp = e.target;
  const { channel, title, field, grouped, members } = inp.dataset;
  const value = inp.value === '' ? null : Number(inp.value);
  inp.disabled = true;
  try {
    if (grouped === '1') {
      // Linha unificada: grava o mesmo valor em cada produto do grupo (dentro deste canal).
      const titles = JSON.parse(members || '[]');
      await Promise.all(titles.map(t => fetch('/api/products/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, title: t, [field]: value }),
      })));
    } else {
      await fetch('/api/products/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, title, [field]: value }),
      });
    }
    await load();
  } catch (err) {
    console.warn('Produtos: falha ao salvar dado financeiro', err);
    inp.disabled = false;
  }
}

function render() {
  const d = current; if (!d) return;
  const updated = d.updatedAt ? new Date(d.updatedAt).toLocaleString('pt-BR') : '—';
  // "Ao vivo · HH:MM" — mesmo padrão amigável já usado em index.html/geografia*/segmentos.html; aqui
  // ainda era "sync: DD/MM/AAAA, HH:MM:SS", cru demais pro cabeçalho.
  const updatedDate = d.updatedAt ? new Date(d.updatedAt) : null;
  setText('lastUpdate', updatedDate ? `Ao vivo · ${String(updatedDate.getHours()).padStart(2,'0')}:${String(updatedDate.getMinutes()).padStart(2,'0')}` : 'Sem sincronização ainda');
  setText('pageSub', 'Vita Pet Life · ' + state.label);
  setText('footerDate', `Vita Pet Life · período ${state.label} · última sincronização: ${updated}`);
  const channels = getOrderedChannels(market);
  document.getElementById('prodGrid').innerHTML = channels.map(cardHTML).join('');
  document.querySelectorAll('.prod-input').forEach(inp => inp.addEventListener('change', onFinanceEdit));
  attachDragHandlers();
}

// ── Carregamento ──────────────────────────────────────────
async function load() {
  try {
    const r = await fetch(`/api/products?market=${market}&since=${state.since}&until=${state.until}`);
    current = await r.json();
  } catch (e) { console.warn('Produtos: falha ao carregar', e); return; }
  render();
}

// ── Init ─────────────────────────────────────────────────
(function init(){
  document.getElementById('mktBtnBr').classList.toggle('active', market === 'br');
  document.getElementById('mktBtnUs').classList.toggle('active', market === 'us');
  document.body.classList.toggle('market-us', market === 'us');
  applyLayout();
  applyDefaultCollapse(getOrderedChannels(market));
  document.getElementById('refreshVal').textContent = refreshMin === 0 ? 'Desligar' : `${refreshMin} min`;
  document.querySelectorAll('#cselRefresh .csel-opt').forEach(o => o.classList.toggle('active', Number(o.dataset.value) === refreshMin));
  applyRefresh();
  load();
})();
