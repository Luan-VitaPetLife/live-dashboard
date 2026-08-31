// backfill.js — recupera pedido antigo das lojas Shopify (Coco and Luna + Yucaloo).
//
// Por que existe: o sync periódico busca uma janela móvel de 60 dias (defaultWindow em sync.js)
// e faz upsert. Nada anterior à PRIMEIRA sincronização jamais entrou no banco, então o histórico
// da dashboard começa quando o projeto começou, e não na primeira venda da empresa. A Amazon já
// tinha como recuperar isso (Reports API); as lojas Shopify não tinham, apesar de a Admin API
// servir o histórico inteiro.
//
// Como funciona: percorre a janela pedida em blocos de 30 dias, do mais antigo pro mais novo,
// e entrega cada bloco pronto pra quem chamou gravar. Gravar bloco a bloco (em vez de tudo no
// fim) é o que faz uma interrupção no meio preservar o que já veio — mesmo princípio do backfill
// da Amazon. Como o upsert é por id, repetir um bloco não duplica nada.
import * as shopify from './shopify.js';
import * as shopifyYucaloo from './shopifyYucaloo.js';
import { isIntegrationEnabled } from './store.js';

// A consulta de pedidos do shopify.js pagina até 50 páginas de 100, ou seja, 5.000 pedidos por
// janela. Com 30 dias por bloco isso dá folga de sobra pro volume atual (algumas centenas por
// mês no pico) e mantém cada consulta pequena o bastante pra não pesar na cota da Admin API.
export const CHUNK_DAYS = 30;

// Respiro entre blocos. A Admin API é limitada por custo, não por número de chamadas, e um
// backfill longo é a única coisa neste projeto que dispara muitas consultas grandes seguidas.
const PAUSA_ENTRE_BLOCOS_MS = 400;

const iso = d => d.toISOString().slice(0, 10);
const espera = ms => new Promise(r => setTimeout(r, ms));

// As lojas Shopify de um mercado. Cada uma sabe se pode rodar (integração ligada) e como
// buscar — a Coco and Luna por token fixo de ambiente, a Yucaloo pelo token de OAuth guardado
// no store, que devolve [] sozinho quando a loja ainda não foi conectada.
export function lojasDoMercado(market) {
  const lojas = [];

  if (market === 'br') {
    lojas.push({
      chave: 'shopify_br',
      nome: 'Shopify Coco and Luna BR',
      buscar: (since, until) => shopify.fetchOrders(since, until),
    });
  } else {
    const store = process.env.SHOPIFY_US_STORE;
    const token = process.env.SHOPIFY_US_ADMIN_TOKEN;
    if (store && token) {
      lojas.push({
        chave: 'shopify_us',
        nome: 'Shopify Coco and Luna EUA',
        buscar: (since, until) => shopify.fetchOrders(since, until, { store, token, market: 'us', channel: 'shopify_us' }),
      });
    }
  }

  lojas.push({
    chave: `yucaloo_${market}`,
    nome: `Shopify Yucaloo ${market === 'us' ? 'EUA' : 'BR'}`,
    buscar: (since, until) => shopifyYucaloo.fetchOrders(since, until, market),
  });

  return lojas.filter(l => isIntegrationEnabled(l.chave));
}

// Os blocos de datas que o backfill vai percorrer, do mais antigo pro mais novo.
// Exportada pra poder ser testada sem rede: é a parte com aritmética de data, que é onde
// um erro passa despercebido (bloco faltando no meio, dia repetido na emenda).
export function blocosDeDatas(days, hoje = new Date()) {
  const fim = new Date(hoje);
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - (days - 1));

  const blocos = [];
  let cursor = new Date(inicio);
  while (cursor <= fim) {
    const ate = new Date(cursor);
    ate.setDate(ate.getDate() + CHUNK_DAYS - 1);
    blocos.push({ since: iso(cursor), until: iso(ate > fim ? fim : ate) });
    cursor = new Date(ate);
    cursor.setDate(cursor.getDate() + 1);
  }
  return blocos;
}

// onProgress(mensagem, { feitos, total }) — chamada entre blocos; pode lançar pra cancelar.
// onChunk(pedidos, { loja, since, until }) — chamada com cada lote pronto pra gravar.
export async function backfillShopify({ market = 'br', days = 365, onProgress = () => {}, onChunk = () => {} } = {}) {
  const lojas = lojasDoMercado(market);
  if (!lojas.length) return { pedidos: 0, lojas: [], blocos: 0 };

  const blocos = blocosDeDatas(days);
  const total = blocos.length * lojas.length;
  let feitos = 0, pedidos = 0;
  const porLoja = {};
  const falhas = [];

  for (const loja of lojas) {
    porLoja[loja.nome] = 0;
    for (const { since, until } of blocos) {
      onProgress(`${loja.nome}: ${since} a ${until}`, { feitos, total });
      try {
        const lote = await loja.buscar(since, until);
        if (lote.length) {
          onChunk(lote, { loja: loja.nome, since, until });
          pedidos += lote.length;
          porLoja[loja.nome] += lote.length;
        }
      } catch (e) {
        // Uma janela que falha não pode derrubar o backfill inteiro: as outras continuam e o
        // que já veio fica gravado. Mas a falha PRECISA aparecer no fim, senão um buraco no
        // histórico passa por "não tinha venda nesse período" — que é exatamente a confusão
        // que este backfill existe pra desfazer.
        falhas.push(`${loja.nome} ${since}..${until}: ${e.message}`);
      }
      feitos++;
      await espera(PAUSA_ENTRE_BLOCOS_MS);
    }
  }

  onProgress(`${pedidos} pedidos gravados`, { feitos, total });
  return { pedidos, porLoja, blocos: blocos.length, lojas: lojas.map(l => l.nome), falhas };
}
