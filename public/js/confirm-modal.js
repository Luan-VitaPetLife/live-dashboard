// confirm-modal.js — substitui o confirm() nativo do navegador (a barra cinza
// "site diz", sem cara nenhuma de app) por um pop-up no estilo da própria
// dashboard — pedido do Luan, 19/08/2026: "não poderia acontecer".
//
// Uso: <script src="js/confirm-modal.js"></script> logo depois de sidebar.js.
// API: await cocoConfirm('Mensagem', { title, confirmText, cancelText, danger })
// → Promise<boolean> (true = confirmou, false = cancelou/Esc/clique fora).
// Mesmo padrão de componente injetado via IIFE do sidebar.js/jobs-widget.js.
(function () {
  const css = ''
    + '.cc-overlay{position:fixed;inset:0;background:rgba(20,18,15,.5);z-index:2000;'
    + 'display:none;align-items:center;justify-content:center;padding:16px;opacity:0;'
    + 'transition:opacity .15s}'
    + '.cc-overlay.cc-show{display:flex;opacity:1}'
    + '.cc-box{background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius,10px);'
    + 'box-shadow:0 20px 60px rgba(30,28,24,.28);width:100%;max-width:380px;padding:22px;'
    + 'transform:translateY(6px) scale(.98);transition:transform .15s;font-family:inherit}'
    + '.cc-overlay.cc-show .cc-box{transform:translateY(0) scale(1)}'
    + '.cc-title{font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px}'
    + '.cc-msg{font-size:12px;color:var(--sub);line-height:1.6;white-space:pre-line}'
    + '.cc-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}'
    + '.cc-btn{font-size:12px;font-weight:600;padding:9px 16px;border-radius:var(--radius-sm,6px);'
    + 'cursor:pointer;font-family:inherit;border:1px solid transparent;transition:opacity .12s}'
    + '.cc-btn:hover{opacity:.85}'
    + '.cc-btn-cancel{background:var(--surface2);color:var(--text);border-color:var(--border2)}'
    + '.cc-btn-ok{background:var(--ink);color:var(--side-text)}'
    + '.cc-btn-danger{background:var(--red,#9b3a3a);color:#fff}'
    + '@media(max-width:480px){.cc-box{max-width:none}}';

  const html = ''
    + '<div class="cc-overlay" id="ccOverlay" role="alertdialog" aria-modal="true">'
    + '<div class="cc-box">'
    + '<div class="cc-title" id="ccTitle"></div>'
    + '<div class="cc-msg" id="ccMsg"></div>'
    + '<div class="cc-actions">'
    + '<button class="cc-btn cc-btn-cancel" id="ccCancel"></button>'
    + '<button class="cc-btn cc-btn-ok" id="ccOk"></button>'
    + '</div></div></div>';

  let overlay, titleEl, msgEl, okBtn, cancelBtn, resolveFn = null;

  function mount() {
    if (document.getElementById('ccOverlay')) return;
    if (!document.getElementById('confirmModalStyle')) {
      const style = document.createElement('style');
      style.id = 'confirmModalStyle';
      style.textContent = css;
      document.head.appendChild(style);
    }
    document.body.insertAdjacentHTML('beforeend', html);
    overlay = document.getElementById('ccOverlay');
    titleEl = document.getElementById('ccTitle');
    msgEl = document.getElementById('ccMsg');
    okBtn = document.getElementById('ccOk');
    cancelBtn = document.getElementById('ccCancel');

    okBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(false); });
    document.addEventListener('keydown', e => {
      if (!overlay.classList.contains('cc-show')) return;
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter') finish(true);
    });
  }

  function finish(result) {
    if (!resolveFn) return;
    overlay.classList.remove('cc-show');
    const r = resolveFn;
    resolveFn = null;
    r(result);
  }

  // window.cocoConfirm(message, opts) — Promise<boolean>. Chamadas empilhadas (pop-up dentro de
  // pop-up) não são esperadas neste app; uma nova chamada só substitui o texto/handlers da mesma
  // caixa, então não precisa de fila.
  window.cocoConfirm = function (message, opts) {
    opts = opts || {};
    mount();
    titleEl.textContent = opts.title || 'Confirmar ação';
    msgEl.textContent = message || '';
    okBtn.textContent = opts.confirmText || 'Confirmar';
    cancelBtn.textContent = opts.cancelText || 'Cancelar';
    okBtn.className = 'cc-btn ' + (opts.danger ? 'cc-btn-danger' : 'cc-btn-ok');
    overlay.classList.add('cc-show');
    okBtn.focus();
    return new Promise(resolve => { resolveFn = resolve; });
  };
})();
