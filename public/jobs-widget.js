// ─────────────────────────────────────────────
//  jobs-widget.js — indicador flutuante de processos em segundo plano
//  (backfill/imagens/itens da Amazon, geografia via Bling, backup),
//  compartilhado por TODAS as páginas — mesmo padrão do sidebar.js.
//
//  Uso: <script src="jobs-widget.js"></script> logo depois de sidebar.js.
//  Sozinho: puxa GET /api/jobs a cada poucos segundos, mostra um card
//  flutuante e arrastável quando há algo rodando, some sozinho um tempo
//  depois de tudo terminar. Continua visível ao navegar pra outra página
//  (cada página carrega o script de novo, mas a posição/tamanho ficam em
//  localStorage — pedido do Luan, 18/08/2026: "quando sair dessa página,
//  a barra de progresso continua na tela"). Redimensionável pelas bordas
//  e cada job tem um × pra cancelar (com confirmação) — pedido do Luan,
//  19/08/2026.
// ─────────────────────────────────────────────
(function () {
  const POS_KEY = 'coco_jobs_widget_pos';
  const SIZE_KEY = 'coco_jobs_widget_size';
  const COLLAPSED_KEY = 'coco_jobs_widget_collapsed';
  const POLL_MS = 3000;
  const HIDE_AFTER_DONE_MS = 8000;
  const MIN_W = 240, MIN_H = 130;

  const esc = window.escapeHtml || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  };

  const css = ''
    + '.jw-widget{position:fixed;right:20px;bottom:20px;width:280px;max-height:400px;background:var(--surface);'
    + 'border:1px solid var(--border2);border-radius:10px;box-shadow:0 8px 28px rgba(30,28,24,.2);'
    + 'z-index:900;font-family:inherit;overflow:hidden;opacity:0;transform:translateY(8px);'
    + 'display:flex;flex-direction:column;transition:opacity .2s,transform .2s}'
    + '.jw-widget.jw-show{opacity:1;transform:translateY(0)}'
    + '.jw-widget.jw-collapsed{width:auto!important;height:auto!important;max-height:none!important}'
    + '.jw-widget.jw-collapsed .jw-body{display:none}'
    + '.jw-widget.jw-collapsed .jw-resize{display:none}'
    + '.jw-head{display:flex;align-items:center;gap:8px;padding:9px 10px;cursor:grab;user-select:none;'
    + 'background:var(--surface2);border-bottom:1px solid var(--border2);flex-shrink:0}'
    + '.jw-widget.jw-collapsed .jw-head{border-bottom:none}'
    + '.jw-head:active{cursor:grabbing}'
    + '.jw-spinner{width:11px;height:11px;border-radius:50%;border:2px solid var(--border2);'
    + 'border-top-color:var(--ink);flex-shrink:0;animation:jwSpin .7s linear infinite}'
    + '@keyframes jwSpin{to{transform:rotate(360deg)}}'
    + '.jw-title{font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;'
    + 'text-overflow:ellipsis;flex:1}'
    + '.jw-toggle{background:none;border:none;color:var(--muted);font-size:13px;cursor:pointer;'
    + 'width:18px;height:18px;line-height:1;flex-shrink:0;padding:0}'
    + '.jw-toggle:hover{color:var(--text)}'
    + '.jw-body{flex:1;min-height:0;overflow-y:auto;padding:4px}'
    + '.jw-job{padding:8px 10px;border-radius:8px}'
    + '.jw-job+.jw-job{margin-top:2px}'
    + '.jw-job-top{display:flex;align-items:baseline;gap:6px}'
    + '.jw-job-label{font-size:11px;font-weight:600;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.jw-job-by{font-size:9px;color:var(--muted);white-space:nowrap;flex-shrink:0}'
    + '.jw-job-cancel{background:none;border:none;color:var(--muted);font-size:14px;line-height:1;'
    + 'cursor:pointer;padding:0 0 0 4px;flex-shrink:0}'
    + '.jw-job-cancel:hover{color:var(--red,#9b3a3a)}'
    + '.jw-bar-wrap{height:4px;border-radius:2px;background:var(--border2);margin-top:6px;overflow:hidden}'
    + '.jw-bar{height:100%;background:var(--ink);border-radius:2px;transition:width .3s}'
    + '.jw-bar-indeterminate{width:30%!important;animation:jwIndeterminate 1.1s ease-in-out infinite}'
    + '@keyframes jwIndeterminate{0%{margin-left:-30%}100%{margin-left:100%}}'
    + '.jw-job-msg{font-size:10px;color:var(--sub);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.jw-job-done .jw-bar{background:var(--sage,#6a8c6e)}'
    + '.jw-job-error .jw-bar{background:var(--red,#9b3a3a)}'
    + '.jw-job-cancelled .jw-bar{background:var(--muted)}'
    + '.jw-resize{position:absolute;z-index:5}'
    + '.jw-resize[data-dir="n"]{top:-3px;left:8px;right:8px;height:6px;cursor:ns-resize}'
    + '.jw-resize[data-dir="s"]{bottom:-3px;left:8px;right:8px;height:6px;cursor:ns-resize}'
    + '.jw-resize[data-dir="e"]{right:-3px;top:8px;bottom:8px;width:6px;cursor:ew-resize}'
    + '.jw-resize[data-dir="w"]{left:-3px;top:8px;bottom:8px;width:6px;cursor:ew-resize}'
    + '.jw-resize[data-dir="ne"]{top:-3px;right:-3px;width:12px;height:12px;cursor:nesw-resize}'
    + '.jw-resize[data-dir="nw"]{top:-3px;left:-3px;width:12px;height:12px;cursor:nwse-resize}'
    + '.jw-resize[data-dir="se"]{bottom:-3px;right:-3px;width:12px;height:12px;cursor:nwse-resize}'
    + '.jw-resize[data-dir="sw"]{bottom:-3px;left:-3px;width:12px;height:12px;cursor:nesw-resize}'
    + '@media(max-width:768px){.jw-widget{right:12px;bottom:12px;left:12px;width:auto!important}.jw-widget .jw-resize{display:none}}';

  const html = ''
    + '<div class="jw-widget" id="jobsWidget" role="status" aria-live="polite">'
    + '<div class="jw-head" id="jwHead">'
    + '<span class="jw-spinner"></span>'
    + '<span class="jw-title" id="jwTitle">Processos</span>'
    + '<button class="jw-toggle" id="jwToggle" title="Minimizar/expandir">–</button>'
    + '</div>'
    + '<div class="jw-body" id="jwBody"></div>'
    + '</div>';

  function mount() {
    if (document.getElementById('jobsWidget')) return; // idempotente
    if (!document.getElementById('jobsWidgetStyle')) {
      const style = document.createElement('style');
      style.id = 'jobsWidgetStyle';
      style.textContent = css;
      document.head.appendChild(style);
    }
    document.body.insertAdjacentHTML('beforeend', html);

    const widget = document.getElementById('jobsWidget');
    const head = document.getElementById('jwHead');
    const toggleBtn = document.getElementById('jwToggle');
    const body = document.getElementById('jwBody');

    // Posição/tamanho arrastados/redimensionados persistem entre páginas (localStorage) — sem
    // nada salvo, fica no canto inferior direito com o tamanho padrão (via CSS).
    try {
      const pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        widget.style.left = pos.left + 'px';
        widget.style.top = pos.top + 'px';
        widget.style.right = 'auto';
        widget.style.bottom = 'auto';
      }
    } catch (e) {}
    try {
      const size = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
      if (size && size.width > 0 && size.height > 0) {
        widget.style.width = size.width + 'px';
        widget.style.height = size.height + 'px';
        widget.style.maxHeight = 'none';
      }
    } catch (e) {}

    let collapsed = localStorage.getItem(COLLAPSED_KEY) === '1';
    function applyCollapsed() {
      widget.classList.toggle('jw-collapsed', collapsed);
      toggleBtn.textContent = collapsed ? '+' : '–';
    }
    applyCollapsed();
    toggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      collapsed = !collapsed;
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
      applyCollapsed();
    });

    // Arrastar pelo cabeçalho — mesmo padrão de clone/posição-fixa já usado em Produtos/Estoque
    // pra reordenar cards (ver CLAUDE.md "Padrões de UI compartilhados"), simplificado aqui
    // porque é um elemento só, não uma lista reordenável.
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    head.addEventListener('pointerdown', e => {
      if (e.target === toggleBtn) return;
      dragging = true;
      const rect = widget.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      widget.style.left = startLeft + 'px';
      widget.style.top = startTop + 'px';
      widget.style.right = 'auto';
      widget.style.bottom = 'auto';
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', e => {
      if (!dragging) return;
      const left = Math.max(4, Math.min(window.innerWidth - 40, startLeft + (e.clientX - startX)));
      const top = Math.max(4, Math.min(window.innerHeight - 40, startTop + (e.clientY - startY)));
      widget.style.left = left + 'px';
      widget.style.top = top + 'px';
    });
    head.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      localStorage.setItem(POS_KEY, JSON.stringify({ left: parseFloat(widget.style.left), top: parseFloat(widget.style.top) }));
      head.releasePointerCapture(e.pointerId);
    });

    // Redimensionar puxando pelas bordas/cantos, igual uma janela normal — pedido do Luan,
    // 19/08/2026. Puxar por N/W move a origem também (senão o canto oposto "andaria" junto).
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(dir => {
      const handle = document.createElement('div');
      handle.className = 'jw-resize';
      handle.dataset.dir = dir;
      widget.appendChild(handle);

      let resizing = false, rStartX = 0, rStartY = 0, rStartW = 0, rStartH = 0, rStartLeft = 0, rStartTop = 0;
      handle.addEventListener('pointerdown', e => {
        e.stopPropagation();
        resizing = true;
        const rect = widget.getBoundingClientRect();
        rStartX = e.clientX; rStartY = e.clientY;
        rStartW = rect.width; rStartH = rect.height;
        rStartLeft = rect.left; rStartTop = rect.top;
        widget.style.left = rStartLeft + 'px';
        widget.style.top = rStartTop + 'px';
        widget.style.right = 'auto';
        widget.style.bottom = 'auto';
        widget.style.maxHeight = 'none';
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener('pointermove', e => {
        if (!resizing) return;
        const dx = e.clientX - rStartX, dy = e.clientY - rStartY;
        let w = rStartW, h = rStartH, left = rStartLeft, top = rStartTop;
        if (dir.includes('e')) w = Math.max(MIN_W, Math.min(window.innerWidth - left - 4, rStartW + dx));
        if (dir.includes('s')) h = Math.max(MIN_H, Math.min(window.innerHeight - top - 4, rStartH + dy));
        if (dir.includes('w')) { w = Math.max(MIN_W, rStartW - dx); left = rStartLeft + (rStartW - w); }
        if (dir.includes('n')) { h = Math.max(MIN_H, rStartH - dy); top = rStartTop + (rStartH - h); }
        widget.style.width = w + 'px';
        widget.style.height = h + 'px';
        widget.style.left = left + 'px';
        widget.style.top = top + 'px';
      });
      handle.addEventListener('pointerup', e => {
        if (!resizing) return;
        resizing = false;
        handle.releasePointerCapture(e.pointerId);
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: parseFloat(widget.style.width), height: parseFloat(widget.style.height) }));
        localStorage.setItem(POS_KEY, JSON.stringify({ left: parseFloat(widget.style.left), top: parseFloat(widget.style.top) }));
      });
    });

    // Cancelar um job (delegado no body, que é recriado a cada render) — confirmação antes de
    // mandar, pedido do Luan 19/08/2026.
    body.addEventListener('click', e => {
      const btn = e.target.closest('.jw-job-cancel');
      if (!btn) return;
      const id = btn.dataset.cancelId;
      const label = btn.dataset.cancelLabel || 'esse processo';
      if (!confirm(`Cancelar "${label}"? O que já foi feito até agora fica salvo.`)) return;
      btn.disabled = true;
      fetch('/api/jobs/' + id + '/cancel', { method: 'POST', credentials: 'same-origin' })
        .then(poll)
        .catch(() => { btn.disabled = false; });
    });

    return widget;
  }

  function jobRowHtml(job) {
    const done = job.status === 'done';
    const error = job.status === 'error';
    const cancelled = job.status === 'cancelled';
    const running = job.status === 'running';
    const statusClass = done ? 'jw-job-done' : error ? 'jw-job-error' : cancelled ? 'jw-job-cancelled' : '';

    // Concluído/erro/cancelado sempre com a barra cheia e sólida — o "correndo rapidinho" só faz
    // sentido enquanto o processo está de fato rodando sem uma % conhecida ainda (iniciando).
    // Bug relatado pelo Luan (19/08/2026): job já concluído aparecia com a barrinha animada e só
    // parcialmente preenchida, parecendo travado.
    const indeterminate = running && job.progressPct == null;
    const barClass = indeterminate ? 'jw-bar jw-bar-indeterminate' : 'jw-bar';
    const pct = !running ? 100 : (job.progressPct == null ? 0 : job.progressPct);
    const barWidth = indeterminate ? '' : ('width:' + pct + '%;');

    const by = job.startedBy ? ('por ' + esc(job.startedBy)) : 'automático';
    const msg = done ? 'Concluído' + (job.message ? ': ' + job.message : '')
      : error ? 'Erro: ' + (job.message || '')
      : cancelled ? 'Cancelado' + (job.message ? ': ' + job.message : '')
      : (job.message || 'em andamento…');
    const cancelBtn = job.cancelable
      ? `<button class="jw-job-cancel" data-cancel-id="${esc(job.id)}" data-cancel-label="${esc(job.label)}" title="Cancelar">×</button>`
      : '';

    return '<div class="jw-job ' + statusClass + '">'
      + '<div class="jw-job-top"><span class="jw-job-label">' + esc(job.label) + '</span>'
      + '<span class="jw-job-by">' + by + '</span>' + cancelBtn + '</div>'
      + '<div class="jw-bar-wrap"><div class="' + barClass + '" style="' + barWidth + '"></div></div>'
      + '<div class="jw-job-msg">' + esc(msg) + '</div>'
      + '</div>';
  }

  let lastAnyRunning = false;
  let hideTimer = null;

  function render(jobs) {
    const widget = document.getElementById('jobsWidget');
    if (!widget) return;
    const body = document.getElementById('jwBody');
    const title = document.getElementById('jwTitle');
    const running = jobs.filter(j => j.status === 'running');
    const anyRunning = running.length > 0;

    if (!jobs.length) {
      if (widget.classList.contains('jw-show')) widget.classList.remove('jw-show');
      return;
    }

    body.innerHTML = jobs.map(jobRowHtml).join('');
    title.textContent = anyRunning
      ? (running.length === 1 ? running[0].label : running.length + ' processos em andamento')
      : 'Processos concluídos';
    widget.querySelector('.jw-spinner').style.display = anyRunning ? '' : 'none';
    widget.classList.add('jw-show');

    if (anyRunning) {
      lastAnyRunning = true;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    } else if (lastAnyRunning) {
      // Acabou de terminar agora — some sozinho depois de um tempo, dá pra ler o resultado antes.
      lastAnyRunning = false;
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { widget.classList.remove('jw-show'); }, HIDE_AFTER_DONE_MS);
    }
  }

  async function poll() {
    try {
      const r = await fetch('/api/jobs', { credentials: 'same-origin' });
      if (!r.ok) return;
      const d = await r.json();
      render(d.jobs || []);
    } catch (e) { /* silencioso — não é crítico, só um indicador */ }
  }

  function init() {
    mount();
    poll();
    setInterval(poll, POLL_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
