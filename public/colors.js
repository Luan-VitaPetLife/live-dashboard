// ─────────────────────────────────────────────
//  colors.js — sistema de cores compartilhado (Coco and Luna)
//  IIFE incluído via <script src="colors.js"> em qualquer página, mesmo
//  padrão de sidebar.js. Expõe window.CocoColors com:
//   - defaults (DEFAULT_CH/DEFAULT_MKT) + objetos vivos (.ch/.mkt)
//   - persistência em localStorage('coco_colors') (mesma chave de sempre)
//   - o novo seletor de cor (paleta de swatches curados + hex), substituindo
//     o <input type="color"> nativo do navegador (lento/feio/inconsistente
//     entre SOs) em qualquer lugar do app — painel de cores de canal/
//     marketing (index.html) e configurações de mapa (geografia*.html).
// ─────────────────────────────────────────────
(function () {
  const STORAGE_KEY = 'coco_colors';

  const DEFAULT_CH = {
    shopify:      { bg: '#95BF47', label: 'Shopify' },
    shopify_us:   { bg: '#7EAD3C', label: 'Shopify US' },
    shopee:       { bg: '#EE4D2D', label: 'Shopee' },
    mercadolivre: { bg: '#FFE600', label: 'Mercado Livre' },
    amazon:       { bg: '#111111', label: 'Amazon' },
    amazon_us:    { bg: '#FF9900', label: 'Amazon US' },
  };
  const DEFAULT_MKT = {
    Instagram:       '#E1306C',
    Facebook:        '#1877F2',
    Google:          '#6a8c6e',
    Shopee:          '#EE4D2D',
    'Mercado Livre': '#FFE600',
    Amazon:          '#4a90c4',
    Clássico:        '#4a9e6e',
    Destaque:        '#e8a225',
    Direto:          '#c4b49a',
    Outros:          '#b0a898',
  };

  // Paleta curada pro grid de swatches do picker — cobre o espectro todo com
  // tons que já combinam com o visual "earthy" do dashboard, mais alguns
  // acentos vivos pra badges/gráficos precisarem se destacar.
  const SWATCHES = [
    '#9b3a3a', '#c0524a', '#d9704f', '#a05a3a', '#c8863f', '#e0a83e',
    '#d4b23c', '#b7a832', '#8c9c3f', '#6a8c6e', '#4f8f6b', '#3d7a52',
    '#3d8f7a', '#3d8f95', '#3d7a8f', '#4a7ab5', '#5a6bb5', '#6a5ab5',
    '#8a5ab5', '#a55ab0', '#b5559a', '#c45a85', '#d4607a', '#e1306c',
    '#2d2a26', '#6b6760', '#9c9790', '#c4b49a',
  ];

  function contrastText(hex) {
    const h = (hex || '#000').replace('#', '');
    if (h.length !== 6) return '#fff';
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#333' : '#fff';
  }

  function readSaved() { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  function save(key, value) {
    const saved = readSaved();
    saved[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }

  const ch = {};
  const mkt = {};
  function load() {
    const saved = readSaved();
    for (const k in DEFAULT_CH) {
      const bg = saved[`ch.${k}`] || DEFAULT_CH[k].bg;
      ch[k] = { bg, text: contrastText(bg), label: DEFAULT_CH[k].label };
    }
    for (const k in DEFAULT_MKT) {
      mkt[k] = saved[`mkt.${k}`] || DEFAULT_MKT[k];
    }
  }
  function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    load();
  }

  function chBadgeHTML(chKey) {
    const c = ch[chKey] || { bg: '#999', text: '#fff', label: chKey || '?' };
    return `<span style="background:${c.bg};color:${c.text};font-size:10px;padding:2px 7px;border-radius:3px;font-weight:600;white-space:nowrap">${c.label}</span>`;
  }

  // ── CSS injetado uma única vez (escopado com prefixo ccp- pra não colidir
  // com o CSS de cada página — todas já compartilham as mesmas variáveis
  // --surface/--border2/--radius/etc definidas no :root de cada arquivo) ──
  const STYLE = `
    .ccp-trigger{width:40px;height:28px;border:1px solid var(--border2);border-radius:var(--radius-sm);cursor:pointer;padding:0;transition:border-color .12s,transform .08s}
    .ccp-trigger:hover{border-color:var(--ink)}
    .ccp-trigger:active{transform:scale(.94)}
    .ccp-pop{position:fixed;display:none;flex-direction:column;gap:10px;background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius-sm);box-shadow:0 8px 28px rgba(30,28,24,.18);padding:12px;z-index:900;width:212px}
    .ccp-pop.open{display:flex}
    .ccp-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}
    .ccp-swatch{width:26px;height:26px;border-radius:6px;border:1px solid rgba(30,28,24,.12);cursor:pointer;padding:0;transition:transform .08s,box-shadow .08s}
    .ccp-swatch:hover{transform:scale(1.12);box-shadow:0 2px 6px rgba(30,28,24,.25)}
    .ccp-swatch.active{box-shadow:0 0 0 2px var(--surface),0 0 0 3.5px var(--ink)}
    .ccp-hex-row{display:flex;align-items:center;gap:8px;border-top:1px solid var(--border);padding-top:10px}
    .ccp-hex-preview{width:26px;height:26px;border-radius:6px;border:1px solid rgba(30,28,24,.12);flex-shrink:0}
    .ccp-hex-input{flex:1;min-width:0;font-size:12px;font-family:inherit;color:var(--text);padding:6px 8px;border:1px solid var(--border2);border-radius:5px;background:var(--surface2);outline:none;text-transform:uppercase}
    .ccp-hex-input:focus{border-color:var(--ink);background:#fff}
  `;
  function injectStyle() {
    if (document.getElementById('ccp-style')) return;
    const s = document.createElement('style');
    s.id = 'ccp-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // ── Popover singleton (reaproveitado entre todas as chamadas de openPicker,
  // mesmo padrão de outros popovers do app como .bulk-pop/.period-pop) ──
  let popEl = null, hexInput = null, previewEl = null, gridEl = null;
  let activeTrigger = null, activeOnPick = null;

  function ensurePop() {
    if (popEl) return;
    injectStyle();
    popEl = document.createElement('div');
    popEl.className = 'ccp-pop';
    const grid = document.createElement('div');
    grid.className = 'ccp-grid';
    SWATCHES.forEach(hex => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ccp-swatch';
      b.style.background = hex;
      b.dataset.hex = hex;
      b.addEventListener('click', () => pick(hex));
      grid.appendChild(b);
    });
    gridEl = grid;
    const hexRow = document.createElement('div');
    hexRow.className = 'ccp-hex-row';
    previewEl = document.createElement('div');
    previewEl.className = 'ccp-hex-preview';
    hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'ccp-hex-input';
    hexInput.maxLength = 7;
    hexInput.placeholder = '#RRGGBB';
    hexInput.addEventListener('input', () => {
      const v = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { previewEl.style.background = v; pick(v, { keepOpen: true }); }
    });
    hexInput.addEventListener('keydown', e => { if (e.key === 'Enter') close(); });
    hexRow.appendChild(previewEl);
    hexRow.appendChild(hexInput);
    popEl.appendChild(grid);
    popEl.appendChild(hexRow);
    document.body.appendChild(popEl);

    document.addEventListener('click', e => {
      if (!popEl.classList.contains('open')) return;
      if (popEl.contains(e.target) || e.target === activeTrigger) return;
      close();
    });
    window.addEventListener('resize', () => { if (popEl.classList.contains('open')) close(); });
  }

  function pick(hex, opts) {
    if (activeOnPick) activeOnPick(hex);
    if (activeTrigger) activeTrigger.style.background = hex;
    gridEl.querySelectorAll('.ccp-swatch').forEach(b => b.classList.toggle('active', b.dataset.hex.toLowerCase() === hex.toLowerCase()));
    if (!opts || !opts.keepOpen) close();
  }

  function close() {
    if (popEl) popEl.classList.remove('open');
    activeTrigger = null;
    activeOnPick = null;
  }

  // anchorEl: elemento (geralmente o próprio swatch/trigger) perto do qual abrir.
  // currentHex: cor atual (pré-seleciona o swatch correspondente e preenche o hex).
  // onPick(hex): chamado a cada escolha (clique no swatch ou hex válido digitado) — igual ao
  // evento "input" ao vivo do <input type="color"> nativo que esse picker substitui.
  function openPicker(anchorEl, currentHex, onPick) {
    ensurePop();
    if (popEl.classList.contains('open') && activeTrigger === anchorEl) { close(); return; }
    activeTrigger = anchorEl;
    activeOnPick = onPick;
    hexInput.value = (currentHex || '').toUpperCase();
    previewEl.style.background = currentHex || '#fff';
    gridEl.querySelectorAll('.ccp-swatch').forEach(b => b.classList.toggle('active', b.dataset.hex.toLowerCase() === (currentHex || '').toLowerCase()));
    popEl.classList.add('open');
    const rect = anchorEl.getBoundingClientRect();
    const popW = 212;
    let left = rect.left;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    popEl.style.top = (rect.bottom + 6) + 'px';
    popEl.style.left = Math.max(8, left) + 'px';
  }

  // Cria um <button class="ccp-trigger"> com o mesmo footprint do antigo
  // <input type="color" class="sp-color-inp">, já com o color-picker ligado.
  function makeTrigger(currentHex, onPick, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ccp-trigger' + (extraClass ? ' ' + extraClass : '');
    btn.style.background = currentHex;
    btn.addEventListener('click', e => { e.stopPropagation(); openPicker(btn, btn.style.background || currentHex, onPick); });
    return btn;
  }

  // Monta as linhas .sp-row (canal/marketing) num container já existente no HTML da página —
  // mesmo formato de sp-row/sp-row-left/sp-swatch/sp-row-label já usado em index.html, só troca
  // o <input type="color"> final pelo novo trigger.
  function buildSection(container, defaults, prefix, getCurrent, onChange) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    container.innerHTML = '';
    for (const k in defaults) {
      const label = typeof defaults[k] === 'object' ? defaults[k].label : k;
      const currentColor = getCurrent(k);
      const row = document.createElement('div');
      row.className = 'sp-row';
      const left = document.createElement('div');
      left.className = 'sp-row-left';
      const swatch = document.createElement('div');
      swatch.className = 'sp-swatch';
      swatch.style.background = currentColor;
      const lbl = document.createElement('span');
      lbl.className = 'sp-row-label';
      lbl.textContent = label;
      left.appendChild(swatch);
      left.appendChild(lbl);
      const trigger = makeTrigger(currentColor, hex => {
        onChange(k, hex);
        swatch.style.background = hex;
      });
      row.appendChild(left);
      row.appendChild(trigger);
      container.appendChild(row);
    }
  }

  load();

  window.CocoColors = {
    DEFAULT_CH, DEFAULT_MKT, ch, mkt,
    load, save, resetAll, contrastText, chBadgeHTML,
    buildSection, openPicker, makeTrigger,
  };
})();
