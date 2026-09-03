// Botão "Sincronizar": o que ele mostra enquanto trabalha e quando falha.
//
// `POST /api/sync` espera a sincronização INTEIRA terminar antes de responder, e isso leva
// minutos. Em Produtos, Estoque e Campanhas o clique não mudava NADA na tela nesse tempo todo, e a
// leitura de quem clicava era a única possível: "não funciona" (relatado pelo Luan em 03/09/2026).
// Os seis handlers também engoliam o erro com `catch (e) {}`, o que o CLAUDE.md proíbe — e como o
// endpoint tem limite de chamadas, o segundo clique tomava 429 e sumia em silêncio.
//
// Por isso o comportamento é executado aqui de verdade, contra um DOM e um fetch falsos.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, PUB } from './_lib.mjs';

const t = criarTeste('Botão Sincronizar');

const src = fs.readFileSync(path.join(PUB, 'js', 'sync-btn.js'), 'utf8');

// Monta um contexto novo por cenário: botão falso, fetch falso, e os timers sob controle.
function cenario({ resposta, explode } = {}) {
  const botao = {
    innerHTML: '<i class="bi bi-arrow-clockwise"></i> Sincronizar',
    disabled: false, title: 'Buscar dados novos agora',
    _cliques: [],
    addEventListener(_, fn) { botao._cliques.push(fn); },
    clicar() { return botao._cliques[0](); },
  };
  const style = { textContent: '' };
  let chamadas = 0;
  const ctx = {
    console: { error() {} },
    window: {},
    setTimeout: () => 0, clearTimeout: () => {},
    document: {
      getElementById: id => (id === 'syncBtn' ? botao : null),
      createElement: () => style,
      head: { appendChild() {} },
    },
    fetch: async () => {
      chamadas++;
      if (explode) throw new Error('rede caiu');
      return { ok: resposta.ok, status: resposta.status, json: async () => resposta.corpo || null };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, botao, style, chamadas: () => chamadas };
}

const OK = { ok: true, status: 200 };

// ── O módulo se anuncia e traz o próprio giro ──
const base = cenario({ resposta: OK });
t.ok(!!base.ctx.window.CocoSync, 'o módulo publica CocoSync');
t.ok(/@keyframes csSpin/.test(base.style.textContent), 'e injeta a animação de girar');

// ── Enquanto roda, a tela diz que está rodando ──
// É a correção central: sem isto o clique não mudava nada por minutos.
{
  const c = cenario({ resposta: OK });
  let recarregou = false;
  let durante = null;
  c.ctx.window.CocoSync.ligar(() => { durante = { texto: c.botao.innerHTML, travado: c.botao.disabled }; recarregou = true; });
  const p = c.botao.clicar();
  t.ok(/Sincronizando/.test(c.botao.innerHTML), 'ao clicar, o botão diz que está sincronizando');
  t.ok(/cs-spin/.test(c.botao.innerHTML), 'com o ícone girando');
  t.ok(c.botao.disabled, 'e fica travado enquanto isso');
  await p;
  t.ok(recarregou, 'terminando, a página recarrega os dados');
  t.ok(!c.botao.disabled, 'e o botão volta a funcionar');
  t.ok(/Sincronizar/.test(c.botao.innerHTML) && !/Sincronizando/.test(c.botao.innerHTML), 'com o texto original de volta');
}

// ── Clicar duas vezes não dispara duas sincronizações ──
// O endpoint tem limite de chamadas: o segundo clique é justamente o que toma 429.
{
  const c = cenario({ resposta: OK });
  c.ctx.window.CocoSync.ligar(() => {});
  const p1 = c.botao.clicar();
  const p2 = c.botao.clicar();
  await Promise.all([p1, p2]);
  t.eq(c.chamadas(), 1, 'dois cliques seguidos disparam uma sincronização só');
}

// ── Falha aparece na tela, não só no console ──
{
  const c = cenario({ resposta: { ok: false, status: 429 } });
  let recarregou = false;
  c.ctx.window.CocoSync.ligar(() => { recarregou = true; });
  await c.botao.clicar();
  t.ok(/Aguarde/.test(c.botao.innerHTML), '429 explica que é pra esperar, em vez de sumir calado');
  t.ok(!c.botao.disabled, 'e o botão destrava pra poder tentar de novo');
  // Recarregar depois de falhar redesenha os mesmos números e faz parecer que sincronizou.
  t.ok(!recarregou, 'falhou: não recarrega os dados fingindo que deu certo');
}
{
  const c = cenario({ resposta: { ok: false, status: 401 } });
  c.ctx.window.CocoSync.ligar(() => {});
  await c.botao.clicar();
  t.ok(/Sess/.test(c.botao.innerHTML), '401 diz que a sessão expirou');
}
{
  const c = cenario({ resposta: { ok: false, status: 500, corpo: { error: 'Sync falhou.' } } });
  c.ctx.window.CocoSync.ligar(() => {});
  await c.botao.clicar();
  t.ok(/Sync falhou/.test(c.botao.innerHTML), 'o motivo que o servidor deu é o que aparece');
}
{
  const c = cenario({ explode: true });
  c.ctx.window.CocoSync.ligar(() => {});
  await c.botao.clicar();
  t.ok(/conex/i.test(c.botao.innerHTML), 'rede fora também aparece, em vez de silêncio');
  t.ok(!c.botao.disabled, 'e o botão não fica travado pra sempre');
}

// ── Página sem o botão não quebra ──
{
  const c = cenario({ resposta: OK });
  c.ctx.document.getElementById = () => null;
  let erro = null;
  try { c.ctx.window.CocoSync.ligar(() => {}); } catch (e) { erro = e; }
  t.ok(!erro, 'página sem botão de sincronizar não estoura');
}

// ── Nenhuma página tem mais a sua própria cópia ──
const paginas = ['index', 'geografia', 'campanhas', 'produtos', 'estoque', 'unificador'];
for (const p of paginas) {
  const js = fs.readFileSync(path.join(PUB, 'js', 'paginas', p + '.js'), 'utf8');
  const semComentario = js.replace(/^\s*\/\/.*$/gm, '');
  t.ok(/CocoSync\.ligar\(/.test(semComentario), `${p}: usa o comportamento compartilhado`);
  // A página não fala mais com /api/sync direto: é ali que morava o `catch (e) {}` que engolia o
  // erro. (Um `catch` vazio em cima de `JSON.parse` do localStorage é outra coisa e continua
  // valendo — ali cair no padrão é o comportamento certo.)
  t.ok(!/fetch\('\/api\/sync'/.test(semComentario), `${p}: não chama /api/sync por conta própria`);
  t.ok(!/getElementById\('syncBtn'\)\.addEventListener/.test(semComentario), `${p}: não liga o botão por conta própria`);
  const html = fs.readFileSync(path.join(PUB, p + '.html'), 'utf8');
  t.ok(/<script src="js\/sync-btn\.js"><\/script>/.test(html), `${p}.html carrega o js/sync-btn.js`);
  t.ok(html.indexOf('js/sync-btn.js') < html.indexOf(`js/paginas/${p}.js`), `${p}.html carrega antes do script da página`);
}

t.fim();
