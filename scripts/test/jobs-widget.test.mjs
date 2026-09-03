// Card flutuante de processos: quando ele fica na tela e quando some sozinho.
//
// Com tudo concluído o card some sozinho depois de 3 segundos. A regra parece trivial e já errou
// de dois jeitos, nenhum dos dois dando erro nenhum:
//   1. o card reacendia três segundos depois de ter sumido — o render roda a cada volta do poll e
//      reacendia sem saber que o sumiço tinha sido deliberado, e ele ficava piscando até o
//      servidor esquecer o job (15 min);
//   2. quem trocava de página logo depois que o processo terminou chegava com tudo já concluído,
//      sem transição nenhuma pra observar, e o card ficava parado na tela.
//
// Por isso a decisão é uma função pura e ela é EXECUTADA aqui, em vez de conferida por texto.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, PUB } from './_lib.mjs';

const t = criarTeste('Card de processos: sumir sozinho');

const src = fs.readFileSync(path.join(PUB, 'js', 'jobs-widget.js'), 'utf8');
const ini = src.indexOf('function planoDoCard(');
t.ok(ini >= 0, 'achou a decisão de visibilidade');
let prof = 0, fim = ini;
// Conta a partir da chave do CORPO, não da primeira do arquivo depois do nome: os parâmetros são
// desestruturados (`{ anyRunning, ... }`) e fechariam a contagem antes da função começar.
for (let j = src.indexOf('{', src.indexOf(')', ini)); j < src.length; j++) {
  if (src[j] === '{') prof++;
  else if (src[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
}
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src.slice(ini, fim), ctx);
const plano = ctx.planoDoCard;

const base = { anyRunning: false, dismissed: false, autoHidden: false, timerArmado: false };

// ── Rodando: fica na tela e o cronômetro não corre ──
const rodando = plano({ ...base, anyRunning: true });
t.ok(rodando.mostrar, 'com processo rodando, o card aparece');
t.ok(!rodando.armarTimer, 'e não arma o cronômetro de sumir');
t.ok(rodando.cancelarTimer, 'um cronômetro já armado é cancelado');
// Um processo novo não pode nascer escondido por causa de um sumiço antigo.
const voltou = plano({ ...base, anyRunning: true, autoHidden: true });
t.ok(voltou.mostrar, 'processo novo traz o card de volta mesmo depois de ele ter sumido sozinho');
t.ok(!voltou.autoHidden, 'e a marca de sumiu-sozinho é esquecida');

// ── Concluído: arma o cronômetro, tendo visto a transição ou não ──
const concluido = plano({ ...base });
t.ok(concluido.mostrar, 'recém-concluído, o card continua na tela pra dar tempo de ler');
t.ok(concluido.armarTimer, 'e o cronômetro de sumir é armado');
// Rearmar a cada volta do poll empurraria o prazo pra frente pra sempre e o card nunca sumiria.
t.ok(!plano({ ...base, timerArmado: true }).armarTimer, 'cronômetro já armado não é rearmado a cada leitura');

// ── Depois de sumir, fica sumido ──
const sumido = plano({ ...base, autoHidden: true });
t.ok(!sumido.mostrar, 'depois de sumir sozinho, o card não reacende na leitura seguinte');
t.ok(sumido.autoHidden, 'e continua marcado como sumido');

// ── Fechado no × continua fechado ──
t.ok(!plano({ ...base, dismissed: true }).mostrar, 'card fechado no × não aparece com tudo concluído');
t.ok(!plano({ ...base, dismissed: true, anyRunning: true }).mostrar, 'nem com processo rodando');

// ── O prazo ──
t.ok(/const HIDE_AFTER_DONE_MS = 3000;/.test(src), 'o card some 3 segundos depois de tudo concluir');
// Quem some tem que marcar que sumiu, senão a leitura seguinte reacende.
const disparo = src.slice(src.indexOf('if (plano.armarTimer)'), src.indexOf('HIDE_AFTER_DONE_MS);', src.indexOf('if (plano.armarTimer)')));
t.ok(/autoHidden = true/.test(disparo), 'ao sumir, o card registra que o sumiço foi deliberado');
t.ok(/hideTimer = null/.test(disparo), 'e libera o cronômetro pra poder ser armado de novo');
t.ok(/remove\('jw-show'\)/.test(disparo), 'e some de fato');
// Estado que só é escrito e nunca lido engana quem for mexer aqui depois.
t.ok(!/lastAnyRunning/.test(src), 'sem estado morto sobrando da versão que dependia da transição');

t.fim();
