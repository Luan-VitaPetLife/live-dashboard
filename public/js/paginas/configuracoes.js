const $ = id => document.getElementById(id);
let AVAILABLE_PAGES = [];   // [{file,label}]
let IS_ADMIN = true;
let EDIT_ID = null;         // id do usuário em edição (null = novo)

const FALLBACK_PAGES = [
  { file:'index.html', label:'Dashboard' },
  { file:'campanhas.html', label:'Campanhas' },
  { file:'produtos.html', label:'Produtos' },
  { file:'estoque.html', label:'Estoque' },
  { file:'segmentos.html', label:'Segmentos' },
  { file:'geografia.html', label:'Geografia' }
];

function toast(msg, isErr){
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(()=>{ t.className = 'toast' + (isErr ? ' err' : ''); }, 2600);
}

function pageLabel(file){
  const p = AVAILABLE_PAGES.find(x => x.file === file);
  return p ? p.label : file;
}

/* iniciais + cor por hash do nome */
function initials(name){
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '?';
  if(parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
}
function hashColor(str){
  let h = 0;
  for(let i=0;i<(str||'').length;i++) h = (h*31 + str.charCodeAt(i)) & 0xffffffff;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue},42%,45%)`;
}

/* ── /api/me — estado de login + páginas + admin ── */
async function loadMe(){
  try{
    const r = await fetch('/api/me', { credentials:'same-origin' });
    if(!r.ok) throw new Error('http '+r.status);
    const d = await r.json();

    AVAILABLE_PAGES = Array.isArray(d.pages) && d.pages.length ? d.pages : FALLBACK_PAGES;
    IS_ADMIN = (d.isAdmin === true) || (d.role === 'admin') || (d.user && d.user.role === 'admin');

    // login toggle
    const enabled = !!d.enabled;
    const cb = $('loginToggle');
    cb.checked = enabled;
    cb.disabled = false;
    setLoginStatus(enabled);

    // whoami no topo
    const uname = d.username || (d.user && (d.user.name || d.user.username)) || (IS_ADMIN ? 'Admin' : 'Usuário');
    $('whoami').textContent = uname;

    if(!IS_ADMIN) $('notAdminBanner').classList.add('show');
  }catch(e){
    AVAILABLE_PAGES = FALLBACK_PAGES;
    $('loginStatus').textContent = 'Não foi possível carregar o estado do login.';
    $('whoami').textContent = '—';
  }
}

function setLoginStatus(enabled){
  const el = $('loginStatus');
  if(enabled){ el.textContent = 'Login exigido'; el.className = 'switch-status'; }
  else{ el.textContent = 'Dashboard aberta a todos'; el.className = 'switch-status off'; }
}

/* ── Unificador: liga/desliga global ── */
function setGroupsStatus(enabled){
  const el = $('groupsStatus');
  if(enabled){ el.textContent = 'Unificação ativa'; el.className = 'switch-status'; }
  else{ el.textContent = 'Desligado: telas mostram produtos sem agrupar'; el.className = 'switch-status off'; }
}
async function loadGroupsConfig(){
  try{
    const r = await fetch('/api/product-groups/config', { credentials:'same-origin' });
    if(!r.ok) throw new Error('http '+r.status);
    const d = await r.json();
    const cb = $('groupsToggle');
    cb.checked = d.enabled !== false;
    cb.disabled = false;
    setGroupsStatus(cb.checked);
  }catch(e){
    $('groupsStatus').textContent = 'Não foi possível carregar o estado do Unificador.';
  }
}
$('groupsToggle').addEventListener('change', async function(){
  const desired = this.checked;
  this.disabled = true;
  try{
    const r = await fetch('/api/product-groups/config', {
      method:'POST', credentials:'same-origin',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ enabled: desired })
    });
    if(!r.ok){ const d = await r.json().catch(()=>({})); throw new Error(d.error || 'http '+r.status); }
    setGroupsStatus(desired);
    toast(desired ? 'Unificador ativado.' : 'Unificador desativado.');
  }catch(e){
    this.checked = !desired;
    setGroupsStatus(!desired);
    toast('Erro ao salvar: ' + (e.message || 'falha de rede'), true);
  }finally{
    this.disabled = false;
  }
});

/* ── Toggle de login ── */
$('loginToggle').addEventListener('change', async function(){
  const desired = this.checked;
  this.disabled = true;
  try{
    const r = await fetch('/api/auth/config', {
      method:'POST', credentials:'same-origin',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ enabled: desired })
    });
    if(!r.ok){ const d = await r.json().catch(()=>({})); throw new Error(d.error || 'http '+r.status); }
    setLoginStatus(desired);
    toast(desired ? 'Login passou a ser exigido.' : 'Login desativado.');
  }catch(e){
    this.checked = !desired;         // reverte
    setLoginStatus(!desired);
    toast('Erro ao salvar: ' + (e.message || 'falha de rede'), true);
  }finally{
    this.disabled = false;
  }
});

/* ── Lista de usuários — modos Colunas (padrão) e Linhas, mesmo padrão de view-switch
     já usado em integracoes.html. Sem "@usuário" nas duas visões: o handle não é usado
     em lugar nenhum do app (só o nome de exibição), então só confundia. ── */
let userViewMode = localStorage.getItem('coco_users_view') || 'colunas';
let lastUsers = [];

function syncUserViewSwitch(){
  document.querySelectorAll('#userViewSwitch .vs-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === userViewMode));
}
$('userViewSwitch').addEventListener('click', e => {
  const btn = e.target.closest('.vs-btn');
  if(!btn) return;
  userViewMode = btn.dataset.mode;
  localStorage.setItem('coco_users_view', userViewMode);
  syncUserViewSwitch();
  renderUsers(lastUsers);
});

async function loadUsers(){
  const list = $('userList');
  try{
    const r = await fetch('/api/users', { credentials:'same-origin' });
    if(!r.ok) throw new Error('http '+r.status);
    const d = await r.json();
    lastUsers = Array.isArray(d.users) ? d.users : [];
    renderUsers(lastUsers);
  }catch(e){
    list.innerHTML = '<div class="empty">Não foi possível carregar os usuários.</div>';
  }
}

function renderUsers(users){
  const list = $('userList');
  if(!users.length){ list.className = ''; list.innerHTML = '<div class="empty">Nenhum usuário cadastrado.</div>'; return; }
  if(userViewMode === 'linhas'){
    list.className = 'user-list';
    list.innerHTML = '';
    users.forEach(u => list.appendChild(userRowEl(u)));
  }else{
    list.className = 'user-grid';
    list.innerHTML = '';
    users.forEach(u => list.appendChild(userCardEl(u)));
  }
}

function pagesSummary(u){
  if(u.role === 'admin') return 'Todas as páginas';
  const pages = Array.isArray(u.pages) ? u.pages : [];
  if(!pages.length) return 'Nenhuma página liberada';
  if(pages.length <= 3) return pages.map(pageLabel).join(' · ');
  return pages.length + ' páginas liberadas';
}

function avatarEl(u){
  const av = document.createElement('div');
  av.className = 'avatar';
  av.style.background = hashColor(u.name || u.username);
  av.textContent = initials(u.name || u.username);
  return av;
}

function userInfoEl(u){
  const info = document.createElement('div');
  info.className = 'user-info';
  const isAdmin = u.role === 'admin';
  info.innerHTML =
    `<div class="user-name">${escapeHtml(u.name || u.username)}
       <span class="tag ${isAdmin?'tag-admin':'tag-padrao'}">${isAdmin?'Admin':'Padrão'}</span>
     </div>
     <div class="user-pages"><i class="bi bi-window-stack"></i> ${escapeHtml(pagesSummary(u))}</div>`;
  return info;
}

function userActionsEl(u){
  const actions = document.createElement('div');
  actions.className = 'user-actions';
  const edit = document.createElement('button');
  edit.className = 'btn btn-icon btn-sm';
  edit.title = 'Editar';
  edit.innerHTML = '<i class="bi bi-pencil"></i>';
  edit.onclick = () => openModal(u);
  const del = document.createElement('button');
  del.className = 'btn btn-icon btn-sm btn-danger';
  del.title = 'Excluir';
  del.innerHTML = '<i class="bi bi-trash"></i>';
  del.onclick = () => deleteUser(u);
  actions.appendChild(edit);
  actions.appendChild(del);
  return actions;
}

function userRowEl(u){
  const row = document.createElement('div');
  row.className = 'user-row';
  row.appendChild(avatarEl(u));
  row.appendChild(userInfoEl(u));
  row.appendChild(userActionsEl(u));
  return row;
}

function userCardEl(u){
  const card = document.createElement('div');
  card.className = 'user-card';
  const top = document.createElement('div');
  top.className = 'user-card-top';
  top.appendChild(avatarEl(u));
  top.appendChild(userInfoEl(u));
  card.appendChild(top);
  card.appendChild(userActionsEl(u));
  return card;
}

async function deleteUser(u){
  if(!(await cocoConfirm('Esta ação não pode ser desfeita.', { title: `Excluir o usuário "${u.name || u.username}"?`, confirmText: 'Excluir', danger: true }))) return;
  try{
    const r = await fetch('/api/users/' + encodeURIComponent(u.id), { method:'DELETE', credentials:'same-origin' });
    if(!r.ok){ const d = await r.json().catch(()=>({})); throw new Error(d.error || 'http '+r.status); }
    toast('Usuário excluído.');
    loadUsers();
  }catch(e){
    toast('Erro ao excluir: ' + (e.message || 'falha de rede'), true);
  }
}

/* ── Modal ── */
function renderPagesBox(selected){
  const box = $('pagesBox');
  box.innerHTML = '';
  const sel = new Set(selected || []);
  AVAILABLE_PAGES.forEach(p => {
    const lab = document.createElement('label');
    lab.className = 'page-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = p.file;
    cb.checked = sel.has(p.file);
    const sp = document.createElement('span');
    sp.textContent = p.label;
    lab.appendChild(cb);
    lab.appendChild(sp);
    box.appendChild(lab);
  });
}

function syncRoleUI(){
  const isPadrao = $('fRole').value === 'padrao';
  $('pagesField').style.display = isPadrao ? 'block' : 'none';
}

function openModal(user){
  EDIT_ID = user ? user.id : null;
  $('modalTitle').textContent = user ? 'Editar usuário' : 'Adicionar usuário';
  $('modalErr').textContent = '';
  $('fName').value = user ? (user.name || '') : '';
  $('fUsername').value = user ? (user.username || '') : '';
  $('fPassword').value = '';
  $('fPassword').placeholder = user ? '••••••••' : 'Senha de acesso';
  $('pwdHint').style.display = user ? 'block' : 'none';
  setPasswordVisible(false);
  $('fRole').value = user ? (user.role || 'padrao') : 'admin';
  renderPagesBox(user ? user.pages : []);
  syncRoleUI();
  $('userModal').classList.add('open');
  setTimeout(()=>$('fName').focus(), 30);
}

function closeModal(){ $('userModal').classList.remove('open'); }

async function saveUser(){
  const name = $('fName').value.trim();
  const username = $('fUsername').value.trim();
  const password = $('fPassword').value;
  const role = $('fRole').value;
  const errEl = $('modalErr');
  errEl.textContent = '';

  if(!name){ errEl.textContent = 'Informe o nome.'; return; }
  if(!username){ errEl.textContent = 'Informe o usuário.'; return; }
  if(!EDIT_ID && !password){ errEl.textContent = 'Informe uma senha.'; return; }

  const pages = role === 'padrao'
    ? Array.from($('pagesBox').querySelectorAll('input:checked')).map(c => c.value)
    : [];

  const body = { name, username, role, pages };
  if(password) body.password = password;

  const url = EDIT_ID ? '/api/users/' + encodeURIComponent(EDIT_ID) : '/api/users';
  const method = EDIT_ID ? 'PUT' : 'POST';

  const saveBtn = $('modalSave');
  saveBtn.disabled = true;
  try{
    const r = await fetch(url, {
      method, credentials:'same-origin',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error || 'Erro ao salvar.');
    toast(EDIT_ID ? 'Usuário atualizado.' : 'Usuário criado.');
    closeModal();
    loadUsers();
  }catch(e){
    errEl.textContent = e.message || 'Falha de rede.';
  }finally{
    saveBtn.disabled = false;
  }
}


/* ── Mostrar/ocultar senha (mesmo padrão de login.html) ── */
function setPasswordVisible(visible){
  $('fPassword').type = visible ? 'text' : 'password';
  $('fPasswordToggle').querySelector('i').className = visible ? 'bi bi-eye-slash' : 'bi bi-eye';
  $('fPasswordToggle').setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
}
$('fPasswordToggle').addEventListener('click', () => {
  setPasswordVisible($('fPassword').type === 'password');
  $('fPassword').focus();
});

/* ── Wiring ── */
$('addUserBtn').addEventListener('click', ()=>openModal(null));
$('modalCancel').addEventListener('click', closeModal);
$('modalSave').addEventListener('click', saveUser);
$('fRole').addEventListener('change', syncRoleUI);
$('userModal').addEventListener('click', e => { if(e.target === $('userModal')) closeModal(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeModal(); });

/* ── Init ── */
(async function(){
  syncUserViewSwitch();
  await loadMe();
  await loadUsers();
  await loadGroupsConfig();
})();
