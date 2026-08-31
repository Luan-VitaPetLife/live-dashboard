const $ = id => document.getElementById(id);
const LOGO_BASE = 'img/integracoes/';
const FALLBACK_ICON = { geral: 'bi-shop', marketing: 'bi-megaphone', planned: 'bi-hourglass-split' };
const STATE_LABEL = {
  connected: 'Conectada', pending_auth: 'Aguardando autorização', not_configured: 'Não configurada',
  paused: 'Pausada', disabled: 'Desativada', planned: 'Em breve',
};
const COUNTRY_LABEL = { br: 'Brasil', us: 'Estados Unidos' };
const COUNTRY_FLAG  = { br: 'img/bandeiras/bandeira_brasil.webp', us: 'img/bandeiras/bandeira_eua.svg' };

// Metadados de cada PLATAFORMA (não confundir com o canal em si) — usados só pro cabeçalho do
// bloco de família, quando 2+ integrações do mesmo `group` aparecem juntas (ver server.js
// computeIntegrationsList). Logo do card individual continua sendo o da conta/marca (ex.: ícone
// da Coco and Luna no card Shopify BR) — aqui é o logo da plataforma em si.
const GROUP_ORDER = ['shopify','mercadolivre','amazon','shopee','meta','google','bling','tiktok'];
const GROUP_META = {
  shopify:      { label: 'Shopify',       logo: 'Shopify_logo.png' },
  mercadolivre: { label: 'Mercado Livre', logo: 'Logotipo_MercadoLivre.png' },
  amazon:       { label: 'Amazon',        logo: 'Amazon_logo.png' },
  shopee:       { label: 'Shopee',        logo: 'logo-shopee.png' },
  meta:         { label: 'Meta',          logo: 'logo-meta.png' },
  google:       { label: 'Google Ads',    logo: 'google_ads_logo_icon.png' },
  bling:        { label: 'Bling',         logo: 'logo-bling1.png' },
  tiktok:       { label: 'TikTok Shop',   logo: 'logo-tiktok-shop.png' },
};

let viewMode = localStorage.getItem('coco_integ_view') || 'cards';
let lastItems = [];

function toast(msg, isErr){
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(()=>{ t.className = 'toast' + (isErr ? ' err' : ''); }, 2600);
}

function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function loadMe(){
  try{
    const r = await fetch('/api/me', { credentials:'same-origin' });
    const d = await r.json();
    const uname = (d.user && (d.user.name || d.user.username)) || 'Admin';
    $('whoami').textContent = uname;
  }catch(e){}
}

// ── Ligar/desligar — compartilhado por todos os modos de visualização (switch nos modos Cards/
// Colunas/Linhas, clique na bolinha de status no modo Compacto). `revert` desfaz uma mudança
// visual otimista (hoje só o checkbox nativo, que já se marca sozinho antes do evento `change`
// disparar) se o usuário cancelar a confirmação ou a chamada falhar. ──
async function requestToggle(it, desired, revert){
  const question = desired
    ? 'Ativar ' + it.label + ' (' + COUNTRY_LABEL[it.country] + ')? A sincronização automática volta a rodar no próximo ciclo.'
    : 'Desativar ' + it.label + ' (' + COUNTRY_LABEL[it.country] + ')? A sincronização automática para de buscar dados novos desse canal. O que já está salvo continua no painel normalmente.';
  if (!(await cocoConfirm(question, { title: desired ? 'Ativar integração' : 'Desativar integração' }))){ if (revert) revert(); return; }
  try{
    const r = await fetch('/api/integrations/' + encodeURIComponent(it.key) + '/toggle', {
      method:'POST', credentials:'same-origin',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ enabled: desired }),
    });
    if (!r.ok){ const d = await r.json().catch(()=>({})); throw new Error(d.error || 'http ' + r.status); }
    toast(it.label + (desired ? ' ativada.' : ' desativada.'));
    load();
  }catch(e){
    if (revert) revert();
    toast('Erro ao salvar: ' + (e.message || 'falha de rede'), true);
  }
}

function makeSwitch(it){
  const sw = document.createElement('label');
  sw.className = 'ios-switch';
  sw.innerHTML = '<input type="checkbox" class="ios-switch-input" ' + (it.state !== 'disabled' ? 'checked' : '') + '>' +
    '<span class="ios-switch-track"><span class="ios-switch-thumb"></span></span>';
  const cb = sw.querySelector('input');
  cb.addEventListener('change', () => {
    const desired = cb.checked;
    cb.disabled = true;
    requestToggle(it, desired, () => { cb.checked = !desired; }).finally(() => { cb.disabled = false; });
  });
  return sw;
}

function logoBoxEl(className, logo, label, category){
  const box = document.createElement('div');
  box.className = className;
  const img = document.createElement('img');
  // Logo começando com "/" é servida direto da raiz de public/ (ex: /Logo2.png, o ícone da
  // própria Coco and Luna) em vez de img/integracoes/ — usado pros canais Shopify que são a
  // marca em si, não um serviço de terceiro (ver server.js computeIntegrationsList).
  img.src = (logo || '').startsWith('/') ? logo : LOGO_BASE + logo;
  img.alt = label;
  img.onerror = function(){
    box.innerHTML = '<i class="bi ' + (FALLBACK_ICON[category] || 'bi-app') + '"></i>';
  };
  box.appendChild(img);
  return box;
}

// ── Card individual (usado tanto pra canal avulso quanto pra membro dentro de um fam-block) ──
function integCardEl(it){
  const card = document.createElement('div');
  card.className = 'integ-card' + (it.state === 'planned' ? ' is-planned' : '');

  const top = document.createElement('div');
  top.className = 'integ-top';
  top.appendChild(logoBoxEl('integ-logo', it.logo, it.label, it.category));

  const info = document.createElement('div');
  info.className = 'integ-info';
  const noteText = it.note || it.detail || '';
  info.innerHTML =
    '<div class="integ-name">' + escapeHtml(it.label) + '</div>' +
    '<div class="integ-badge badge-' + it.state + '">' + STATE_LABEL[it.state] + '</div>' +
    (noteText ? '<div class="integ-note">' + escapeHtml(noteText) + '</div>' : '');
  top.appendChild(info);
  card.appendChild(top);

  if (it.state !== 'planned'){
    const bottom = document.createElement('div');
    bottom.className = 'integ-bottom';
    const label = document.createElement('span');
    label.className = 'integ-note';
    label.textContent = it.state === 'disabled' ? 'Sincronização pausada' : 'Sincronização automática';
    bottom.appendChild(label);
    bottom.appendChild(makeSwitch(it));
    card.appendChild(bottom);
  }

  return card;
}

// ── Bloco de família: a logo da plataforma fica grande, fora da caixa do card (só o ícone —
// sem repetir o nome em texto, os cards dos membros já dizem quem são); o card em si só tem a
// contagem de conectadas + os cards das contas daquela plataforma. ──
function famBlockEl(groupId, items){
  const meta = GROUP_META[groupId] || { label: groupId, logo: '' };
  const wrap = document.createElement('div');
  wrap.className = 'fam-block';

  const head = document.createElement('div');
  head.className = 'fam-head';
  head.appendChild(logoBoxEl('fam-head-logo', meta.logo, meta.label, 'geral'));
  const count = document.createElement('div');
  count.className = 'fam-count';
  const connected = items.filter(it => it.state === 'connected').length;
  count.textContent = connected + '/' + items.length + ' conectadas';
  head.appendChild(count);
  wrap.appendChild(head);

  const cardsWrap = document.createElement('div');
  cardsWrap.className = 'fam-cards';
  items.forEach(it => cardsWrap.appendChild(integCardEl(it)));
  wrap.appendChild(cardsWrap);

  return wrap;
}

// ── Agrupa por plataforma (`group`), preservando a ordem de GROUP_ORDER. Grupo com 2+ itens vira
// um fam-block; grupo com 1 item só aparece como card avulso (sem cabeçalho de família). ──
function buildBlocks(items){
  const byGroup = {};
  items.forEach(it => { (byGroup[it.group] ||= []).push(it); });
  const order = GROUP_ORDER.filter(g => byGroup[g]).concat(Object.keys(byGroup).filter(g => !GROUP_ORDER.includes(g)));
  return order.map(g => {
    const list = byGroup[g];
    return list.length > 1 ? { kind: 'family', group: g, items: list } : { kind: 'solo', item: list[0] };
  });
}

// ── Modos Cards/Colunas: mesmos elementos (fam-block / integ-card), só muda a classe do
// container — flex-wrap num, CSS multi-column no outro. ──
function renderFlowLikeMode(container, blocks, className){
  container.className = className;
  blocks.forEach(b => {
    container.appendChild(b.kind === 'family' ? famBlockEl(b.group, b.items) : integCardEl(b.item));
  });
}

// ── Modo Linhas: lista compacta, um bloco (com cabeçalho, se família) por grupo ──
function rowEl(it, isMember){
  const row = document.createElement('div');
  row.className = 'integ-row' + (it.state === 'planned' ? ' is-planned' : '');
  row.appendChild(logoBoxEl('integ-logo', it.logo, it.label, it.category));

  const name = document.createElement('div');
  name.className = 'integ-row-name';
  name.textContent = it.label;
  row.appendChild(name);

  const badge = document.createElement('div');
  badge.className = 'integ-badge badge-' + it.state;
  badge.textContent = STATE_LABEL[it.state];
  row.appendChild(badge);

  const note = document.createElement('div');
  note.className = 'integ-row-note';
  note.textContent = it.note || it.detail || '';
  row.appendChild(note);

  if (it.state !== 'planned'){
    const sw = makeSwitch(it);
    sw.classList.add('integ-row-sw');
    row.appendChild(sw);
  }
  return row;
}
function renderRowsMode(container, blocks){
  container.className = 'integ-rows-wrap';
  blocks.forEach(b => {
    const list = document.createElement('div');
    list.className = 'integ-rows';
    if (b.kind === 'family'){
      const meta = GROUP_META[b.group] || { label: b.group, logo: '' };
      const head = document.createElement('div');
      head.className = 'rows-famhead';
      head.appendChild(logoBoxEl('fam-logo', meta.logo, meta.label, 'geral'));
      const nm = document.createElement('span');
      nm.className = 'rows-famhead-name';
      nm.textContent = meta.label;
      head.appendChild(nm);
      list.appendChild(head);
      b.items.forEach(it => list.appendChild(rowEl(it, true)));
    } else {
      list.appendChild(rowEl(b.item, false));
    }
    container.appendChild(list);
  });
}

// ── Modo Compacto: grade densa de ícones — clique na bolinha de status liga/desliga direto,
// sem precisar abrir o card inteiro. Itens avulsos (sem família) ficam juntos numa grade final,
// sem cabeçalho, pra não criar uma grade de 1 ícone só pra cada um. ──
function compactTileEl(it){
  const tile = document.createElement('div');
  tile.className = 'compact-tile' + (it.state === 'planned' ? ' is-planned' : '');
  const noteText = it.note || it.detail || '';
  tile.title = it.label + ' — ' + STATE_LABEL[it.state] + (noteText ? ' · ' + noteText : '');
  tile.appendChild(logoBoxEl('compact-logo', it.logo, it.label, it.category));
  const name = document.createElement('div');
  name.className = 'compact-name';
  name.textContent = it.label;
  tile.appendChild(name);
  const dot = document.createElement('div');
  dot.className = 'compact-dot dot-' + it.state + (it.state === 'planned' ? '' : ' clickable');
  if (it.state !== 'planned'){
    dot.addEventListener('click', e => {
      e.stopPropagation();
      requestToggle(it, it.state === 'disabled', null);
    });
  }
  tile.appendChild(dot);
  return tile;
}
function renderCompactMode(container, blocks){
  container.className = 'integ-compact-wrap';
  const solo = [];
  blocks.forEach(b => {
    if (b.kind === 'family'){
      const meta = GROUP_META[b.group] || { label: b.group, logo: '' };
      const wrap = document.createElement('div');
      const head = document.createElement('div');
      head.className = 'compact-famhead';
      head.appendChild(logoBoxEl('fam-logo', meta.logo, meta.label, 'geral'));
      const nm = document.createElement('span');
      nm.className = 'compact-famhead-name';
      nm.textContent = meta.label;
      head.appendChild(nm);
      wrap.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'compact-grid';
      b.items.forEach(it => grid.appendChild(compactTileEl(it)));
      wrap.appendChild(grid);
      container.appendChild(wrap);
    } else {
      solo.push(b.item);
    }
  });
  if (solo.length){
    const wrap = document.createElement('div');
    const grid = document.createElement('div');
    grid.className = 'compact-grid';
    solo.forEach(it => grid.appendChild(compactTileEl(it)));
    wrap.appendChild(grid);
    container.appendChild(wrap);
  }
}

async function load(){
  try{
    const r = await fetch('/api/integrations', { credentials:'same-origin' });
    if (!r.ok) throw new Error('http ' + r.status);
    const d = await r.json();
    lastItems = d.integrations || [];
    render(lastItems);
  }catch(e){
    $('listArea').innerHTML = '<div class="empty">Não foi possível carregar as integrações.</div>';
  }
}

function render(items){
  const area = $('listArea');
  area.innerHTML = '';
  const countries = ['br', 'us'];
  countries.forEach(country => {
    const inCountry = items.filter(it => it.country === country);
    if (!inCountry.length) return;

    const block = document.createElement('div');
    block.className = 'country-block';

    const head = document.createElement('div');
    head.className = 'country-head';
    head.innerHTML =
      '<img src="' + COUNTRY_FLAG[country] + '" class="country-flag" alt="' + COUNTRY_LABEL[country] + '">' +
      '<span class="country-name">' + COUNTRY_LABEL[country] + '</span>';
    block.appendChild(head);

    const container = document.createElement('div');
    const blocks = buildBlocks(inCountry);
    if (viewMode === 'colunas') renderFlowLikeMode(container, blocks, 'integ-columns');
    else if (viewMode === 'linhas') renderRowsMode(container, blocks);
    else if (viewMode === 'compacto') renderCompactMode(container, blocks);
    else renderFlowLikeMode(container, blocks, 'integ-flow');
    block.appendChild(container);

    area.appendChild(block);
  });

  if (!area.children.length) area.innerHTML = '<div class="empty">Nenhuma integração encontrada.</div>';
}

function syncViewSwitch(){
  document.querySelectorAll('#viewSwitch .vs-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === viewMode));
}
$('viewSwitch').addEventListener('click', e => {
  const btn = e.target.closest('.vs-btn');
  if (!btn) return;
  viewMode = btn.dataset.mode;
  localStorage.setItem('coco_integ_view', viewMode);
  syncViewSwitch();
  if (lastItems.length) render(lastItems);
});

// ── Histórico da Amazon (BR/EUA separados) — um campo só por mercado ────
// "Dias de histórico desejado": se for menos do que já existe, poda (pede prévia + confirmação,
// só essa ação apaga pedido de verdade); se for mais, busca automaticamente o que falta
// (backfill, não precisa de confirmação — só soma). Nunca os dois separados, evita confundir
// "isso soma com aquilo?" (pergunta real de quem usa a tela). Ver server.js /api/amazon/history.
const RET_MARKET_LABEL = { br: 'Brasil', us: 'Estados Unidos' };
let retBackfillPolling = null;

// Os dois painéis de histórico (Amazon e Shopify) mostram o MESMO tipo de informação, então
// mostram a mesma frase, montada aqui. Antes cada um tinha a sua: um dizia "336 pedidos · cobre
// 136 dias hoje" e o outro "começa em 17/04/2026 (137 dias) · Shopify Coco and Luna BR · ...".
// Eram dois formatos para o mesmo dado, e o painel parecia dois painéis sem relação.
function retResumo(info){
  const pedidos = Number(info.totalOrders || 0);
  if (!pedidos || !info.oldestOrderDate) return 'nenhum pedido guardado ainda';
  const desde = CocoPeriodo.data(info.oldestOrderDate);
  const dias = Number(info.oldestOrderDays || 0).toLocaleString('pt-BR');
  return `${pedidos.toLocaleString('pt-BR')} pedidos · desde ${desde} (${dias} dias)`;
}

// O markup das quatro linhas também é um só. `extra` vira o title do rótulo: é onde a linha da
// Shopify diz quais lojas ela alcança, sem que isso desmonte a frase padrão.
function retLinha({ mkt, id, logo, info, botao, extra }){
  const cap = mkt === 'us' ? 'Us' : 'Br';
  const titulo = extra ? ` title="${extra}"` : '';
  return `<div class="ret-row">
    <div class="ret-row-main">
      <div class="ret-row-label"${titulo}>
        <img class="ret-row-logo" src="${logo}" alt="">
        <span class="ret-row-label-text">${RET_MARKET_LABEL[mkt]}<span class="ret-row-sub">${retResumo(info)}</span></span>
      </div>
      <div class="ret-row-input"><input type="number" id="${id}Days${cap}" min="${id === 'ret' ? 0 : 1}"${id === 'ret' ? '' : ' max="1825"'} value="${info.campo}"><span>dias</span></div>
      <button class="ret-btn" id="${id}Apply${cap}" onclick="${id === 'ret' ? 'applyHistory' : 'applyShopHistory'}('${mkt}')"${info.desabilitado ? ' disabled' : ''}>${botao}</button>
    </div>
    <div class="ret-row-status" id="${id}Status${cap}"></div>
  </div>`;
}
async function loadHistory(){
  try{
    const r = await fetch('/api/amazon/history', { credentials:'same-origin' });
    if (!r.ok) throw new Error('http ' + r.status);
    const d = await r.json();
    $('retPanelSub').textContent = 'Quantos dias de pedidos manter guardados em cada mercado. Um número menor apaga o excesso e pede confirmação antes; um número maior busca na Amazon o que estiver faltando. Zero significa sem limite.';
    $('retRows').innerHTML = ['br','us'].map(mkt => retLinha({
      mkt, id: 'ret', logo: 'img/integracoes/Amazon_logo.png', botao: 'Aplicar',
      info: { ...(d[mkt] || { days: 0, totalOrders: 0, oldestOrderDate: null, oldestOrderDays: null }), campo: (d[mkt] || {}).days ?? 0 },
    })).join('');
  }catch(e){
    $('retPanelSub').textContent = 'Não foi possível carregar o histórico da Amazon.';
  }
}
async function applyHistory(market){
  const cap = market === 'us' ? 'Us' : 'Br';
  const input = $('retDays' + cap), btn = $('retApply' + cap), statusEl = $('retStatus' + cap);
  const days = Number(input.value);
  if (!(days >= 0)){ toast('Dias precisa ser um número válido.', true); return; }
  btn.disabled = true;
  try{
    const pr = await fetch(`/api/amazon/history/preview?market=${market}&days=${days}`, { credentials:'same-origin' });
    const plan = await pr.json();
    if (!pr.ok) throw new Error(plan.error || 'falha ao calcular prévia');

    if (plan.action === 'prune' && plan.wouldDelete > 0){
      const ok = await cocoConfirm(
        `Isso vai apagar ${plan.wouldDelete.toLocaleString('pt-BR')} de ${plan.totalOrders.toLocaleString('pt-BR')} pedidos da Amazon ${RET_MARKET_LABEL[market]}, mantendo só os últimos ${days} dias. Essa ação não tem volta.`,
        { title: 'Apagar histórico antigo', confirmText: 'Apagar', danger: true }
      );
      if (!ok){ btn.disabled = false; return; }
    }

    const r = await fetch('/api/amazon/history', {
      method:'POST', credentials:'same-origin',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ market, days }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'http ' + r.status);

    if (d.action === 'pruned'){
      toast(`${d.deleted.toLocaleString('pt-BR')} pedidos apagados. Histórico agora: ${days === 0 ? 'sem limite' : days + ' dias'}.`);
      btn.disabled = false;
      loadHistory();
    } else if (d.action === 'backfill_started'){
      statusEl.textContent = 'Buscando o histórico que falta…';
      toast(`Buscando mais histórico da Amazon ${RET_MARKET_LABEL[market]}.`);
      pollHistoryBackfill(cap);
    } else {
      toast(`Configuração salva: ${days === 0 ? 'sem limite' : days + ' dias'}.`);
      btn.disabled = false;
    }
  }catch(e){
    toast('Erro: ' + (e.message || 'falha de rede'), true);
    btn.disabled = false;
  }
}
function pollHistoryBackfill(cap){
  if (retBackfillPolling) clearInterval(retBackfillPolling);
  const tick = async () => {
    try{
      const r = await fetch('/api/status', { credentials:'same-origin' });
      const d = await r.json();
      const b = d.amazon?.backfill;
      const statusEl = $('retStatus' + cap);
      if (!b || !statusEl) return;
      statusEl.textContent = b.status === 'running' ? `Buscando… ${b.message || ''}`
        : b.status === 'done' ? `Concluído: ${b.message || ''}`
        : b.status === 'error' ? `Erro: ${b.message || ''}`
        : '';
      if (b.status !== 'running'){
        clearInterval(retBackfillPolling);
        retBackfillPolling = null;
        $('retApply' + cap).disabled = false;
        if (b.status === 'done') loadHistory();
      }
    }catch(e){}
  };
  tick();
  retBackfillPolling = setInterval(tick, 4000);
}

// ── Histórico das lojas Shopify (BR/EUA) ────
// Só soma: busca pedido antigo que nunca entrou no banco porque o sync guarda uma janela móvel
// de 60 dias. Diferente do painel da Amazon acima, aqui não existe poda, então também não existe
// confirmação — nada é apagado em hipótese nenhuma.
let shopHistPolling = null;
async function loadShopHistory(){
  try{
    const r = await fetch('/api/shopify/history', { credentials:'same-origin' });
    if (!r.ok) throw new Error('http ' + r.status);
    const d = await r.json();
    $('shopHistSub').textContent = 'Quantos dias de pedidos buscar nas lojas Shopify de cada mercado. Nada é apagado: o pedido que já existe é só atualizado e o que faltava entra. Pode demorar alguns minutos.';
    $('shopHistRows').innerHTML = ['br','us'].map(mkt => {
      const info = d[mkt] || { totalOrders: 0, oldestOrderDate: null, oldestOrderDays: null, lojas: [] };
      return retLinha({
        mkt, id: 'shop', logo: 'img/integracoes/Shopify_logo.png', botao: 'Buscar',
        info: { ...info, campo: 365, desabilitado: !info.lojas.length },
        extra: info.lojas.length ? info.lojas.join(' · ') : 'nenhuma loja ligada neste mercado',
      });
    }).join('');
  }catch(e){
    $('shopHistSub').textContent = 'Não foi possível carregar o histórico das lojas Shopify.';
  }
}
async function applyShopHistory(market){
  const cap = market === 'us' ? 'Us' : 'Br';
  const btn = $('shopApply' + cap), statusEl = $('shopStatus' + cap);
  const days = Number($('shopDays' + cap).value);
  if (!(days >= 1)){ toast('Dias precisa ser um número maior que zero.', true); return; }
  btn.disabled = true;
  try{
    const r = await fetch('/api/shopify/backfill?market=' + market + '&days=' + days, { method:'POST', credentials:'same-origin' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'http ' + r.status);
    statusEl.textContent = 'Buscando…';
    toast('Buscando ' + days + ' dias de histórico Shopify ' + RET_MARKET_LABEL[market] + '.');
    pollShopHistory(cap);
  }catch(e){
    toast('Erro: ' + (e.message || 'falha de rede'), true);
    btn.disabled = false;
  }
}
function pollShopHistory(cap){
  if (shopHistPolling) clearInterval(shopHistPolling);
  const tick = async () => {
    try{
      const r = await fetch('/api/jobs', { credentials:'same-origin' });
      const d = await r.json();
      const j = (d.jobs || []).find(x => x.id === 'shopify-backfill');
      const statusEl = $('shopStatus' + cap);
      if (!j || !statusEl) return;
      statusEl.textContent = j.status === 'running' ? 'Buscando… ' + (j.message || '')
        : j.status === 'done' ? 'Concluído: ' + (j.message || '')
        : j.status === 'cancelled' ? 'Cancelado: ' + (j.message || '')
        : j.status === 'error' ? 'Erro: ' + (j.message || '')
        : '';
      if (j.status !== 'running'){
        clearInterval(shopHistPolling);
        shopHistPolling = null;
        $('shopApply' + cap).disabled = false;
        if (j.status === 'done') loadShopHistory();
      }
    }catch(e){}
  };
  tick();
  shopHistPolling = setInterval(tick, 4000);
}

// ── Backup do banco (Backblaze B2) — ver src/backup.js ────
function fmtBytes(n){
  if (!n) return '0 KB';
  return n > 1024*1024 ? (n/1024/1024).toFixed(1) + ' MB' : (n/1024).toFixed(0) + ' KB';
}
async function loadBackupStatus(){
  try{
    const r = await fetch('/api/backup/status', { credentials:'same-origin' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'http ' + r.status);
    if (!d.configured){
      $('backupPanelSub').textContent = 'Não configurado — faltam B2_KEY_ID / B2_APPLICATION_KEY / B2_BUCKET_NAME nas variáveis do servidor.';
      $('backupRunBtn').disabled = true;
      return;
    }
    $('backupRunBtn').disabled = d.running;
    const last = d.last;
    $('backupPanelSub').textContent = !last ? 'Configurado, ainda sem nenhum backup rodado.'
      : last.status === 'done' ? `Último backup: ${new Date(last.finishedAt).toLocaleString('pt-BR')} · ${fmtBytes(last.sizeBytes)}${last.pruned ? ` · ${last.pruned} antigo(s) removido(s)` : ''}`
      : `Última tentativa falhou (${new Date(last.finishedAt).toLocaleString('pt-BR')}): ${last.message}`;
    $('backupFilesDivider').style.display = d.files.length ? '' : 'none';
    $('backupFilesList').innerHTML = d.files.slice(0, 10).map(f => `
      <div class="backup-file-row">
        <span class="backup-file-name">${escapeHtml(f.fileName.replace('db-backup/',''))}</span>
        <span>${fmtBytes(Number(f.sizeBytes))} · ${new Date(f.uploadedAt).toLocaleDateString('pt-BR')}</span>
      </div>`).join('');
  }catch(e){
    $('backupPanelSub').textContent = 'Não foi possível carregar o status do backup.';
  }
}
async function runBackupNow(){
  const btn = $('backupRunBtn');
  btn.disabled = true;
  $('backupStatusMsg').textContent = 'Rodando backup…';
  try{
    const r = await fetch('/api/backup/run', { method:'POST', credentials:'same-origin' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'http ' + r.status);
    $('backupStatusMsg').textContent = `Backup concluído: ${fmtBytes(d.sizeBytes)}.`;
    toast('Backup concluído.');
    loadBackupStatus();
  }catch(e){
    $('backupStatusMsg').textContent = 'Erro: ' + (e.message || 'falha de rede');
    toast('Erro ao rodar backup: ' + (e.message || 'falha de rede'), true);
    btn.disabled = false;
  }
}

// ── Alerta de sincronização (Telegram) — ver src/alerts.js. Reaproveita GET /api/status
// (mesma checagem já usada pra Bling/Amazon/etc.) em vez de um endpoint só pra isso. ────
async function loadAlertsStatus(){
  try{
    const r = await fetch('/api/status', { credentials:'same-origin' });
    const d = await r.json();
    if (!r.ok) throw new Error('http ' + r.status);
    const configured = d.alerts?.configured;
    $('alertsTestBtn').disabled = !configured;
    $('alertsPanelSub').textContent = configured
      ? 'Configurado — avisa no Telegram quando um canal fica travado sem sincronizar por horas.'
      : 'Não configurado — faltam TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID nas variáveis do servidor.';
  }catch(e){
    $('alertsPanelSub').textContent = 'Não foi possível carregar o status do alerta.';
  }
}
async function testAlertNow(){
  const btn = $('alertsTestBtn');
  btn.disabled = true;
  $('alertsStatusMsg').textContent = 'Enviando…';
  try{
    const r = await fetch('/api/alerts/test', { method:'POST', credentials:'same-origin' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'http ' + r.status);
    $('alertsStatusMsg').textContent = 'Enviado — confira o Telegram.';
    toast('Alerta de teste enviado.');
  }catch(e){
    $('alertsStatusMsg').textContent = 'Erro: ' + (e.message || 'falha de rede');
    toast('Erro ao enviar alerta: ' + (e.message || 'falha de rede'), true);
  }finally{
    btn.disabled = false;
  }
}

(async function(){
  syncViewSwitch();
  await loadMe();
  await load();
  await loadHistory();
  await loadShopHistory();
  // Retoma o acompanhamento se uma busca de histórico já estava rodando antes de recarregar a
  // página (ex.: deu F5 no meio de um backfill).
  try{
    const s = await fetch('/api/status', { credentials:'same-origin' }).then(r => r.json());
    if (s.amazon?.backfill?.status === 'running'){
      const cap = s.amazon.backfill.market === 'us' ? 'Us' : 'Br';
      $('retApply' + cap).disabled = true;
      pollHistoryBackfill(cap);
    }
  }catch(e){}
  try{
    const d = await fetch('/api/jobs', { credentials:'same-origin' }).then(r => r.json());
    const j = (d.jobs || []).find(x => x.id === 'shopify-backfill' && x.status === 'running');
    if (j){
      const cap = /EUA/.test(j.label) ? 'Us' : 'Br';
      $('shopApply' + cap).disabled = true;
      pollShopHistory(cap);
    }
  }catch(e){}
  loadBackupStatus();
  loadAlertsStatus();
})();
