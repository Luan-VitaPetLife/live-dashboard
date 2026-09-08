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

// ── Histórico de pedidos (Amazon e Shopify, BR e EUA) ───────────────────────
// Um painel só, quatro linhas que fazem exatamente a MESMA coisa: buscar os últimos N dias
// daquela loja. O número é o ALCANCE DA BUSCA e mudar ele muda o alcance, sempre — pedido do
// Luan em 08/09/2026, junto de "essa tela está muito bagunçada".
//
// Eram três painéis com três textos longos. O da Amazon tinha um campo que PODAVA ou BUSCAVA
// conforme o número fosse menor ou maior que o histórico atual: duas ações opostas no mesmo lugar,
// e a poda é a única coisa neste projeto que apaga pedido de verdade. O de reembolsos era um botão
// separado, e separado dava pra esquecer — esquecer significa pedido recuperado sem a marca de
// devolução, contando como vendida uma unidade que voltou. Hoje a busca da Amazon traz os
// reembolsos junto, e nenhum botão desta tela apaga nada.
const RET_MARKET_LABEL = { br: 'Brasil', us: 'Estados Unidos' };
const HIST_PADRAO_DIAS = 365;

const HIST_LINHAS = [
  { slot: 'AmzBr',  loja: 'amazon',  nome: 'Amazon',  mkt: 'br', job: 'amazon-backfill',  max: 730,  logo: 'img/integracoes/Amazon_logo.png' },
  { slot: 'AmzUs',  loja: 'amazon',  nome: 'Amazon',  mkt: 'us', job: 'amazon-backfill',  max: 730,  logo: 'img/integracoes/Amazon_logo.png' },
  { slot: 'ShopBr', loja: 'shopify', nome: 'Shopify', mkt: 'br', job: 'shopify-backfill', max: 1825, logo: 'img/integracoes/Shopify_logo.png' },
  { slot: 'ShopUs', loja: 'shopify', nome: 'Shopify', mkt: 'us', job: 'shopify-backfill', max: 1825, logo: 'img/integracoes/Shopify_logo.png' },
];

let histInfo = { amazon: {}, shopify: {} };
let histPoll = null;

// A mesma frase nas quatro linhas. Duas frases diferentes pro mesmo dado faziam o painel parecer
// dois painéis sem relação, e foi o que essa função resolveu quando os painéis ainda eram dois.
function retResumo(info){
  const pedidos = Number(info.totalOrders || 0);
  if (!pedidos || !info.oldestOrderDate) return 'nenhum pedido guardado ainda';
  const desde = CocoPeriodo.data(info.oldestOrderDate);
  const dias = Number(info.oldestOrderDays || 0).toLocaleString('pt-BR');
  return `${pedidos.toLocaleString('pt-BR')} pedidos · desde ${desde} (${dias} dias)`;
}

// O markup da linha existe num lugar só: escrito quatro vezes, ele divergiria na primeira mexida.
function retLinha({ slot, logo, nome, mkt, resumo, dica, valor, max, desabilitado }){
  return `<div class="ret-row">
    <div class="ret-row-main">
      <div class="ret-row-label" title="${dica}">
        <img class="ret-row-logo" src="${logo}" alt="">
        <span class="ret-row-label-text">${nome} · ${RET_MARKET_LABEL[mkt]}<span class="ret-row-sub">${resumo}</span></span>
      </div>
      <div class="ret-row-input"><input type="number" id="histDias${slot}" min="1" max="${max}" value="${valor}"><span>dias</span></div>
      <button class="ret-btn" id="histBtn${slot}" onclick="buscarHistorico('${slot}')"${desabilitado ? ' disabled' : ''}>Buscar</button>
    </div>
    <div class="ret-row-status" id="histStatus${slot}"></div>
  </div>`;
}

// O campo nasce com o ÚLTIMO número digitado nele (pedido do Luan): quem ajusta o alcance costuma
// repetir o mesmo ajuste, e reabrir a tela com outro número faria a próxima busca ter um alcance
// que ninguém escolheu.
function histDiasSalvos(slot){
  const v = Number(localStorage.getItem('coco_hist_dias_' + slot));
  return v >= 1 ? v : HIST_PADRAO_DIAS;
}

function renderHistorico(){
  const el = $('histRows');
  if (!el) return;
  el.innerHTML = HIST_LINHAS.map(l => {
    const info = (histInfo[l.loja] || {})[l.mkt] || {};
    const lojas = info.lojas || [];
    const semLoja = l.loja === 'shopify' && info.lojas && !lojas.length;
    return retLinha({
      ...l,
      resumo: retResumo(info),
      dica: l.loja === 'amazon'
        ? 'Busca os pedidos e também os reembolsos do período'
        : (lojas.length ? lojas.join(' · ') : 'nenhuma loja ligada neste mercado'),
      valor: histDiasSalvos(l.slot),
      desabilitado: semLoja,
    });
  }).join('');
}

async function carregarHistorico(){
  const pega = async (url) => {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(url + ': http ' + r.status);
    return r.json();
  };
  // Uma das duas falhar não pode apagar a outra da tela: cada lado é independente, e o erro
  // aparece no lugar do resumo daquelas linhas em vez de sumir no console.
  const [amz, shop] = await Promise.allSettled([pega('/api/amazon/history'), pega('/api/shopify/history')]);
  histInfo = {
    amazon:  amz.status  === 'fulfilled' ? amz.value  : {},
    shopify: shop.status === 'fulfilled' ? shop.value : {},
  };
  for (const r of [amz, shop]) if (r.status === 'rejected') console.error('histórico:', r.reason);
  renderHistorico();
  if (amz.status === 'rejected' || shop.status === 'rejected') {
    toast('Não deu pra carregar o histórico de uma das lojas. As linhas dela ficam sem o resumo.', true);
  }
}

async function buscarHistorico(slot){
  const l = HIST_LINHAS.find(x => x.slot === slot);
  if (!l) return;
  const btn = $('histBtn' + slot), st = $('histStatus' + slot);
  const dias = Number($('histDias' + slot).value);
  if (!(dias >= 1)){ toast('Dias precisa ser um número maior que zero.', true); return; }
  localStorage.setItem('coco_hist_dias_' + slot, String(dias));

  btn.disabled = true;
  st.textContent = 'Iniciando…';
  try{
    const r = l.loja === 'amazon'
      ? await fetch('/api/amazon/history', { method:'POST', credentials:'same-origin',
          headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ market: l.mkt, days: dias }) })
      : await fetch(`/api/shopify/backfill?market=${l.mkt}&days=${dias}`, { method:'POST', credentials:'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'http ' + r.status);
    st.textContent = 'Buscando…';
    toast(`Buscando ${dias} dias de ${l.nome} ${RET_MARKET_LABEL[l.mkt]}.`);
    acompanharHistorico(slot);
  }catch(e){
    st.textContent = 'Erro: ' + (e.message || 'falha de rede');
    toast('Erro: ' + (e.message || 'falha de rede'), true);
    btn.disabled = false;
  }
}

// Acompanha o job e SEMPRE devolve o botão. A versão anterior desistia calada quando o job não
// aparecia na lista (`if (!j) return`): o intervalo seguia rodando, o botão ficava travado e a
// tela não dizia uma palavra — foi assim que "cliquei e não funcionou" virou o relato, mesmo
// quando a busca tinha rodado. Agora, sem notícia por algumas voltas, ele encerra dizendo isso.
function acompanharHistorico(slot){
  const l = HIST_LINHAS.find(x => x.slot === slot);
  if (!l) return;
  if (histPoll) clearInterval(histPoll);
  let semNoticia = 0;

  const encerrar = (texto) => {
    if (histPoll) clearInterval(histPoll);
    histPoll = null;
    const st = $('histStatus' + slot), btn = $('histBtn' + slot);
    if (st) st.textContent = texto;
    if (btn) btn.disabled = false;
    carregarHistorico();
  };

  const tick = async () => {
    const st = $('histStatus' + slot);
    try{
      const r = await fetch('/api/jobs', { credentials:'same-origin' });
      if (!r.ok) throw new Error('http ' + r.status);
      const j = ((await r.json()).jobs || []).find(x => x.id === l.job);
      if (!j){
        // O servidor esquece job concluído 15 min depois de terminar, e um reinício no meio some
        // com ele. Nos dois casos não há o que esperar.
        if (++semNoticia < 3) return;
        return encerrar('Sem notícia do processo. Confira o card de processos.');
      }
      semNoticia = 0;
      if (j.status === 'running'){
        if (st) st.textContent = 'Buscando… ' + (j.message || '');
        return;
      }
      encerrar((j.status === 'done' ? 'Concluído: ' : j.status === 'cancelled' ? 'Cancelado: ' : 'Erro: ') + (j.message || ''));
    }catch(e){
      // Rede fora não é "acabou": o botão continua travado de propósito, mas a tela diz o que está
      // acontecendo em vez de ficar parada.
      console.error('acompanhamento do histórico:', e);
      if (st) st.textContent = 'Sem conexão com o servidor. Tentando de novo…';
    }
  };
  tick();
  histPoll = setInterval(tick, 4000);
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
    // Renderiza TODOS: quem limita a altura é o recolhimento abaixo, não um corte na lista.
    // Cortar em 10 escondia backup sem dizer que existia mais.
    $('backupFilesList').innerHTML = d.files.map(f => `
      <div class="backup-file-row">
        <span class="backup-file-name">${escapeHtml(f.fileName.replace('db-backup/',''))}</span>
        <span>${fmtBytes(Number(f.sizeBytes))} · ${new Date(f.uploadedAt).toLocaleDateString('pt-BR')}</span>
      </div>`).join('');
    ajustarListaDeBackups(d.files.length);
  }catch(e){
    $('backupPanelSub').textContent = 'Não foi possível carregar o status do backup.';
  }
}
// A lista de backup cresce um arquivo por dia e a retenção é de 30 dias, então mostrar tudo
// deixava o painel enorme. Recolhida, ela mostra três linhas inteiras e deixa a quarta se
// apagando: é o que diz "tem mais embaixo" sem precisar de texto.
//
// A altura é medida do DOM, não calculada a partir da altura de linha: a fonte pode chegar
// depois do primeiro desenho e mudar a altura da linha, e um número fixo no CSS cortaria no
// meio da terceira ou sobraria um vão.
//
// A medida sai de getBoundingClientRect, e NÃO de offsetTop: offsetTop é relativo ao ancestral
// posicionado mais próximo, e nem a lista nem as linhas têm position, então ele devolvia a
// distância até um ancestral lá em cima da página. O max-height saía grande demais e não
// recortava nada — a quarta linha aparecia apagada com a lista inteira embaixo dela. Os dois
// rects são relativos à janela, então a subtração dá a distância real dentro da lista, com
// position ou sem.
const BACKUPS_VISIVEIS = 3;
let backupsAbertos = false;

function ajustarListaDeBackups(total){
  const lista = $('backupFilesList');
  const btn = $('backupToggle');
  const linhas = lista.querySelectorAll('.backup-file-row');
  const cabemTodas = linhas.length <= BACKUPS_VISIVEIS + 1;

  btn.style.display = cabemTodas ? 'none' : '';
  lista.classList.toggle('recolhida', !cabemTodas && !backupsAbertos);

  if (cabemTodas) { lista.style.maxHeight = 'none'; return; }
  if (backupsAbertos) {
    lista.style.maxHeight = lista.scrollHeight + 'px';
    btn.textContent = 'Ver menos';
  } else {
    const espia = linhas[BACKUPS_VISIVEIS];
    lista.style.maxHeight = (espia.getBoundingClientRect().bottom - lista.getBoundingClientRect().top) + 'px';
    btn.textContent = `Ver todos os ${total} backups`;
  }
}

function alternarBackups(){
  backupsAbertos = !backupsAbertos;
  ajustarListaDeBackups($('backupFilesList').querySelectorAll('.backup-file-row').length);
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

// Se uma busca já estava rodando antes de a página ser recarregada (F5 no meio dela), a linha
// correspondente volta acompanhando. Sem isso o botão apareceria livre, um segundo clique tomaria
// 409 e a tela diria "já existe uma busca em andamento" sem mostrar qual.
async function retomarBuscaEmAndamento(){
  try{
    const r = await fetch('/api/jobs', { credentials:'same-origin' });
    if (!r.ok) throw new Error('http ' + r.status);
    const jobs = (await r.json()).jobs || [];
    for (const l of HIST_LINHAS){
      const j = jobs.find(x => x.id === l.job && x.status === 'running');
      // O rótulo do job diz o mercado ("Buscar histórico Amazon EUA"): sem conferir, a busca do
      // Brasil apareceria acompanhada também na linha dos EUA.
      if (!j || (l.mkt === 'us') !== /EUA/.test(j.label || '')) continue;
      const btn = $('histBtn' + l.slot);
      if (btn) btn.disabled = true;
      acompanharHistorico(l.slot);
      return;
    }
  }catch(e){
    console.error('retomar busca de histórico:', e);
  }
}

(async function(){
  syncViewSwitch();
  await loadMe();
  await load();
  await carregarHistorico();
  await retomarBuscaEmAndamento();
  loadBackupStatus();
  loadAlertsStatus();
})();
