// Todo recurso de CDN carrega com integrity (Subresource Integrity): o navegador confere o
// hash do arquivo antes de executar. Sem isso, um pacote adulterado na origem roda dentro da
// dashboard já logada, com acesso ao cookie de sessão e a tudo que a tela mostra.
//
// O risco do integrity é o oposto do risco de não tê-lo: um hash errado BLOQUEIA o recurso, e
// aí o gráfico ou o mapa simplesmente não aparece. Por isso este teste existe em duas partes —
// uma que roda sempre (toda tag tem hash, e o mesmo recurso tem o mesmo hash em todas as
// páginas) e uma que baixa o arquivo do CDN e confere byte a byte.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { criarTeste, PUB, paginas, buscar } from './_lib.mjs';

const t = criarTeste('Integridade dos recursos de CDN');

// A folha do Google Fonts não entra: o CSS que ela devolve varia conforme o navegador que
// pede, então o hash nunca bateria e o recurso ficaria bloqueado pra sempre.
const SEM_SRI = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const porUrl = new Map();
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  for (const m of s.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="(https:\/\/[^"]+)"([^>]*)>/g)) {
    const [, url, resto] = m;
    if (SEM_SRI.some(h => url.includes(h))) continue;
    const hash = resto.match(/integrity="([^"]+)"/)?.[1] || null;
    t.ok(!!hash, `${nome}: ${url.split('/').pop()} declara integrity`);
    // Sem crossorigin o navegador não consegue verificar recurso de outro domínio e bloqueia
    // do mesmo jeito — o par integrity+crossorigin é indivisível.
    t.ok(/crossorigin=/.test(resto), `${nome}: ${url.split('/').pop()} declara crossorigin`);
    if (!porUrl.has(url)) porUrl.set(url, new Map());
    porUrl.get(url).set(hash, (porUrl.get(url).get(hash) || 0) + 1);
  }
}

t.ok(porUrl.size > 0, `encontrou recursos de CDN para conferir (${porUrl.size})`);
// O mesmo arquivo carregado em várias páginas precisa do mesmo hash em todas. Uma página que
// ficou pra trás numa atualização de versão quebraria só ela, e só pra quem a abrisse.
for (const [url, hashes] of porUrl)
  t.ok(hashes.size === 1, `${url.split('/').pop()}: um hash só em todas as páginas (achei ${hashes.size})`);

// ── Daqui pra baixo precisa de rede ──
const urls = [...porUrl.keys()];
const primeira = await buscarBytes(urls[0]);
if (!primeira) {
  t.pular('sem rede: a conferência do hash contra o arquivo real não rodou');
} else {
  for (const url of urls) {
    const declarado = [...porUrl.get(url).keys()][0];
    const bytes = url === urls[0] ? primeira : await buscarBytes(url);
    if (!bytes) { t.ok(false, `${url} não respondeu`); continue; }
    const real = 'sha384-' + crypto.createHash('sha384').update(bytes.buf).digest('base64');
    t.ok(real === declarado,
      `${url.split('/').pop()}: o hash declarado bate com o arquivo do CDN${real === declarado ? '' : `\n        declarado ${declarado}\n        real      ${real}`}`);
    // crossorigin="anonymous" faz o navegador pedir o recurso em modo CORS. Se o CDN não
    // devolver Access-Control-Allow-Origin, a requisição falha inteira e o recurso não carrega
    // — hash certo, e ainda assim tela sem gráfico. É o único jeito de o integrity quebrar a
    // página sem o hash estar errado, então vale conferir.
    t.ok(!!bytes.cors, `${url.split('/').pop()}: o CDN devolve Access-Control-Allow-Origin (${bytes.cors || 'ausente'})`);
  }
  t.fim();
}

// buscar() do _lib devolve só o tamanho; aqui o conteúdo e o cabeçalho CORS é que interessam.
async function buscarBytes(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'coco-luna-dashboard/1.0 (teste automatizado)', Origin: 'https://live-dashboard-vitapetlife.up.railway.app' },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return { buf: Buffer.from(await r.arrayBuffer()), cors: r.headers.get('access-control-allow-origin') };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
