// historico.js — transforma o registro cru de uma edição na frase que a tela mostra.
//
// A frase e os valores saem PRONTOS daqui, e o front só desenha. É o mesmo princípio já usado no
// card de Insights (ver CLAUDE.md): duas pontas formatando o mesmo número acabam discordando, e
// aqui isso seria especialmente ruim — o histórico existe justamente pra dizer que valor era.
//
// Puro: recebe as linhas já lidas e devolve a lista montada. Não lê banco, não faz I/O.
import { CANAIS } from './metrics.js';

// Páginas que aparecem no seletor. Uma página só entra se ela tem ALGO que uma pessoa salva —
// Visão geral, Geografia e Campanhas não têm nada editável, então não têm histórico pra mostrar,
// e oferecê-las seria prometer uma lista que nunca teria conteúdo.
//
// `mercados` vazio quer dizer que aquilo não é por país: usuário e liga/desliga de integração
// valem pra dashboard inteira. A tela esconde o seletor de país nesses casos, em vez de mostrar
// um filtro que não filtra nada.
export const PAGINAS = [
  { id: 'produtos',      label: 'Produtos',      mercados: ['br', 'us'] },
  { id: 'estoque',       label: 'Estoque',       mercados: ['br', 'us'] },
  { id: 'unificador',    label: 'Unificador',    mercados: ['br', 'us'] },
  { id: 'segmentos',     label: 'Segmentos',     mercados: ['br', 'us'] },
  { id: 'integracoes',   label: 'Integrações',   mercados: ['br', 'us'] },
  { id: 'configuracoes', label: 'Configurações', mercados: [] },
];

const MOEDA = { br: { locale: 'pt-BR', currency: 'BRL' }, us: { locale: 'en-US', currency: 'USD' } };

// Nome e país de cada integração que dá pra ligar/desligar. `setIntegrationEnabled` só recebe a
// CHAVE, então sem esta tabela o histórico diria "Luan desligou shopee", em minúsculo e com o
// nome interno — e a integração não apareceria sob país nenhum, apesar de a Shopee ser só do
// Brasil. A lista precisa bater com a de `computeIntegrationsList` (server.js), que é a que a
// tela de Integrações mostra: `scripts/test/historico.test.mjs` compara as duas e falha se elas
// divergirem, que é o único jeito de uma cópia dessas não envelhecer escondida.
export const INTEGRACOES = {
  shopify_br:       { label: 'Shopify - Coco and Luna BR',  market: 'br' },
  yucaloo_br:       { label: 'Yucaloo BR',                  market: 'br' },
  mercadolivre:     { label: 'Mercado Livre',               market: 'br' },
  amazon_br:        { label: 'Amazon BR',                   market: 'br' },
  shopee:           { label: 'Shopee',                      market: 'br' },
  bling:            { label: 'Bling',                       market: 'br' },
  mercadolivre_ads: { label: 'Mercado Ads',                 market: 'br' },
  meta_br:          { label: 'Meta Ads BR',                 market: 'br' },
  shopify_us:       { label: 'Shopify - Coco and Luna EUA', market: 'us' },
  yucaloo_us:       { label: 'Yucaloo EUA',                 market: 'us' },
  amazon_us:        { label: 'Amazon EUA',                  market: 'us' },
  meta_us:          { label: 'Meta Ads EUA',                market: 'us' },
  google_ads:       { label: 'Google Ads',                  market: 'us' },
};

// Mercado da linha: o que foi gravado, ou o do canal quando a edição é por canal (Produtos e
// Estoque gravam "canal|||título", e o canal é que diz o país), ou o da integração ligada.
export function mercadoDaLinha(l) {
  if (l.market) return l.market;
  if (l.canal && CANAIS[l.canal]) return CANAIS[l.canal].market;
  if (l.pagina === 'integracoes' && INTEGRACOES[l.alvo]) return INTEGRACOES[l.alvo].market;
  return null;
}

// O nome que a pessoa reconhece. Só a tela de Integrações precisa dessa tradução: nas outras o
// alvo já é o nome do produto ou do grupo, escrito pela própria pessoa.
function alvoLegivel(l) {
  if (l.pagina === 'integracoes' && INTEGRACOES[l.alvo]) return INTEGRACOES[l.alvo].label;
  return l.alvo || null;
}

// Valor legível. Dinheiro sempre com centavos e com o símbolo saindo do Intl, igual ao resto da
// dashboard (ver "Dinheiro sempre com centavos" no CLAUDE.md).
export function valor(v, formato, market) {
  if (v === null || v === undefined || v === '') return null;
  if (formato === 'dinheiro') {
    const { locale, currency } = MOEDA[market] || MOEDA.br;
    return (Number(v) || 0).toLocaleString(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (formato === 'porcentagem') return String(Number(v) || 0).replace('.', ',') + '%';
  if (formato === 'numero')      return String(Number(v) || 0).replace('.', ',');
  return String(v);
}

// A frase, em PEDAÇOS, com o valor antigo e o novo já separados do texto.
//
// Em pedaços, e não como uma frase pronta que a tela depois vasculha atrás dos valores pra
// destacar: procurar quebra quando um valor é pedaço do outro. Numa mudança de estoque "de 10
// para 1", procurar o "1" acharia primeiro o "1" de dentro do "10" que acabou de ser marcado, e
// o destaque sairia embaralhado. Aqui a tela só pinta o que já veio separado.
//
// Cada ação tem a sua frase, porque "editou com valor antigo" e "apagou" não são a mesma coisa
// dita de jeitos diferentes: são fatos diferentes.
export function partes(l, { de, para }) {
  const quem = l.autor || 'O sistema';
  const alvo = l.alvo || '';
  const t = v => ({ t: 'txt', v });
  // O NOME do campo também sai separado, pra tela poder destacá-lo: numa lista de várias edições
  // do mesmo produto, o que muda de uma linha pra outra é justamente qual campo foi mexido, e é
  // isso que o olho procura primeiro. Pedido do Luan, 04/09/2026.
  const campo = { t: 'campo', v: l.campo || '' };
  switch (l.acao) {
    case 'criou':    return para ? [t(`${quem} criou ${alvo} como `), { t: 'para', v: para }] : [t(`${quem} criou ${alvo}`)];
    case 'apagou':   return [t(`${quem} apagou ${alvo}`)];
    case 'ligou':    return [t(`${quem} ligou ${alvo}`)];
    case 'desligou': return [t(`${quem} desligou ${alvo}`)];
    case 'agrupou':  return [t(`${quem} adicionou `), { t: 'para', v: para || '' }, t(` ao grupo ${alvo}`)];
    default:
      if (de && para) return [t(`${quem} mudou `), campo, t(` em ${alvo}: de `), { t: 'de', v: de }, t(' para '), { t: 'para', v: para }];
      if (para)       return [t(`${quem} definiu `), campo, t(` em ${alvo} como `), { t: 'para', v: para }];
      if (de)         return [t(`${quem} removeu `), { t: 'de', v: de }, t(' de '), campo, t(` em ${alvo}`)];
      return [t(`${quem} alterou `), campo, t(` em ${alvo}`)];
  }
}

// A mesma frase, corrida. É o que vai no `texto` de cada item: quem ler a API direto não deveria
// precisar remontar nada.
export function frase(l, vals) {
  return partes(l, vals).map(p => p.v).join('');
}

// Monta a lista já filtrada e com a frase pronta. `pagina` obrigatória (a tela sempre escolhe
// uma); `market` opcional — sem ele, vem tudo daquela página.
export function montar(linhas, { pagina, market } = {}) {
  const out = [];
  for (const l of linhas) {
    if (pagina && l.pagina !== pagina) continue;
    const mkt = mercadoDaLinha(l);
    // Filtro de país só descarta linha que TEM país e é de outro. Edição sem país (liga/desliga
    // de integração, usuário) não pertence a país nenhum e não pode aparecer sob a bandeira de um.
    if (market && mkt !== market) continue;
    const de   = valor(l.de,   l.formato, mkt);
    const para = valor(l.para, l.formato, mkt);
    const alvo = alvoLegivel(l);
    out.push({
      ts: l.ts,
      autor: l.autor || null,
      acao: l.acao,
      alvo,
      campo: l.campo || null,
      canal: l.canal ? (CANAIS[l.canal]?.label || l.canal) : null,
      market: mkt,
      de, para,
      texto: frase({ ...l, alvo }, { de, para }),
      partes: partes({ ...l, alvo }, { de, para }),
    });
  }
  return out;
}
