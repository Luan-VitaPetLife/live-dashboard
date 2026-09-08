// Lista de backups do painel de Integrações.
//
// A lista cresce um arquivo por dia e a retenção é de 30 dias, então mostrar tudo deixava o
// painel enorme. Recolhida, ela mostra três linhas inteiras e a quarta se apagando.
//
// O que este teste protege é a decisão de QUANDO recolher. Dois erros aqui não dão erro nenhum,
// só mentem na tela: recolher quando não há nada escondido (a quarta linha apagada sugere um
// quinto backup que não existe) e não recolher quando há (a lista volta a ficar gigante). Por
// isso as funções são executadas de verdade, contra um DOM falso, em vez de conferidas por texto.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, ROOT, PUB, fontePagina } from './_lib.mjs';

const t = criarTeste('Lista de backups em Integrações');

const src = fs.readFileSync(path.join(PUB, 'js', 'paginas', 'integracoes.js'), 'utf8');
const ini = src.indexOf('const BACKUPS_VISIVEIS');
const fim = src.indexOf('async function runBackupNow');
t.ok(ini >= 0 && fim > ini, 'achou o bloco do recolhimento da lista');

const ALTURA = 29, GAP = 4;

// O painel de backup fica lá embaixo na página, e é isso que o DOM falso precisa reproduzir:
// a primeira versão media com offsetTop, que é relativo ao ancestral POSICIONADO mais próximo —
// e nem a lista nem as linhas têm position. Na tela real o número saía grande demais, o
// max-height não recortava nada, e a quarta linha aparecia apagada com a lista inteira embaixo.
// O teste passava porque o DOM falso repetia a mesma suposição errada.
//
// Por isso as linhas aqui NÃO expõem offsetTop nem offsetHeight: quem voltar a usá-los quebra o
// teste em vez de quebrar só a tela.
const TOPO_DA_LISTA = 900;
function cenario(n) {
  const linhas = Array.from({ length: n }, (_, i) => {
    const top = TOPO_DA_LISTA + i * (ALTURA + GAP);
    return { getBoundingClientRect: () => ({ top, bottom: top + ALTURA, height: ALTURA }) };
  });
  const lista = {
    _classes: new Set(), style: {},
    scrollHeight: n ? (n - 1) * (ALTURA + GAP) + ALTURA : 0,
    getBoundingClientRect: () => ({ top: TOPO_DA_LISTA }),
    classList: { toggle(c, on) { on ? lista._classes.add(c) : lista._classes.delete(c); } },
    querySelectorAll: () => linhas,
  };
  const btn = { style: {}, textContent: '' };
  const ctx = { $: id => (id === 'backupFilesList' ? lista : btn), console };
  vm.createContext(ctx);
  vm.runInContext(src.slice(ini, fim), ctx);
  ctx.ajustarListaDeBackups(n);
  return { ctx, lista, btn, recolhida: () => lista._classes.has('recolhida'), visivel: () => btn.style.display !== 'none' };
}

// ── Com backup escondido: recolhe e oferece o botão ──
const muitos = cenario(10);
t.ok(muitos.recolhida(), '10 backups: a lista fica recolhida');
t.ok(muitos.visivel(), '10 backups: o botão aparece');
t.eq(muitos.btn.textContent, 'Ver todos os 10 backups', 'o botão diz quantos existem');
// 3 linhas inteiras + a quarta: é a quarta apagada que diz "tem mais embaixo".
t.eq(muitos.lista.style.maxHeight, `${3 * (ALTURA + GAP) + ALTURA}px`, 'a altura recolhida cabe exatamente quatro linhas');
// A medida é a distância DENTRO da lista, não a posição dela na página: se voltar a sair de
// offsetTop, este número vira a distância até o topo do documento e nada é recortado.
t.ok(parseInt(muitos.lista.style.maxHeight, 10) < TOPO_DA_LISTA,
  'a altura é medida dentro da lista, não a partir do topo da página');

muitos.ctx.alternarBackups();
t.ok(!muitos.recolhida(), 'clicando, abre');
t.eq(muitos.lista.style.maxHeight, `${muitos.lista.scrollHeight}px`, 'aberta, a altura é a da lista inteira');
t.eq(muitos.btn.textContent, 'Ver menos', 'e o botão passa a oferecer o contrário');

muitos.ctx.alternarBackups();
t.ok(muitos.recolhida(), 'clicando de novo, recolhe');
t.eq(muitos.btn.textContent, 'Ver todos os 10 backups', 'e o texto volta');

// ── Sem nada escondido: não pode recolher ──
// Com exatamente quatro, apagar a quarta sugeriria um quinto que não existe.
for (const n of [4, 3, 1, 0]) {
  const c = cenario(n);
  t.ok(!c.recolhida(), `${n} backup(s): não recolhe, porque não há o que esconder`);
  t.ok(!c.visivel(), `${n} backup(s): sem botão`);
}
const cinco = cenario(5);
t.ok(cinco.recolhida() && cinco.visivel(), '5 backups: recolhe, porque aí já sobra um escondido');

// ── A lista não pode ser cortada na renderização ──
// Cortar em N escondia backup sem dizer que existia mais; quem limita é o recolhimento.
const tela = fontePagina('integracoes.html').tudo;
const render = tela.slice(tela.indexOf("$('backupFilesList').innerHTML"), tela.indexOf('ajustarListaDeBackups(d.files.length)'));
t.ok(!/\.slice\(\s*0\s*,/.test(render), 'renderiza todos os backups, sem corte');
t.ok(/#backupFilesList\{[^}]*min-height:0/.test(tela),
  'a lista leva min-height:0 (item de coluna flex ignoraria o max-height sem isso)');
t.ok(/onclick="alternarBackups\(\)"/.test(tela), 'o botão está ligado ao alternador');

// ── Painel único "Histórico de pedidos" ──
// Eram TRÊS painéis: histórico da Amazon, reembolsos da Amazon e histórico da Shopify. Dois
// botões chamados "Buscar" que faziam coisas diferentes, e um campo que ora buscava ora APAGAVA.
t.ok(/id="histPanel"/.test(tela), 'existe um painel de histórico só');
t.ok(/id="histRows"/.test(tela), 'com o container onde as quatro linhas são montadas');
t.ok(!/id="refundsPanel"|id="shopHistPanel"|id="retPanel"/.test(tela), 'e os três painéis antigos não voltaram');

// O reembolso deixou de ser um botão separado. A garantia não mudou de valor, mudou de lugar:
// pedido recuperado sem a marca de devolução conta como vendida uma unidade que voltou, e um
// botão separado era um botão que dava pra esquecer.
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const job = server.slice(server.indexOf('function startBackfillJob'), server.indexOf('function startShopifyBackfillJob'));
// O literal completo, com o await: procurar só o nome da função passa com a chamada desligada
// por um `if (false)` do lado, que foi exatamente a mutação que escapou.
t.ok(job.includes('const rr = await reconcileAmazonReturns({'),
  'buscar histórico da Amazon busca os reembolsos junto');
t.ok(/dias: days/.test(job), 'na mesma janela de dias que a pessoa pediu');
t.ok(/reembolsos falharam/.test(job), 'e uma falha no reembolso não apaga o resultado da busca de pedidos');

// Nenhum botão desta tela apaga pedido. O campo da Amazon podava quando o número era menor que o
// histórico atual, e a poda já quase apagou nove meses de dado recém-recuperado uma vez.
const postHist = server.slice(server.indexOf("app.post('/api/amazon/history'"), server.indexOf("app.post('/api/backup/run'"));
t.ok(!/pruneOrders\(/.test(postHist), 'buscar histórico nunca apaga pedido');
t.ok(/days > atual/.test(postHist), 'e a retenção sobe pra cobrir o que foi buscado, senão a poda automática desfaria');

// O botão precisa voltar a funcionar SEMPRE. Antes, se o job sumisse da lista, o acompanhamento
// parava calado: intervalo rodando, botão travado e nenhuma palavra na tela — foi assim que
// "cliquei e não funcionou" virou o relato.
const acomp = tela.slice(tela.indexOf('function acompanharHistorico('), tela.indexOf('// Se uma busca já estava rodando'));
t.ok(/if \(btn\) btn\.disabled = false;/.test(acomp), 'o acompanhamento sempre devolve o botão');
// A contagem precisa CHEGAR ao encerramento: `semNoticia` declarado e nunca usado pra desistir
// deixa o acompanhamento rodando pra sempre de novo.
t.ok(acomp.includes('if (++semNoticia < 3) return;'), 'ele conta as voltas sem notícia');
t.ok(acomp.includes("encerrar('Sem notícia do processo"), 'e desiste avisando quando o processo some da lista');
t.ok(!/catch\(e\)\{\}/.test(acomp), 'sem engolir erro de rede');

// O campo lembra o último número digitado (pedido do Luan).
t.ok(/localStorage\.setItem\('coco_hist_dias_'/.test(tela), 'o número digitado fica guardado');
t.ok(/localStorage\.getItem\('coco_hist_dias_'/.test(tela), 'e volta no campo quando a tela reabre');

t.fim();
