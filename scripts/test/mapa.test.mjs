// O fundo do mapa é o recurso externo mais frágil da dashboard: o provedor muda de política e
// o mapa continua "funcionando", só que com a marca d'água do provedor carimbada por cima.
// Foi o que a CartoDB fez em 08/2026 — tile com HTTP 200, imagem válida, "API KEY REQUIRED"
// escrito atravessado no meio do Brasil. Nada no código falhou, o usuário é que viu.
//
// Duas checagens: uma que roda sempre (nenhuma página pode voltar a apontar pra um provedor
// que exige chave) e uma que precisa de rede (os tiles configurados respondem mesmo).
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, PUB, paginas, buscar } from './_lib.mjs';

const t = criarTeste('Fundo do mapa');

// Provedores que hoje exigem chave de API. Voltar pra qualquer um destes sem uma chave traz
// a marca d'água de volta.
const EXIGEM_CHAVE = [
  ['basemaps.cartocdn.com', 'CartoDB'],
  ['cartodb-basemaps', 'CartoDB (domínio antigo)'],
  ['tiles.stadiamaps.com', 'Stadia Maps'],
  ['api.maptiler.com', 'MapTiler'],
  ['tile.thunderforest.com', 'Thunderforest'],
  ['api.mapbox.com', 'Mapbox'],
];

const comMapa = [];
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  if (!s.includes('L.tileLayer')) continue;
  comMapa.push(nome);
  for (const [host, marca] of EXIGEM_CHAVE)
    t.ok(!s.includes(host), `${nome} não usa ${marca}, que exige chave`);
}
t.ok(comMapa.length === 2, `duas telas desenham mapa (${comMapa.join(', ')})`);

// As duas telas precisam do MESMO fundo: são o mesmo tipo de mapa, e já aconteceu de uma
// mudança pegar só um dos arquivos.
const urls = new Set();
for (const nome of comMapa) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  const m = s.match(/const ESRI_TILE = camada =>\s*`([^`]+)`/);
  if (m) urls.add(m[1]);
  t.ok(!!m, `${nome} declara o template do tile`);
}
t.ok(urls.size === 1, `as duas telas usam o mesmo provedor (${urls.size} template(s) distinto(s))`);

const template = [...urls][0];
if (template) {
  for (const marca of ['{z}', '{x}', '{y}'])
    t.ok(template.includes(marca), `o template tem ${marca}`);
  t.ok(!/\bkey=|\bapikey=|access_token=/i.test(template), 'o template não carrega chave embutida (o repositório é público)');

  // ── Daqui pra baixo precisa de rede ──
  const monta = camada => template
    .replace('${camada}', camada)
    .replace('{z}', '5').replace('{y}', '17').replace('{x}', '12');

  const primeira = await buscar(monta('Base'));
  if (!primeira) {
    t.pular('sem rede: a parte que baixa tile de verdade não rodou');
  } else {
    for (const camada of ['Base', 'Reference']) {
      const r = camada === 'Base' ? primeira : await buscar(monta(camada));
      if (!r) { t.ok(false, `camada ${camada} não respondeu`); continue; }
      t.ok(r.ok, `camada ${camada} responde HTTP ${r.status}`);
      t.ok(r.tipo.startsWith('image/'), `camada ${camada} devolve imagem (${r.tipo})`);
      t.ok(r.bytes > 500, `camada ${camada} tem conteúdo (${r.bytes} bytes)`);
    }
    t.fim();
  }
} else {
  t.fim();
}
