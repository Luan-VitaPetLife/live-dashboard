// Mapa de calor por cidade de verdade (Segmentos e Geografia).
//
// Caso real (25/09/2026): um produto que vendeu 1 unidade no dia, pelo TikTok Shop, aparecia com
// vários focos no mesmo estado, e sempre um atrás da pill laranja. Eram 3 a 5 pontos FIXOS por
// estado, escritos à mão, pintados pra qualquer venda. E cidade que teve pedido nunca ganhava
// foco, porque a dashboard só guardava a sigla do estado.
//
// Executa as funções puras (localizacao.js e revenueByCity) e confere a captura em cada canal.
import path from 'node:path';
import { criarTeste, ler, ROOT } from './_lib.mjs';

const t = criarTeste('mapa de calor por cidade');
delete process.env.DATABASE_URL;
const url = f => 'file:///' + path.join(ROOT, f).replace(/\\/g, '/');
const L = await import(url('src/localizacao.js'));
const { revenueByCity } = await import(url('src/metrics.js'));

// ── Onde fica a cidade ──
const salvador = L.coordenadaDoPedido({ market: 'br', state: 'BA', city: 'Salvador' });
t.ok(salvador && Math.abs(salvador[0] + 12.97) < 0.05 && Math.abs(salvador[1] + 38.5) < 0.05, 'Salvador/BA pela tabela do IBGE');
t.ok(!!L.coordenadaDoPedido({ market: 'br', state: 'SP', city: 'SÃO PAULO' }), 'caixa alta e acento não atrapalham');
t.ok(!!L.coordenadaDoPedido({ market: 'br', state: 'MA', city: 'Sao Luis - MA' }), 'sufixo " - UF" (Bling) não atrapalha');
t.ok(!!L.coordenadaDoPedido({ market: 'br', state: 'SP', city: "Aparecida d'Oeste" }), 'apóstrofo não atrapalha');
t.ok(!!L.coordenadaDoPedido({ market: 'br', state: 'SAO PAULO', city: 'Feira de Santana' }),
  'estado em grafia errada: nome de município que só existe num estado ainda acha');
t.eq(L.coordenadaDoPedido({ market: 'br', state: 'XX', city: 'Bom Jesus' }), null,
  'nome repetido em vários estados, sem estado válido: não chuta');
t.eq(L.coordenadaDoPedido({ market: 'br', state: 'SP', city: '****' }), null, 'endereço mascarado (Shopee) não vira foco');
t.ok(!!L.coordenadaDoPedido({ market: 'us', state: 'CA', zip: '90210-1234' }), 'EUA pelo CEP de 5 dígitos (ZIP+4 também)');
t.eq(L.coordenadaDoPedido({ market: 'us', state: 'CA', zip: '00000' }), null, 'CEP que não existe: sem foco');

// Coordenada do canal: arredondada a ~1 km (é a casa do cliente) e validada pelo país.
t.eq(JSON.stringify(L.geoDoCanal('br', -12.97123, -38.50111)), '[-12.97,-38.5]', 'coordenada do canal arredondada a 2 casas');
t.eq(L.geoDoCanal('br', 0, 0), null, '0,0 (coordenada vazia) é descartada');
t.eq(L.geoDoCanal('br', 40.7, -74), null, 'coordenada fora do país do mercado é descartada');
t.eq(L.geoDoCanal('br', null, null), null, 'sem coordenada, null');

// A chave é a CIDADE: dois clientes da mesma cidade com coordenadas diferentes = um foco só.
const a = L.lugarDoPedido({ market: 'br', state: 'BA', city: 'Salvador', geo: [-12.9, -38.4] }, 'BA');
const b = L.lugarDoPedido({ market: 'br', state: 'BA', city: 'salvador', geo: [-13.0, -38.5] }, 'BA');
t.ok(a && b && a.chave === b.chave && a.lat === b.lat, 'mesma cidade, mesmo foco (coordenada da cidade, não da casa)');
t.eq(L.lugarDoPedido({ market: 'br', state: 'BA' }, 'BA'), null, 'pedido só com estado não ganha foco inventado');

// ── Agregação por cidade (Geografia) ──
const pedidos = [
  { id: 1, market: 'br', channel: 'tiktok', state: 'BA', city: 'Salvador', total: 100 },
  { id: 2, market: 'br', channel: 'shopify', state: 'BA', city: 'SALVADOR', total: 50 },
  { id: 3, market: 'br', channel: 'shopee', state: 'BA', city: 'Feira de Santana', total: 30 },
  { id: 4, market: 'br', channel: 'shopee', state: 'BA', total: 20 },        // sem cidade: só no estado
  { id: 5, market: 'br', channel: 'shopify', state: 'SP', city: 'Campinas', total: 0 }, // total 0: fora, igual ao estado
];
const cidades = revenueByCity(pedidos, 'br');
t.eq(cidades.length, 2, 'duas cidades: Salvador e Feira de Santana (nem o sem cidade, nem o de total zero)');
t.eq(cidades[0].cidade + '|' + cidades[0].orders + '|' + cidades[0].revenue, 'Salvador|2|150', 'Salvador soma os dois pedidos');
t.eq(cidades[0].byChannel.tiktok, 100, 'e sabe por qual canal');
t.eq(cidades[0].state, 'BA', 'cada cidade diz o estado (pra contar o que ficou sem cidade)');

// ── Captura em cada canal ──
const SHOPIFY = ler('src/shopify.js');
t.ok(/shippingAddress \{ provinceCode city zip latitude longitude \}/.test(SHOPIFY), 'Shopify pede cidade, CEP e coordenada (as quatro lojas usam a mesma consulta)');
t.ok(/city:\s+n\.shippingAddress\?\.city/.test(SHOPIFY) && /geo:\s+geoDoCanal\(market,/.test(SHOPIFY), 'Shopify grava cidade e coordenada validada');
const ML = ler('src/mercadolivre.js');
t.ok(/city: ra\.city\?\.name/.test(ML) && /zip: ra\.zip_code/.test(ML) && /geoDoCanal\('br', ra\.latitude, ra\.longitude\)/.test(ML), 'Mercado Livre grava cidade, CEP e coordenada do envio');
t.ok(/o\.city = l\.city; o\.zip = l\.zip; o\.geo = l\.geo;/.test(ML), 'Mercado Livre passa o lugar pro pedido');
const AMZ = ler('src/amazon.js');
t.ok(/city:\s+o\.ShippingAddress\?\.City/.test(AMZ) && /zip:\s+o\.ShippingAddress\?\.PostalCode/.test(AMZ), 'Amazon (Orders API) grava cidade e CEP');
t.ok(/city:\s+r\['ship-city'\]/.test(AMZ) && /zip:\s+r\['ship-postal-code'\]/.test(AMZ), 'Amazon (relatório/backfill) grava cidade e CEP');
const TT = ler('src/tiktok.js');
t.ok(/city:\s+d\.transporte\?\.etiqueta\?\.municipio/.test(TT) && /zip:\s+d\.transporte\?\.etiqueta\?\.cep/.test(TT), 'TikTok grava cidade e CEP da etiqueta do Bling');
const BLING = ler('src/bling.js');
const endereco = BLING.slice(BLING.indexOf('export async function fetchOrderAddress'), BLING.indexOf('// ── Sonda das saídas'));
t.ok(/city: e\.municipio/.test(endereco) && /zip:\s+e\.cep/.test(endereco), 'Bling devolve cidade e CEP (Shopee mascara o endereço)');
t.ok(!/endereco|numero|nome|bairro/.test(endereco.replace(/\/\/.*$/gm, '')), 'Bling: rua, número, bairro e nome do cliente nunca saem');

// Shopee: pedido que tem estado mas não tem cidade precisa ser perguntado ao Bling UMA vez.
const SYNC = ler('src/sync.js');
t.ok(/if \(localOrder\.state && \(localOrder\.city \|\| localOrder\.lugarConsultado\)\) \{ out\.alreadyHadState\+\+; continue; \}/.test(SYNC),
  'reconciliação pede a cidade de quem tem só o estado, e não repete quem já foi perguntado');
t.ok(/lugarConsultado: true/.test(SYNC), 'marca o pedido como perguntado');
t.ok(/if \(local && !local\.city && !local\.lugarConsultado\) queue\.push\(\{ blingId: o\.id, localId: local\.id \}\);/.test(SYNC),
  'TikTok gravado antes da captura da cidade também é completado (só patch, nunca insere)');

// O sync de 15 min regrava a Shopee sem cidade: a guarda impede apagar o que o Bling preencheu.
const STORE = ler('src/store.js');
t.ok(/if \(existing && !o\.city && existing\.city\) \{\s+o\.city = existing\.city;/.test(STORE), 'upsertOrders não apaga a cidade');
t.ok(/if \(existing && !o\.geo && existing\.geo\) o\.geo = existing\.geo;/.test(STORE), 'upsertOrders não apaga a coordenada');
t.ok(/if \(existing && !o\.lugarConsultado && existing\.lugarConsultado\) o\.lugarConsultado/.test(STORE), 'upsertOrders não apaga a marca de consultado');
t.ok(/if \(!existing\.city && p\.city\) \{ existing\.city = p\.city;/.test(STORE), 'patchOrderState preenche a cidade que falta (e nunca troca a que existe)');

// Segmentos: foco por cidade dentro de cada produto, e o Unificador junta as cidades dos membros.
const M = ler('src/metrics.js');
t.ok(/const lugar = geoState \? lugarDoPedido\(o, geoState\) : null;/.test(M) && /byCity: Object\.entries\(g\.byCity\)/.test(M), 'Segmentos: cidades por produto');
t.ok(/\{ key: 'byCity', idKey: 'chave', sumKeys: \['qty', 'revenue', 'orders'\], keepKeys: \['state', 'cidade', 'lat', 'lng'\] \}/.test(M) &&
  /for \(const kk of ak\.keepKeys \|\| \[\]\) acc\[id\]\[kk\] = entry\[kk\];/.test(M), 'produto unificado junta as cidades dos membros sem perder nome e coordenada');
t.ok(/byCity: revenueByCity\(valid, market\),/.test(M), 'Geografia recebe as cidades no /api/dashboard');

t.fim();
