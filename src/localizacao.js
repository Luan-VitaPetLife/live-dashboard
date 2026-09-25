// Onde, no mapa, fica a entrega de um pedido. Serve ao modo "Calor" de Segmentos e de Geografia.
//
// Até 25/09/2026 a dashboard só guardava a SIGLA do estado, e o mapa de calor desenhava cada venda do
// estado em 3 a 5 pontos FIXOS escritos à mão (o primeiro deles no centro do estado, bem atrás da
// etiqueta). Uma venda na Bahia aparecia como cinco focos espalhados, nenhum deles onde a venda foi,
// e uma cidade que teve pedido nunca ganhava foco (relatado pelo Luan com print). Hoje cada pedido
// guarda a cidade, e este módulo diz a coordenada dela.
//
// De onde vem a coordenada, do mais preciso pro menos:
//   1. `geo` gravado no pedido: a Shopify e o Mercado Livre mandam latitude/longitude do endereço.
//      Arredondada a 2 casas (~1 km) NA CAPTURA: é o endereço de casa de um cliente, e o mapa só
//      precisa da cidade.
//   2. Brasil: UF + nome da cidade na tabela de municípios do IBGE (5.571, `geo-dados/municipios-br.json`,
//      gerada da base pública kelvins/municipios-brasileiros, licença MIT).
//   3. EUA: CEP de 5 dígitos na tabela de ZCTA do Censo americano (33.791, `geo-dados/cep-us.json`,
//      Census Gazetteer 2023, domínio público).
// Nada disso encontrado → null. Venda sem coordenada NÃO vira foco inventado: entra só na contagem
// do estado, e a tela diz quantas ficaram sem cidade.
//
// Tabelas carregadas uma vez, só quando alguém pede (~1 MB): quem nunca abre o mapa não paga a memória.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'geo-dados');
let tabelaBR = null, tabelaUS = null;
function municipios() { return tabelaBR ||= JSON.parse(fs.readFileSync(path.join(DIR, 'municipios-br.json'), 'utf8')); }
function ceps() { return tabelaUS ||= JSON.parse(fs.readFileSync(path.join(DIR, 'cep-us.json'), 'utf8')); }

// "São Luís", "SAO LUIS", "Sao Luis - MA", "Aparecida D'Oeste" → mesma chave da tabela.
export function normalizarCidade(nome) {
  return String(nome || '')
    .replace(/\s+-\s+[A-Za-z]{2}\s*$/, '') // "Cidade - UF" (o Bling e alguns canais mandam assim)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Caixa geográfica de cada mercado: coordenada fora dela é lixo (0,0, sinal trocado) e não pode
// virar um foco no meio do oceano.
const CAIXA = {
  br: { lat: [-34, 6], lng: [-74.5, -28] },
  us: { lat: [17, 72], lng: [-180, -64] },
};
function dentro(market, lat, lng) {
  const c = CAIXA[market];
  return c && Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= c.lat[0] && lat <= c.lat[1] && lng >= c.lng[0] && lng <= c.lng[1];
}

const r2 = n => Math.round(n * 100) / 100;

// Latitude/longitude vinda do canal → `geo` pra gravar no pedido (ou null). Arredonda a 2 casas.
export function geoDoCanal(market, lat, lng) {
  const la = Number(lat), lo = Number(lng);
  if (lat == null || lng == null || !dentro(market, la, lo)) return null; // 0,0 (vazio) cai fora da caixa
  return [r2(la), r2(lo)];
}

// Brasil: nome de município que só existe em UM estado → [lat,lng]. Socorro pra quando o estado veio
// numa grafia que não é UF ou veio errado; nome repetido em dois estados não entra (seria chute).
let unicosBR = null;
function municipioUnico(nomeNorm) {
  if (!unicosBR) {
    const cont = {};
    unicosBR = {};
    for (const [k, c] of Object.entries(municipios())) {
      const n = k.slice(3);
      cont[n] = (cont[n] || 0) + 1;
      unicosBR[n] = c;
    }
    for (const n of Object.keys(cont)) if (cont[n] > 1) delete unicosBR[n];
  }
  return unicosBR[nomeNorm] || null;
}

// Coordenada [lat, lng] da entrega de um pedido, ou null.
export function coordenadaDoPedido(o) {
  if (!o) return null;
  const market = o.market === 'us' ? 'us' : 'br';
  if (Array.isArray(o.geo) && dentro(market, o.geo[0], o.geo[1])) return o.geo;
  if (market === 'br' && o.city) {
    const n = normalizarCidade(o.city);
    const c = (o.state && municipios()[String(o.state).toUpperCase() + '|' + n]) || municipioUnico(n);
    if (c) return c;
  }
  if (market === 'us' && o.zip) {
    const zip5 = String(o.zip).replace(/\D/g, '').slice(0, 5);
    const c = zip5.length === 5 ? ceps()[zip5] : null;
    if (c) return c;
  }
  return null;
}

// Nome da cidade pra mostrar ("Salvador"), sem sufixo de UF.
export function nomeDaCidade(o) {
  const c = String(o?.city || '').replace(/\s+-\s+[A-Za-z]{2}\s*$/, '').trim();
  return c || null;
}

// Onde a venda entra no mapa de calor: { chave, cidade, lat, lng }, ou null (fica só na contagem do
// estado, como "sem cidade"). `uf` é o estado JÁ normalizado por quem chama (o mesmo do ranking).
//
// A chave é a CIDADE, não a coordenada: a Shopify manda a coordenada do endereço de cada cliente, e
// agrupar por ela faria dez focos numa cidade só. Por isso, no Brasil, a coordenada da cidade da
// tabela vale ANTES da do pedido; a do pedido só entra quando a cidade não está na tabela.
export function lugarDoPedido(o, uf) {
  if (!o) return null;
  const market = o.market === 'us' ? 'us' : 'br';
  const cidade = nomeDaCidade(o);
  const n = normalizarCidade(cidade);
  let coord = null;
  if (market === 'br' && n) coord = (uf && municipios()[uf + '|' + n]) || municipioUnico(n);
  if (!coord) coord = coordenadaDoPedido(o);
  if (!coord) return null;
  const chave = n ? `${uf || '?'}|${n}` : `@${coord[0].toFixed(1)},${coord[1].toFixed(1)}`;
  return { chave, cidade, lat: coord[0], lng: coord[1] };
}
