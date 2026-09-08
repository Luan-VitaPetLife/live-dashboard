// Guarda o backfill histórico das lojas Shopify (src/backfill.js).
//
// A parte que este teste protege é a divisão da janela em blocos: um erro ali não dá erro
// nenhum, só deixa um buraco no meio do histórico — e um buraco é indistinguível de "não teve
// venda nesse período", que é exatamente a confusão que este backfill existe pra desfazer.
//
// Não faz rede e não toca no banco: só a aritmética de data e a ligação com o servidor.
import path from 'node:path';
import { criarTeste, ler, ROOT, fontePagina } from './_lib.mjs';

const t = criarTeste('backfill histórico das lojas Shopify');

const { blocosDeDatas, CHUNK_DAYS } = await import('file:///' + path.join(ROOT, 'src/backfill.js').replace(/\\/g, '/'));

const HOJE = new Date('2026-08-31T12:00:00Z');
const dias = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
const HOJE_DIA = dias('2026-08-31');

// ── Cobertura: os blocos cobrem a janela inteira, sem buraco e sem dia repetido ──
for (const janela of [1, 30, 31, 60, 90, 365, 400]) {
  const b = blocosDeDatas(janela, HOJE);
  t.eq(dias(b[0].since), HOJE_DIA - (janela - 1), `janela de ${janela} dias: começa ${janela - 1} dias atrás`);
  t.eq(b[b.length - 1].until, '2026-08-31', `janela de ${janela} dias: termina hoje`);
  t.eq(dias(b[b.length - 1].until) - dias(b[0].since) + 1, janela, `janela de ${janela} dias: cobre exatamente ${janela} dias`);

  let emenda = true;
  for (let i = 1; i < b.length; i++) {
    if (dias(b[i].since) !== dias(b[i - 1].until) + 1) emenda = false;
  }
  t.ok(emenda, `janela de ${janela} dias: cada bloco começa no dia seguinte ao fim do anterior`);

  const grandes = b.filter(x => dias(x.until) - dias(x.since) + 1 > CHUNK_DAYS);
  t.eq(grandes.length, 0, `janela de ${janela} dias: nenhum bloco maior que ${CHUNK_DAYS} dias`);
}

// ── Ordem: do mais antigo pro mais novo ──
const b365 = blocosDeDatas(365, HOJE);
t.ok(b365.every((x, i) => i === 0 || x.since > b365[i - 1].since), 'blocos saem do mais antigo pro mais novo');

// ── Ligação com o servidor ──
const server = ler('server.js');
t.ok(/from '\.\/src\/backfill\.js'/.test(server), 'server.js importa o módulo de backfill');
t.ok(server.includes("app.post('/api/shopify/backfill', requireAdmin"), 'o endpoint de disparo exige admin');
t.ok(server.includes("app.get('/api/shopify/history', requireAdmin"), 'o endpoint de leitura exige admin');
t.ok(/shopifyBackfillRunning/.test(server), 'existe trava contra duas execuções ao mesmo tempo');
t.ok(/CANCELABLE_JOB_IDS = new Set\(\[[^\]]*'shopify-backfill'/.test(server), 'o job aparece como cancelável');
t.ok(/STALE_AFTER_MS = \{[^}]*'shopify-backfill'/.test(server), 'o job tem prazo de "travado" próprio');
// Tudo o que segue precisa ser código vivo, não texto comentado: comentar uma linha é
// exatamente a forma mais fácil de desligar uma dessas garantias sem parecer que mudou nada.
const semComentario = txt => txt.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const listaDeJobs = semComentario(server.slice(server.indexOf("app.get('/api/jobs'"), server.indexOf("app.post('/api/jobs/:id/cancel'")));
t.ok(/normalizeJob\('shopify-backfill'/.test(listaDeJobs), 'o job aparece no widget de processos (GET /api/jobs)');

const jobShopify = semComentario(server.slice(server.indexOf('function startShopifyBackfillJob'), server.indexOf("app.get('/api/shopify/history'")));

// As duas callbacks precisam checar: só no onProgress, um backfill que já está baixando um bloco
// grande ignora o clique em cancelar até o bloco terminar.
t.eq((jobShopify.match(/checkCancelled\('shopify-backfill'\)/g) || []).length, 2, 'as duas callbacks (progresso e bloco) checam cancelamento');

// Gravar bloco a bloco é o que faz uma interrupção preservar o que já veio. Se alguém trocar
// por um upsert único no fim, um backfill de um ano interrompido no meio perde tudo.
t.ok(/onChunk:[\s\S]*upsertOrders\(/.test(jobShopify), 'grava bloco a bloco, dentro do onChunk');

// ── Ligação com a tela ──
const tela = fontePagina('integracoes.html').tudo;
t.ok(tela.includes('/api/shopify/backfill'), 'a tela de Integrações dispara o backfill');
t.ok(tela.includes('/api/shopify/history'), 'a tela lê onde o histórico começa hoje');
t.ok(tela.includes('js/periodo.js'), 'a tela carrega periodo.js, que formata a data mostrada');

// O painel da Amazon poda pedido e por isso pede confirmação. Este só soma, então não pode
// herdar aquele texto por engano: um aviso de "isso não tem volta" aqui seria mentira.
const painel = tela.slice(tela.indexOf('function loadShopHistory'), tela.indexOf('function pollShopHistory'));
t.ok(!/cocoConfirm/.test(painel), 'não pede confirmação: este painel não apaga nada');

// ── Os dois painéis de histórico mostram o mesmo tipo de dado, então mostram a mesma frase ──
// Cada um tinha o seu formato, e o resultado era um painel que parecia dois sem relação.
t.ok(/function retLinha\(/.test(tela), 'existe um único montador de linha pros dois painéis');
t.ok(/function retResumo\(/.test(tela), 'existe um único montador da frase de resumo');
const MARKUP_DA_LINHA = /<div class="ret-row">/g;
t.eq((tela.match(MARKUP_DA_LINHA) || []).length, 1, 'o markup da linha existe num lugar só (dentro de retLinha)');
// As quatro linhas (Amazon BR/EUA, Shopify BR/EUA) saem do MESMO montador e do mesmo painel.
// Eram três painéis com três textos e dois botões chamados "Buscar" que faziam coisas diferentes.
{
  const ini = tela.indexOf('function renderHistorico(');
  const corpo = tela.slice(ini, tela.indexOf('async function carregarHistorico', ini));
  t.ok(/retLinha\(/.test(corpo), 'as linhas saem do montador compartilhado');
  const linhas = tela.slice(tela.indexOf('const HIST_LINHAS'), tela.indexOf('let histInfo'));
  t.eq((linhas.match(/slot:/g) || []).length, 4, 'são quatro linhas: Amazon e Shopify, Brasil e EUA');
  t.ok(!MARKUP_DA_LINHA.test(corpo), 'e nenhuma delas monta linha por conta própria');
  MARKUP_DA_LINHA.lastIndex = 0;
}

// A frase precisa dos mesmos campos vindos dos DOIS endpoints, senão um dos painéis mostra
// meia frase. É o tipo de divergência que só aparece na tela, nunca num erro.
const shopResposta = server.slice(server.indexOf("app.get('/api/shopify/history'"), server.indexOf("app.post('/api/shopify/backfill'"));
for (const campo of ['totalOrders', 'oldestOrderDate', 'oldestOrderDays']) {
  t.ok(new RegExp(campo).test(shopResposta), `/api/shopify/history devolve ${campo}`);
}
// O endpoint da Amazon devolve os MESMOS três campos que o da Shopify: a tela monta a frase com
// um formato só, e um campo faltando deixa a linha da Amazon com meia frase.
const amzResposta = server.slice(server.indexOf("app.get('/api/amazon/history'"), server.indexOf("app.post('/api/amazon/history'"));
for (const campo of ['totalOrders', 'oldestOrderDate', 'oldestOrderDays']) {
  t.ok(new RegExp(campo).test(amzResposta), `/api/amazon/history devolve ${campo}`);
}
// Ele deixou de decidir entre podar e buscar. Enquanto decidia, era preciso saber qual das duas ia
// acontecer ANTES de clicar, e a tela tinha que perguntar antes de apagar.
t.ok(!server.includes("action: 'prune'"), 'e não decide mais entre podar e buscar');

t.fim();
