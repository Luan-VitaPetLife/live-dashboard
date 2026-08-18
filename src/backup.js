// ─────────────────────────────────────────────
//  backup.js — snapshot diário do banco pra Backblaze B2.
//  Sem SDK (mesma regra do resto do projeto — ver CLAUDE.md
//  "Dependências mínimas"): API nativa do B2 direto via fetch,
//  igual ao SigV4 feito à mão pra Amazon em amazon.js.
//
//  Motivo: sem plano Pro no Railway, não existe backup automático
//  do Postgres (só um manual antigo) — pedido do Luan, 18/08/2026.
// ─────────────────────────────────────────────
import 'dotenv/config';
import zlib from 'zlib';
import crypto from 'crypto';
import { getFullSnapshot, getBackupStatus, setBackupStatus } from './store.js';

const KEY_ID      = process.env.B2_KEY_ID;
const APP_KEY     = process.env.B2_APPLICATION_KEY;
const BUCKET_NAME = process.env.B2_BUCKET_NAME;
const PREFIX = 'db-backup/';
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);
const EVERY_HOURS    = Number(process.env.BACKUP_EVERY_HOURS || 24);

export function isConfigured() { return Boolean(KEY_ID && APP_KEY && BUCKET_NAME); }

async function b2Fetch(url, opts, label) {
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`B2 ${label}: ${json.message || json.code || res.status}`);
  return json;
}

// b2_authorize_account (API v4 — resposta aninhada em apiInfo.storageApi, diferente das versões
// antigas com apiUrl/downloadUrl direto na raiz que aparecem em exemplo antigo por aí).
export async function authorize() {
  const basic = Buffer.from(`${KEY_ID}:${APP_KEY}`).toString('base64');
  const json = await b2Fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    headers: { Authorization: `Basic ${basic}` },
  }, 'authorize_account');
  const storage = json.apiInfo?.storageApi;
  if (!storage) throw new Error('B2 authorize_account: resposta sem apiInfo.storageApi.');

  // Chave criada com acesso restrito a um bucket já devolve o bucketId em allowed.buckets — evita
  // precisar de uma variável de ambiente extra só pro ID. Sem restrição (chave de conta inteira),
  // resolve o nome via b2_list_buckets.
  let bucketId = storage.allowed?.buckets?.find(b => b.bucketName === BUCKET_NAME)?.bucketId
    || (storage.allowed?.buckets?.length === 1 ? storage.allowed.buckets[0].bucketId : null);
  if (!bucketId) {
    const lb = await b2Fetch(
      `${storage.apiUrl}/b2api/v4/b2_list_buckets?accountId=${json.accountId}&bucketName=${encodeURIComponent(BUCKET_NAME)}`,
      { headers: { Authorization: json.authorizationToken } },
      'list_buckets'
    );
    bucketId = lb.buckets?.[0]?.bucketId;
  }
  if (!bucketId) throw new Error(`B2: bucket "${BUCKET_NAME}" não encontrado ou a chave não tem acesso a ele.`);
  return { apiUrl: storage.apiUrl, downloadUrl: storage.downloadUrl, token: json.authorizationToken, bucketId };
}

// Baixa um backup pelo nome (scripts/restore-backup.mjs) — b2_download_file_by_name usa o
// downloadUrl da conta, não o apiUrl (hosts diferentes).
export async function downloadBackup(fileName) {
  const { downloadUrl, token } = await authorize();
  const encodedName = fileName.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${downloadUrl}/file/${encodeURIComponent(BUCKET_NAME)}/${encodedName}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`B2 download_file_by_name: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function getUploadUrl(apiUrl, token, bucketId) {
  return b2Fetch(`${apiUrl}/b2api/v4/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId }),
  }, 'get_upload_url');
}

async function uploadFile(uploadUrl, uploadToken, fileName, buf, contentType) {
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
  return b2Fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: uploadToken,
      'X-Bz-File-Name': encodeURIComponent(fileName),
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'X-Bz-Content-Sha1': sha1,
    },
    body: buf,
  }, 'upload_file');
}

export async function listBackups() {
  if (!isConfigured()) return [];
  const { apiUrl, token, bucketId } = await authorize();
  let files = [], startFileName;
  do {
    const json = await b2Fetch(`${apiUrl}/b2api/v4/b2_list_file_names`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketId, prefix: PREFIX, maxFileCount: 1000, startFileName }),
    }, 'list_file_names');
    files = files.concat(json.files);
    startFileName = json.nextFileName || undefined;
  } while (startFileName);
  return files.sort((a, b) => b.uploadTimestamp - a.uploadTimestamp);
}

async function deleteFile(apiUrl, token, fileName, fileId) {
  return b2Fetch(`${apiUrl}/b2api/v4/b2_delete_file_version`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, fileId }),
  }, 'delete_file_version');
}

// authSessions fica de fora do snapshot de propósito — token de sessão é efêmero (expira em 30
// dias, ver auth.js) e não deveria persistir em armazenamento frio; restaurar um backup antigo
// simplesmente exige login de novo, o que já é o comportamento esperado.
function buildSnapshotBuffer() {
  const full = getFullSnapshot();
  const { authSessions, ...rest } = full;
  const json = JSON.stringify(rest);
  return zlib.gzipSync(Buffer.from(json, 'utf8'));
}

export async function runBackup() {
  if (!isConfigured()) throw new Error('Backup não configurado (B2_KEY_ID / B2_APPLICATION_KEY / B2_BUCKET_NAME ausentes no ambiente).');
  const startedAt = new Date().toISOString();
  try {
    const { apiUrl, token, bucketId } = await authorize();
    const gz = buildSnapshotBuffer();
    const stamp = startedAt.slice(0, 19).replace(/[:T]/g, '-'); // 2026-08-18-14-30-00
    const fileName = `${PREFIX}${stamp}.json.gz`;

    const { uploadUrl, authorizationToken } = await getUploadUrl(apiUrl, token, bucketId);
    await uploadFile(uploadUrl, authorizationToken, fileName, gz, 'application/gzip');

    // Retenção: apaga backups mais antigos que BACKUP_RETENTION_DAYS.
    const files = await listBackups();
    const cutoff = Date.now() - RETENTION_DAYS * 864e5;
    let pruned = 0;
    for (const f of files) {
      if (f.uploadTimestamp < cutoff) {
        await deleteFile(apiUrl, token, f.fileName, f.fileId);
        pruned++;
      }
    }

    const status = { status: 'done', fileName, sizeBytes: gz.length, pruned, startedAt, finishedAt: new Date().toISOString() };
    setBackupStatus(status);
    return status;
  } catch (e) {
    const status = { status: 'error', message: e.message, startedAt, finishedAt: new Date().toISOString() };
    setBackupStatus(status);
    throw e;
  }
}

// Roda no máximo uma vez a cada BACKUP_EVERY_HOURS — chamado periodicamente pelo scheduler do
// server.js (mesmo padrão de auto-throttle do reconcileAmazonNames em sync.js).
export async function runBackupIfDue() {
  if (!isConfigured()) return null;
  const last = getBackupStatus();
  if (last?.finishedAt) {
    const hoursSince = (Date.now() - new Date(last.finishedAt).getTime()) / 36e5;
    if (hoursSince < EVERY_HOURS) return null;
  }
  return runBackup();
}
