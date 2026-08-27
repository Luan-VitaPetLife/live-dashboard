// Roda todos os *.test.mjs desta pasta, cada um no seu processo, e resume no fim.
// Processos separados de propósito: um teste que derruba o Node não pode levar o resto junto,
// e assim cada arquivo pode mexer no seu próprio estado sem contaminar o vizinho.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const alvo = process.argv[2]; // `npm test -- mapa` roda só o que casa com "mapa"

const arquivos = fs.readdirSync(AQUI)
  .filter(f => f.endsWith('.test.mjs'))
  .filter(f => !alvo || f.includes(alvo))
  .sort();

if (!arquivos.length) {
  console.error(alvo ? `Nenhum teste casa com "${alvo}".` : 'Nenhum teste encontrado.');
  process.exit(1);
}

const passou = [], falhou = [], pulado = [];
for (const f of arquivos) {
  const r = spawnSync(process.execPath, [path.join(AQUI, f)], { stdio: 'inherit' });
  if (r.status === 0) passou.push(f);
  else if (r.status === 2) pulado.push(f);
  else falhou.push(f);
}

console.log('\n' + '─'.repeat(60));
console.log(`${passou.length} passou · ${falhou.length} falhou · ${pulado.length} pulado`);
if (pulado.length) console.log('pulados: ' + pulado.join(', '));
if (falhou.length) {
  console.log('FALHARAM: ' + falhou.join(', '));
  process.exit(1);
}
console.log('tudo certo');
