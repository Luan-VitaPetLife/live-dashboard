// Tela "Histórico" — linha do tempo de quem editou o quê.
//
// A tela só DESENHA: a frase de cada evento e os valores já formatados vêm prontos do servidor
// (src/historico.js). É o mesmo princípio do card de Insights, e aqui ele pesa mais que o normal,
// porque um histórico que reformata número por conta própria pode acabar mostrando um valor
// diferente do que foi realmente salvo.

// ── Período ───────────────────────────────────────────────
function rangeForPreset(p) {
  const today = new Date(); const iso = d => d.toISOString().slice(0, 10);
  if (p === 'today') return { since: iso(today), until: iso(today), label: 'Hoje' };
  if (p === '7d')   { const s = new Date(today); s.setDate(s.getDate() - 6); return { since: iso(s), until: iso(today), label: '7 dias' }; }
  if (p === 'month'){ const s = new Date(today.getFullYear(), today.getMonth(), 1); return { since: iso(s), until: iso(today), label: 'Este mês' }; }
  const s = new Date(today); s.setDate(s.getDate() - 29); return { since: iso(s), until: iso(today), label: '30 dias' };
}
let state = rangeForPreset('30d');

function togglePeriodPop() {
  document.getElementById('periodPop').classList.toggle('open');
  document.getElementById('periodPill').classList.toggle('open');
}
function fecharPeriodo() {
  document.getElementById('periodPop').classList.remove('open');
  document.getElementById('periodPill').classList.remove('open');
}
function selectPreset(btn, label) {
  document.querySelectorAll('.pp-presets button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state = rangeForPreset(btn.dataset.preset);
  document.getElementById('periodValue').textContent = label;
  fecharPeriodo();
  load();
}
function applyRange() {
  const from = document.getElementById('dateFrom').value;
  const to = document.getElementById('dateTo').value;
  const err = document.getElementById('ppErr');
  if (!from || !to) { err.textContent = 'Preencha as duas datas'; return; }
  if (from > to) { err.textContent = 'A data inicial deve ser anterior à final'; return; }
  err.textContent = '';
  state = { since: from, until: to, label: CocoPeriodo.rotulo(from, to) };
  document.getElementById('periodValue').textContent = state.label;
  fecharPeriodo();
  load();
}
document.addEventListener('click', e => {
  const wrap = document.getElementById('periodWrap');
  if (wrap && !wrap.contains(e.target)) fecharPeriodo();
});

// ── Página e país ─────────────────────────────────────────
const ICONE = {
  produtos: 'bi-box-seam', estoque: 'bi-layers', unificador: 'bi-diagram-3',
  segmentos: 'bi-pie-chart', integracoes: 'bi-plug', configuracoes: 'bi-gear',
};

let paginas = [];
let pagina = '';
let market = '';

function setPagina(id) {
  pagina = id;
  document.querySelectorAll('.hi-pag').forEach(b => b.classList.toggle('active', b.dataset.pagina === id));
  const def = paginas.find(p => p.id === id);
  const temPais = !!(def && def.mercados && def.mercados.length);
  document.getElementById('hiPaises').hidden = !temPais;
  // Sair de uma página com país pra uma sem país zera o filtro: senão a próxima página com país
  // herdaria um "Brasil" que a pessoa não escolheu ali, e mostraria menos do que existe.
  if (!temPais && market) marcarPais('');
  load();
}

function marcarPais(m) {
  market = m;
  document.getElementById('mktBtnAll').classList.toggle('active', m === '');
  document.getElementById('mktBtnBr').classList.toggle('active', m === 'br');
  document.getElementById('mktBtnUs').classList.toggle('active', m === 'us');
}

function setMarket(m) {
  marcarPais(m);
  load();
}

function renderPaginas() {
  document.getElementById('hiPaginas').innerHTML = paginas.map(p =>
    `<button class="hi-pag" data-pagina="${escapeHtml(p.id)}" onclick="setPagina('${escapeHtml(p.id)}')">`
    + `<i class="bi ${ICONE[p.id] || 'bi-dot'}"></i>${escapeHtml(p.label)}</button>`
  ).join('');
}

// ── Desenho da linha do tempo ─────────────────────────────
// Agrupa por dia porque é assim que a pessoa procura ("o que mudou ontem?"), e porque repetir a
// data em cada linha empurraria a informação que importa pra longe do olho.
function rotuloDoDia(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  const mesmoDia = (a, b) => a.toDateString() === b.toDateString();
  if (mesmoDia(d, hoje))  return 'Hoje';
  if (mesmoDia(d, ontem)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function hora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// A frase já vem do servidor em pedaços, com o valor antigo e o novo separados do texto. A tela
// só pinta cada pedaço — nada de procurar o valor dentro da frase pronta, que embaralha quando um
// valor é pedaço do outro (ver src/historico.js).
const CLASSE = { de: 'hi-de', para: 'hi-para' };
function destacar(item) {
  const partes = item.partes || [{ t: 'txt', v: item.texto || '' }];
  return partes.map(p => {
    const txt = escapeHtml(p.v);
    return CLASSE[p.t] ? `<span class="${CLASSE[p.t]}">${txt}</span>` : txt;
  }).join('');
}

function render(itens) {
  const card = document.getElementById('hiCard');
  if (!itens.length) {
    card.innerHTML = `<div class="hi-vazio"><i class="bi bi-clock-history"></i>`
      + `<div class="hi-vazio-titulo">Nenhuma edição neste período</div>`
      + `<div class="hi-vazio-sub">O histórico guarda o que foi editado à mão nesta página. `
      + `Um período sem nada aqui quer dizer que ninguém mexeu, não que algo falhou.</div></div>`;
    return;
  }
  const dias = [];
  for (const it of itens) {
    const dia = rotuloDoDia(it.ts);
    if (!dias.length || dias[dias.length - 1].dia !== dia) dias.push({ dia, itens: [] });
    dias[dias.length - 1].itens.push(it);
  }
  card.innerHTML = dias.map(g => `<div class="hi-dia">
    <div class="hi-dia-label">${escapeHtml(g.dia)}</div>
    <div class="hi-lista">${g.itens.map(it => `
      <div class="hi-item hi-${escapeHtml(it.acao || 'editou')}">
        <div class="hi-corpo">
          <div class="hi-texto">${destacar(it)}</div>
          ${it.canal ? `<div class="hi-meta"><span class="hi-chip">${escapeHtml(it.canal)}</span></div>` : ''}
        </div>
        <div class="hi-hora">${escapeHtml(hora(it.ts))}</div>
      </div>`).join('')}</div>
  </div>`).join('');
}

// ── Carga ─────────────────────────────────────────────────
function setLive(txt) { document.getElementById('lastUpdate').textContent = txt; }

async function load() {
  if (!pagina) return;
  setLive('Carregando…');
  try {
    const q = new URLSearchParams({ page: pagina, since: state.since, until: state.until });
    if (market) q.set('market', market);
    const r = await fetch('/api/history?' + q.toString(), { credentials: 'same-origin' });
    if (!r.ok) throw new Error('Erro ' + r.status);
    const data = await r.json();
    render(data.itens || []);
    setLive('Ao vivo · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    setLive('Erro');
    console.error('historico:', e);
    document.getElementById('hiCard').innerHTML =
      `<div class="hi-vazio"><i class="bi bi-exclamation-triangle"></i>`
      + `<div class="hi-vazio-titulo">Não deu para carregar o histórico</div>`
      + `<div class="hi-vazio-sub">${escapeHtml(e.message)}</div></div>`;
  }
}

async function init() {
  try {
    const r = await fetch('/api/history/paginas', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('Erro ' + r.status);
    paginas = (await r.json()).paginas || [];
  } catch (e) {
    setLive('Erro');
    console.error('historico:', e);
    return;
  }
  renderPaginas();
  if (paginas.length) setPagina(paginas[0].id);
}
init();
