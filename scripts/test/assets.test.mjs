// Caminho de imagem quebrado não gera erro em lugar nenhum: o navegador mostra o ícone de
// imagem faltando e segue. Como as páginas ficam na raiz de public/ e os arquivos em subpastas,
// é fácil um caminho relativo ficar para trás numa reorganização de pasta.
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, ROOT, PUB } from './_lib.mjs';

const t = criarTeste('Caminhos de arquivo local');

const arquivos = [];
(function varrer(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) varrer(p);
    else if (/\.(html|js|css)$/.test(e.name)) arquivos.push(p);
  }
})(PUB);
arquivos.push(path.join(ROOT, 'server.js'));

// src=/href= das páginas, e o campo logo:'...' das telas que montam card de canal.
const RE = /(?:src|href)\s*=\s*["']([^"'>]+)["']|logo:\s*["']([^"']+)["']/g;
let checados = 0;
const quebrados = [];

for (const arq of arquivos) {
  const txt = fs.readFileSync(arq, 'utf8');
  const rel = path.relative(ROOT, arq).replace(/\\/g, '/');
  for (const m of txt.matchAll(RE)) {
    const ref = (m[1] ?? m[2] ?? '').trim();
    // Fora do escopo: URL externa, âncora, dado embutido, e template literal (o valor só
    // existe em tempo de execução, não dá pra conferir daqui).
    if (!ref || /^(https?:|\/\/|#|data:|mailto:|javascript:)/i.test(ref) || ref.includes('${')) continue;
    // Só interessa arquivo. Uma rota da própria dashboard (/produtos, /api/...) é URL limpa,
    // não existe como arquivo em disco e não tem o que conferir aqui.
    if (!/\.(png|webp|svg|jpe?g|ico|css|js|json)$/i.test(ref.split('?')[0])) continue;
    const linha = txt.slice(0, m.index).split('\n').length;
    const limpo = ref.split('?')[0];
    // Três formas válidas de escrever o mesmo arquivo, todas resolvendo pela raiz de public/:
    //  - caminho absoluto (/img/marca/x.png);
    //  - relativo, que resolve pela PÁGINA e não pela pasta do .js que escreveu a tag — por
    //    isso sidebar.js pede "favicon.png" mesmo morando em public/js/;
    //  - nome pelado de logo, que o front prefixa com LOGO_BASE (ver integracoes.html).
    const candidatos = [
      path.join(PUB, limpo.replace(/^\//, '')),
      path.join(PUB, 'img', 'integracoes', limpo),
    ];
    checados++;
    if (!candidatos.some(c => fs.existsSync(c))) quebrados.push(`${rel}:${linha} → ${ref}`);
  }
}

t.info(`${checados} caminhos conferidos`);
for (const q of quebrados) t.ok(false, q);
t.ok(quebrados.length === 0, `nenhum caminho quebrado (${quebrados.length} encontrado(s))`);
t.fim();
