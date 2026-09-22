// Guarda a janela de histórico: 90 dias, em todo canal, nos dois mercados (src/retencao.js).
//
// Os erros daqui não dão erro nenhum, só apagam coisa demais ou de menos. Apagar demais tira
// venda real da tela sem aviso; apagar de menos desfaz a economia de memória que é a razão da
// regra existir. E há um terceiro, mais escondido: memória e banco cortarem em pontos diferentes,
// o que faz a tela mudar sozinha depois de um reinício.
//
// Não faz rede e não toca no banco: executa a regra pura e lê o texto de store.js/sync.js.
import path from 'node:path';
import { criarTeste, ler, ROOT } from './_lib.mjs';

const t = criarTeste('janela de histórico de 90 dias');
delete process.env.PEDIDOS_RETENCAO_DIAS;
const { RETENCAO_DIAS, corteDaRetencao, foraDaJanela, diasForaDaJanela } =
  await import('file:///' + path.join(ROOT, 'src/retencao.js').replace(/\\/g, '/'));

t.eq(RETENCAO_DIAS, 90, 'a janela padrão é de 90 dias');

// ── O corte ──
const AGORA = Date.parse('2026-09-22T15:30:00Z');
const corte = corteDaRetencao(AGORA);
t.eq(corte, '2026-06-23T00:00:00.000Z', 'corte = meia-noite UTC de 91 dias atrás (90 + 1 de folga pro fuso)');
// Mesmo dia, horas diferentes: o corte não pode andar ao longo do dia, senão cada sync apagaria um
// pedaço diferente do dia da beira.
t.eq(corteDaRetencao(Date.parse('2026-09-22T00:00:01Z')), corte, 'o corte é o mesmo no começo do dia');
t.eq(corteDaRetencao(Date.parse('2026-09-22T23:59:59Z')), corte, 'e no fim do dia');
t.eq(corteDaRetencao(Date.parse('2026-09-23T10:00:00Z')), '2026-06-24T00:00:00.000Z', 'no dia seguinte o corte anda exatamente um dia');
t.eq(corteDaRetencao(Date.parse('2027-01-15T12:00:00Z')), '2026-10-16T00:00:00.000Z', 'e atravessa a virada de ano');

// ── O que sai ──
t.ok(foraDaJanela({ createdAt: '2026-06-22T23:59:59Z' }, corte), 'pedido anterior ao corte sai');
t.ok(!foraDaJanela({ createdAt: '2026-06-23T00:00:00Z' }, corte), 'pedido no instante do corte fica');
t.ok(!foraDaJanela({ createdAt: '2026-09-22T10:00:00Z' }, corte), 'pedido de hoje fica');
// "90 dias atrás" na hora do Brasil já é 03:00 UTC: o dia da beira precisa estar inteiro.
t.ok(!foraDaJanela({ createdAt: '2026-06-24T02:59:00Z' }, corte), 'o primeiro dia da janela fica inteiro, no fuso do Brasil');
t.ok(!foraDaJanela({ createdAt: '2026-06-24T06:00:00Z' }, corte), 'e no fuso dos EUA');
for (const semData of [{}, { createdAt: null }, { createdAt: '' }, null]) {
  t.ok(!foraDaJanela(semData, corte), `pedido sem data não é apagado no escuro (${JSON.stringify(semData)})`);
}
// A regra não olha canal nem mercado: é o pedido do Luan, "todos os canais".
for (const channel of ['shopify', 'shopify_us', 'yucaloo_br', 'yucaloo_us', 'shopee', 'mercadolivre', 'amazon', 'amazon_us', 'bonificacao']) {
  t.ok(foraDaJanela({ channel, createdAt: '2026-01-01T00:00:00Z' }, corte), `pedido antigo de ${channel} sai`);
}

// ── Séries diárias ──
const serie = { '2026-06-22': 1, '2026-06-23': 1, 'us:2026-06-22': 1, 'us:2026-06-23': 1, '2026-09-22': 1, config: 1 };
const velhos = diasForaDaJanela(serie, corte).sort();
t.eq(JSON.stringify(velhos), JSON.stringify(['2026-06-22', 'us:2026-06-22']), 'saem os dias antigos dos dois mercados, inclusive a chave "us:" das sessões');
t.eq(diasForaDaJanela(undefined, corte).length, 0, 'série que não existe não quebra');

// ── Memória e banco cortam no MESMO ponto ──
const semComentario = txt => txt.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const STORE = semComentario(ler('src/store.js'));
const init = STORE.slice(STORE.indexOf('export async function initStore'), STORE.indexOf('// ── Fallback JSON'));
t.ok(/FROM orders WHERE data->>'createdAt' IS NULL OR data->>'createdAt' = '' OR data->>'createdAt' >= \$1/.test(init),
  'o servidor só carrega pra memória o que está dentro da janela');
t.ok(/\[corteDaRetencao\(\)\]/.test(init), 'com o corte da regra, não um número próprio');
t.ok(!/SELECT id, data FROM orders'\)/.test(init), 'e não voltou a ler a tabela inteira');

const poda = STORE.slice(STORE.indexOf('async function pgPodarPedidos'), STORE.indexOf('export function getFullSnapshot'));
t.ok(/DELETE FROM orders WHERE id IN \(\s*SELECT id FROM orders WHERE data->>'createdAt' <> '' AND data->>'createdAt' < \$1 LIMIT/.test(poda),
  'o banco apaga pela condição oposta exata à da leitura');
// Um DELETE de dezenas de milhares de linhas num comando só gera um pico de escrita que já encheu o
// disco do Postgres uma vez.
t.ok(/for \(;;\)[\s\S]*await pool\.query[\s\S]*if \(r\.rowCount < PODA_LOTE\) break/.test(poda), 'o banco apaga em lotes, um de cada vez');
t.ok(/DELETE FROM sessions_daily WHERE right\(date, 10\) < \$1/.test(poda), 'as sessões antigas saem do banco também, nos dois mercados');
t.ok(/podaNoBancoRodando/.test(poda), 'e duas podas não correm ao mesmo tempo');

const podarMem = poda.slice(poda.indexOf('export function podarPedidosAntigos'));
t.ok(/foraDaJanela\(o, corteIso\)/.test(podarMem), 'a memória usa a mesma regra');
t.ok(!/channel|market/.test(podarMem), 'e não filtra canal nem mercado nenhum');
for (const chave of ['metaInsightsDaily', 'metaUSInsightsDaily', 'mlAdCostsDaily', 'yucalooSessionsDaily', 'sessionsDaily']) {
  t.ok(podarMem.includes(chave), `a série ${chave} segue a mesma janela`);
}

// ── O sync roda a poda, e a poda antiga (só Amazon, número da tela) não existe mais ──
const SYNC = semComentario(ler('src/sync.js'));
t.ok(/podarPedidosAntigos\(\)/.test(SYNC), 'o sync poda a cada ciclo');
t.ok(SYNC.indexOf('podarPedidosAntigos()') > SYNC.indexOf('syncBonificacoes()'), 'depois da última busca do ciclo');
for (const velho of ['pruneOrders', 'getAmazonRetentionConfig', 'AMAZON_RETENTION_DAYS']) {
  t.ok(!SYNC.includes(velho) && !STORE.includes(velho), `${velho} não existe mais`);
}

t.fim();
