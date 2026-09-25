// As tabelas de mapa (nome de estado, centróide, códigos do IBGE e FIPS) eram
// cópias iguais dentro de geografia.html e segmentos.html, cerca de 150 linhas em cada. Uma
// correção num lado nunca chegava no outro. Agora vivem em js/geo.js, e este teste executa o
// módulo de verdade para conferir os dados, não só a presença do arquivo.
import fs from 'node:fs';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { criarTeste, PUB, paginas } from './_lib.mjs';

const t = criarTeste('Tabelas e utilitários de mapa');

const src = fs.readFileSync(path.join(PUB, 'js', 'geo.js'), 'utf8');
const janela = {};
const ctx = createContext({
  window: janela,
  // O geo.js só toca em L dentro de addBasemap, que este teste não chama.
  L: { tileLayer: () => ({ addTo: () => ({}) }) },
  fetch: async () => { throw new Error('sem rede neste teste'); },
});
try { runInContext(src, ctx); } catch (e) { t.ok(false, `geo.js não executou: ${e.message}`); }

const G = janela.CocoGeo;
if (t.ok(!!G, 'geo.js expõe window.CocoGeo')) {
  // Quantidades: se uma tabela perder linhas numa edição, o estado some do mapa em silêncio.
  const esperado = {
    'STATE_NAMES.br': 27, 'CENTROIDS.br': 27, 'IBGE_UF': 27,
    'STATE_NAMES.us': 60, 'CENTROIDS.us': 51, 'FIPS_UF': 51,
  };
  for (const [caminho, n] of Object.entries(esperado)) {
    const obj = caminho.split('.').reduce((o, k) => o?.[k], G);
    t.ok(Object.keys(obj || {}).length === n, `${caminho}: ${n} entradas (veio ${Object.keys(obj || {}).length})`);
  }

  // Todo estado do Brasil precisa de nome e centróide, senão o mapa desenha o polígono e não
  // consegue posicionar a pill de rótulo.
  for (const uf of Object.keys(G.STATE_NAMES.br)) {
    if (!G.CENTROIDS.br[uf]) t.ok(false, `BR ${uf}: sem centróide`);
  }
  t.ok(Object.keys(G.STATE_NAMES.br).every(uf => G.CENTROIDS.br[uf]), 'todo estado do Brasil tem nome e centróide');

  // Modo Calor (25/09/2026): um foco por cidade de verdade. Os pontos fixos inventados por estado
  // (SUB_REGIONS) saíram: uma venda virava vários focos, um deles atrás da pill.
  t.ok(!('SUB_REGIONS' in G), 'não existem mais pontos fixos inventados por estado');
  const sem = G.semCidade([{ state: 'BA', qty: 5 }, { state: 'SP', qty: 3 }, { state: 'RJ', qty: 2 }],
    [{ state: 'BA', qty: 2 }, { state: 'BA', qty: 1 }, { state: 'SP', qty: 3 }], 'qty');
  t.eq(JSON.stringify(sem), JSON.stringify({ BA: 2, RJ: 2 }), 'semCidade: estado menos a soma das cidades dele (SP completo não aparece)');
  t.eq(JSON.stringify(G.semCidade({ BA: { orders: 4 } }, [{ state: 'BA', orders: 1 }], 'orders')), JSON.stringify({ BA: 3 }),
    'semCidade aceita o byState da Geografia (objeto por UF)');
  t.ok(G.raioDoFoco(1, 'br') > G.raioDoFoco(0.25, 'br') && G.raioDoFoco(0.25, 'br') > G.raioDoFoco(0, 'br'),
    'foco maior pra cidade que vendeu mais');
  t.ok(G.raioDoFoco(9, 'br') === G.raioDoFoco(1, 'br') && G.raioDoFoco(-1, 'br') === G.raioDoFoco(0, 'br'),
    'raio do foco não passa dos limites');

  // Coordenada fora de faixa aponta latitude e longitude trocadas, erro fácil de cometer e
  // difícil de ver: o estado simplesmente aparece no meio do oceano.
  const coordOk = ([lat, lon]) => lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  const ruins = [];
  for (const m of ['br', 'us'])
    for (const [uf, c] of Object.entries(G.CENTROIDS[m]))
      if (!Array.isArray(c) || c.length !== 2 || !coordOk(c)) ruins.push(`${m}/${uf}`);
  t.ok(ruins.length === 0, `todo centróide é um par [lat, lon] plausível${ruins.length ? ' (' + ruins.join(', ') + ')' : ''}`);

  // O Brasil fica no hemisfério sul e a oeste de Greenwich; os EUA, no norte.
  t.ok(Object.values(G.CENTROIDS.br).every(([lat, lon]) => lat < 6 && lon < -30), 'os centróides do Brasil caem no Brasil');
  t.ok(Object.values(G.CENTROIDS.us).every(([lat]) => lat > 15), 'os centróides dos EUA caem no hemisfério norte');

  // O nome do estado é como o GeoJSON dos EUA é casado com a sigla.
  t.ok(G.NAME_TO_UF_US['California'] === 'CA', 'NAME_TO_UF_US casa California com CA');
  t.ok(G.NAME_TO_UF_US['District of Columbia'] === 'DC', 'NAME_TO_UF_US cobre o Distrito de Columbia');

  // Rampa de calor: os extremos e o meio precisam ser as cores pedidas, e nada pode sair NaN.
  t.ok(G.heatColor(0) === 'rgb(34,197,94)', `heatColor(0) é o verde (veio ${G.heatColor(0)})`);
  t.ok(G.heatColor(1) === 'rgb(239,68,68)', `heatColor(1) é o vermelho (veio ${G.heatColor(1)})`);
  // Arrow, e não `.map(G.heatColor)`: o map passa o índice como segundo argumento, que cairia
  // no parâmetro de cores da função.
  t.ok(!/NaN/.test([0, 0.25, 0.5, 0.75, 1, -3, 9].map(v => G.heatColor(v)).join()), 'heatColor nunca devolve NaN, nem fora da faixa 0..1');
}

// ── Nenhuma página pode redeclarar o que agora é compartilhado ──
const COMPARTILHADO = ['STATE_NAMES_BR', 'STATE_NAMES_US', 'IBGE_UF', 'FIPS_UF', 'CENTROIDS_BR', 'CENTROIDS_US', 'SUB_REGIONS_BR', 'SUB_REGIONS_US', 'ESRI_TILE', 'ESRI_ATTR'];
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  const repetidos = COMPARTILHADO.filter(c => new RegExp(`(const|let|var)\\s+${c}\\s*=`).test(s));
  t.ok(repetidos.length === 0, `${nome} não redeclara tabela de mapa${repetidos.length ? ' (' + repetidos.join(', ') + ')' : ''}`);
}

// As duas telas desenham o calor pelas cidades do servidor, nunca por ponto inventado.
for (const [nome, campo] of [['js/paginas/segmentos.js', 'p.byCity'], ['js/paginas/geografia.js', 'd.byCity']]) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  t.ok(s.includes(campo) && s.includes('CocoGeo.raioDoFoco(') && s.includes('CocoGeo.semCidade('),
    `${nome}: foco por cidade (${campo}) e contagem do que ficou sem cidade`);
  t.ok(!/SUB_REGIONS/.test(s), `${nome}: nada de pontos fixos por estado`);
  // Cidade é texto digitado pelo cliente: sempre escapada no popup.
  t.ok(/escapeHtml\(c\.cidade/.test(s), `${nome}: nome da cidade escapado no popup`);
}

// Quem desenha mapa precisa carregar o módulo.
for (const nome of paginas()) {
  const s = fs.readFileSync(path.join(PUB, nome), 'utf8');
  if (!s.includes('L.map(')) continue;
  t.ok(s.includes('js/geo.js'), `${nome} carrega js/geo.js`);
}

t.fim();
