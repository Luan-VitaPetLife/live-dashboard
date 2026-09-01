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
import { criarTeste, PUB, fontePagina } from './_lib.mjs';

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

// ── Painel "Amazon — Reembolsos" ──
// A rodada automática cobre só a janela recente. Sem este botão, reembolso mais antigo nunca é
// marcado e a quantidade vendida daquele período fica errada pra sempre — e ninguém percebe,
// porque não existe erro, existe um número a mais.
t.ok(/id="refundsPanel"/.test(tela), 'o painel de reembolsos existe');
t.ok(/id="refundsRows"/.test(tela), 'com o container onde as linhas são montadas');
t.ok(/function renderReembolsos\(\)/.test(tela), 'e um montador próprio pras linhas');
const montador = tela.slice(tela.indexOf('function renderReembolsos()'), tela.indexOf('async function loadHistory'));
t.ok(/retLinha\(\{/.test(montador), 'que reaproveita o montador de linha compartilhado');
t.ok(!/campo:/.test(montador), 'sem caixa de dias: aqui não há número pra escolher');

const acao = tela.slice(tela.indexOf('async function buscarReembolsos'), tela.indexOf('// ── Alerta de sincronização'));
t.ok(/\/api\/amazon\/sync-returns/.test(acao), 'o botão chama a busca de reembolsos');
t.ok(/method:\s*'POST'/.test(acao), 'por POST');
t.ok(/days=365/.test(acao), 'na janela funda de um ano, que é o que conserta período antigo');
t.ok(/cocoConfirm/.test(acao), 'pede confirmação: a busca é longa e prende a cota da Amazon');
// Montar as linhas e nunca chamar o montador deixa o painel vazio, sem erro nenhum.
t.ok(/^\s*renderReembolsos\(\);/m.test(tela), 'o montador é chamado ao abrir a página');
// A função do botão vem por parâmetro. Enquanto era um ternário em cima do `id`, só cabiam dois
// painéis, e o terceiro apontaria para a ação de um dos outros.
t.ok(/onclick="\$\{acao\}/.test(tela), 'o botão de cada linha chama a ação que a linha declarou');

t.fim();
