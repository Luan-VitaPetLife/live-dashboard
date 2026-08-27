// ─────────────────────────────────────────────
//  sidebar.js — Sidebar única e compartilhada por TODAS as páginas.
//  A sidebar não muda de página para página (as opções são sempre as mesmas),
//  então fica definida UMA vez aqui em vez de duplicada em cada .html.
//
//  Uso na página: colocar <script src="js/sidebar.js"></script> logo após <body>.
//  O componente injeta o markup, marca o item ativo pela URL atual e liga
//  o comportamento de abrir/fechar (desktop e mobile). Nada mais é necessário.
// ─────────────────────────────────────────────

// Escapa texto vindo de dado externo (nome de cliente, título de produto etc.) antes de
// interpolar em innerHTML — evita XSS armazenado a partir de pedido/produto malicioso.
// Compartilhado globalmente porque sidebar.js é a única coisa carregada por todas as páginas.
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
window.escapeHtml = escapeHtml;

// pageLoaderHtml() — anel colorido animado (4 círculos), substitui texto estático tipo
// "carregando..." em qualquer lugar que espera uma resposta de verdade (ex: campanhas.html
// esperando /api/campaigns, que chama Meta/Mercado Ads/Google Ads ao vivo). Peças de
// uiverse.io/Nawsome, mesmo componente já usado na dashboard de social media. Concatenado
// com + (não template literal com crase) de propósito — um comentário com crase dentro de
// um template literal já quebrou o mount() inteiro da sidebar uma vez, nesse mesmo arquivo
// em outro projeto irmão; nunca mais correr esse risco aqui.
function pageLoaderHtml() {
  return '<div class="page-loader"><svg class="pl" viewBox="0 0 240 240">'
    + '<circle class="pl__ring pl__ring--a" cx="120" cy="120" r="105" fill="none" stroke="#000" stroke-width="20" stroke-dasharray="0 660" stroke-dashoffset="-330" stroke-linecap="round"></circle>'
    + '<circle class="pl__ring pl__ring--b" cx="120" cy="120" r="35" fill="none" stroke="#000" stroke-width="20" stroke-dasharray="0 220" stroke-dashoffset="-110" stroke-linecap="round"></circle>'
    + '<circle class="pl__ring pl__ring--c" cx="85" cy="120" r="70" fill="none" stroke="#000" stroke-width="20" stroke-dasharray="0 440" stroke-linecap="round"></circle>'
    + '<circle class="pl__ring pl__ring--d" cx="155" cy="120" r="70" fill="none" stroke="#000" stroke-width="20" stroke-dasharray="0 440" stroke-linecap="round"></circle>'
    + '</svg></div>';
}
window.pageLoaderHtml = pageLoaderHtml;

// initCollapsibleNotice({ noteId, collapseBtnId, fabId, storageKey }) — liga o botão "x" de um
// aviso fixo (encolhe com animação) a uma bolinha (fab) que fica no canto da tela e reabre o
// aviso ao clicar. Estado (aberto/fechado) persistido em localStorage por storageKey. Cada
// página que usar isso ainda precisa do próprio CSS de .limit-note/.notice-collapse-btn/
// .notice-fab no <style> dela (não centralizado aqui) — só a lógica é compartilhada.
function initCollapsibleNotice(opts) {
  const noteId = opts.noteId, collapseBtnId = opts.collapseBtnId, fabId = opts.fabId, storageKey = opts.storageKey;
  const note = document.getElementById(noteId);
  const collapseBtn = document.getElementById(collapseBtnId);
  const fab = document.getElementById(fabId);
  if (!note || !collapseBtn || !fab) return;

  function collapse(persist) {
    if (persist) localStorage.setItem(storageKey, '1');
    note.classList.add('is-collapsing');
    note.addEventListener('transitionend', function onEnd(e) {
      if (e.target !== note) return;
      note.removeEventListener('transitionend', onEnd);
      note.style.display = 'none';
      fab.classList.add('show');
      requestAnimationFrame(() => requestAnimationFrame(() => fab.classList.add('in')));
    });
  }

  function expand() {
    localStorage.removeItem(storageKey);
    fab.classList.remove('in');
    setTimeout(() => fab.classList.remove('show'), 200);
    note.style.display = '';
    void note.offsetWidth; // força reflow pra a transição de volta rodar
    note.classList.remove('is-collapsing');
  }

  collapseBtn.addEventListener('click', () => collapse(true));
  fab.addEventListener('click', expand);
  if (localStorage.getItem(storageKey) === '1') collapse(false);
}
window.initCollapsibleNotice = initCollapsibleNotice;

(function () {
  const html = `
<div id="sidebarOverlay" class="sidebar-overlay"></div>
<nav class="sidebar">
  <div class="sidebar-header">
    <button id="sidebarToggle" class="sidebar-close-btn" title="Fechar/expandir menu"><i class="bi bi-layout-sidebar-reverse"></i></button>
  </div>
  <div class="brand">
    <a href="/" class="brand-link">
      <!-- Caminho relativo à PÁGINA, não a este arquivo: favicon.png segue na raiz de public/
           (convenção de favicon) mesmo com sidebar.js tendo mudado pra public/js/. -->
      <img src="favicon.png" alt="Vita Pet Life" class="brand-mark">
    </a>
    <div class="brand-text">
      <span class="brand-name">Dashboard</span>
      <span class="brand-sub">Painel Principal</span>
      <span class="brand-sub">Vita Pet Life</span>
    </div>
  </div>
  <div class="nav-group"><div class="nav-label">Visão Geral</div>
    <a class="nav-item" data-page="index.html" data-label="Visão geral" href="/"><i class="bi bi-bar-chart-line nav-icon"></i><span class="nav-text">Visão geral</span></a>
    <a class="nav-item" data-page="segmentos.html" data-label="Segmentos" href="/segmentos"><i class="bi bi-pie-chart nav-icon"></i><span class="nav-text">Segmentos</span></a>
    <a class="nav-item" data-page="geografia.html" data-label="Geografia" href="/geografia"><i class="bi bi-map nav-icon"></i><span class="nav-text">Geografia</span></a></div>
  <div class="nav-group"><div class="nav-label">Operações</div>
    <a class="nav-item" data-page="produtos.html" data-label="Produtos" href="/produtos"><i class="bi bi-box-seam nav-icon"></i><span class="nav-text">Produtos</span></a>
    <a class="nav-item" data-page="estoque.html" data-label="Estoque" href="/estoque"><i class="bi bi-layers nav-icon"></i><span class="nav-text">Estoque</span></a>
    <a class="nav-item nav-soon" data-label="Financeiro (em breve)" aria-disabled="true"><i class="bi bi-wallet2 nav-icon"></i><span class="nav-text">Financeiro</span><span class="nav-soon-tag">em breve</span></a></div>
  <div class="nav-group"><div class="nav-label">Marketing</div>
    <a class="nav-item" data-page="campanhas.html" data-label="Campanhas" href="/campanhas"><i class="bi bi-megaphone nav-icon"></i><span class="nav-text">Campanhas</span></a></div>
  <div class="nav-group" id="navGroupSistema"><div class="nav-label">Sistema</div>
    <a class="nav-item" data-page="configuracoes.html" data-label="Configurações" href="/configuracoes" id="navConfig" style="display:none"><i class="bi bi-gear nav-icon"></i><span class="nav-text">Configurações</span></a></div>
  <div class="side-user" id="sideUser" style="display:none"></div>
</nav>
<button id="sidebarOpen" class="sidebar-open-btn" title="Abrir menu"><i class="bi bi-layout-sidebar"></i></button>`;

  // CSS do componente sidebar — vive AQUI (fonte única), não duplicado em cada .html.
  // As páginas só cuidam do próprio layout (.main/.topbar/.content). Usa as variáveis
  // de tema (--side-*, --border2, etc.) definidas no :root de cada página. As páginas de
  // Geografia sobrescrevem só o z-index (`body .sidebar{z-index:3000}`, maior especificidade)
  // por causa das camadas do Leaflet. Ver CLAUDE.md (backlog "CSS da sidebar duplicado").
  // Colapsada, a sidebar não some mais da tela (era transform:translateX(-100%), some por
  // completo, e um botão flutuante fora dela — .sidebar-open-btn — reaparecia por cima do
  // conteúdo da página pra reabrir; ficava em cima dos seletores de país em campanhas.html,
  // reportado pelo Luan 19/08/2026). Agora colapsa pra uma faixa fina só de ícones (width
  // 180px→64px, padrão pedido pelo Luan a partir de uma referência visual) — o botão de
  // abrir/fechar continua dentro da própria sidebar nos dois estados, nunca mais um elemento
  // solto flutuando por cima da página. Os 64px aqui precisam bater com o `margin-left` de
  // `body.sidebar-hidden .main` em cada página (ver CLAUDE.md) — as duas precisam concordar,
  // senão o conteúdo da página desliza por baixo da faixa de ícones (ou sobra um vão vazio).
  const baseCss = `
.sidebar{width:180px;min-height:100vh;background:var(--side-bg);display:flex;flex-direction:column;padding:20px 0;position:fixed;top:0;left:0;z-index:200;transition:width .25s cubic-bezier(.4,0,.2,1)}
/* Cabeçalho (logo+texto) no mesmo tamanho/layout da sidebar de dashboard-social-media
   (ícone pequeno à esquerda + nome/subtítulo à direita, em vez do logo grande empilhado em cima
   do texto) — pedido do Luan, 21/08/2026. Só o TAMANHO/LAYOUT vem de lá; a paleta (--side-bg/
   --side-text/--side-muted/--side-hover/--side-active) continua a mesma de sempre — uma tentativa
   anterior mudou a cor de fundo pra um gradiente pastel claro sem que isso tivesse sido pedido, e
   foi revertida. favicon.png (ícone quadrado) no lugar de Logo2.png (faixa larga, não cabe em
   34px) — mesma imagem já usada no estado colapsado, então não precisa mais trocar de logo ao
   colapsar, só esconder o bloco de texto. */
.brand{display:flex;align-items:center;gap:11px;padding:0 20px 20px;border-bottom:1px solid rgba(240,235,224,0.07);margin-bottom:20px;transition:padding .2s}
.brand-link{display:block;line-height:0;flex-shrink:0}
.brand-mark{width:34px;height:34px;border-radius:10px;object-fit:cover;flex-shrink:0}
.brand-text{display:flex;flex-direction:column;line-height:1.3;min-width:0}
.brand-name{font-size:13px;font-weight:700;color:var(--side-text);white-space:nowrap}
.brand-sub{font-size:10.5px;color:var(--side-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nav-group{margin-bottom:24px}
.nav-label{font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--side-muted);padding:0 18px;margin-bottom:4px;white-space:nowrap}
.nav-item{display:flex;align-items:center;gap:9px;padding:7px 18px;font-size:12px;color:rgba(240,235,224,0.55);cursor:pointer;transition:background .15s,color .15s;text-decoration:none;position:relative}
.nav-item:hover{background:var(--side-hover);color:var(--side-text)}
.nav-item.active{background:var(--side-active);color:var(--side-text);font-weight:500}
.nav-icon{font-size:15px;width:16px;text-align:center;flex-shrink:0;line-height:1;opacity:.75}
.nav-text{white-space:nowrap}
/* Item de página que ainda não existe (Financeiro). Fica no menu de propósito, pra sinalizar
   o que vem por aí, mas sem fingir que é clicável: sem hover, cursor normal e um selo. Quando
   a página existir, é só tirar a classe/selo e dar a ele href + data-page como os outros
   (sem data-page o item escapa do controle de permissão). */
.nav-item.nav-soon{cursor:default;color:rgba(240,235,224,0.30)}
.nav-item.nav-soon:hover{background:none;color:rgba(240,235,224,0.30)}
.nav-soon-tag{margin-left:auto;font-size:8.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:rgba(240,235,224,0.32);border:1px solid rgba(240,235,224,0.16);border-radius:3px;padding:1px 4px;white-space:nowrap}
body.sidebar-hidden .nav-soon-tag{display:none}
.sidebar-header{display:flex;justify-content:flex-end;padding:6px 10px 0;transition:padding .2s}
.sidebar-close-btn{width:30px;height:30px;border-radius:8px;border:none;background:transparent;color:rgba(240,235,224,.4);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .15s;flex-shrink:0}
.sidebar-close-btn:hover{background:rgba(240,235,224,.12);color:rgba(240,235,224,.9)}
.sidebar-open-btn{display:none;position:fixed;left:12px;top:11px;z-index:300;width:36px;height:32px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--sub);cursor:pointer;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 8px rgba(30,28,24,.1);transition:all .15s}
.sidebar-open-btn:hover{border-color:var(--ink);color:var(--text)}
body.sidebar-mobile-open .sidebar-open-btn{display:none!important}
.sidebar-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:150;opacity:0;pointer-events:none;transition:opacity .25s}
body.sidebar-mobile-open .sidebar-overlay{opacity:1;pointer-events:auto}
body.sidebar-mobile-open .sidebar{transform:translateX(0)!important}

/* ── Estado colapsado (desktop): faixa de 64px só com ícones, mesmo padrão da referência que o
     Luan trouxe (19/08/2026) — logo vira só o ícone, textos somem, hover mostra um balão com o
     rótulo (mesmo texto do item, via data-label, sem precisar de JS pra montar tooltip). ── */
body.sidebar-hidden .sidebar{width:64px}
body.sidebar-hidden .sidebar-header{justify-content:center;padding:6px 0 0}
body.sidebar-hidden .brand{padding:0 0 18px;justify-content:center}
body.sidebar-hidden .brand-text{display:none}
body.sidebar-hidden .nav-label{display:none}
body.sidebar-hidden .nav-group{margin-bottom:14px}
body.sidebar-hidden .nav-item{justify-content:center;padding:9px 0}
body.sidebar-hidden .nav-text{display:none}
body.sidebar-hidden .nav-item::after{content:attr(data-label);position:absolute;left:100%;top:50%;transform:translateY(-50%);margin-left:10px;background:#000;color:#fff;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:500;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s;box-shadow:0 6px 18px rgba(0,0,0,.28);z-index:210}
body.sidebar-hidden .nav-item:hover::after{opacity:1}

@media(max-width:768px){
.sidebar{transform:translateX(-100%)}
.sidebar-open-btn{display:flex}
/* O botão de abrir é fixed, fora do fluxo de cada página — sem isso ele ficava sobreposto aos
   primeiros pills do topbar (ex.: seletor de país em index.html/campanhas.html), reportado pelo
   Luan 19/08/2026. Reservar o espaço aqui, uma vez, evita repetir isso em cada uma das 12
   páginas — a mesma lógica de "nunca sobrepor o conteúdo" que já motivou a sidebar colapsada
   virar faixa de ícones em vez de botão flutuante, agora aplicada ao caso mobile. */
.topbar{padding-left:56px!important}
}
`;
  const css = baseCss
    // Bloco de usuário no rodapé da sidebar (alimentado por /api/me)
    + '.sidebar .side-user{margin-top:auto;padding:12px 14px;border-top:1px solid rgba(240,235,224,0.08);display:flex;align-items:center;gap:9px}'
    + '.sidebar .side-avatar{width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff}'
    + '.sidebar .side-user-info{min-width:0;flex:1}'
    + '.sidebar .side-user-name{font-size:12px;color:var(--side-text);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.sidebar .side-user-role{font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--side-muted);margin-top:1px}'
    + '.sidebar .side-user-role.admin{color:var(--side-text)}'
    + '.sidebar .side-logout{background:none;border:none;color:var(--side-muted);cursor:pointer;font-size:14px;padding:4px;line-height:1}'
    + '.sidebar .side-logout:hover{color:var(--side-text)}'
    // Colapsada: só o avatar (mesmo padrão de "ícone só + tooltip" dos itens de navegação acima).
    + 'body.sidebar-hidden .sidebar .side-user{padding:12px 0;justify-content:center;position:relative}'
    + 'body.sidebar-hidden .sidebar .side-user-info,body.sidebar-hidden .sidebar .side-logout{display:none}'
    + 'body.sidebar-hidden .sidebar .side-user::after{content:attr(data-label);position:absolute;left:100%;top:50%;transform:translateY(-50%);margin-left:10px;background:#000;color:#fff;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:500;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s;box-shadow:0 6px 18px rgba(0,0,0,.28);z-index:210}'
    + 'body.sidebar-hidden .sidebar .side-user:hover::after{opacity:1}'
    // pageLoaderHtml() — anel colorido animado (ver função no topo do arquivo).
    + '.page-loader{display:flex;align-items:center;justify-content:center;padding:18px 0}'
    + '.page-loader .pl{width:48px;height:48px}'
    + '.page-loader .pl__ring{animation:pageLoaderRingA 2s linear infinite}'
    + '.page-loader .pl__ring--a{stroke:#ee2a7b}'
    + '.page-loader .pl__ring--b{animation-name:pageLoaderRingB;stroke:#f9ce34}'
    + '.page-loader .pl__ring--c{animation-name:pageLoaderRingC;stroke:#4776e6}'
    + '.page-loader .pl__ring--d{animation-name:pageLoaderRingD;stroke:#6228d7}'
    + '@keyframes pageLoaderRingA{'
    + 'from,4%{stroke-dasharray:0 660;stroke-width:20;stroke-dashoffset:-330}'
    + '12%{stroke-dasharray:60 600;stroke-width:30;stroke-dashoffset:-335}'
    + '32%{stroke-dasharray:60 600;stroke-width:30;stroke-dashoffset:-595}'
    + '40%,54%{stroke-dasharray:0 660;stroke-width:20;stroke-dashoffset:-660}'
    + '62%{stroke-dasharray:60 600;stroke-width:30;stroke-dashoffset:-665}'
    + '82%{stroke-dasharray:60 600;stroke-width:30;stroke-dashoffset:-925}'
    + '90%,to{stroke-dasharray:0 660;stroke-width:20;stroke-dashoffset:-990}}'
    + '@keyframes pageLoaderRingB{'
    + 'from,12%{stroke-dasharray:0 220;stroke-width:20;stroke-dashoffset:-110}'
    + '20%{stroke-dasharray:20 200;stroke-width:30;stroke-dashoffset:-115}'
    + '40%{stroke-dasharray:20 200;stroke-width:30;stroke-dashoffset:-195}'
    + '48%,62%{stroke-dasharray:0 220;stroke-width:20;stroke-dashoffset:-220}'
    + '70%{stroke-dasharray:20 200;stroke-width:30;stroke-dashoffset:-225}'
    + '90%{stroke-dasharray:20 200;stroke-width:30;stroke-dashoffset:-305}'
    + '98%,to{stroke-dasharray:0 220;stroke-width:20;stroke-dashoffset:-330}}'
    + '@keyframes pageLoaderRingC{'
    + 'from{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:0}'
    + '8%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-5}'
    + '28%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-175}'
    + '36%,58%{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:-220}'
    + '66%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-225}'
    + '86%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-395}'
    + '94%,to{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:-440}}'
    + '@keyframes pageLoaderRingD{'
    + 'from,8%{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:0}'
    + '16%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-5}'
    + '36%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-175}'
    + '44%,50%{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:-220}'
    + '58%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-225}'
    + '78%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-395}'
    + '86%,to{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:-440}}'
    // Avisos minimizáveis (initCollapsibleNotice, ver topo do arquivo) — botão "x" e a bolinha
    // que fica no canto quando o aviso está minimizado. A caixa em si (.limit-note) ainda
    // precisa do próprio CSS visual em cada página que a usar (cor de fundo, borda etc.).
    + '.notice-collapse-btn{position:absolute;top:10px;right:10px;width:22px;height:22px;border-radius:50%;'
    + 'border:none;cursor:pointer;font-size:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
    + '.notice-fab{display:none;position:fixed;bottom:26px;right:26px;width:46px;height:46px;border-radius:50%;'
    + 'border:none;color:#fff;font-size:18px;cursor:pointer;align-items:center;justify-content:center;'
    + 'box-shadow:0 4px 16px rgba(0,0,0,.25);z-index:250;transform:scale(0);opacity:0;'
    + 'transition:transform .28s cubic-bezier(.34,1.56,.64,1),opacity .2s}'
    + '.notice-fab.show{display:flex}'
    + '.notice-fab.show.in{transform:scale(1);opacity:1}'
    + '@media(max-width:768px){.notice-fab{right:18px;bottom:18px}}';

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
    produtos: 'produtos.html', estoque: 'estoque.html',
    campanhas: 'campanhas.html', configuracoes: 'configuracoes.html', integracoes: 'integracoes.html',
    unificador: 'unificador.html', login: 'login.html',
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
      if ((page === 'configuracoes.html' || page === 'integracoes.html' || page === 'unificador.html') && !isAdmin) { location.href = '/'; return; }
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
      box.dataset.label = user.name || user.username || ''; // tooltip da sidebar colapsada
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
