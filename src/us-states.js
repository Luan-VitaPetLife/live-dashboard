// ─────────────────────────────────────────────
//  us-states.js — normalização de estado dos EUA
//
//  O `ship-state` da Amazon (Reports API e Orders API) vem em grafias
//  inconsistentes para o mesmo estado: "California", "CALIFORNIA", "CA", "CA.",
//  "N.Y.", "N C", "PUERTO RICO", "P.R. 00623"... Sem normalizar, cada variante
//  vira uma chave distinta em `byState` (metrics.js), poluindo o ranking de
//  Geografia US e fazendo o mapa subcontar (ele só casa códigos de 2 letras).
//  Ver CLAUDE.md 4.7.5 / 4.10.
//
//  normalizeUsState() reduz qualquer variante ao código de 2 letras (uppercase).
//  O que não for reconhecível (ex: província canadense, typo) volta só com pontos
//  removidos e espaços colapsados — não some, só não vira código.
// ─────────────────────────────────────────────

// Códigos válidos: 50 estados + DC + territórios + endereços militares (APO/FPO).
const CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY',
  'DC','PR','VI','GU','AS','MP',   // território / DC
  'AA','AE','AP',                  // militar (Armed Forces)
]);

// Nome por extenso → código. Chave já em UPPERCASE, sem pontos, espaços colapsados.
const NAME_TO_CODE = {
  ALABAMA:'AL', ALASKA:'AK', ARIZONA:'AZ', ARKANSAS:'AR', CALIFORNIA:'CA',
  COLORADO:'CO', CONNECTICUT:'CT', DELAWARE:'DE', FLORIDA:'FL', GEORGIA:'GA',
  HAWAII:'HI', IDAHO:'ID', ILLINOIS:'IL', INDIANA:'IN', IOWA:'IA', KANSAS:'KS',
  KENTUCKY:'KY', LOUISIANA:'LA', MAINE:'ME', MARYLAND:'MD', MASSACHUSETTS:'MA',
  MICHIGAN:'MI', MINNESOTA:'MN', MISSISSIPPI:'MS', MISSOURI:'MO', MONTANA:'MT',
  NEBRASKA:'NE', NEVADA:'NV', 'NEW HAMPSHIRE':'NH', 'NEW JERSEY':'NJ',
  'NEW MEXICO':'NM', 'NEW YORK':'NY', 'NORTH CAROLINA':'NC', 'NORTH DAKOTA':'ND',
  OHIO:'OH', OKLAHOMA:'OK', OREGON:'OR', PENNSYLVANIA:'PA', 'RHODE ISLAND':'RI',
  'SOUTH CAROLINA':'SC', 'SOUTH DAKOTA':'SD', TENNESSEE:'TN', TEXAS:'TX', UTAH:'UT',
  VERMONT:'VT', VIRGINIA:'VA', WASHINGTON:'WA', 'WEST VIRGINIA':'WV',
  WISCONSIN:'WI', WYOMING:'WY',
  // DC / territórios (e apelidos comuns)
  'DISTRICT OF COLUMBIA':'DC', 'WASHINGTON DC':'DC',
  'PUERTO RICO':'PR', 'PUERTO RICO USA':'PR',
  'US VIRGIN ISLANDS':'VI', 'U S VIRGIN ISLANDS':'VI', 'VIRGIN ISLANDS':'VI', USVI:'VI',
  'ST CROIX':'VI', 'ST CROIX VI':'VI', 'ST THOMAS':'VI', 'ST THOMAS VI':'VI',
  'ST JOHN':'VI', 'ST JOHN VI':'VI',
  GUAM:'GU', 'AMERICAN SAMOA':'AS', 'NORTHERN MARIANA ISLANDS':'MP',
  // typos observados em endereços reais da Amazon
  MARULAND:'MD',
};

// true se `code` é uma região dos EUA (estado, DC, território ou endereço militar).
// Usado para separar o que é EUA do que é estrangeiro no ranking de Geografia US.
export function isUsRegionCode(code) {
  return CODES.has(code);
}

export function normalizeUsState(raw) {
  if (raw == null) return raw;
  const up = String(raw).trim().toUpperCase();
  if (!up) return up;

  // 1) nome por extenso (pontos removidos, espaços colapsados)
  const nameKey = up.replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (NAME_TO_CODE[nameKey]) return NAME_TO_CODE[nameKey];

  // 2) código: só as letras ("CA."→CA, "N.Y."→NY, "N C"→NC, "P.R. 00623"→PR)
  const letters = up.replace(/[^A-Z]/g, '');
  if (CODES.has(letters)) return letters;

  // 3) primeiro token sendo um código válido ("PR 00623", "AE 09..." )
  const firstTok = nameKey.split(' ')[0];
  if (CODES.has(firstTok)) return firstTok;

  // 4) desconhecido: devolve limpo (não perde a receita, só não vira código)
  return nameKey;
}
