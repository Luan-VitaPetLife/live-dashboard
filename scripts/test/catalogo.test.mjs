// O CSS que Produtos e Estoque desenham igual mora em css/catalogo.css.
//
// O risco aqui não é o arquivo sumir, é a CASCATA. `catalogo.css` carrega antes da folha da
// página; se um seletor voltar a existir nos dois lugares, quem vence um empate de
// especificidade passa a ser decidido pela ordem dos arquivos, e a regra muda de dono sem que
// nada acuse. Foi por isso que a extração só foi feita depois de conferir que isso não acontecia.
//
// O outro erro possível é a página parar de carregar o arquivo: aí ela perde a casca inteira
// (topbar, sidebar recolhida, cards) e só se vê abrindo a tela.
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, PUB, fontePagina } from './_lib.mjs';

const t = criarTeste('CSS compartilhado entre Produtos e Estoque');

const semComentario = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
function regras(bruto) {
  const css = semComentario(bruto);
  const out = [];
  let prof = 0, ini = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') prof++;
    else if (css[i] === '}') { prof--; if (prof === 0) { out.push(css.slice(ini, i + 1)); ini = i + 1; } }
  }
  return out.filter(r => r.trim()).map(r => r.replace(/\s+/g, ' ').trim());
}
const seletor = r => r.split('{')[0].trim();

const caminhoComum = path.join(PUB, 'css', 'catalogo.css');
t.ok(fs.existsSync(caminhoComum), 'css/catalogo.css existe');

const comuns = regras(fs.readFileSync(caminhoComum, 'utf8'));
t.ok(comuns.length >= 100, `o arquivo comum tem conteúdo de verdade (${comuns.length} regras)`);

const seletoresComuns = new Set(comuns.map(seletor));

for (const [pagina, folha] of [['produtos.html', 'produtos'], ['estoque.html', 'estoque']]) {
  const { html } = fontePagina(pagina);
  const iComum = html.indexOf('css/catalogo.css');
  const iPropria = html.indexOf(`css/paginas/${folha}.css`);

  t.ok(iComum >= 0, `${pagina} carrega css/catalogo.css`);
  t.ok(iPropria >= 0, `${pagina} carrega a própria folha`);
  if (iComum >= 0 && iPropria >= 0) {
    t.ok(iComum < iPropria, `${pagina}: o comum vem antes da folha da página`);
  }

  // A trava principal: nenhum seletor pode estar nos dois arquivos.
  const proprias = regras(fs.readFileSync(path.join(PUB, 'css', 'paginas', folha + '.css'), 'utf8'));
  const repetidos = [...new Set(proprias.map(seletor).filter(s => seletoresComuns.has(s)))];
  for (const s of repetidos) t.ok(false, `${folha}.css redeclara "${s}", que já está no comum`);
  t.ok(repetidos.length === 0, `${folha}.css não redeclara nada do comum (${repetidos.length})`);
}

// As duas folhas não podem voltar a ter a mesma regra uma da outra: é exatamente o estado de
// onde este arquivo saiu.
const p = new Set(regras(fs.readFileSync(path.join(PUB, 'css', 'paginas', 'produtos.css'), 'utf8')));
const e = regras(fs.readFileSync(path.join(PUB, 'css', 'paginas', 'estoque.css'), 'utf8'));
const aindaIguais = e.filter(r => p.has(r));
for (const r of aindaIguais.slice(0, 5)) t.ok(false, `regra ainda duplicada nas duas folhas: ${r.slice(0, 70)}`);
t.ok(aindaIguais.length === 0, `nenhuma regra sobrou duplicada entre as duas (${aindaIguais.length})`);

t.fim();
