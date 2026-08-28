// br-states.js — normalização de estado do Brasil
//
// O campo `state` de um pedido nem sempre chega como o código UF de 2 letras — alguns canais
// gravam o nome por extenso, com grafias diferentes ("São Paulo", "SAO PAULO", "sao paulo"...).
// Sem normalizar, cada variante vira uma chave distinta em `byState`/`productGeo` (metrics.js),
// duplicando o mesmo estado no ranking de Geografia BR e no card "Onde os produtos vendem"
// (Segmentos) — ex.: "SP" e "SÃO PAULO" aparecendo como duas linhas separadas pro mesmo estado
// (reportado em produção). Mesmo princípio já usado pros EUA, ver us-states.js — só que lá a
// Amazon é a fonte da inconsistência; aqui pode vir de qualquer canal que grave o nome por
// extenso em vez do código.
//
// normalizeBrState() reduz qualquer variante ao código de 2 letras (uppercase). O que não for
// reconhecível volta só com acentos removidos e espaços colapsados — não some, só não vira
// código.

const CODES = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]);

// Nome por extenso (sem acento, uppercase, espaços colapsados) → código.
const NAME_TO_CODE = {
  ACRE:'AC', ALAGOAS:'AL', AMAPA:'AP', AMAZONAS:'AM', BAHIA:'BA', CEARA:'CE',
  'DISTRITO FEDERAL':'DF', 'ESPIRITO SANTO':'ES', GOIAS:'GO', MARANHAO:'MA',
  'MATO GROSSO':'MT', 'MATO GROSSO DO SUL':'MS', 'MINAS GERAIS':'MG', PARA:'PA',
  PARAIBA:'PB', PARANA:'PR', PERNAMBUCO:'PE', PIAUI:'PI', 'RIO DE JANEIRO':'RJ',
  'RIO GRANDE DO NORTE':'RN', 'RIO GRANDE DO SUL':'RS', RONDONIA:'RO',
  RORAIMA:'RR', 'SANTA CATARINA':'SC', 'SAO PAULO':'SP', SERGIPE:'SE',
  TOCANTINS:'TO',
};

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeBrState(raw) {
  if (raw == null) return raw;
  const clean = stripAccents(String(raw).trim().toUpperCase()).replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return clean;

  // 1) já é o código
  if (CODES.has(clean)) return clean;

  // 2) nome por extenso
  if (NAME_TO_CODE[clean]) return NAME_TO_CODE[clean];

  // 3) desconhecido: devolve limpo (não perde a receita/unidade, só não vira código)
  return clean;
}

// Código UF → nome por extenso, com acento, para texto gerado no SERVIDOR (card de Insights).
// Fica aqui porque quem já é dono do vocabulário de estado do Brasil é este módulo. As telas de
// Geografia/Segmentos têm as suas próprias tabelas de nome por motivo histórico, mas frase montada
// no backend precisa de uma fonte no backend.
export const BR_STATE_NAMES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins',
};
