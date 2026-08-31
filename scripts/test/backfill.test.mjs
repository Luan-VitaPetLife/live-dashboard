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
for (const painelNome of ['loadHistory', 'loadShopHistory']) {
  const ini = tela.indexOf(`async function ${painelNome}(`);
  const corpo = tela.slice(ini, tela.indexOf('}catch(e){', ini));
  t.ok(/retLinha\(/.test(corpo), `${painelNome} monta as linhas pelo montador compartilhado`);
  t.ok(!MARKUP_DA_LINHA.test(corpo), `${painelNome} não monta linha por conta própria`);
  MARKUP_DA_LINHA.lastIndex = 0;
}

// A frase precisa dos mesmos campos vindos dos DOIS endpoints, senão um dos painéis mostra
// meia frase. É o tipo de divergência que só aparece na tela, nunca num erro.
const shopResposta = server.slice(server.indexOf("app.get('/api/shopify/history'"), server.indexOf("app.post('/api/shopify/backfill'"));
for (const campo of ['totalOrders', 'oldestOrderDate', 'oldestOrderDays']) {
  t.ok(new RegExp(campo).test(shopResposta), `/api/shopify/history devolve ${campo}`);
}
// TODO return do planAmazonHistory precisa levar os três: a tela usa um formato só, e um
// return incompleto deixa a linha da Amazon com meia frase justamente nos casos de borda
// (sem limite, poda, backfill) — que são os que ninguém testa a olho.
const planoAmazon = server.slice(server.indexOf('function planAmazonHistory'), server.indexOf('\napp.get(\'/api/amazon/history\'') );
const retornos = planoAmazon.match(/return \{ action:[^;]*\};/g) || [];
t.ok(retornos.length >= 5, `achou os retornos do planAmazonHistory (${retornos.length})`);
for (const r of retornos) {
  const acao = (r.match(/action: '(\w+)'/) || [, '?'])[1];
  const faltando = ['totalOrders', 'oldestOrderDate', 'oldestOrderDays'].filter(c => !r.includes(c));
  t.ok(faltando.length === 0, `retorno '${acao}' leva os três campos${faltando.length ? ' (falta ' + faltando.join(', ') + ')' : ''}`);
}

// O painel da Shopify precisa medir as LOJAS SHOPIFY, não o mercado inteiro: com
// getOldestOrderDate(market) ele mostrava a data do pedido mais antigo de qualquer canal — na
// prática, a da Amazon BR — como se fosse o começo do histórico das lojas Shopify.
const shopHist = server.slice(server.indexOf("app.get('/api/shopify/history'"), server.indexOf("app.post('/api/shopify/backfill'"));
t.ok(/historicoDosCanais\(/.test(shopHist), 'mede por canal, com o mesmo helper dos dois painéis');
t.ok(!/getOldestOrderDate\(/.test(shopHist), 'não usa a data do mercado inteiro');

// ── O seletor de visualização controla a lista, então fica junto dela ──
const html = fontePagina('integracoes.html').html;
t.ok(html.indexOf('id="viewSwitch"') < html.indexOf('id="listArea"'), 'o seletor vem antes da lista');
t.ok(html.indexOf('id="viewSwitch"') > html.indexOf('id="retPanel"'), 'e depois dos painéis de histórico, não no cabeçalho');

t.fim();
