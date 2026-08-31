const fmtInt = v => Math.round(v || 0).toLocaleString('pt-BR');
const fmtDec = (v, d = 1) => v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

// ── Metadados de canal (mesmas cores de produtos.html/index.html) ──
// Nome, cor, logo e mercado de cada canal vêm do catálogo único em js/colors.js — antes esta
// tabela existia igualzinha aqui e em outras quatro telas, e as cópias já discordavam entre si.
// Lendo de lá, a página também passa a respeitar a cor que o usuário salva em Configurações.
const chMeta = ch => CocoColors.ch[ch] || { label: ch, bg: '#999', text: '#fff' };

function contrastText(hex) {
  const h = (hex || '#000').replace('#', '');
  if (h.length !== 6) return '#fff';
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.55 ? '#333' : '#fff';
}

// ── State ─────────────────────────────────────────────────
let market = localStorage.getItem('coco_market') || 'br';
let current = null;
let refreshMin = Number(localStorage.getItem('coco_refresh') ?? 5);

// ── Period (seletor de período, mesmo padrão de produtos.html/campanhas.html) ──
// Antes a tela usava sempre uma janela fixa de 30 dias no backend (sem seletor); agora o período é
// escolhido aqui, igual às outras telas — mas o catálogo continua mesclando produto sem venda no
// período (qty zerada), então nenhum produto some da lista só por não ter vendido, como já
// combinado antes.
function rangeForPreset(p) {
  const today = new Date(); const iso = d => d.toISOString().slice(0, 10);
  if (p === 'today') return { since: iso(today), until: iso(today), label: 'Hoje' };
  if (p === '7d')   { const s = new Date(today); s.setDate(s.getDate() - 6); return { since: iso(s), until: iso(today), label: '7 dias' }; }
  if (p === 'month'){ const s = new Date(today.getFullYear(), today.getMonth(), 1); return { since: iso(s), until: iso(today), label: 'Este mês' }; }
  const s = new Date(today); s.setDate(s.getDate() - 29); return { since: iso(s), until: iso(today), label: '30 dias' };
}
let state = rangeForPreset('30d');

// "Unificar" deixou de ser uma opção local desta tela: o grupo manual agora é global (tela
// Unificador, dentro de Configurações) e o backend já devolve `agg.products` agrupado por ele (com
// prioridade sobre a família automática Lysine/Daily, ver metrics.js computeStock) — aqui só
// exibimos o resultado (badge 🔗 na linha já agrupada, ver aggRowHTML), sem toggle nem criação de
// grupo. Os 3 campos de ordem (Projetada/Nova/Andamento) continuam editáveis por linha, como sempre
// — o nome do grupo funciona como família própria pra eles (ver groupOrders no backend).
let refreshTimer = null;
function applyRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (refreshMin > 0) refreshTimer = setInterval(load, refreshMin * 60 * 1000);
}
// Cards sempre abrem só com o primeiro expandido — não persiste entre recarregamentos (proposital).
let collapsedState = {};
const expandedState = JSON.parse(localStorage.getItem('coco_estoque_expanded') || '{}');
let layout = localStorage.getItem('coco_estoque_layout') || 'row';

// ── Ordem dos canais (drag and drop) ───────────────────────
let channelOrder = JSON.parse(localStorage.getItem('coco_estoque_order') || '{}');
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
  localStorage.setItem('coco_estoque_layout', mode);
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
  localStorage.setItem('coco_estoque_order', JSON.stringify(channelOrder));
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
  localStorage.setItem('coco_estoque_expanded', JSON.stringify(expandedState));
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
  await Promise.all(products.map(p => fetch('/api/stock/finance', {
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


function monthsCellClass(v) {
  if (v == null) return 'prod-muted';
  if (v < 1) return 'stk-low';
  return 'stk-ok';
}

const SUGGESTION_META = {
  urgente:  { label: 'Pedir urgente', cls: 'sug-urgent' },
  atencao:  { label: 'Atenção',       cls: 'sug-warn' },
  aguardar: { label: 'Aguardar',      cls: 'sug-ok' },
};
function suggestionHTML(s) {
  const m = SUGGESTION_META[s];
  return m ? `<span class="stk-badge ${m.cls}">${m.label}</span>` : '<span class="prod-muted">—</span>';
}

function rowHTML(p, ch) {
  const combo = comboBits(p);
  const thumb = p.image
    ? `<img class="prod-thumb" src="${p.image}" alt="" loading="lazy" draggable="false" onerror="this.outerHTML='<div class=&quot;prod-thumb-ph&quot;><i class=&quot;bi bi-image&quot;></i></div>'">`
    : `<div class="prod-thumb-ph"><i class="bi bi-image"></i></div>`;
  const typeTag = p.type ? `<span class="prod-type-tag">${p.type}</span>` : '';
  const dataAttrs = `data-channel="${escapeHtml(ch)}" data-title="${escapeHtml(p.title)}"`;
  return `<tr>
    <td>
      <div class="prod-name-wrap">
        ${thumb}
        <div class="prod-name-col">
          <div class="prod-name-line"><span class="prod-name" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span>${typeTag}</div>
          ${combo ? `<div class="prod-combo">${combo}</div>` : ''}
        </div>
      </div>
    </td>
    <td class="prod-num prod-muted">${fmtDec(p.salesDaily, 1)}</td>
    <td class="prod-num prod-muted">${fmtInt(p.salesMonth)}</td>
    <td class="prod-num"><input class="prod-input" type="number" step="1" placeholder="0" value="${p.stock ?? ''}" ${dataAttrs} data-field="stock" title="Estoque físico/FBA atual, em unidades."></td>
    <td class="prod-num"><input class="prod-input" type="number" step="1" placeholder="0" value="${p.incoming ?? ''}" ${dataAttrs} data-field="incoming" title="Unidades a caminho (recebendo), em trânsito."></td>
    <td class="prod-num ${monthsCellClass(p.monthsOfStock)}">${fmtDec(p.monthsOfStock, 1)}</td>
  </tr>`;
}

function cardHTML(ch) {
  const meta = chMeta(ch);
  const chClass = meta.market === 'us' ? 'ch-us' : 'ch-br';
  const data = current?.channels?.[ch];
  const products = data?.products || [];
  const rows = products.length
    ? products.map(p => rowHTML(p, ch)).join('')
    : '<tr><td colspan="6" class="prod-empty">Sem dados no período</td></tr>';
  const collapsed = collapsedState[ch] ? ' collapsed' : '';
  const expanded = expandedState[ch] ? ' expanded' : '';
  const expandIcon = expandedState[ch] ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand';
  const t = data?.totals || { salesDaily: 0, salesMonth: 0, stock: 0, incoming: 0, monthsOfStock: null };
  const footRow = products.length ? `<tfoot><tr class="prod-total-row">
    <td>Total</td>
    <td class="prod-num">${fmtDec(t.salesDaily, 1)}</td>
    <td class="prod-num">${fmtInt(t.salesMonth)}</td>
    <td class="prod-num">${fmtInt(t.stock)}</td>
    <td class="prod-num">${fmtInt(t.incoming)}</td>
    <td class="prod-num ${monthsCellClass(t.monthsOfStock)}">${fmtDec(t.monthsOfStock, 1)}</td>
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
        <div class="prod-head-stats">
          <div>
            <div class="prod-stat-lbl">Vendas/mês</div>
            <div class="prod-stat-val">${fmtInt(t.salesMonth)}</div>
          </div>
          <div>
            <div class="prod-stat-lbl">Estoque</div>
            <div class="prod-stat-val">${fmtInt(t.stock)}</div>
          </div>
        </div>
      </div>
      <div class="prod-table-wrap">
        <table class="prod-table">
          <thead><tr>
            <th>Produto</th>
            <th class="num">Vendas/dia</th>
            <th class="num">Vendas/mês</th>
            <th class="num"><span class="th-label">Estoque<button class="th-bulk-btn" onclick="openBulkPop(event,'stock','${ch}','Estoque')" title="Definir para todos os produtos deste canal"><i class="bi bi-pencil-fill"></i></button></span></th>
            <th class="num"><span class="th-label">Recebendo<button class="th-bulk-btn" onclick="openBulkPop(event,'incoming','${ch}','Recebendo')" title="Definir para todos os produtos deste canal"><i class="bi bi-pencil-fill"></i></button></span></th>
            <th class="num">Meses de Estoque</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          ${footRow}
        </table>
      </div>
    </div>`;
}

async function onStockEdit(e) {
  const inp = e.target;
  const { channel, title, field } = inp.dataset;
  const value = inp.value === '' ? null : Number(inp.value);
  inp.disabled = true;
  try {
    await fetch('/api/stock/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, title, [field]: value }),
    });
    await load();
  } catch (err) {
    console.warn('Estoque: falha ao salvar dado', err);
    inp.disabled = false;
  }
}

function rangeLabelShort(since, until) { return CocoPeriodo.rotulo(since, until); }

// ── Card agregado "Estoque" (por família de produto, somando todos os canais) ──
let aggCollapsed = JSON.parse(localStorage.getItem('coco_estoque_agg_collapsed') || 'false');
function toggleAggCollapse() {
  aggCollapsed = !aggCollapsed;
  localStorage.setItem('coco_estoque_agg_collapsed', JSON.stringify(aggCollapsed));
  document.getElementById('agg-card')?.classList.toggle('collapsed', aggCollapsed);
}

function aggRowHTML(p) {
  const combo = comboBits(p);
  const thumb = p.image
    ? `<img class="prod-thumb" src="${p.image}" alt="" loading="lazy" draggable="false" onerror="this.outerHTML='<div class=&quot;prod-thumb-ph&quot;><i class=&quot;bi bi-image&quot;></i></div>'">`
    : `<div class="prod-thumb-ph"><i class="bi bi-image"></i></div>`;
  const typeTag = p.type ? `<span class="prod-type-tag">${p.type}</span>` : '';
  const dataAttrs = `data-title="${escapeHtml(p.title)}"`;
  const badge = p._grouped
    ? `<span class="stk-unify-badge" title="${escapeHtml(p._members.join(' + '))}"><i class="bi bi-link-45deg"></i>${p._members.length}</span>`
    : '';
  // Linha unificada: Ordem Projetada/Nova/Andamento continuam editáveis igual a qualquer produto —
  // `p.title` é o nome do grupo, e o servidor já resolve esses 3 campos por grupo (não por soma dos
  // membros), ver groupOrders em computeStock()/metrics.js. Mesmo POST de sempre, sem caso especial.
  const projTitle = p._grouped ? 'Simulação do grupo unificado: quantidade cogitada para um novo pedido, só pra ver o efeito no Tempo de Estoque Total. Não é um pedido real ainda.' : 'Simulação: quantidade cogitada para um novo pedido ao laboratório, só pra ver o efeito no Tempo de Estoque Total. Não é um pedido real ainda.';
  const newTitle = p._grouped ? 'Unidades de um novo pedido ao laboratório, para o grupo unificado inteiro.' : 'Unidades de um novo pedido a ser feito ao laboratório.';
  const progressTitle = p._grouped ? 'Unidades já pedidas ao laboratório, produção em andamento, para o grupo unificado inteiro.' : 'Unidades já pedidas ao laboratório, produção em andamento.';
  const orderCells = `<td class="prod-num"><input class="prod-input" type="number" step="1" placeholder="0" value="${p.projected ?? ''}" ${dataAttrs} data-field="projected" title="${escapeHtml(projTitle)}"></td>
    <td class="prod-num"><input class="prod-input" type="number" step="1" placeholder="0" value="${p.orderNew ?? ''}" ${dataAttrs} data-field="orderNew" title="${escapeHtml(newTitle)}"></td>
    <td class="prod-num"><input class="prod-input" type="number" step="1" placeholder="0" value="${p.orderInProgress ?? ''}" ${dataAttrs} data-field="orderInProgress" title="${escapeHtml(progressTitle)}"></td>`;
  return `<tr data-title="${escapeHtml(p.title)}">
    <td>
      <div class="prod-name-wrap">
        ${thumb}
        <div class="prod-name-col">
          <div class="prod-name-line"><span class="prod-name" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span>${typeTag}${badge}</div>
          ${combo ? `<div class="prod-combo">${combo}</div>` : ''}
        </div>
      </div>
    </td>
    <td class="prod-num prod-muted">${fmtDec(p.salesDaily, 1)}</td>
    <td class="prod-num prod-muted">${fmtInt(p.salesMonth)}</td>
    <td class="prod-num prod-muted">${fmtInt(p.stock)}</td>
    <td class="prod-num prod-muted">${fmtInt(p.incoming)}</td>
    <td class="prod-num ${monthsCellClass(p.monthsOfStock)}">${fmtDec(p.monthsOfStock, 1)}</td>
    ${orderCells}
    <td class="prod-num ${monthsCellClass(p.totalMonthsOfStock)}">${fmtDec(p.totalMonthsOfStock, 1)}</td>
    <td class="prod-num">${suggestionHTML(p.suggestion)}</td>
  </tr>`;
}

function aggCardHTML() {
  // agg.products já vem agrupado do backend (grupo manual do Unificador tem prioridade sobre a
  // família automática Lysine/Daily, ver metrics.js computeStock) — nada a mesclar aqui.
  const products = current?.agg?.products || [];
  const raw = products;
  const rows = products.length
    ? products.map(aggRowHTML).join('')
    : '<tr><td colspan="11" class="prod-empty">Sem dados no período</td></tr>';
  const collapsed = aggCollapsed ? ' collapsed' : '';
  const t = current?.agg?.totals || { salesDaily: 0, salesMonth: 0, stock: 0, incoming: 0, orderInProgress: 0, orderNew: 0, projected: 0, monthsOfStock: null, totalMonthsOfStock: null, suggestion: null };
  const footRow = raw.length ? `<tfoot><tr class="prod-total-row">
    <td>Total</td>
    <td class="prod-num">${fmtDec(t.salesDaily, 1)}</td>
    <td class="prod-num">${fmtInt(t.salesMonth)}</td>
    <td class="prod-num">${fmtInt(t.stock)}</td>
    <td class="prod-num">${fmtInt(t.incoming)}</td>
    <td class="prod-num ${monthsCellClass(t.monthsOfStock)}">${fmtDec(t.monthsOfStock, 1)}</td>
    <td class="prod-num">${fmtInt(t.projected)}</td>
    <td class="prod-num">${fmtInt(t.orderNew)}</td>
    <td class="prod-num">${fmtInt(t.orderInProgress)}</td>
    <td class="prod-num ${monthsCellClass(t.totalMonthsOfStock)}">${fmtDec(t.totalMonthsOfStock, 1)}</td>
    <td class="prod-num">${suggestionHTML(t.suggestion)}</td>
  </tr></tfoot>` : '';
  return `
    <div class="prod-card${collapsed}" id="agg-card">
      <div class="prod-card-head">
        <div class="camp-logo" style="background:var(--ink);color:var(--side-text)"><i class="bi bi-boxes"></i></div>
        <div>
          <div class="camp-ch-name">Estoque</div>
          <div class="camp-ch-type">${raw.length} produto${raw.length === 1 ? '' : 's'} · todos os canais</div>
        </div>
        <div class="prod-head-stats">
          <div>
            <div class="prod-stat-lbl">Vendas/mês</div>
            <div class="prod-stat-val">${fmtInt(t.salesMonth)}</div>
          </div>
          <div>
            <div class="prod-stat-lbl">Estoque</div>
            <div class="prod-stat-val">${fmtInt(t.stock)}</div>
          </div>
        </div>
        <button class="prod-collapse-btn" onclick="toggleAggCollapse()" title="Minimizar/expandir"><i class="bi bi-chevron-down"></i></button>
      </div>
      <div class="prod-table-wrap">
        <table class="prod-table">
          <thead><tr>
            <th>Produto</th>
            <th class="num">Vendas/dia</th>
            <th class="num">Vendas/mês</th>
            <th class="num">Estoque</th>
            <th class="num">Recebendo</th>
            <th class="num">Meses de Estoque</th>
            <th class="num">Ordem Projetada</th>
            <th class="num">Ordem Nova</th>
            <th class="num">Ordem em Andamento</th>
            <th class="num">Tempo de Estoque Total</th>
            <th class="num">Sugestão</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          ${footRow}
        </table>
      </div>
    </div>`;
}

async function onStockAggEdit(e) {
  const inp = e.target;
  const { title, field } = inp.dataset;
  const value = inp.value === '' ? null : Number(inp.value);
  inp.disabled = true;
  try {
    await fetch('/api/stock/agg-finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market, title, [field]: value }),
    });
    await load();
  } catch (err) {
    console.warn('Estoque: falha ao salvar dado agregado', err);
    inp.disabled = false;
  }
}

function renderAggCard() {
  document.getElementById('aggCardWrap').innerHTML = aggCardHTML();
  document.querySelectorAll('#aggCardWrap .prod-input').forEach(inp => inp.addEventListener('change', onStockAggEdit));
}

function render() {
  const d = current; if (!d) return;
  const updated = d.updatedAt ? new Date(d.updatedAt).toLocaleString('pt-BR') : '—';
  // "Ao vivo · HH:MM" — mesmo padrão amigável já usado em index.html/geografia*/segmentos.html; aqui
  // ainda era "sync: DD/MM/AAAA, HH:MM:SS", cru demais pro cabeçalho.
  const updatedDate = d.updatedAt ? new Date(d.updatedAt) : null;
  setText('lastUpdate', updatedDate ? `Ao vivo · ${String(updatedDate.getHours()).padStart(2,'0')}:${String(updatedDate.getMinutes()).padStart(2,'0')}` : 'Sem sincronização ainda');
  setText('pageSub', `Vita Pet Life · ${state.label} (${rangeLabelShort(d.since, d.until)}) · vendas reais do período`);
  setText('footerDate', `Vita Pet Life · período ${state.label} · última sincronização: ${updated}`);
  renderAggCard();
  const channels = getOrderedChannels(market);
  document.getElementById('prodGrid').innerHTML = channels.map(cardHTML).join('');
  document.querySelectorAll('#prodGrid .prod-input').forEach(inp => inp.addEventListener('change', onStockEdit));
  attachDragHandlers();
}

// ── Carregamento ──────────────────────────────────────────
async function load() {
  try {
    const r = await fetch(`/api/stock?market=${market}&since=${state.since}&until=${state.until}`);
    current = await r.json();
  } catch (e) { console.warn('Estoque: falha ao carregar', e); return; }
  render();
}

// ── Sincronizar agora ───────────────────────────────────────
document.getElementById('syncBtn').addEventListener('click', async () => {
  try { await fetch('/api/sync', { method: 'POST' }); } catch (e) {}
  load();
});

// ── Atualizar (frequência de refresh automático) ───────────
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

// ── Painel de configurações (cores compartilhadas) ─────────
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
