// Guarda o TikTok Shop lido pelo Bling (src/tiktok.js + syncTiktok em src/sync.js), e as duas
// correções da bonificação que vieram junto, aprendidas no quadro de pedidos.
//
// O que quebra em silêncio aqui:
//   1. situação que ninguém decidiu passando a contar como venda (ou cancelado contando);
//   2. a mesma unidade contada duas vezes: como venda pelo pedido e como doação pela nota;
//   3. o cursor andando depois de uma leitura incompleta, perdendo pedido pra sempre;
//   4. a doação cancelada depois de capturada ficando contada, porque a listagem de notas esconde
//      nota cancelada;
//   5. o filtro de alteração escrito em UTC, que o Bling aceita e responde com lista vazia.
//
// Não faz rede e não toca no banco.
import path from 'node:path';
import { criarTeste, ler, ROOT } from './_lib.mjs';

const t = criarTeste('TikTok Shop pelo Bling');
const { TIKTOK_LOJA_ID, classificarSituacao, pedidoDoTiktok, dataBlingParaISO } =
  await import('file:///' + path.join(ROOT, 'src/tiktok.js').replace(/\\/g, '/'));

// ── 1. Situação ──
for (const [nome, tipo] of [
  ['Em aberto', 'venda'], ['Atendido', 'venda'], ['Em andamento', 'venda'], ['Aguardando Coleta', 'venda'],
  ['Cancelado', 'cancelado'], ['Em devolução', 'devolvido'], ['Devolvido', 'devolvido'],
  ['Em digitação', null], ['Venda Agenciada', null], ['', null], [undefined, null],
]) t.eq(classificarSituacao(nome), tipo, `"${nome}" → ${tipo === null ? 'não conta (desconhecida)' : tipo}`);
t.eq(classificarSituacao('EM ABERTO'), 'venda', 'maiúscula e acento não mudam a decisão');

// ── Datas do Bling: horário de Brasília, sem fuso escrito ──
t.eq(dataBlingParaISO('2026-09-18'), '2026-09-18T03:00:00.000Z', 'pedido traz só o dia: começa à meia-noite de Brasília');
t.eq(dataBlingParaISO('2026-09-30 22:30:00'), '2026-10-01T01:30:00.000Z', 'nota da noite fica no dia certo (e no mês certo)');
t.eq(dataBlingParaISO('0000-00-00'), null, '"0000-00-00" é ausência de data');

// ── 2. Pedido → formato da dashboard ──
const SIT = { 6: 'Em aberto', 9: 'Atendido', 12: 'Cancelado', 99: 'Em devolução', 77: 'Situação nova' };
const base = {
  id: 555, numero: 1482, numeroLoja: '5781234', data: '2026-09-18', total: 139.8,
  loja: { id: Number(TIKTOK_LOJA_ID) }, situacao: { id: 9 }, notaFiscal: { id: 0 },
  contato: { nome: 'Cliente' }, transporte: { etiqueta: { uf: 'sp' } },
  itens: [
    { codigo: 'LIS-120', descricao: 'Lisina para gatos 120g', quantidade: 2, valor: 59.9 },
    { codigo: 'X', descricao: 'Brinde', quantidade: 0, valor: 0 },
  ],
};
const { pedido } = pedidoDoTiktok(base, { situacoes: SIT });
t.eq(pedido.id, 'tiktok:555', 'id próprio do canal');
t.eq(pedido.channel, 'tiktok', 'canal tiktok');
t.eq(pedido.market, 'br', 'mercado Brasil');
t.eq(pedido.cancelled, false, 'situação de venda conta');
t.eq(pedido.status, 'PAID', 'e vira o status que as telas já rotulam como Autorizado');
t.eq(pedido.total, 139.8, 'total do pedido');
t.eq(pedido.items.length, 1, 'item com quantidade zero não entra');
t.eq(pedido.items[0].qty, 2, 'quantidade do item');
t.eq(pedido.items[0].amount, 119.8, 'receita do item = preço × unidades');
t.eq(pedido.state, 'SP', 'estado de entrega, em maiúscula');
t.eq(pedido.name, '#5781234', 'o número que aparece é o do TikTok');

const canc = pedidoDoTiktok({ ...base, situacao: { id: 12 } }, { situacoes: SIT }).pedido;
t.ok(canc.cancelled && canc.status === 'CANCELLED', 'cancelado não conta');
const nova = pedidoDoTiktok({ ...base, situacao: { id: 77 } }, { situacoes: SIT }).pedido;
t.ok(nova.cancelled, 'situação que ninguém decidiu NÃO conta como venda');
t.eq(nova.status, 'PENDING', 'e aparece como "Em aberto", não como cancelado');
const semNome = pedidoDoTiktok({ ...base, situacao: { id: 4040 } }, { situacoes: SIT }).pedido;
t.ok(semNome.cancelled, 'situação sem nome conhecido também não conta');
const dev = pedidoDoTiktok({ ...base, situacao: { id: 99 } }, { situacoes: SIT }).pedido;
t.ok(!dev.cancelled && dev.refunded === 'total', 'devolvido continua sendo pedido, marcado como reembolsado');
t.eq(dev.refundedQty, 2, 'e as unidades saem da quantidade vendida');
t.eq(dev.refundedTotal, 139.8, 'e o dinheiro sai da receita');

// ── A mesma unidade não entra duas vezes ──
t.eq(pedidoDoTiktok({ ...base, notaFiscal: { id: 8001 } }, { situacoes: SIT, notasBonificacao: new Set(['8001']) }).pular, 'bonificacao',
  'pedido cuja nota é de bonificação não é venda (a nota já conta a unidade como doação)');
t.ok(pedidoDoTiktok({ ...base, notaFiscal: { id: 8002 } }, { situacoes: SIT, notasBonificacao: new Set(['8001']) }).pedido, 'nota de venda comum segue como venda');
t.eq(pedidoDoTiktok({ ...base, loja: { id: 205370623 } }, { situacoes: SIT }).pular, 'outro canal',
  'pedido de outro canal nunca vira pedido do TikTok (a API dele já traz, seria venda duplicada)');

// ── 3. O sync ──
const semComentario = txt => txt.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const SYNC = semComentario(ler('src/sync.js'));
const fn = SYNC.slice(SYNC.indexOf('export async function syncTiktok'), SYNC.indexOf('export function classificarReembolsoShopee') > 0 ? SYNC.indexOf('export function classificarReembolsoShopee') : SYNC.indexOf('function classificarReembolsoShopee'));
t.ok(/isIntegrationEnabled\('tiktok_shop'\)/.test(fn), 'desligar a integração na tela para a captura');
t.ok(/String\(p\.loja\?\.id\) === TIKTOK_LOJA_ID/.test(fn), 'só pedido do canal do TikTok é lido a fundo');
t.ok(/out\.completa = !lista\.incompleta && !faltou;\s*if \(out\.completa\) setTiktokCursor/.test(fn), 'o cursor só anda com a leitura inteira');
t.ok(/faltou = true;\s*out\.errors\.push\('tiktok\.pedido/.test(fn), 'detalhe que falhou segura o cursor e aparece no relatório');
t.ok(/if \(detalhes >= TIKTOK_DETALHES_MAX\) \{ faltou = true; break; \}/.test(fn), 'pedido que ficou pra próxima rodada também segura o cursor');
t.ok(/alteradosDesde: bling\.momentoNoBling\(/.test(fn), 'o filtro de alteração vai no horário de São Paulo, nunca em UTC');
t.ok(/notasBonificacao\.has\(String\(o\.notaFiscalId\)\)\) retirar\.push/.test(fn), 'pedido já gravado cuja nota virou doação depois é retirado');
t.ok(/situacaoBlingId\) === String\(p\.situacao\?\.id\)/.test(fn), 'pedido gravado sem mudança não custa outra chamada');
const run = SYNC.slice(SYNC.indexOf('export async function runSync'));
t.ok(run.indexOf('syncBonificacoes()') < run.indexOf('syncTiktok()') && run.indexOf('syncTiktok()') < run.indexOf('podarPedidosAntigos()'),
  'o TikTok roda depois da bonificação (precisa saber quais notas são doação) e antes da poda');

const BLING = semComentario(ler('src/bling.js'));
t.ok(/timeZone: 'America\/Sao_Paulo'/.test(BLING), 'momentoNoBling usa o relógio de São Paulo');
t.ok(/if \(Object\.keys\(mapa\)\.length\) situacoesVenda = mapa;/.test(BLING), 'lista de situações vazia não fica guardada');

// ── 4. Doação cancelada depois de capturada ──
const boni = SYNC.slice(SYNC.indexOf('export async function syncBonificacoes'), SYNC.indexOf('export async function syncTiktok'));
t.ok(/if \(!r\.incompleta\) \{/.test(boni), 'só confere ausência com a listagem completa');
t.ok(/\.filter\(o => o\.createdAt >= borda && !r\.listadas\.has\(o\.id\.replace\('bonificacao:', ''\)\)\)/.test(boni),
  'confere a doação gravada, dentro da janela, que a listagem deixou de trazer');
t.ok(/if \(situacao != null && !bling\.notaSaiu\(situacao\)\) retirar\.push/.test(boni), 'e retira só se a nota, perguntada uma a uma, não saiu mais');
t.ok(/removerPedidos\(retirar\)/.test(boni), 'retirando de verdade');

// ── 5. As telas conhecem o canal ──
t.ok(/tiktok: \s*\{ bg: '#FE2C55', label: 'TikTok Shop', \s*market: 'br'/.test(ler('public/js/colors.js')), 'TikTok Shop no catálogo de canais');
t.ok(/tiktok:\s*\['PENDING'\]/.test(ler('src/store.js')) && /tiktok:\s*\['PENDING'\]/.test(ler('public/js/paginas/index.js')),
  'situação desconhecida aparece "Em aberto" no servidor e na tela');
t.ok(/'tiktok_shop'/.test(ler('server.js').slice(ler('server.js').indexOf('const TOGGLEABLE_KEYS'))), 'TikTok Shop tem liga/desliga em Integrações');

// ── A sonda não expõe cliente ──
const probe = BLING.slice(BLING.indexOf('export async function probeTiktok'), BLING.indexOf('export const KNOWN_CHANNELS'));
t.ok(/const \{ customer, \.\.\.semCliente \} = r\.pedido;\s*amostra\.push\(semCliente\)/.test(probe), 'a sonda tira o nome do cliente da amostra');
t.ok(/esqueletoBling\(d\)/.test(probe), 'e o detalhe cru só sai mascarado');

t.fim();
