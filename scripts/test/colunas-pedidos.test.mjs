// Colunas do card "Pedidos recentes" (index.html).
//
// A tabela deixou de ter as colunas escritas à mão no markup: cabeçalho, células e linha de total
// são montados a partir de UMA lista (RO_COLUMNS/roCols), porque no modo de edição a ordem é
// arrastável e cada coluna pode ser ocultada. Escrito à mão, o cabeçalho diria "Cliente" com o
// valor do canal embaixo, e a tabela continuaria desenhando normalmente — erro que não dá erro.
//
// Por isso as funções são EXECUTADAS aqui, contra pedidos falsos, em vez de conferidas por texto.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, PUB, fontePagina } from './_lib.mjs';

const t = criarTeste('Colunas de "Pedidos recentes"');

const src = fs.readFileSync(path.join(PUB, 'js', 'paginas', 'index.js'), 'utf8');
const ini = src.indexOf('// ── Colunas do card "Pedidos recentes" ──');
const fim = src.indexOf('function renderOrdersPage() {');
t.ok(ini >= 0 && fim > ini, 'achou o bloco das colunas');

// Dublês do que o bloco usa de fora. O `document` é só o suficiente pro renderOrdersHead escrever
// e pros dois addEventListener do bloco não estourarem.
const cabecalho = { innerHTML: '', addEventListener() {} };
const corpo = { _classes: new Set(), classList: { contains: c => corpo._classes.has(c), add(c){corpo._classes.add(c);}, remove(c){corpo._classes.delete(c);} } };
const ctx = {
  console,
  escapeHtml: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])),
  statusTag: o => ({ cls: o.cancelled ? 'canc' : 'ok', label: o.cancelled ? 'Cancelado' : 'Autorizado' }),
  fmtMoney: v => 'R$ ' + Number(v).toFixed(2),
  CocoColors: { chBadgeHTML: c => `<span class="badge">${c}</span>`, ch: { amazon: { label: 'Amazon BR' } } },
  EXPORT_COLUMN_DEFS: {
    name: 'Pedido', createdAt: 'Data/Hora da compra', customer: 'Cliente',
    statusLabel: 'Situação', total: 'Valor', channel: 'Canal',
    products: 'Produto(s) da compra', itemsCount: 'Nº de produtos', itemsQty: 'Qtd. de itens',
  },
  _roMode: 'recent',
  _roIsAllCh: true,
  renderOrdersPage: () => {},
  persistLayout: () => {},
  document: { getElementById: id => (id === 'ordersHead' ? cabecalho : null), body: corpo, addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {} } }) },
};
vm.createContext(ctx);
// `const`/`let` no topo de um script do vm não viram propriedade do contexto (só `function` e
// `var` viram), então o bloco leva um epílogo que entrega o modelo e o estado editável.
vm.runInContext(src.slice(ini, fim) + `
globalThis.modelo = { RO_COLUMNS, RO_DEFAULT_COLS,
  get roColOrder() { return roColOrder; }, set roColOrder(v) { roColOrder = v; },
  get roHiddenCols() { return roHiddenCols; }, set roHiddenCols(v) { roHiddenCols = v; },
  set roDragKey(v) { roDragKey = v; } };`, ctx);
const m = ctx.modelo;
const { RO_COLUMNS, RO_DEFAULT_COLS } = m;
const editando = on => on ? corpo._classes.add('edit-mode') : corpo._classes.delete('edit-mode');

const PEDIDO = {
  name: '#701-1986193-1656211', createdAt: '2026-08-18T14:30:00Z', customer: 'Fulano',
  status: 'Shipped', cancelled: false, total: 134.98, items: 2, itemsQty: 3, channel: 'amazon',
};

// ── A coluna nova existe e sai do mesmo vocabulário do exportar ──
t.ok(RO_DEFAULT_COLS.includes('itemsQty'), 'a coluna "Qtd. de itens" está na tabela');
for (const k of RO_DEFAULT_COLS) {
  t.ok(!!ctx.EXPORT_COLUMN_DEFS[k], `a coluna "${k}" tem rótulo em EXPORT_COLUMN_DEFS`);
}

// ── Toda célula se identifica: é disso que o CSS do celular depende pra esconder a coluna certa ──
for (const k of RO_DEFAULT_COLS) {
  t.ok(new RegExp(`data-col="${k}"`).test(ctx.roCell(k, PEDIDO)), `a célula de "${k}" carrega o próprio data-col`);
}
t.ok(/>3</.test(ctx.roCell('itemsQty', PEDIDO)), 'a célula de "Qtd. de itens" mostra as unidades, não o nº de linhas');
t.ok(!/<script>/.test(ctx.roCell('customer', { ...PEDIDO, customer: '<script>x</script>' })), 'o nome do cliente é escapado');

// ── Ordem salva velha não pode quebrar nem esconder coluna ──
m.roColOrder = ['channel', 'name', 'colunaQueNaoExisteMais'];
const remendada = ctx.roCols();
t.ok(!remendada.includes('colunaQueNaoExisteMais'), 'coluna salva que não existe mais é descartada');
t.eq(remendada.length, RO_DEFAULT_COLS.length, 'a tabela continua com todas as colunas');
t.eq(remendada[0], 'channel', 'a ordem escolhida é respeitada');
t.ok(remendada.includes('itemsQty'), 'coluna que nasceu depois da ordem salva entra no fim, em vez de sumir');
m.roColOrder = [...RO_DEFAULT_COLS];

// ── Ocultar: cinza enquanto se edita, some depois ──
// É o par que dá sentido ao recurso. Sumir nos DOIS modos deixaria a coluna inalcançável; ficar
// cinza nos dois faria "ocultar" não ocultar nada.
m.roHiddenCols = new Set(['customer']);
editando(true);
t.ok(ctx.roVisibleCols().includes('customer'), 'editando: a coluna oculta continua na tela pra poder voltar');
t.ok(/ro-col-off/.test(ctx.roCell('customer', PEDIDO)), 'editando: e vem apagada');
editando(false);
t.ok(!ctx.roVisibleCols().includes('customer'), 'fora da edição: a coluna oculta some de verdade');
t.eq(ctx.roVisibleCols().length, RO_DEFAULT_COLS.length - 1, 'e só ela some');
m.roHiddenCols = new Set();
t.eq(ctx.roVisibleCols().length, RO_DEFAULT_COLS.length, 'sem nada oculto, a tabela mostra tudo');

// ── Arrastar: a coluna inteira vira rastro tracejado, cabeçalho E células ──
// A primeira versão movia só o <th>. Numa <table> cabeçalho e corpo dividem as mesmas colunas, o
// corpo continuava na ordem antiga e nada se reorganizava na tela.
m.roDragKey = 'total';
t.ok(/ro-col-ghost/.test(ctx.roCell('total', PEDIDO)), 'a célula da coluna arrastada vira rastro');
t.ok(/ro-col-ghost/.test(ctx.roSummaryRow(RO_DEFAULT_COLS, 4, 500)), 'a linha de total também');
editando(true);
ctx.renderOrdersHead();
t.ok(/ro-col-ghost/.test(cabecalho.innerHTML), 'e o cabeçalho dela também');
m.roDragKey = null;

// ── A conta que decide a ordem nova ──
const abc = ['a','b','c','d'];
t.eq(ctx.roReordenar(abc, 'a', 2).join(''), 'bcad', 'arrastando pra direita, a coluna para no lugar apontado');
t.eq(ctx.roReordenar(abc, 'd', 0).join(''), 'dabc', 'arrastando pra esquerda também');
t.eq(ctx.roReordenar(abc, 'b', 1).join(''), 'abcd', 'soltar no mesmo lugar não muda nada');
t.eq(ctx.roReordenar(abc, 'a', 9).join(''), 'bcda', 'alvo além do fim não perde a coluna');
t.eq(ctx.roReordenar(abc, 'z', 1).join(''), 'abcd', 'coluna desconhecida não bagunça a lista');
// Arrastar uma coluna visível não pode embaralhar a ordem das ocultas, que não estão na tela.
m.roHiddenCols = new Set(['customer']);
// "Cliente" está oculta, então não aparece na lista que veio da tela: as outras seis, com "Valor"
// arrastada pra frente.
const completa = ctx.roOrdemCompleta(['total','name','createdAt','statusLabel','itemsQty','channel']);
t.eq(completa.length, RO_DEFAULT_COLS.length, 'a coluna oculta continua na ordem salva');
t.eq(completa.indexOf('customer'), completa.indexOf('createdAt') + 1, 'e volta pro lugar relativo que tinha');
t.eq(completa[0], 'total', 'e a coluna arrastada fica onde foi solta');
// Testar a função certa não basta: o arraste precisa CHAMAR ela. Gravando direto o resultado do
// roReordenar, as colunas ocultas caem todas pro fim da ordem e reaparecem fora de lugar quando
// alguém volta a mostrá-las.
const arraste = src.slice(src.indexOf('function roDragMove('), src.indexOf('function roReordenar('));
t.ok(/roOrdemCompleta\(roReordenar\(/.test(arraste), 'arrastar uma coluna visível não embaralha a ordem das ocultas');
m.roHiddenCols = new Set();

// ── A linha de total segue a coluna "Valor", onde quer que ela esteja ──
for (const cols of [RO_DEFAULT_COLS, ['channel','total','name'], ['total','name','channel']]) {
  const celulas = ctx.roSummaryRow(cols, 4, 500).match(/<td[^>]*>/g) || [];
  t.eq(celulas.length, cols.length, `total com ${cols.length} colunas: uma célula por coluna`);
  t.eq(celulas.findIndex(c => /ro-summary-val/.test(c)), cols.indexOf('total'), `total com ${cols.length} colunas: o valor cai embaixo de "Valor"`);
  t.ok(/ro-summary-label/.test(celulas.join('')), `total com ${cols.length} colunas: o rótulo continua na linha`);
}
t.ok(!/colspan/.test(ctx.roSummaryRow(RO_DEFAULT_COLS, 4, 500)), 'a linha de total não usa colspan');

// ── Cabeçalho montado ──
editando(true);
ctx.renderOrdersHead();
const th = cabecalho.innerHTML;
t.eq((th.match(/<th /g) || []).length, RO_DEFAULT_COLS.length, 'o cabeçalho tem uma célula por coluna');
t.ok(/Qtd\. de itens/.test(th), 'o cabeçalho mostra "Qtd. de itens"');
t.ok(/data-col="itemsQty"/.test(th), 'e a identifica');
t.eq((th.match(/ro-th-grip/g) || []).length, RO_DEFAULT_COLS.length, 'toda coluna tem alça de arrastar');
t.eq((th.match(/ro-th-eye/g) || []).length, RO_DEFAULT_COLS.length, 'e um botão de ocultar');
m.roHiddenCols = new Set(['customer']);
ctx.renderOrdersHead();
t.ok(/data-eye="customer"[^>]*Mostrar/.test(cabecalho.innerHTML), 'na coluna oculta o botão passa a oferecer mostrar');
m.roHiddenCols = new Set();
editando(false);

// ── Markup, ligações e CSS ──
const tela = fontePagina('index.html').tudo;
t.ok(/<thead id="ordersHead"><\/thead>/.test(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')),
  'o cabeçalho sai do montador, não do markup');
// A tabela muda de conteúdo entre os dois modos: sem remontar ao entrar/sair, a alça e o olho
// ficariam pra trás e a coluna oculta não sumiria.
const modo = src.slice(src.indexOf('function setEditMode('), src.indexOf("document.getElementById('editModeBtn')"));
t.ok(/renderOrdersPage/.test(modo), 'entrar e sair do modo de edição remonta a tabela');
// Gravar e ler são dois lados, e cada um some sozinho sem quebrar nada visível.
const gravador = src.slice(src.indexOf('function persistLayout()'), src.indexOf('function applyLayout()'));
const leitor = src.slice(src.indexOf('function applyLayout()'), src.indexOf('function resetLayout()'));
const redefinir = src.slice(src.indexOf('function resetLayout()'));
t.ok(/colOrder:\s*roColOrder/.test(gravador), 'a ordem escolhida é gravada junto do resto do layout');
t.ok(/colHidden:\s*\[\.\.\.roHiddenCols\]/.test(gravador), 'as colunas ocultas também');
t.ok(/saved\.colOrder/.test(leitor), 'a ordem é lida de volta ao abrir a página');
t.ok(/saved\.colHidden/.test(leitor), 'as ocultas também');
t.ok(/roColOrder = \[\.\.\.RO_DEFAULT_COLS\]/.test(redefinir), '"Redefinir" devolve a ordem de fábrica');
t.ok(/roHiddenCols = new Set\(\)/.test(redefinir), 'e mostra todas as colunas de novo');
// A última coluna visível não pode sumir: fora do modo de edição a tabela ficaria sem coluna
// nenhuma e ninguém adivinharia que o conserto está em "Editar".
t.ok(/roCols\(\)\.filter\(c => !roHiddenCols\.has\(c\)\)\.length <= 1/.test(tela), 'a última coluna visível não pode ser ocultada');

const css = fs.readFileSync(path.join(PUB, 'css', 'paginas', 'index.css'), 'utf8');
// A regra do celular escondia a 3ª e a 4ª coluna. Com a ordem editável isso passou a significar
// "o que estiver no 3º e no 4º lugar", que pode ser o número do pedido e o valor.
t.ok(!/\.tbl (th|td):nth-child/.test(css), 'o celular não esconde coluna por posição');
t.ok(/\.tbl th\[data-col="customer"\]/.test(css), 'esconde por identidade: Cliente');
t.ok(/\.tbl th\[data-col="statusLabel"\]/.test(css), 'esconde por identidade: Situação');
t.ok(/body\.edit-mode \.ro-th-grip\{[^}]*display:inline-flex/.test(css), 'a alça só aparece no modo de edição');
t.ok(/body\.edit-mode \.ro-th-eye\{[^}]*display:inline-flex/.test(css), 'o botão de ocultar também');
t.ok(/\.ro-col-off\{[^}]*opacity/.test(css), 'a coluna oculta fica apagada enquanto se edita');
t.ok(/\.ro-col-ghost/.test(css), 'a coluna arrastada tem o próprio rastro');
t.ok(/\.ro-col-floating\{[^}]*position:fixed/.test(css), 'e uma etiqueta que segue o cursor');

t.fim();
