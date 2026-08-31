// O rótulo de status de um pedido é escrito DUAS vezes: `statusLabelPt` (src/metrics.js), que
// alimenta a busca de pedidos, e `statusTag` (js/paginas/index.js), que desenha a tag em "Pedidos
// recentes". As duas precisam dizer a mesma coisa — buscar por "reembolsado" tem que achar os
// pedidos que a tela marca como reembolsados.
//
// Duas cópias do mesmo vocabulário é exatamente o que diverge sem ninguém ver, então aqui as duas
// são EXECUTADAS contra a mesma lista de casos e comparadas uma com a outra.
//
// O caso que originou o teste: um pedido devolvido (REFUNDED) caía no "Em aberto" do fim das duas
// funções, e a tela dizia que o cliente ainda não tinha pagado — o oposto do que aconteceu.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, PUB, ROOT } from './_lib.mjs';

const t = criarTeste('Rótulo de status do pedido');

// Não importa metrics.js: ele puxa store.js junto, e nenhum teste toca no banco. Roda o texto
// das duas funções num contexto com a tabela de status não pago dublada.
const UNPAID = {
  amazon: ['Pending', 'PendingAvailability'],
  amazon_us: ['Pending', 'PendingAvailability'],
  shopify: ['PENDING', 'AUTHORIZED'],
  shopify_us: ['PENDING', 'AUTHORIZED'],
  mercadolivre: ['confirmed', 'payment_required', 'payment_in_process'],
};

function carregar(arquivo, nomeFn) {
  const src = fs.readFileSync(arquivo, 'utf8');
  const i = src.indexOf(`function ${nomeFn}(`);
  if (i < 0) return null;
  let prof = 0, fim = i;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const ctx = { UNPAID_STATUS_BY_CHANNEL: UNPAID, console };
  vm.createContext(ctx);
  vm.runInContext(src.slice(i, fim), ctx);
  return ctx[nomeFn];
}

const doServidor = carregar(path.join(ROOT, 'src', 'metrics.js'), 'statusLabelPt');
const daTela = carregar(path.join(PUB, 'js', 'paginas', 'index.js'), 'statusTag');
t.ok(typeof doServidor === 'function', 'achou statusLabelPt em metrics.js');
t.ok(typeof daTela === 'function', 'achou statusTag em index.js');

if (typeof doServidor === 'function' && typeof daTela === 'function') {
  const casos = [
    // [pedido, rótulo esperado]
    [{ channel: 'shopify', status: 'REFUNDED', cancelled: false }, 'Reembolsado'],
    [{ channel: 'shopify', status: 'PARTIALLY_REFUNDED', cancelled: false }, 'Reembolso parcial'],
    [{ channel: 'shopify', status: 'PAID', cancelled: false }, 'Autorizado'],
    [{ channel: 'shopify', status: 'PARTIALLY_PAID', cancelled: false }, 'Em aberto'],
    [{ channel: 'amazon', status: 'Shipped', cancelled: false }, 'Autorizado'],
    // Não pago não é cancelamento: rótulo próprio pra não alarmar à toa.
    [{ channel: 'amazon', status: 'Pending', cancelled: true }, 'Em aberto'],
    [{ channel: 'shopify', status: 'AUTHORIZED', cancelled: true }, 'Em aberto'],
    [{ channel: 'shopify', status: 'EXPIRED', cancelled: true }, 'Cancelado'],
    [{ channel: 'amazon', status: 'Canceled', cancelled: true }, 'Cancelado'],
    [{ channel: 'shopee', status: 'CANCELLED', cancelled: true }, 'Cancelado'],
    [{ channel: 'mercadolivre', status: 'confirmed', cancelled: true }, 'Em aberto'],
    [{ channel: 'shopify', status: '', cancelled: false }, 'Em aberto'],
  ];

  for (const [pedido, esperado] of casos) {
    const como = `${pedido.channel}/${pedido.status || '(vazio)'}`;
    t.eq(doServidor(pedido), esperado, `servidor: ${como}`);
    t.eq(daTela(pedido).label, esperado, `tela: ${como}`);
  }

  // O que este teste existe pra impedir: as duas divergirem.
  const divergentes = casos.filter(([p]) => doServidor(p) !== daTela(p).label);
  t.eq(divergentes.length, 0, 'servidor e tela dão o mesmo rótulo em todos os casos');

  // Devolvido não pode cair no balde de "ainda não pagou".
  t.ok(doServidor({ channel: 'shopify', status: 'REFUNDED', cancelled: false }) !== 'Em aberto',
    'REFUNDED não é tratado como pagamento pendente');
}

// A tag precisa de uma cor própria: nem o verde de autorizado, nem o vermelho de cancelado.
const css = fs.readFileSync(path.join(PUB, 'css', 'paginas', 'index.css'), 'utf8');
const classes = [...(fs.readFileSync(path.join(PUB, 'js', 'paginas', 'index.js'), 'utf8')
  .matchAll(/cls\s*:\s*'([a-z]+)'/g))].map(m => m[1]);
for (const c of [...new Set(classes)]) {
  t.ok(new RegExp(`\\.st-tag\\.${c}\\{`).test(css), `.st-tag.${c} tem estilo declarado`);
}

t.fim();
