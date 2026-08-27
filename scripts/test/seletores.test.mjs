// Todo seletor de opção do app usa o mesmo componente (.pill-switch, em js/pill-switch.js): moldura
// discreta e um pill claro que desliza até a opção ativa. Antes eram quatro aparências
// diferentes pra mesma decisão de interface, três delas marcando o ativo com fundo escuro.
//
// O componente é pura apresentação: ele observa a classe `active`, posta pela própria página,
// e leva o pill até lá. Por isso o que dá pra quebrar aqui é sempre estrutural — pill ausente,
// script não carregado, nenhuma opção ativa — e é isso que este teste cobre.
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, PUB, paginas } from './_lib.mjs';

const t = criarTeste('Seletores de opção');

const comSwitch = [];
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  // Cada <div class="pill-switch ..."> com o conteúdo até o </div> que o fecha no mesmo nível.
  const blocos = [...s.matchAll(/<div class="pill-switch(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/div>/g)];
  if (!blocos.length) continue;
  comSwitch.push(nome);

  // A TAG, não o nome do arquivo solto: o comentário que cada página tem no CSS também cita
  // js/pill-switch.js, e procurar só pelo nome dava o script como carregado sem ele estar.
  t.ok(/<script src="js\/pill-switch\.js"><\/script>/.test(s), `${nome} carrega js/pill-switch.js`);

  blocos.forEach((m, i) => {
    const corpo = m[1];
    const onde = `${nome} seletor ${i + 1}`;
    // O pill precisa ser o PRIMEIRO filho: ele fica atrás das opções e, vindo depois, cobriria
    // o texto delas.
    t.ok(/^\s*<span class="ps-pill"/.test(corpo), `${onde}: o pill é o primeiro elemento`);
    const opts = [...corpo.matchAll(/class="ps-opt\b[^"]*"/g)];
    t.ok(opts.length >= 2, `${onde}: tem pelo menos duas opções (achei ${opts.length})`);
    // Exatamente uma ativa: nenhuma deixa o pill invisível, duas deixam o pill numa delas e a
    // outra parecendo selecionada também.
    const ativas = opts.filter(o => /\bactive\b/.test(o[0])).length;
    t.ok(ativas === 1, `${onde}: exatamente uma opção começa ativa (achei ${ativas})`);
  });
}

t.ok(comSwitch.length === 9, `nove telas usam o componente (${comSwitch.length}: ${comSwitch.join(', ')})`);

// ── Nenhuma página pode ressuscitar a aparência antiga ──
// Estes eram os quatro seletores com visual próprio. As CLASSES seguem nos botões, porque são
// o gancho dos handlers de cada tela; o que não pode voltar é o CSS de aparência delas.
const REGRAS_ANTIGAS = [
  ['.mkt-btn{', 'seletor de mercado'],
  ['.mkt-btn.active{', 'seletor de mercado (ativo)'],
  ['.vs-btn{', 'Colunas/Linhas'],
  ['.vs-btn.active{', 'Colunas/Linhas (ativo)'],
  ['.chart-type-btn{', 'tipo de gráfico'],
  ['.chart-type-btn.active{', 'tipo de gráfico (ativo)'],
  ['.mode-btn{', 'modo do mapa'],
  ['.mode-btn.active{', 'modo do mapa (ativo)'],
  ['.view-switch{', 'moldura do Colunas/Linhas'],
];
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  const voltaram = REGRAS_ANTIGAS.filter(([r]) => s.includes(r)).map(([, d]) => d);
  t.ok(voltaram.length === 0, `${nome} não redefine a aparência antiga${voltaram.length ? ' (' + voltaram.join(', ') + ')' : ''}`);
}

// ── O componente em si ──
const js = fs.readFileSync(path.join(PUB, 'js', 'pill-switch.js'), 'utf8');
t.ok(/transition:transform/.test(js), 'o pill anima por transform (não por left, que recalcula layout a cada quadro)');
t.ok(js.includes('prefers-reduced-motion'), 'respeita movimento reduzido no sistema');
t.ok(js.includes('MutationObserver'), 'segue a classe active em vez de tratar o clique');
t.ok(js.includes('ResizeObserver'), 'reposiciona quando a largura muda');
t.ok(js.includes('ps-medindo'), 'a primeira medida não anima, senão o pill desliza da borda a cada carga');
t.ok(!/addEventListener\(\s*['"]click/.test(js), 'o componente não trata clique: quem manda no estado é a página');

// Toda classe citada no CSS do componente precisa existir de fato. Uma regra apontando pra
// classe que ninguém usa não dá erro em lugar nenhum: ela simplesmente não se aplica, e o
// efeito some em silêncio. Foi o que aconteceu ao renomear o componente — a regra que impede
// o pill de deslizar no carregamento continuou apontando pro nome antigo, e o pill voltaria a
// entrar deslizando da borda a cada abertura de página, sem nada falhar.
const cssDoComponente = js.slice(js.indexOf('const CSS = `'), js.indexOf('`;', js.indexOf('const CSS = `')));
const usadas = new Set();
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  for (const m of s.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c => usadas.add(c));
}
// Classes que o próprio JS adiciona em tempo de execução, então não aparecem no HTML.
['ps-medindo', 'active'].forEach(c => usadas.add(c));

const semDono = [...new Set([...cssDoComponente.matchAll(/\.([a-z][\w-]*)/g)].map(m => m[1]))]
  .filter(c => !usadas.has(c));
t.ok(semDono.length === 0, `toda classe do CSS do componente existe no markup${semDono.length ? ' (órfãs: ' + semDono.join(', ') + ')' : ''}`);

t.fim();
