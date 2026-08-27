// O contorno dos estados dos EUA é servido do próprio domínio (antes vinha de um repositório
// de terceiros, que podia sumir sem aviso). Se o arquivo for movido, renomeado ou trocado por
// um de formato diferente, o mapa dos EUA desenha em branco sem erro nenhum: o Leaflet apenas
// não acha o estado. Este teste sobe SÓ a parte estática do servidor — não importa o server.js,
// porque subir o servidor de verdade dispararia o sync das integrações.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { criarTeste, ROOT, PUB, paginas } from './_lib.mjs';

const t = criarTeste('GeoJSON dos estados dos EUA');

const CAMINHO = '/geo/us-states.json';

// As duas telas de mapa precisam apontar pro arquivo local.
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  if (!s.includes('us-states.json')) continue;
  t.ok(s.includes(`'${CAMINHO}'`), `${nome} busca o arquivo local`);
  t.ok(!s.includes('PublicaMundi'), `${nome} não busca mais no repositório de terceiros`);
}

const app = express();
app.use(express.static(PUB));
const srv = app.listen(0);
const porta = srv.address().port;

try {
  const r = await fetch(`http://127.0.0.1:${porta}${CAMINHO}`);
  t.ok(r.ok, `GET ${CAMINHO} responde ${r.status}`);
  if (r.ok) {
    const j = await r.json();
    t.ok(j.type === 'FeatureCollection', 'é um FeatureCollection');
    t.ok(j.features?.length === 52, `52 feições, 50 estados mais DC e Porto Rico (veio ${j.features?.length})`);
    // A tela casa a feição pelo properties.name. Se o formato mudar, o mapa fica em branco.
    const nomes = new Set((j.features || []).map(f => f.properties?.name));
    for (const n of ['California', 'Texas', 'New York', 'Florida', 'District of Columbia'])
      t.ok(nomes.has(n), `properties.name traz "${n}"`);
  }
} finally {
  srv.close();
}

// O portão de acesso do server.js só deixa passar sem login o que casa com STATIC_ASSET_RE.
// Um .json fora dessa lista viraria redirecionamento pro login e o mapa receberia HTML.
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const re = server.match(/const STATIC_ASSET_RE = (\/.*\/[a-z]*);/);
t.ok(!!re && new RegExp(re[1].slice(1, re[1].lastIndexOf('/')), 'i').test(CAMINHO),
  'o portão de acesso trata .json como arquivo estático');

t.fim();
