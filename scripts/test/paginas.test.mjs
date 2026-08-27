// Toda a lógica das telas vive em <script> dentro do HTML, então nada checa a sintaxe delas:
// um erro de digitação só aparece quando alguém abre a página e ela não faz nada. Aqui cada
// bloco inline é extraído e passado pelo parser do próprio Node.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { criarTeste, PUB, paginas } from './_lib.mjs';

const t = criarTeste('Sintaxe dos scripts das páginas');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-paginas-'));

try {
  for (const nome of paginas()) {
    const html = fs.readFileSync(path.join(PUB, nome), 'utf8');
    // (?![^>]*\ssrc) descarta as tags que só apontam pra um arquivo externo.
    const blocos = [...html.matchAll(/<script(?![^>]*\ssrc)[^>]*>([\s\S]*?)<\/script>/g)];
    if (!blocos.length) { t.info(`${nome}: nenhum script inline`); continue; }
    blocos.forEach((m, i) => {
      const linha = html.slice(0, m.index).split('\n').length;
      const arq = path.join(tmp, `${nome}.${i}.mjs`);
      fs.writeFileSync(arq, m[1]);
      let erro = null;
      try { execFileSync(process.execPath, ['--check', arq], { stdio: 'pipe' }); }
      catch (e) { erro = String(e.stderr || e.message).split('\n').slice(0, 3).join(' '); }
      t.ok(!erro, `${nome} (bloco na linha ${linha})${erro ? ': ' + erro : ''}`);
    });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

t.fim();
