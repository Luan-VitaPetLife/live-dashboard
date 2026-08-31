// O fundo do mapa é o recurso externo mais frágil da dashboard: o provedor muda de política e
// o mapa continua "funcionando", só que com a marca d'água do provedor carimbada por cima.
// Foi o que a CartoDB fez em 08/2026 — tile com HTTP 200, imagem válida, "API KEY REQUIRED"
// escrito atravessado no meio do Brasil. Nada no código falhou, o usuário é que viu.
//
// Duas checagens: uma que roda sempre (ninguém volta pra um provedor que exige chave, e nenhuma
// página monta o próprio fundo) e uma que precisa de rede (os tiles configurados respondem).
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, PUB, paginas, buscar, fontePagina } from './_lib.mjs';

const t = criarTeste('Fundo do mapa');

const geoJs = fs.readFileSync(path.join(PUB, 'js', 'geo.js'), 'utf8');

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
for (const [host, marca] of EXIGEM_CHAVE)
  t.ok(!geoJs.includes(host), `o fundo do mapa não usa ${marca}, que exige chave`);

// O fundo vive num lugar só (js/geo.js). Uma página que monte o próprio L.tileLayer volta a
// poder divergir da outra — foi assim que a troca de provedor quase pegou só uma das telas.
const comMapa = [];
for (const nome of paginas()) {
  const s = fontePagina(nome).tudo;
  if (!s.includes('L.map(')) continue;
  comMapa.push(nome);
  t.ok(!s.includes('L.tileLayer'), `${nome} não monta o próprio fundo, usa CocoGeo.addBasemap`);
  t.ok(s.includes('CocoGeo.addBasemap'), `${nome} chama CocoGeo.addBasemap`);
}
t.ok(comMapa.length === 2, `duas telas desenham mapa (${comMapa.join(', ')})`);

const m = geoJs.match(/const TILE_URL = camada =>\s*`([^`]+)`/);
t.ok(!!m, 'geo.js declara o template do tile');

const template = m?.[1];
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
