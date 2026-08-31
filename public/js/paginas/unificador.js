const $ = id => document.getElementById(id);
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtInt(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function fmtMoney(n){ return (market==='us'?'US$ ':'R$ ') + (n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function toast(msg, isErr){
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(()=>{ t.className = 'toast' + (isErr ? ' err' : ''); }, 2600);
}

let market = localStorage.getItem('coco_market') || 'br';
let catalog = [];   // [{title, channel, image, type, qty, revenue}]
let groups = {};    // { [nome]: [tituloBruto,...] }
// "Tag mae" de cada grupo: { [nome]: { type, typeGroup } }. Definida a mao aqui e gravada em
// kv.productGroupTypes; vazio = automatico (o backend infere pelo catalogo Shopify dos membros).
let groupTypes = {};
let typeRuleNames = [];  // nomes cadastrados em Segmentos -> "Tipos de produto", usados como sugestao de categoria
let selectMode = false;
let selected = new Set();
let addToGroupTarget = null; // nome do grupo quando o modal abre a partir de "+ Adicionar produtos"
let searchQuery = '';

// ── Formas de visualizar cada coluna (persistido por coluna) ──
let ungroupedView = localStorage.getItem('coco_uni_view_ungrouped') || 'list'; // 'list' | 'grid' | 'compact'
let groupedView = localStorage.getItem('coco_uni_view_grouped') || 'cards';    // 'cards' | 'grid' | 'compact'
// Nos modos Grade/Compacta da coluna "Com grupo", clicar num grupo alterna se o card detalhado dele
// aparece embaixo da grade/lista (evita duplicar a renderização completa do card por padrão).
let expandedGroups = new Set();
// No modo Cards, cada grupo pode ser fechado/aberto individualmente (member list some, só o
// cabeçalho fica visível) — útil com muitos grupos na tela. Não persiste entre recarregamentos.
let collapsedCards = new Set();

// ── Arrastar produtos entre grupos (e de/para "sem grupo") ──
let dragTitle = null;     // título cru sendo arrastado no momento
let dragFromGroup = null; // nome do grupo de origem, ou null se veio da coluna "sem grupo"

function setMarket(m){
  market = m;
  localStorage.setItem('coco_market', m);
  $('mktBtnBr').classList.toggle('active', m === 'br');
  $('mktBtnUs').classList.toggle('active', m === 'us');
  exitSelectMode();
  load();
}

/* ── /api/me — whoami + guarda de admin no cliente (defesa; o servidor também valida) ── */
async function loadMe(){
  try{
    const r = await fetch('/api/me', { credentials:'same-origin' });
    const d = await r.json();
    const isAdmin = !d.enabled || (d.user && d.user.role === 'admin');
    if(!isAdmin) $('notAdminBanner').classList.add('show');
    $('whoami').textContent = (d.user && (d.user.name || d.user.username)) || 'Admin';
  }catch(e){ $('whoami').textContent = '—'; }
}

/* ── Toggle liga/desliga global (espelha o de Configurações) ── */
function setGroupsStatus(enabled){
  const el = $('groupsStatus');
  if(enabled){ el.textContent = 'Unificação ativa'; el.className = 'switch-status'; }
  else{ el.textContent = 'Desligado — as telas mostram os produtos sem agrupar'; el.className = 'switch-status off'; }
}
async function loadGroupsConfig(){
  try{
    const r = await fetch('/api/product-groups/config', { credentials:'same-origin' });
    const d = await r.json();
    const cb = $('groupsToggle');
    cb.checked = d.enabled !== false;
    cb.disabled = false;
    setGroupsStatus(cb.checked);
  }catch(e){ $('groupsStatus').textContent = 'Não foi possível carregar.'; }
}
$('groupsToggle').addEventListener('change', async function(){
  const desired = this.checked;
  this.disabled = true;
  try{
    const r = await fetch('/api/product-groups/config', {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ enabled: desired })
    });
    if(!r.ok) throw new Error('http '+r.status);
    setGroupsStatus(desired);
    toast(desired ? 'Unificador ativado.' : 'Unificador desativado.');
  }catch(e){
    this.checked = !desired; setGroupsStatus(!desired);
    toast('Erro ao salvar.', true);
  }finally{ this.disabled = false; }
});

/* ── Carrega catálogo + grupos do mercado atual ── */
async function load(){
  try{
    const [rCat, rGroups, rTypes] = await Promise.all([
      fetch('/api/product-groups/catalog?market=' + market, { credentials:'same-origin' }),
      fetch('/api/product-groups?market=' + market, { credentials:'same-origin' }),
      fetch('/api/product-types?market=' + market, { credentials:'same-origin' }),
    ]);
    const dCat = await rCat.json();
    const dGroups = await rGroups.json();
    const dTypes = await rTypes.json().catch(()=>({}));
    catalog = dCat.items || [];
    groups = dGroups.groups || {};
    groupTypes = dGroups.types || {};
    typeRuleNames = Object.keys(dTypes.types || {}).sort();
    render();
  }catch(e){
    $('groupsWrap').innerHTML = '<div class="empty">Não foi possível carregar o catálogo.</div>';
    $('plainList').innerHTML = '';
  }
}

/* Todas as linhas do catálogo que têm este título cru (pode ser >1: mesmo título em canais
   diferentes) — soma qty/receita, junta canais e imagem. */
function rowsForTitle(title){
  return catalog.filter(c => c.title === title);
}
function summarize(rows){
  const qty = rows.reduce((a,r)=>a+(r.qty||0),0);
  const revenue = rows.reduce((a,r)=>a+(r.revenue||0),0);
  const image = rows.map(r=>r.image).find(Boolean) || null;
  const channels = [...new Set(rows.map(r=>r.channel))];
  return { qty, revenue, image, channels };
}
function thumbHtml(image, title){
  return image
    ? `<img class="row-thumb" src="${escapeHtml(image)}" alt="" onerror="this.outerHTML='<span class=row-thumb-ph><i class=&quot;bi bi-image&quot;></i></span>'">`
    : `<span class="row-thumb-ph"><i class="bi bi-image"></i></span>`;
}
function channelBadges(channels){
  return channels.map(ch => CocoColors.chBadgeHTML(ch)).join(' ');
}

function matchesSearch(title){
  if(!searchQuery) return true;
  return title.toLowerCase().includes(searchQuery);
}

function render(){
  renderTagSuggestions();
  renderGroups();
  renderPlainList();
  renderHiddenList();
  updateSelectBar();
}

/* Sugestoes dos campos Tipo/Categoria. "Tipo" oferece os Types que ja existem no catalogo Shopify
   deste mercado (Po, Tablets, Soft Chews...) e "Categoria" oferece os nomes cadastrados em
   Segmentos > "Tipos de produto". Sao <datalist>, entao continuam aceitando um valor novo digitado
   na mao: a lista e atalho pro que ja existe, nao camisa de forca. */
function renderTagSuggestions(){
  const types = [...new Set(catalog.map(c => c.type).filter(Boolean))].sort();
  const opts = arr => arr.map(v => `<option value="${escapeHtml(v)}">`).join('');
  $('gtTypeList').innerHTML = opts(types);
  $('gtCatList').innerHTML  = opts(typeRuleNames);
}

/* Grava a tag mae de um grupo. Campo vazio limpa aquele eixo e volta pro automatico (o backend
   volta a inferir pelo catalogo Shopify dos membros, ver resolveGroupTypes em metrics.js). */
async function saveGroupTag(name, axis, value){
  const before = { ...(groupTypes[name] || {}) };
  try{
    const r = await fetch('/api/product-groups/type', {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
      body: JSON.stringify({ market, name, [axis]: value }),
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || 'Falha ao salvar.');
    groupTypes = d.types || {};
    toast(value ? `"${name}" agora e ${value}.` : `"${name}" voltou pro tipo automatico.`);
  }catch(e){
    groupTypes[name] = before;
    renderGroups();
    toast(e.message || 'Nao foi possivel salvar a tag do grupo.');
  }
}

// Soma qty/receita de todos os membros de um grupo (referência mostrada nos chips/linhas
// compactas — o dado "de verdade" por membro só aparece no card detalhado, expandido).
function summarizeGroup(name){
  const members = groups[name] || [];
  let qty = 0, revenue = 0;
  const channels = new Set();
  members.forEach(t => {
    const s = summarize(rowsForTitle(t));
    qty += s.qty; revenue += s.revenue;
    s.channels.forEach(c => channels.add(c));
  });
  return { qty, revenue, channels: [...channels] };
}

// Card detalhado (visual de sempre) — usado sempre no modo Cards, e sob demanda (grupo expandido)
// nos modos Grade/Compacta.
function groupCardHtml(name){
  const members = groups[name] || [];
  const gt = groupTypes[name] || {};
  const collapsed = collapsedCards.has(name);
  const memberRows = members.map(title => {
    const rows = rowsForTitle(title);
    const s = summarize(rows);
    return `<div class="member-row" draggable="${selectMode?'false':'true'}" data-drag-title="${escapeHtml(title)}" data-drag-from="${escapeHtml(name)}">
      ${thumbHtml(s.image, title)}
      <span class="row-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
      ${channelBadges(s.channels)}
      <span class="row-stat">${fmtInt(s.qty)} un · ${fmtMoney(s.revenue)}</span>
      <button class="row-remove" data-remove-member="${escapeHtml(title)}" data-group="${escapeHtml(name)}" title="Tirar do grupo"><i class="bi bi-x-lg"></i></button>
    </div>`;
  }).join('');
  return `<div class="group-card${collapsed?' collapsed':''}" data-group-card="${escapeHtml(name)}" data-drop-group="${escapeHtml(name)}">
    <div class="group-head">
      <div class="group-icon"><i class="bi bi-link-45deg"></i></div>
      <div>
        <div class="group-name">${escapeHtml(name)}</div>
        <div class="group-stat">${members.length} produto${members.length===1?'':'s'} unificado${members.length===1?'':'s'}</div>
      </div>
      <div class="group-actions">
        <button class="btn btn-sm" data-add-to-group="${escapeHtml(name)}"><i class="bi bi-plus-lg"></i> Adicionar produtos</button>
        <button class="btn btn-sm btn-danger" data-delete-group="${escapeHtml(name)}"><i class="bi bi-trash"></i></button>
        <button class="btn btn-sm btn-icon" data-collapse-card="${escapeHtml(name)}" title="${collapsed?'Abrir':'Fechar'}"><i class="bi bi-chevron-${collapsed?'down':'up'}"></i></button>
      </div>
    </div>
    ${collapsed ? '' : `<div class="group-tags">
      <span class="gt-hint" title="Um grupo unificado e UM produto fisico, entao ele tem um tipo so. Definindo aqui, o tipo para de depender de qual canal vendeu no periodo escolhido."><i class="bi bi-tag"></i> Tags do grupo</span>
      <label class="gt-field"><span class="gt-label">Tipo</span>
        <input class="gt-input" list="gtTypeList" placeholder="automatico" value="${escapeHtml(gt.type || '')}" data-group-tag="${escapeHtml(name)}" data-axis="type">
      </label>
      <label class="gt-field"><span class="gt-label">Categoria</span>
        <input class="gt-input" list="gtCatList" placeholder="automatico" value="${escapeHtml(gt.typeGroup || '')}" data-group-tag="${escapeHtml(name)}" data-axis="typeGroup">
      </label>
    </div><div class="group-body">${memberRows}</div>`}
  </div>`;
}

function visibleGroupNames(){
  return Object.keys(groups).sort().filter(name => {
    if(!searchQuery) return true;
    if(matchesSearch(name)) return true;
    return (groups[name] || []).some(t => matchesSearch(t));
  });
}

function renderGroups(){
  const wrap = $('groupsWrap');
  const names = visibleGroupNames();
  $('groupedCount').textContent = names.length ? `(${names.length})` : '';
  if(!names.length){
    wrap.innerHTML = `<div class="empty">${searchQuery ? 'Nenhum grupo encontrado.' : 'Nenhum grupo criado ainda. Selecione produtos à esquerda e clique em "Unificar selecionados".'}</div>`;
    return;
  }
  if(groupedView === 'cards'){
    wrap.innerHTML = names.map(groupCardHtml).join('');
    return;
  }
  const expandedHtml = names.filter(n => expandedGroups.has(n)).map(groupCardHtml).join('');
  if(groupedView === 'grid'){
    const chips = names.map(name => {
      const s = summarizeGroup(name);
      const members = groups[name] || [];
      return `<button class="group-chip${expandedGroups.has(name)?' expanded':''}" data-toggle-group="${escapeHtml(name)}" data-drop-group="${escapeHtml(name)}">
        <div class="chip-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <div class="chip-stat">${fmtInt(s.qty)} un · ${fmtMoney(s.revenue)}</div>
        <span class="chip-count">${members.length} produto${members.length===1?'':'s'}</span>
      </button>`;
    }).join('');
    wrap.innerHTML = `<div class="group-grid">${chips}</div>${expandedHtml}`;
    return;
  }
  // compact
  const rows = names.map(name => {
    const s = summarizeGroup(name);
    const members = groups[name] || [];
    return `<button class="group-compact-row${expandedGroups.has(name)?' expanded':''}" data-toggle-group="${escapeHtml(name)}" data-drop-group="${escapeHtml(name)}">
      <i class="bi bi-link-45deg"></i>
      <span class="row-title" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      <span class="row-stat">${members.length} produto${members.length===1?'':'s'} · ${fmtInt(s.qty)} un · ${fmtMoney(s.revenue)}</span>
    </button>`;
  }).join('');
  wrap.innerHTML = `<div class="group-compact">${rows}</div>${expandedHtml}`;
}

// Um título conta como oculto se QUALQUER linha dele (pode haver mais de uma — mesmo título em
// canais diferentes) bateu com alguma palavra-chave de "Ocultar produtos" (ver metrics.js isHiddenItem).
function ungroupedTitles(){
  const usedTitles = new Set(Object.values(groups).flat());
  const seen = new Set();
  const out = [];
  for(const c of catalog){
    if(usedTitles.has(c.title) || seen.has(c.title) || c.hidden) continue;
    seen.add(c.title);
    out.push(c.title);
  }
  return out;
}
function hiddenTitles(){
  const seen = new Set();
  const out = [];
  for(const c of catalog){
    if(!c.hidden || seen.has(c.title)) continue;
    seen.add(c.title);
    out.push(c.title);
  }
  return out;
}

function renderPlainList(){
  const list = $('plainList');
  let titles = ungroupedTitles().filter(matchesSearch);
  // Ordena por receita somada desc (mesmo critério do catálogo).
  titles.sort((a,b) => summarize(rowsForTitle(b)).revenue - summarize(rowsForTitle(a)).revenue);
  $('ungroupedCount').textContent = titles.length ? `(${titles.length})` : '';
  if(!titles.length){ list.innerHTML = `<div class="empty">${searchQuery ? 'Nenhum produto encontrado.' : 'Nenhum produto sem grupo — tudo já está unificado.'}</div>`; return; }

  if(ungroupedView === 'grid'){
    list.innerHTML = `<div class="plain-grid">${titles.map(title => {
      const s = summarize(rowsForTitle(title));
      const check = selectMode
        ? `<input type="checkbox" class="select-check card-check" data-select-title="${escapeHtml(title)}" ${selected.has(title)?'checked':''}>`
        : '';
      return `<div class="plain-card" draggable="${selectMode?'false':'true'}" data-drag-title="${escapeHtml(title)}">
        ${check}
        ${thumbHtml(s.image, title)}
        <div class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
        <div class="card-badges">${channelBadges(s.channels)}</div>
        <div class="card-stat">${fmtInt(s.qty)} un · ${fmtMoney(s.revenue)}</div>
      </div>`;
    }).join('')}</div>`;
    return;
  }
  if(ungroupedView === 'compact'){
    list.innerHTML = `<div class="plain-compact">${titles.map(title => {
      const s = summarize(rowsForTitle(title));
      const check = selectMode
        ? `<input type="checkbox" class="select-check" data-select-title="${escapeHtml(title)}" ${selected.has(title)?'checked':''}>`
        : '';
      return `<div class="plain-compact-row" draggable="${selectMode?'false':'true'}" data-drag-title="${escapeHtml(title)}">
        ${check}
        <span class="row-title" title="${escapeHtml(title)}" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(title)}</span>
        ${channelBadges(s.channels)}
        <span class="row-stat">${fmtInt(s.qty)} un · ${fmtMoney(s.revenue)}</span>
      </div>`;
    }).join('')}</div>`;
    return;
  }
  // list (padrão)
  list.innerHTML = `<div class="plain-list">${titles.map(title => {
    const s = summarize(rowsForTitle(title));
    const check = selectMode
      ? `<input type="checkbox" class="select-check" data-select-title="${escapeHtml(title)}" ${selected.has(title)?'checked':''}>`
      : '';
    return `<div class="plain-row" draggable="${selectMode?'false':'true'}" data-drag-title="${escapeHtml(title)}">
      ${check}
      ${thumbHtml(s.image, title)}
      <span class="row-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
      ${channelBadges(s.channels)}
      <span class="row-stat">${fmtInt(s.qty)} un · ${fmtMoney(s.revenue)}</span>
    </div>`;
  }).join('')}</div>`;
}

// Lista à parte (fora de "Sem grupo"/"Com grupo") dos produtos cujo título bateu com uma
// palavra-chave de "Ocultar produtos" — só exibição, sem drag/seleção (gestão é pelo botão
// "Ocultar produtos" no topo). Some inteiramente da tela quando não há nenhum oculto.
// Esconder/mostrar a área "Ocultos" inteira (não confundir com o que ela mostra — isso só
// esconde a SEÇÃO, o produto continua oculto normalmente). Persistido, sobrevive a reload.
let hiddenSectionCollapsed = localStorage.getItem('coco_uni_hiddensection_collapsed') === '1';
function applyHiddenSectionCollapse(){
  $('hiddenSectionBody').style.display = hiddenSectionCollapsed ? 'none' : '';
  $('hiddenSectionCollapseBtn').innerHTML = `<i class="bi bi-chevron-${hiddenSectionCollapsed ? 'down' : 'up'}"></i>`;
}
$('hiddenSectionCollapseBtn').addEventListener('click', () => {
  hiddenSectionCollapsed = !hiddenSectionCollapsed;
  localStorage.setItem('coco_uni_hiddensection_collapsed', hiddenSectionCollapsed ? '1' : '0');
  applyHiddenSectionCollapse();
});

function renderHiddenList(){
  const section = $('hiddenSection');
  const titles = hiddenTitles().filter(matchesSearch);
  if(!titles.length){ section.style.display = 'none'; return; }
  section.style.display = '';
  $('hiddenCount').textContent = `(${titles.length})`;
  $('hiddenPlainList').innerHTML = `<div class="plain-list">${titles.map(title => {
    const s = summarize(rowsForTitle(title));
    return `<div class="plain-row">
      ${thumbHtml(s.image, title)}
      <span class="row-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
      ${channelBadges(s.channels)}
      <span class="row-stat">${fmtInt(s.qty)} un · ${fmtMoney(s.revenue)}</span>
    </div>`;
  }).join('')}</div>`;
  applyHiddenSectionCollapse();
}

function updateSelectBar(){
  $('selectBar').classList.toggle('open', selectMode);
  $('selectBtn').style.display = selectMode ? 'none' : '';
  $('selectCount').textContent = `${selected.size} selecionado${selected.size===1?'':'s'}`;
  $('selectConfirmBtn').disabled = selected.size < 1;
}

function enterSelectMode(){
  selectMode = true; selected = new Set();
  render();
}
function exitSelectMode(){
  selectMode = false; selected = new Set(); addToGroupTarget = null;
  render();
}

/* ── Modal de nome ── */
function suggestGroupName(titles){
  return titles.reduce((shortest, t) => (t.length < shortest.length ? t : shortest), titles[0]);
}
function openNameModal(){
  const titles = [...selected];
  if(!titles.length) return;
  const input = $('nameInput');
  if(addToGroupTarget){
    $('nameModalTitle').textContent = 'Adicionar ao grupo';
    $('nameModalSub').textContent = `${titles.length} produto${titles.length===1?'':'s'} será${titles.length===1?'':'ão'} adicionado${titles.length===1?'':'s'} ao grupo "${addToGroupTarget}".`;
    input.value = addToGroupTarget;
    input.disabled = true;
  } else {
    $('nameModalTitle').textContent = 'Nome do grupo';
    $('nameModalSub').textContent = 'Reusar um nome já existente adiciona os selecionados a esse grupo.';
    input.value = suggestGroupName(titles);
    input.disabled = false;
  }
  $('nameError').textContent = '';
  $('nameModalOverlay').classList.add('open');
  $('nameModal').classList.add('open');
  if(!addToGroupTarget){ input.focus(); input.select(); }
}
function closeNameModal(){
  $('nameModalOverlay').classList.remove('open');
  $('nameModal').classList.remove('open');
  $('nameInput').disabled = false;
}
async function confirmNameModal(){
  const name = $('nameInput').value.trim();
  if(!name){ $('nameError').textContent = 'Informe um nome.'; return; }
  const members = [...selected];
  $('nameConfirmBtn').disabled = true;
  try{
    const r = await fetch('/api/product-groups', {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ market, name, members })
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || 'Erro ao salvar.');
    groups = d.groups || {};
    closeNameModal();
    exitSelectMode();
    toast('Grupo atualizado.');
  }catch(e){
    $('nameError').textContent = e.message || 'Falha de rede.';
  }finally{
    $('nameConfirmBtn').disabled = false;
  }
}

async function removeMember(name, title){
  try{
    const r = await fetch('/api/product-groups/remove-member', {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ market, name, title })
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || 'Erro ao remover.');
    groups = d.groups || {};
    render();
    toast('Produto removido do grupo.');
  }catch(e){ toast('Erro: ' + (e.message||'falha de rede'), true); }
}
async function deleteGroup(name){
  if(!(await cocoConfirm(`Os produtos voltam a aparecer separados.`, { title: `Desfazer a unificação de "${name}"?` }))) return;
  try{
    const r = await fetch(`/api/product-groups?market=${encodeURIComponent(market)}&name=${encodeURIComponent(name)}`, { method:'DELETE', credentials:'same-origin' });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || 'Erro ao excluir.');
    groups = d.groups || {};
    render();
    toast('Grupo desfeito.');
  }catch(e){ toast('Erro: ' + (e.message||'falha de rede'), true); }
}

/* ── Wiring ── */
$('selectBtn').addEventListener('click', () => { addToGroupTarget = null; enterSelectMode(); });
$('selectCancelBtn').addEventListener('click', exitSelectMode);
$('selectConfirmBtn').addEventListener('click', () => { openNameModal(); });
$('nameCancelBtn').addEventListener('click', closeNameModal);
$('nameConfirmBtn').addEventListener('click', confirmNameModal);
$('nameModalOverlay').addEventListener('click', closeNameModal);
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeNameModal(); });

$('searchInput').addEventListener('input', function(){
  searchQuery = this.value.trim().toLowerCase();
  render();
});

$('plainList').addEventListener('change', e => {
  const cb = e.target.closest('[data-select-title]');
  if(!cb) return;
  const title = cb.dataset.selectTitle;
  if(cb.checked) selected.add(title); else selected.delete(title);
  updateSelectBar();
});
$('plainList').addEventListener('click', e => {
  if(selectMode) return;
  const row = e.target.closest('.plain-row');
  if(!row) return;
});

// 'change' (nao 'input'): so grava quando a pessoa termina de digitar e sai do campo, em vez de
// disparar um POST por tecla. Nao chama renderGroups no sucesso de proposito, porque remontar o
// card enquanto o cursor esta dentro dele tiraria o foco no meio da edicao.
$('groupsWrap').addEventListener('change', e => {
  const inp = e.target.closest('[data-group-tag]');
  if(!inp) return;
  saveGroupTag(inp.dataset.groupTag, inp.dataset.axis, inp.value.trim());
});
$('groupsWrap').addEventListener('click', e => {
  const rm = e.target.closest('[data-remove-member]');
  if(rm){ removeMember(rm.dataset.group, rm.dataset.removeMember); return; }
  const del = e.target.closest('[data-delete-group]');
  if(del){ deleteGroup(del.dataset.deleteGroup); return; }
  const add = e.target.closest('[data-add-to-group]');
  if(add){
    addToGroupTarget = add.dataset.addToGroup;
    enterSelectMode();
    toast(`Selecione os produtos pra adicionar ao grupo "${addToGroupTarget}".`);
    return;
  }
  const collapse = e.target.closest('[data-collapse-card]');
  if(collapse){
    const name = collapse.dataset.collapseCard;
    if(collapsedCards.has(name)) collapsedCards.delete(name); else collapsedCards.add(name);
    renderGroups();
    return;
  }
  const toggle = e.target.closest('[data-toggle-group]');
  if(toggle){
    const name = toggle.dataset.toggleGroup;
    if(expandedGroups.has(name)) expandedGroups.delete(name); else expandedGroups.add(name);
    renderGroups();
  }
});

/* ── Formas de visualizar (Lista/Grade/Compacta e Cards/Grade/Compacta) ── */
function wireViewToggle(elId, current, onChange){
  const wrap = $(elId);
  wrap.querySelectorAll('button[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === current));
  wrap.addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if(!b) return;
    onChange(b.dataset.view);
    wrap.querySelectorAll('button[data-view]').forEach(x => x.classList.toggle('active', x === b));
  });
}
wireViewToggle('ungroupedViewToggle', ungroupedView, v => {
  ungroupedView = v;
  localStorage.setItem('coco_uni_view_ungrouped', v);
  renderPlainList();
});
wireViewToggle('groupedViewToggle', groupedView, v => {
  groupedView = v;
  localStorage.setItem('coco_uni_view_grouped', v);
  renderGroups();
});

/* ── Arrastar produtos entre grupos (e de/para "sem grupo") ──
   Drag and drop nativo (draggable + dragstart/dragover/drop) — ao contrário do arraste
   customizado por ponteiro usado em produtos.html/estoque.html (que resolve reordenar uma lista
   com placeholder), aqui o gesto é só "soltar sobre um alvo" (o grupo de destino), o caso clássico
   que a API nativa já resolve bem, sem precisar clonar elemento nem seguir o cursor. */
async function moveProductToGroup(name, title){
  try{
    const r = await fetch('/api/product-groups', {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ market, name, members: [title] })
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || 'Erro ao mover.');
    groups = d.groups || {};
    render();
    toast(`Movido para "${name}".`);
  }catch(e){ toast('Erro: ' + (e.message||'falha de rede'), true); }
}

document.addEventListener('dragstart', e => {
  const src = e.target.closest('[data-drag-title]');
  if(!src || selectMode) return;
  dragTitle = src.dataset.dragTitle;
  dragFromGroup = src.dataset.dragFrom || null;
  src.classList.add('dragging-source');
  e.dataTransfer.effectAllowed = 'move';
  try{ e.dataTransfer.setData('text/plain', dragTitle); }catch(err){}
});
document.addEventListener('dragend', e => {
  const src = e.target.closest('[data-drag-title]');
  if(src) src.classList.remove('dragging-source');
  dragTitle = null; dragFromGroup = null;
  document.querySelectorAll('.drag-over,.drag-over-col').forEach(el => el.classList.remove('drag-over','drag-over-col'));
});

$('groupsWrap').addEventListener('dragover', e => {
  const target = e.target.closest('[data-drop-group]');
  if(!target || !dragTitle) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  target.classList.add('drag-over');
});
$('groupsWrap').addEventListener('dragleave', e => {
  const target = e.target.closest('[data-drop-group]');
  if(target && !target.contains(e.relatedTarget)) target.classList.remove('drag-over');
});
$('groupsWrap').addEventListener('drop', e => {
  const target = e.target.closest('[data-drop-group]');
  if(!target || !dragTitle) return;
  e.preventDefault();
  target.classList.remove('drag-over');
  const destGroup = target.dataset.dropGroup;
  const title = dragTitle;
  if(destGroup === dragFromGroup) return; // soltou no próprio grupo, nada a fazer
  moveProductToGroup(destGroup, title);
});

const ungroupedCol = $('ungroupedCol');
ungroupedCol.addEventListener('dragover', e => {
  if(!dragTitle || !dragFromGroup) return; // só aceita drop de um produto que veio de um grupo
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  ungroupedCol.classList.add('drag-over-col');
});
ungroupedCol.addEventListener('dragleave', e => {
  if(!ungroupedCol.contains(e.relatedTarget)) ungroupedCol.classList.remove('drag-over-col');
});
ungroupedCol.addEventListener('drop', e => {
  if(!dragTitle || !dragFromGroup) return;
  e.preventDefault();
  ungroupedCol.classList.remove('drag-over-col');
  removeMember(dragFromGroup, dragTitle);
});

/* ── "Ocultar produtos" — palavras-chave buscadas nas tags de cada item (ver isHiddenItem em
   metrics.js). Controle centralizado aqui, a pedido do Luan ("essa função deve estar no
   unificador, que é onde iremos controlar tudo"); o efeito vale em toda a dashboard (Segmentos,
   Produtos, Estoque, Top produtos) — não só no card "Ocultos" de Segmentos. ── */
let hideTags = [];
async function loadHideTags(){
  try{
    const r = await fetch('/api/product-hidden-tags?market=' + market, { credentials:'same-origin' });
    const d = await r.json();
    hideTags = d.tags || [];
  }catch(e){ hideTags = []; }
  renderHideTags();
}
function renderHideTags(){
  const wrap = $('hideTagsList');
  wrap.innerHTML = hideTags.length
    ? hideTags.map(t => `<span class="hide-tag-chip">${escapeHtml(t)}<button data-remove-hide-tag="${escapeHtml(t)}" title="Remover"><i class="bi bi-x"></i></button></span>`).join('')
    : '<div class="sub" style="margin:0">Nenhuma palavra-chave ainda — nenhum produto está oculto.</div>';
}
function openHideModal(){
  $('hideModalOverlay').classList.add('open');
  $('hideModal').classList.add('open');
  loadHideTags();
}
function closeHideModal(){
  $('hideModalOverlay').classList.remove('open');
  $('hideModal').classList.remove('open');
  $('hideNewTag').value = '';
}
async function hideAddTag(tag){
  const r = await fetch('/api/product-hidden-tags', {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
    body: JSON.stringify({ market, tags:[tag] }),
  });
  const d = await r.json();
  if(!r.ok) { toast('Erro: ' + (d.error||'falha de rede'), true); return; }
  hideTags = d.tags || [];
  renderHideTags();
  load(); // recarrega o catálogo pra refletir o novo produto oculto na hora
}
async function hideRemoveTag(tag){
  const r = await fetch('/api/product-hidden-tags/remove', {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
    body: JSON.stringify({ market, tag }),
  });
  const d = await r.json();
  if(!r.ok) return;
  hideTags = d.tags || [];
  renderHideTags();
  load();
}
$('syncBtn').addEventListener('click', async () => {
  $('syncBtn').disabled = true;
  try { await fetch('/api/sync', { method: 'POST' }); } catch (e) {}
  await load();
  $('syncBtn').disabled = false;
  toast('Sincronizado.');
});

$('hideBtn').addEventListener('click', openHideModal);
$('hideCloseBtn').addEventListener('click', closeHideModal);
$('hideModalOverlay').addEventListener('click', closeHideModal);
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeHideModal(); });
$('hideAddBtn').addEventListener('click', () => {
  const t = $('hideNewTag').value.trim();
  if(!t) return;
  hideAddTag(t);
  $('hideNewTag').value = '';
});
$('hideNewTag').addEventListener('keydown', e => {
  if(e.key !== 'Enter') return;
  const t = e.target.value.trim();
  if(!t) return;
  hideAddTag(t);
  e.target.value = '';
});
$('hideTagsList').addEventListener('click', e => {
  const rm = e.target.closest('[data-remove-hide-tag]');
  if(rm) hideRemoveTag(rm.dataset.removeHideTag);
});

/* ── Init ── */
(async function(){
  $('mktBtnBr').classList.toggle('active', market === 'br');
  $('mktBtnUs').classList.toggle('active', market === 'us');
  await loadMe();
  await loadGroupsConfig();
  await load();
})();
