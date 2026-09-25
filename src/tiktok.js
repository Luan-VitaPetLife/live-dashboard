// TikTok Shop, lido pelo Bling (pedido de venda do canal do TikTok). Puro: nenhum I/O, pra o teste
// executar a regra de verdade. Quem busca é src/bling.js e quem grava é src/sync.js.
//
// Por que pelo Bling e não pela API do TikTok: o cadastro de desenvolvedor da TikTok Shop exige
// gerente de conta designado, que a conta não tem. O quadro de pedidos (projeto irmão) já recebe o
// TikTok assim, e a dashboard usa o mesmo caminho (decisão do Luan, 22/09/2026).
//
// As duas marcas (Coco and Luna e Yucaloo) vendem pelo MESMO canal do TikTok no Bling. Na
// dashboard isso é um canal só, "TikTok Shop", do mesmo jeito que Shopee e Mercado Livre já
// mostram as duas marcas juntas: o que separa marca aqui é só a loja Shopify.

// O canal do TikTok no Bling. Os outros três ids de TikTok da conta estão desativados.
export const TIKTOK_LOJA_ID = '206279174';

// ── Situação do pedido no Bling → o que ele é pra dashboard ──
// A situação chega como ID, e o NOME vem de /situacoes/modulos/98310 (módulo de Vendas). A conta
// tem situações próprias além das de fábrica ("Aguardando Coleta", "Em devolução"), então a regra
// compara NOME, não id, pelo mesmo motivo da natureza de operação: id é interno da conta.
//
// VENDA é allowlist positiva. Pedido do TikTok só chega no Bling depois de PAGO (o TikTok libera o
// pedido pro vendedor já pago, pra enviar), então as situações de trabalho do dia a dia contam como
// venda. Situação que a lista não conhece NÃO conta e volta no relatório do sync: contar sozinha uma
// situação nova quebraria a regra mais importante do projeto, "só pedido pago conta como venda".
// Conferir contra a sonda (GET /api/bling/probe-tiktok) depois dos primeiros dias.
const VENDA = [
  'em aberto', 'em andamento', 'atendido', 'verificado', 'aguardando coleta',
  'em separacao', 'separado', 'faturado', 'pronto para envio', 'enviado', 'entregue', 'em transito',
];

export function normalizar(txt) {
  return String(txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// 'venda' | 'cancelado' | 'devolvido' | null (desconhecida)
export function classificarSituacao(nome) {
  const n = normalizar(nome);
  if (!n) return null;
  // Cancelado e devolvido vêm ANTES da lista de venda: "Em devolução" contém "em", e nenhuma
  // palavra de venda pode ganhar de um cancelamento.
  if (/cancel/.test(n)) return 'cancelado';
  if (/devolu|devolvid|reembols|estorn/.test(n)) return 'devolvido';
  if (VENDA.includes(n)) return 'venda';
  return null;
}

// Data do Bling pra ISO. O pedido traz só o DIA ("2026-09-18"); a nota traz dia e hora
// ("2026-09-18 14:22:05"). As duas são horário de Brasília e chegam sem fuso: sem o -03:00, o
// pedido do fim da noite cairia no dia seguinte e mudaria de mês na virada.
export function dataBlingParaISO(s) {
  const t = String(s || '').trim();
  if (!t || t.startsWith('0000')) return null;
  const comHora = /^\d{4}-\d{2}-\d{2}$/.test(t) ? t + 'T00:00:00' : t.replace(' ', 'T');
  const d = new Date(comHora + '-03:00');
  return isNaN(d) ? null : d.toISOString();
}

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Detalhe do pedido de venda do Bling → pedido normalizado da dashboard (formato da seção 5 do
// CLAUDE.md). Devolve { pedido } ou { pular: motivo }.
//
//   situacoes           { [id]: nome } do módulo de Vendas
//   notasBonificacao    Set com o id das notas "Saída em bonificação" já conhecidas
//
// Pedido cuja NOTA é de bonificação não é venda: é uma doação que passou por pedido (amostra pra
// criador de conteúdo pelo próprio TikTok, por exemplo). Ela já é contada como doação pela nota
// (fetchBonificacoes), e contar o pedido também seria a mesma unidade duas vezes, uma delas como
// venda. O quadro de pedidos já trata a bonificação assim: pela nota, mesmo com pedido junto.
export function pedidoDoTiktok(d, { situacoes = {}, notasBonificacao = new Set() } = {}) {
  if (!d || d.id == null) return { pular: 'sem id' };
  if (String(d.loja?.id) !== TIKTOK_LOJA_ID) return { pular: 'outro canal' };
  const notaId = d.notaFiscal?.id != null && String(d.notaFiscal.id) !== '0' ? String(d.notaFiscal.id) : null;
  if (notaId && notasBonificacao.has(notaId)) return { pular: 'bonificacao' };

  const createdAt = dataBlingParaISO(d.data);
  if (!createdAt) return { pular: 'sem data' };

  const situacaoNome = situacoes[String(d.situacao?.id)] || null;
  const tipo = classificarSituacao(situacaoNome);

  const items = (Array.isArray(d.itens) ? d.itens : []).map(it => {
    const qty = num(it.quantidade);
    return {
      title:  String(it.descricao || it.codigo || 'Sem nome').trim(),
      sku:    it.codigo ? String(it.codigo) : null,
      qty,
      // Preço de tabela × unidades. O desconto e o frete ficam no total do pedido, e é o
      // itemRevFactor (metrics.js) que escala a receita dos itens pro total de verdade.
      amount: Math.round(num(it.valor) * qty * 100) / 100,
    };
  }).filter(it => it.qty > 0);

  const total = Math.round(num(d.total) * 100) / 100;
  const unidades = items.reduce((s, it) => s + it.qty, 0);

  const pedido = {
    id:        'tiktok:' + d.id,
    channel:   'tiktok',
    market:    'br',
    name:      '#' + (d.numeroLoja || d.numero || d.id),
    createdAt,
    // O status é traduzido pro vocabulário que as telas já conhecem (statusLabelPt/statusTag):
    // assim nenhuma tela precisa aprender o nome das situações do Bling. O nome original fica em
    // `situacaoBling`, pra sonda e pra quem for investigar.
    status:    tipo === 'venda' ? 'PAID' : tipo === 'devolvido' ? 'REFUNDED' : tipo === 'cancelado' ? 'CANCELLED' : 'PENDING',
    situacaoBling: situacaoNome,
    // Situação desconhecida não conta como venda: sai de tudo como um pedido ainda não pago
    // ("Em aberto" na tela, pela UNPAID_STATUS_BY_CHANNEL do canal).
    cancelled: tipo === 'cancelado' || tipo === null,
    total,
    source:    'TikTok Shop',
    customer:  d.contato?.nome || '',
    state:     d.transporte?.etiqueta?.uf ? String(d.transporte.etiqueta.uf).toUpperCase() : null,
    // Cidade/CEP: pro mapa de calor (localizacao.js). Rua e número ficam de fora.
    city:      d.transporte?.etiqueta?.municipio ? String(d.transporte.etiqueta.municipio).trim() : null,
    zip:       d.transporte?.etiqueta?.cep ? String(d.transporte.etiqueta.cep).trim() : null,
    listingType: null,
    notaFiscalId: notaId,
    items,
  };
  // Devolução inteira: a unidade sai da quantidade vendida e o dinheiro sai da receita, pelo
  // mesmo pedidoLiquido de todos os canais. O Bling não diz devolução parcial por situação.
  if (tipo === 'devolvido') {
    pedido.refunded = 'total';
    pedido.refundedQty = unidades;
    pedido.refundedTotal = total;
  }
  return { pedido };
}
