// ─────────────────────────────────────────────
//  sidebar.js — Sidebar única e compartilhada por TODAS as páginas.
//  A sidebar não muda de página para página (as opções são sempre as mesmas),
//  então fica definida UMA vez aqui em vez de duplicada em cada .html.
//
//  Uso na página: colocar <script src="sidebar.js"></script> logo após <body>.
//  O componente injeta o markup, marca o item ativo pela URL atual e liga
//  o comportamento de abrir/fechar (desktop e mobile). Nada mais é necessário.
// ─────────────────────────────────────────────
(function () {
  const html = `
<div id="sidebarOverlay" class="sidebar-overlay"></div>
<nav class="sidebar">
  <div class="sidebar-header">
    <button id="sidebarToggle" class="sidebar-close-btn" title="Fechar menu"><i class="bi bi-layout-sidebar-reverse"></i></button>
  </div>
  <div class="brand">
    <a href="/" style="display:block;line-height:0"><img src="Logo2.png" alt="Coco and Luna" class="brand-logo"></a>
    <span class="brand-name">Dashboard<br>Vita Pet Life · Coco and Luna</span>
  </div>
  <div class="nav-group"><div class="nav-label">Visão Geral</div>
    <a class="nav-item" data-page="index.html" href="/"><i class="bi bi-bar-chart-line nav-icon"></i> Revenue</a>
    <a class="nav-item" data-page="segmentos.html" href="/segmentos"><i class="bi bi-pie-chart nav-icon"></i> Segmentos</a>
    <a class="nav-item" data-page="geografia.html" href="/geografia"><i class="bi bi-map nav-icon"></i> Geografia <img src="bandeira_brasil.webp" class="nav-flag" alt="BR"></a>
    <a class="nav-item" data-page="geografia-us.html" href="/geografia-us"><i class="bi bi-map nav-icon"></i> Geografia <img src="bandeira_eua.svg" class="nav-flag" alt="EUA"></a></div>
  <div class="nav-group"><div class="nav-label">Operações</div>
    <a class="nav-item" data-page="produtos.html" href="/produtos"><i class="bi bi-box-seam nav-icon"></i> Produtos</a>
    <a class="nav-item" data-page="estoque.html" href="/estoque"><i class="bi bi-layers nav-icon"></i> Estoque</a>
    <a class="nav-item"><i class="bi bi-wallet2 nav-icon"></i> Financeiro</a></div>
  <div class="nav-group"><div class="nav-label">Marketing</div>
    <a class="nav-item" data-page="campanhas.html" href="/campanhas"><i class="bi bi-megaphone nav-icon"></i> Campanhas</a></div>
  <div class="nav-group" id="navGroupSistema"><div class="nav-label">Sistema</div>
    <a class="nav-item" data-page="configuracoes.html" href="/configuracoes" id="navConfig" style="display:none"><i class="bi bi-gear nav-icon"></i> Configurações</a></div>
  <div class="side-user" id="sideUser" style="display:none"></div>
</nav>
<button id="sidebarOpen" class="sidebar-open-btn" title="Abrir menu"><i class="bi bi-layout-sidebar"></i></button>`;

  // CSS do componente sidebar — vive AQUI (fonte única), não duplicado em cada .html.
  // As páginas só cuidam do próprio layout (.main/.topbar/.content). Usa as variáveis
  // de tema (--side-*, --border2, etc.) definidas no :root de cada página. As páginas de
  // Geografia sobrescrevem só o z-index (`body .sidebar{z-index:3000}`, maior especificidade)
  // por causa das camadas do Leaflet. Ver CLAUDE.md (backlog "CSS da sidebar duplicado").
  const baseCss = `
.sidebar{width:180px;min-height:100vh;background:var(--side-bg);display:flex;flex-direction:column;padding:20px 0;position:fixed;top:0;left:0;z-index:200;transition:transform .25s cubic-bezier(.4,0,.2,1)}
.brand{display:flex;flex-direction:column;align-items:center;gap:10px;padding:20px 16px 24px;border-bottom:1px solid rgba(240,235,224,0.07);margin-bottom:20px}
.brand-logo{width:72px;height:auto}
.brand-name{font-size:11px;font-weight:500;color:rgba(240,235,224,.55);letter-spacing:.2px;line-height:1.4;text-align:center}
.nav-group{margin-bottom:24px}
.nav-label{font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--side-muted);padding:0 18px;margin-bottom:4px}
.nav-item{display:flex;align-items:center;gap:9px;padding:7px 18px;font-size:12px;color:rgba(240,235,224,0.55);cursor:pointer;transition:all .15s;text-decoration:none}
.nav-item:hover{background:var(--side-hover);color:var(--side-text)}
.nav-item.active{background:var(--side-active);color:var(--side-text);font-weight:500}
.nav-icon{font-size:15px;width:16px;text-align:center;flex-shrink:0;line-height:1;opacity:.75}
.sidebar-header{display:flex;justify-content:flex-end;padding:6px 10px 0}
.sidebar-close-btn{width:30px;height:30px;border-radius:8px;border:none;background:transparent;color:rgba(240,235,224,.4);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .15s}
.sidebar-close-btn:hover{background:rgba(240,235,224,.12);color:rgba(240,235,224,.9)}
.sidebar-open-btn{display:none;position:fixed;left:12px;top:11px;z-index:300;width:36px;height:32px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--sub);cursor:pointer;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 8px rgba(30,28,24,.1);transition:all .15s}
.sidebar-open-btn:hover{border-color:var(--ink);color:var(--text)}
body.sidebar-hidden .sidebar-open-btn{display:flex}
body.sidebar-mobile-open .sidebar-open-btn{display:none!important}
.sidebar-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:150;opacity:0;pointer-events:none;transition:opacity .25s}
body.sidebar-mobile-open .sidebar-overlay{opacity:1;pointer-events:auto}
body.sidebar-mobile-open .sidebar{transform:translateX(0)!important}
body.sidebar-hidden .sidebar{transform:translateX(-100%)}
@media(max-width:768px){.sidebar{transform:translateX(-100%)}.sidebar-open-btn{display:flex}}
`;
  const css = baseCss
    + '.sidebar .nav-flag{width:15px;height:auto;vertical-align:middle;border-radius:2px;margin-left:3px;position:relative;top:-1px}'
    // Bloco de usuário no rodapé da sidebar (alimentado por /api/me)
    + '.sidebar .side-user{margin-top:auto;padding:12px 14px;border-top:1px solid rgba(240,235,224,0.08);display:flex;align-items:center;gap:9px}'
    + '.sidebar .side-avatar{width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff}'
    + '.sidebar .side-user-info{min-width:0;flex:1}'
    + '.sidebar .side-user-name{font-size:12px;color:var(--side-text);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.sidebar .side-user-role{font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--side-muted);margin-top:1px}'
    + '.sidebar .side-user-role.admin{color:var(--side-text)}'
    + '.sidebar .side-logout{background:none;border:none;color:var(--side-muted);cursor:pointer;font-size:14px;padding:4px;line-height:1}'
    + '.sidebar .side-logout:hover{color:var(--side-text)}';

  // Mapa slug <-> arquivo (espelha SLUG_TO_FILE em server.js) — no escopo do IIFE,
  // não dentro de mount(), porque applyAuth() também precisa dele e é uma função
  // irmã, não aninhada. Estava declarado dentro de mount() antes: applyAuth() lançava
  // ReferenceError ao tentar ler SLUG_TO_FILE (fora de escopo), abortando a função bem
  // no início — antes do trecho que mostra "Configurações" e o bloco de usuário no
  // rodapé. Como a exceção não tinha try/catch ali (só o fetch tem), o erro nunca
  // aparecia pra ninguém: os dois elementos simplesmente ficavam presos no
  // `display:none` padrão do HTML, parecendo terem sido removidos.
  const SLUG_TO_FILE = {
    '': 'index.html', segmentos: 'segmentos.html', geografia: 'geografia.html',
    'geografia-us': 'geografia-us.html', produtos: 'produtos.html', estoque: 'estoque.html',
    campanhas: 'campanhas.html', configuracoes: 'configuracoes.html', login: 'login.html',
  };

  function mount() {
    if (document.querySelector('nav.sidebar')) return; // idempotente
    if (!document.getElementById('sidebarComponentStyle')) {
      const style = document.createElement('style');
      style.id = 'sidebarComponentStyle';
      style.textContent = css;
      document.head.appendChild(style);
    }
    document.body.insertAdjacentHTML('afterbegin', html);

    // Item ativo conforme a URL limpa atual — mapeia de volta pro identificador de
    // arquivo (data-page), que é como as páginas sempre foram referenciadas.
    const seg = location.pathname.replace(/\/+$/, '').replace(/^\//, '').replace(/\.html$/i, '').toLowerCase();
    const page = SLUG_TO_FILE[seg] || seg + '.html';
    const active = document.querySelector('.sidebar .nav-item[data-page="' + page + '"]');
    if (active) active.classList.add('active');

    // Comportamento abrir/fechar (desktop persiste em localStorage; mobile usa overlay)
    const isMobile = () => window.innerWidth <= 768;
    const overlay  = document.getElementById('sidebarOverlay');
    const closeBtn = document.getElementById('sidebarToggle');
    const openBtn  = document.getElementById('sidebarOpen');

    if (!isMobile() && localStorage.getItem('coco_sidebar') === 'hidden') {
      document.body.classList.add('sidebar-hidden');
    }
    closeBtn.addEventListener('click', () => {
      if (isMobile()) {
        document.body.classList.remove('sidebar-mobile-open');
      } else {
        const hidden = document.body.classList.toggle('sidebar-hidden');
        localStorage.setItem('coco_sidebar', hidden ? 'hidden' : 'visible');
      }
    });
    openBtn.addEventListener('click', () => {
      if (isMobile()) {
        document.body.classList.add('sidebar-mobile-open');
      } else {
        document.body.classList.remove('sidebar-hidden');
        localStorage.setItem('coco_sidebar', 'visible');
      }
    });
    overlay.addEventListener('click', () => document.body.classList.remove('sidebar-mobile-open'));
    window.addEventListener('resize', () => {
      if (!isMobile()) document.body.classList.remove('sidebar-mobile-open');
      else document.body.classList.remove('sidebar-hidden');
    });

    // Enriquecimento posterior: usuários / controle de acesso (não bloqueia a montagem)
    applyAuth(page);
  }

  // Iniciais do nome (2 primeiras palavras, ou 2 primeiras letras se palavra única)
  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // Cor de fundo determinística do avatar (hash simples do nome → matiz HSL)
  function avatarColor(name) {
    let h = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',45%,45%)';
  }

  // Busca /api/me e aplica guard de acesso + visibilidade + bloco de usuário
  async function applyAuth(page) {
    let data;
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin' });
      data = await res.json();
    } catch (e) {
      return; // falhou: não mostra bloco de usuário, não quebra a página
    }
    if (!data) return;
    const FILE_TO_SLUG = Object.fromEntries(Object.entries(SLUG_TO_FILE).map(([s, f]) => [f, s ? '/' + s : '/']));
    const managed = new Set((data.pages || []).map(p => String(p.file).toLowerCase()));
    const user = data.user;

    // Guard de acesso (defesa no cliente; o servidor também valida)
    if (data.enabled && !user) { location.href = '/login'; return; }
    if (data.enabled && user) {
      const isAdmin = user.role === 'admin';
      const allowed = (user.pages || []).map(f => String(f).toLowerCase());
      if (managed.has(page) && !isAdmin && !allowed.includes(page)) {
        if (allowed.length) { location.href = FILE_TO_SLUG[allowed[0]] || '/'; return; }
      }
      if (page === 'configuracoes.html' && !isAdmin) { location.href = '/'; return; }
    }

    // Visibilidade dos itens de navegação gerenciados
    const items = document.querySelectorAll('.sidebar .nav-item[data-page]');
    items.forEach(el => {
      const file = (el.getAttribute('data-page') || '').toLowerCase();
      if (!managed.has(file)) return; // só páginas gerenciáveis são escondidas
      const hide = data.enabled && user && user.role !== 'admin' && !(user.pages || []).map(f => String(f).toLowerCase()).includes(file);
      el.style.display = hide ? 'none' : '';
    });

    // Item "Configurações": admin, ou modo aberto (login desligado) p/ configuração inicial
    const cfg = document.getElementById('navConfig');
    if (cfg) {
      const showCfg = (user && user.role === 'admin') || !data.enabled;
      cfg.style.display = showCfg ? '' : 'none';
    }

    // Bloco de usuário no rodapé
    const box = document.getElementById('sideUser');
    if (box && user) {
      const isAdmin = user.role === 'admin';
      const avatar = document.createElement('div');
      avatar.className = 'side-avatar';
      avatar.style.background = avatarColor(user.name);
      avatar.textContent = initials(user.name);

      const info = document.createElement('div');
      info.className = 'side-user-info';
      const nm = document.createElement('div');
      nm.className = 'side-user-name';
      nm.textContent = user.name || user.username || '';
      const rl = document.createElement('div');
      rl.className = 'side-user-role' + (isAdmin ? ' admin' : '');
      rl.textContent = isAdmin ? 'Administrador' : 'Padrão';
      info.appendChild(nm);
      info.appendChild(rl);

      const logout = document.createElement('button');
      logout.className = 'side-logout';
      logout.title = 'Sair';
      logout.innerHTML = '<i class="bi bi-box-arrow-right"></i>';
      logout.addEventListener('click', async () => {
        try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
        location.href = '/login';
      });

      box.innerHTML = '';
      box.appendChild(avatar);
      box.appendChild(info);
      box.appendChild(logout);
      box.style.display = '';
    }
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
