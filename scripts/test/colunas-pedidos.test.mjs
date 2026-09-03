// Colunas do card "Pedidos recentes" (index.html).
//
// A tabela deixou de ter as colunas escritas à mão no markup: cabeçalho, células e linha de total
// são montados a partir de UMA lista (RO_COLUMNS/roCols), porque a ordem virou algo que o usuário
// arrasta no modo de edição. Escrito à mão, o cabeçalho diria "Cliente" com o valor do canal
// embaixo, e a tabela continuaria desenhando normalmente — erro que não dá erro.
//
// Por isso as funções são EXECUTADAS aqui, contra pedidos falsos, em vez de conferidas por texto.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, PUB, fontePagina } from './_lib.mjs';

const t = criarTeste('Colunas de "Pedidos recentes"');

const src = fs.readFileSync(path.join(PUB, 'js', 'paginas', 'index.js'), 'utf8');
const ini = src.indexOf('const RO_COLUMNS');
const fim = src.indexOf('function renderOrdersPage()');
t.ok(ini >= 0 && fim > ini, 'achou o bloco das colunas');

// Dublês do que o bloco usa de fora. `document` é só o suficiente pro renderOrdersHead escrever.
const cabecalho = { innerHTML: '' };
const ctx = {
  console,
  escapeHtml: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])),
  statusTag: o => ({ cls: o.cancelled ? 'canc' : 'ok', label: o.cancelled ? 'Cancelado' : 'Autorizado' }),
  fmtMoney: (v) => 'R$ ' + Number(v).toFixed(2),
  CocoColors: { chBadgeHTML: c => `<span class="badge">${c}</span>`, ch: { amazon: { label: 'Amazon BR' } } },
  EXPORT_COLUMN_DEFS: {
    name: 'Pedido', createdAt: 'Data/Hora da compra', customer: 'Cliente',
    statusLabel: 'Situação', total: 'Valor', channel: 'Canal',
    products: 'Produto(s) da compra', itemsCount: 'Nº de produtos', itemsQty: 'Qtd. de itens',
  },
  _roMode: 'recent',
  _roIsAllCh: true,
  document: { getElementById: id => (id === 'ordersHead' ? cabecalho : null) },
};
vm.createContext(ctx);
// `const`/`let` no topo de um script do vm não viram propriedade do contexto (só `function` e
// `var` viram), então o bloco leva um epílogo que entrega o modelo e dá acesso de escrita à ordem.
vm.runInContext(src.slice(ini, fim) + `
globalThis.modelo = { RO_COLUMNS, RO_DEFAULT_COLS,
  get roColOrder() { return roColOrder; }, set roColOrder(v) { roColOrder = v; } };`, ctx);
const { RO_COLUMNS, RO_DEFAULT_COLS } = ctx.modelo;

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
  const celula = RO_COLUMNS[k](PEDIDO);
  t.ok(new RegExp(`data-col="${k}"`).test(celula), `a célula de "${k}" carrega o próprio data-col`);
}
t.ok(/>3</.test(RO_COLUMNS.itemsQty(PEDIDO)), 'a célula de "Qtd. de itens" mostra as unidades, não o nº de linhas');
// Cliente vem de fora e vai pra dentro de HTML: escapar é obrigatório.
t.ok(!/<script>/.test(RO_COLUMNS.customer({ ...PEDIDO, customer: '<script>x</script>' })),
  'o nome do cliente é escapado');

// ── Ordem salva velha não pode quebrar nem esconder coluna ──
ctx.modelo.roColOrder = ['channel', 'name', 'colunaQueNaoExisteMais'];
const remendada = ctx.roCols();
t.ok(!remendada.includes('colunaQueNaoExisteMais'), 'coluna salva que não existe mais é descartada');
t.eq(remendada.length, RO_DEFAULT_COLS.length, 'a tabela continua com todas as colunas');
t.eq(remendada[0], 'channel', 'a ordem escolhida é respeitada');
t.ok(remendada.includes('itemsQty'), 'coluna que nasceu depois da ordem salva entra no fim, em vez de sumir');

// ── A linha de total segue a coluna "Valor", onde quer que ela esteja ──
function posicaoDoValor(cols) {
  const linha = ctx.roSummaryRow(cols, 4, 500);
  const celulas = linha.match(/<td[^>]*>/g) || [];
  return { celulas, iValor: celulas.findIndex(c => /ro-summary-val/.test(c)) };
}
for (const cols of [
  RO_DEFAULT_COLS,
  ['channel', 'total', 'name'],
  ['total', 'name', 'channel'],      // "Valor" arrastado pra primeira coluna
]) {
  const { celulas, iValor } = posicaoDoValor(cols);
  t.eq(celulas.length, cols.length, `total com ${cols.length} colunas: uma célula por coluna`);
  t.eq(iValor, cols.indexOf('total'), `total com ${cols.length} colunas: o valor cai embaixo de "Valor"`);
  t.ok(/ro-summary-label/.test(celulas.join('')), `total com ${cols.length} colunas: o rótulo continua na linha`);
}
// Sem colspan: era ele que deixava o total embaixo da coluna errada assim que a ordem mudava.
t.ok(!/colspan/.test(ctx.roSummaryRow(RO_DEFAULT_COLS, 4, 500)), 'a linha de total não usa colspan');

// ── Cabeçalho montado: rótulo, identidade e alça ──
ctx.modelo.roColOrder = [...RO_DEFAULT_COLS];
ctx.renderOrdersHead();
const th = cabecalho.innerHTML;
t.eq((th.match(/<th /g) || []).length, RO_DEFAULT_COLS.length, 'o cabeçalho tem uma célula por coluna');
t.ok(/Qtd\. de itens/.test(th), 'o cabeçalho mostra "Qtd. de itens"');
t.ok(/data-col="itemsQty"/.test(th), 'e a identifica');
t.ok((th.match(/ro-th-grip/g) || []).length === RO_DEFAULT_COLS.length, 'toda coluna tem alça de arrastar');

// ── Markup e CSS: o que sustenta o arraste ──
const tela = fontePagina('index.html').tudo;
t.ok(/<thead id="ordersHead"><\/thead>/.test(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')),
  'o cabeçalho sai do montador, não do markup');
t.ok(/makeDragController\(document\.getElementById\('ordersHead'\)/.test(tela),
  'as colunas usam o mesmo controlador de arraste dos cards');
t.ok(/horizontal:\s*true/.test(tela), 'e ele sabe que aqui o arraste é horizontal');
// O placeholder é inserido dentro de um <tr>: um <div> ali é expulso da tabela pelo navegador.
t.ok(/createElement\(ecDragItem\.tagName\)/.test(tela), 'o placeholder nasce com a mesma tag do item arrastado');
// Só o [data-col] entra na ordem salva — o placeholder também é um <th>.
t.ok(/#ordersHead th\[data-col\]/.test(tela), 'o placeholder não entra na ordem salva');
// Gravar e ler são DOIS lados, e cada um some sozinho sem quebrar nada visível: sem gravar, a
// ordem escolhida se perde no recarregamento; sem ler, ela nunca volta. Procurar `colOrder` no
// arquivo inteiro dava por bom com só um dos dois presente.
const gravador = src.slice(src.indexOf('function persistLayout()'), src.indexOf('function applyLayout()'));
const leitor = src.slice(src.indexOf('function applyLayout()'), src.indexOf('function resetLayout()'));
t.ok(/colOrder:\s*roColOrder/.test(gravador), 'a ordem escolhida é gravada junto do resto do layout');
t.ok(/saved\.colOrder/.test(leitor), 'e é lida de volta ao abrir a página');
t.ok(/roColOrder = \[\.\.\.RO_DEFAULT_COLS\]/.test(src.slice(src.indexOf('function resetLayout()'))),
  '"Redefinir" devolve a ordem de fábrica das colunas');

const css = fs.readFileSync(path.join(PUB, 'css', 'paginas', 'index.css'), 'utf8');
// A regra do celular escondia a 3ª e a 4ª coluna. Com a ordem editável isso passou a significar
// "o que estiver no 3º e no 4º lugar", que pode ser o número do pedido e o valor.
t.ok(!/\.tbl (th|td):nth-child/.test(css), 'o celular não esconde coluna por posição');
t.ok(/\.tbl th\[data-col="customer"\]/.test(css), 'esconde por identidade: Cliente');
t.ok(/\.tbl th\[data-col="statusLabel"\]/.test(css), 'esconde por identidade: Situação');
t.ok(/body\.edit-mode \.ro-th-grip\{[^}]*display:inline-flex/.test(css), 'a alça só aparece no modo de edição');

t.fim();
