// scripts/restore-backup.mjs — restaura o banco a partir de um
// backup gravado no Backblaze B2 (ver src/backup.js).
//
// Uso:
//   node scripts/restore-backup.mjs              # restaura o mais recente
//   node scripts/restore-backup.mjs <fileName>    # restaura um específico
//   node scripts/restore-backup.mjs --list        # só lista os disponíveis, não restaura
//
// Roda contra o DATABASE_URL do ambiente atual (Postgres) ou, se ausente,
// contra o data/db.json local — mesma regra de sempre do store.js. Pra
// restaurar produção, rode isso com o DATABASE_URL de produção no ambiente
// (ex.: `DATABASE_URL=... node scripts/restore-backup.mjs`), nunca apontando
// pro banco de produção sem ter certeza — a operação é destrutiva (substitui
// TUDO que está no banco de destino pelo conteúdo do backup).
import 'dotenv/config';
import zlib from 'zlib';
import readline from 'readline';
import { initStore, restoreSnapshot } from '../src/store.js';
import { isConfigured, listBackups, downloadBackup } from '../src/backup.js';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

async function main() {
  if (!isConfigured()) {
    console.error('Backup não configurado (B2_KEY_ID / B2_APPLICATION_KEY / B2_BUCKET_NAME ausentes no ambiente).');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const files = await listBackups();
  if (!files.length) {
    console.error('Nenhum backup encontrado no bucket.');
    process.exit(1);
  }

  if (args.includes('--list')) {
    console.log('Backups disponíveis (mais recente primeiro):');
    for (const f of files) {
      console.log(`  ${f.fileName}  ${(f.contentLength / 1024).toFixed(0)}KB  ${new Date(f.uploadTimestamp).toISOString()}`);
    }
    process.exit(0);
  }

  const requested = args.find(a => !a.startsWith('--'));
  const target = requested ? files.find(f => f.fileName === requested || f.fileName === `db-backup/${requested}`) : files[0];
  if (!target) {
    console.error(`Backup "${requested}" não encontrado. Rode com --list pra ver os disponíveis.`);
    process.exit(1);
  }

  const dbTarget = process.env.DATABASE_URL ? 'Postgres (DATABASE_URL do ambiente atual)' : 'data/db.json local';
  console.log(`Vai restaurar "${target.fileName}" (${new Date(target.uploadTimestamp).toISOString()}) em: ${dbTarget}`);
  console.log('Isso APAGA tudo que está no banco de destino agora e substitui pelo conteúdo do backup. Não tem volta.');
  const answer = await ask('Digite RESTAURAR para confirmar: ');
  if (answer.trim() !== 'RESTAURAR') {
    console.log('Cancelado.');
    process.exit(0);
  }

  await initStore();
  console.log('Baixando backup...');
  const gz = await downloadBackup(target.fileName);
  const snapshot = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  console.log(`Snapshot: ${Object.keys(snapshot.orders || {}).length} pedidos, ${Object.keys(snapshot.sessionsDaily || {}).length} dias de sessão.`);

  console.log('Restaurando...');
  const result = await restoreSnapshot(snapshot);
  console.log('Concluído:', result);
}

main().catch(e => { console.error('Restore falhou:', e.message); process.exit(1); });
