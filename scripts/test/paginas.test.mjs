// A lógica de cada tela não passa por nenhuma etapa de build, então nada checa a sintaxe dela:
// um erro de digitação só aparece quando alguém abre a página e ela não faz nada. Aqui cada
// arquivo de script das páginas passa pelo parser do próprio Node.
//
// Este teste nasceu quando toda a lógica vivia em <script> dentro do HTML. Ele continua checando
// os blocos inline que sobrarem, mas o corpo do trabalho hoje está em public/js/paginas/ — e as
// duas conferências precisam existir, senão voltar um bloco pra dentro do HTML deixaria de ser
// verificado sem ninguém notar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { criarTeste, PUB, paginas } from './_lib.mjs';

const t = criarTeste('Sintaxe dos scripts das páginas');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-paginas-'));

const conferir = (rotulo, codigo) => {
  const arq = path.join(tmp, rotulo.replace(/[\\/]/g, '_') + '.mjs');
  fs.writeFileSync(arq, codigo);
  let erro = null;
  try { execFileSync(process.execPath, ['--check', arq], { stdio: 'pipe' }); }
  catch (e) { erro = String(e.stderr || e.message).split('\n').slice(0, 3).join(' '); }
  t.ok(!erro, `${rotulo}${erro ? ': ' + erro : ''}`);
};

try {
  // ── Os arquivos de script de cada página ──
  const dir = path.join(PUB, 'js', 'paginas');
  const arquivos = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.js')) : [];
  t.ok(arquivos.length >= 9, `achou os scripts das páginas (${arquivos.length})`);
  for (const f of arquivos) conferir(`js/paginas/${f}`, fs.readFileSync(path.join(dir, f), 'utf8'));

  // ── Toda página que carrega um desses precisa ter o arquivo em disco ──
  // Um href errado não dá erro: a página abre e simplesmente não faz nada.
  for (const nome of paginas()) {
    const html = fs.readFileSync(path.join(PUB, nome), 'utf8');
    for (const m of html.matchAll(/<(?:script src|link[^>]*href)="((?:js|css)\/paginas\/[^"]+)"/g)) {
      t.ok(fs.existsSync(path.join(PUB, m[1])), `${nome} aponta pra ${m[1]}, que existe`);
    }
  }

  // ── Blocos inline que porventura sobrem ou voltem ──
  let inline = 0;
  for (const nome of paginas()) {
    const html = fs.readFileSync(path.join(PUB, nome), 'utf8');
    // (?![^>]*\ssrc) descarta as tags que só apontam pra um arquivo externo.
    const blocos = [...html.matchAll(/<script(?![^>]*\ssrc)[^>]*>([\s\S]*?)<\/script>/g)];
    blocos.forEach(m => {
      inline++;
      const linha = html.slice(0, m.index).split('\n').length;
      conferir(`${nome} (bloco inline na linha ${linha})`, m[1]);
    });
  }
  t.info(`${inline} bloco(s) de script ainda dentro do HTML`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

t.fim();
