// O rótulo de período esconde o ano de propósito no uso do dia a dia, e é isso que o torna
// perigoso: um período de outro ano abre a dashboard inteira zerada e o cabeçalho continua
// dizendo "01/08 – 28/08", como se fosse este ano. Aconteceu de verdade.
//
// Este teste executa o js/periodo.js real (não confere só o texto do arquivo) e cobre as duas
// pontas: a regra do ano e o fato de que as seis telas usam ESTE rótulo, não uma cópia local.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, PUB, paginas, fontePagina } from './_lib.mjs';

const t = criarTeste('Rótulo de período');

const fonte = fs.readFileSync(path.join(PUB, 'js', 'periodo.js'), 'utf8');
const janela = {};
vm.createContext(janela);
janela.window = janela;
vm.runInContext(fonte, janela);
const P = janela.CocoPeriodo;

t.ok(typeof P?.rotulo === 'function' && typeof P?.data === 'function',
  'periodo.js expõe window.CocoPeriodo com rotulo() e data()');

const HOJE = '2026-08-28';
const r = (s, u, o) => P.rotulo(s, u, { hoje: HOJE, ...(o || {}) });

// ── A regra do ano ──
t.eq(r('2026-08-01', '2026-08-28'), '01/08 – 28/08', 'ano corrente: rótulo curto, sem ano');
t.eq(r('2025-08-01', '2025-08-28'), '01/08 – 28/08/2025', 'outro ano: o ano aparece');
t.eq(r('2025-12-20', '2026-01-05'), '20/12/2025 – 05/01/2026',
  'virada de ano: cada ponta leva o seu ano, senão "20/12 – 05/01" fica ambíguo');
t.eq(r(HOJE, HOJE), 'Hoje', 'o dia de hoje continua sendo "Hoje"');
t.eq(r('2026-08-01', '2026-08-01'), '01/08', 'um dia só do ano corrente');
t.eq(r('2025-08-01', '2025-08-01'), '01/08/2025', 'um dia só de outro ano leva o ano');
t.eq(r('', ''), '', 'sem data não quebra');

// ── Mercado EUA inverte dia e mês (a tela de Geografia já fazia isso) ──
t.eq(r('2026-08-01', '2026-08-28', { mercado: 'us' }), '08/01 – 08/28', 'EUA: MM/DD');
t.eq(P.data('2026-04-17'), '17/04/2026', 'data() sempre com ano');
t.eq(P.data('2026-04-17', { mercado: 'us' }), '04/17/2026', 'data() respeita o mercado');

// ── Uma fonte só ──
// Se uma tela voltar a formatar o período na mão, ela volta a esconder o ano sozinha.
const TELAS = ['index.html', 'geografia.html', 'segmentos.html', 'produtos.html', 'campanhas.html', 'estoque.html'];
for (const nome of TELAS) {
  const s = fontePagina(nome).tudo;
  t.ok(s.includes('<script src="js/periodo.js"></script>'), `${nome} carrega js/periodo.js`);
  t.ok(/CocoPeriodo\.(rotulo|data)\(/.test(s), `${nome} usa CocoPeriodo pro rótulo de período`);
}

// Nenhuma tela pode ter voltado a montar "dd/mm – dd/mm" por conta própria.
const CASEIRO = /slice\(8,\s*10\)\}\/\$\{[^}]*slice\(5,\s*7\)|slice\(8\)\}\.\$\{/;
for (const nome of paginas()) {
  const s = fontePagina(nome).tudo;
  t.ok(!CASEIRO.test(s), `${nome} não remonta o rótulo de período na mão`);
}

// ── O card de Insights precisa saber diferenciar vazio de estável ──
const index = fontePagina('index.html').tudo;
t.ok(index.includes('function insEmptyHTML'), 'existe um texto de vazio próprio pro Insights');
t.ok(index.includes('anterior ao histórico disponível'),
  'período anterior ao histórico é explicado, não vira "nada fora do normal"');
t.ok(/historyStart/.test(index), 'a tela recebe onde o histórico começa');
const metrics = fs.readFileSync(path.join(PUB, '..', 'src', 'metrics.js'), 'utf8');
t.ok(/historyStart:\s*getOldestOrderDate\(market\)/.test(metrics),
  'o payload da dashboard carrega historyStart por mercado');
const store = fs.readFileSync(path.join(PUB, '..', 'src', 'store.js'), 'utf8');
t.ok(/export function getOldestOrderDate/.test(store), 'store expõe getOldestOrderDate');

t.fim();
