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
    <a href="index.html" style="display:block;line-height:0"><img src="Logo.svg" alt="Coco and Luna" class="brand-logo"></a>
    <span class="brand-name">Dashboard<br>Vita Pet Life</span>
  </div>
  <div class="nav-group"><div class="nav-label">Visão Geral</div>
    <a class="nav-item" data-page="index.html" href="index.html"><i class="bi bi-bar-chart-line nav-icon"></i> Revenue</a>
    <a class="nav-item" data-page="segmentos.html" href="segmentos.html"><i class="bi bi-pie-chart nav-icon"></i> Segmentos</a>
    <a class="nav-item" data-page="geografia.html" href="geografia.html"><i class="bi bi-map nav-icon"></i> Geografia <img src="bandeira_brasil.webp" class="nav-flag" alt="BR"></a>
    <a class="nav-item" data-page="geografia-us.html" href="geografia-us.html"><i class="bi bi-map nav-icon"></i> Geografia <img src="bandeira_eua.svg" class="nav-flag" alt="EUA"></a></div>
  <div class="nav-group"><div class="nav-label">Operações</div>
    <a class="nav-item"><i class="bi bi-box-seam nav-icon"></i> Produtos</a>
    <a class="nav-item"><i class="bi bi-layers nav-icon"></i> Estoque</a>
    <a class="nav-item"><i class="bi bi-wallet2 nav-icon"></i> Financeiro</a></div>
  <div class="nav-group"><div class="nav-label">Marketing</div>
    <a class="nav-item" data-page="campanhas.html" href="campanhas.html"><i class="bi bi-megaphone nav-icon"></i> Campanhas</a></div>
</nav>
<button id="sidebarOpen" class="sidebar-open-btn" title="Abrir menu"><i class="bi bi-layout-sidebar"></i></button>`;

  // CSS próprio do componente (bandeiras do menu). Fica aqui para a sidebar ser
  // autossuficiente — páginas sem essa regra renderizavam a bandeira em tamanho natural.
  const css = '.sidebar .nav-flag{width:15px;height:auto;vertical-align:middle;border-radius:2px;margin-left:3px;position:relative;top:-1px}';

  function mount() {
    if (document.querySelector('nav.sidebar')) return; // idempotente
    if (!document.getElementById('sidebarComponentStyle')) {
      const style = document.createElement('style');
      style.id = 'sidebarComponentStyle';
      style.textContent = css;
      document.head.appendChild(style);
    }
    document.body.insertAdjacentHTML('afterbegin', html);

    // Item ativo conforme o arquivo atual ('/' = index.html)
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase() || 'index.html';
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
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
