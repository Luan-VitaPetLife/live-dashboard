// geo.js — tabelas e utilitários de mapa compartilhados (Coco and Luna) IIFE incluído via
// <script src="js/geo.js">, mesmo padrão de colors.js/sidebar.js. Expõe window.CocoGeo.
//
// Existe porque Geografia e Segmentos desenham o mesmo tipo de mapa e mantinham cópias IGUAIS
// destas oito tabelas, do carregador de GeoJSON, do fundo do mapa e das rampas de cor — cerca
// de 150 linhas repetidas em cada arquivo. Corrigir um lado nunca chegava no outro, e a troca
// do provedor de tile quase passou batido numa das telas.
(function () {
  // ── Brasil ──
  // O GeoJSON do IBGE identifica a unidade federativa pelo código numérico (properties.codarea),
  // não pela sigla, então IBGE_UF faz essa ponte.
  const STATE_NAMES_BR = {
    AC:'Acre',AL:'Alagoas',AM:'Amazonas',AP:'Amapá',BA:'Bahia',
    CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',
    MA:'Maranhão',MG:'Minas Gerais',MS:'Mato Grosso do Sul',MT:'Mato Grosso',
    PA:'Pará',PB:'Paraíba',PE:'Pernambuco',PI:'Piauí',PR:'Paraná',
    RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RO:'Rondônia',RR:'Roraima',
    RS:'Rio Grande do Sul',SC:'Santa Catarina',SE:'Sergipe',SP:'São Paulo',TO:'Tocantins',
  };
  const IBGE_UF = {
    '11':'RO','12':'AC','13':'AM','14':'RR','15':'PA','16':'AP','17':'TO',
    '21':'MA','22':'PI','23':'CE','24':'RN','25':'PB','26':'PE','27':'AL','28':'SE','29':'BA',
    '31':'MG','32':'ES','33':'RJ','35':'SP',
    '41':'PR','42':'SC','43':'RS',
    '50':'MS','51':'MT','52':'GO','53':'DF',
  };
  const CENTROIDS_BR = {
    AC:[-9.0,-70.5],AL:[-9.6,-36.8],AM:[-4.0,-62.0],AP:[1.4,-51.8],BA:[-12.5,-41.7],
    CE:[-5.2,-39.5],DF:[-15.8,-47.9],ES:[-19.2,-40.3],GO:[-16.0,-49.6],MA:[-5.4,-44.4],
    MG:[-18.5,-44.4],MS:[-20.5,-54.5],MT:[-13.0,-55.9],PA:[-4.5,-52.5],PB:[-7.1,-36.7],
    PE:[-8.4,-37.9],PI:[-7.7,-43.5],PR:[-24.9,-51.6],RJ:[-22.2,-42.7],RN:[-5.8,-36.6],
    RO:[-10.9,-62.8],RR:[2.0,-61.4],RS:[-30.2,-53.5],SC:[-27.5,-50.9],SE:[-10.6,-37.5],
    SP:[-22.5,-48.5],TO:[-10.0,-48.3],
  };
  const SUB_REGIONS_BR = {
    AC: [[-9.0,-70.5],[-8.2,-72.8],[-10.3,-68.2]],
    AL: [[-9.6,-36.8],[-9.1,-35.8],[-10.1,-37.3]],
    AM: [[-4.0,-62.0],[-1.5,-67.5],[-6.5,-64.5],[-3.0,-57.5],[-7.5,-72.0]],
    AP: [[1.4,-51.8],[3.1,-51.2],[0.3,-51.5]],
    BA: [[-12.5,-41.7],[-9.5,-38.5],[-15.5,-39.0],[-16.5,-43.5],[-11.0,-44.5]],
    CE: [[-5.2,-39.5],[-3.7,-38.5],[-7.2,-39.3],[-4.8,-41.0]],
    DF: [[-15.8,-47.9],[-15.6,-47.7],[-16.0,-48.1]],
    ES: [[-19.2,-40.3],[-18.3,-40.0],[-20.7,-41.2]],
    GO: [[-16.0,-49.6],[-13.5,-47.5],[-18.0,-50.5],[-15.5,-52.5]],
    MA: [[-5.4,-44.4],[-2.8,-43.0],[-7.5,-46.0],[-5.5,-47.5]],
    MG: [[-18.5,-44.4],[-15.5,-44.0],[-21.0,-46.5],[-18.0,-42.5],[-20.5,-49.0]],
    MS: [[-20.5,-54.5],[-18.5,-55.5],[-22.5,-54.0],[-20.0,-52.0]],
    MT: [[-13.0,-55.9],[-10.5,-54.0],[-16.0,-57.5],[-13.5,-51.5]],
    PA: [[-4.5,-52.5],[-1.5,-51.5],[-7.0,-50.0],[-3.5,-56.0],[-1.0,-55.0]],
    PB: [[-7.1,-36.7],[-6.4,-35.3],[-7.9,-37.5]],
    PE: [[-8.4,-37.9],[-7.9,-35.2],[-9.3,-37.5],[-8.5,-40.5]],
    PI: [[-7.7,-43.5],[-5.0,-42.5],[-9.5,-44.8],[-7.5,-40.5]],
    PR: [[-24.9,-51.6],[-23.5,-51.5],[-26.2,-52.8],[-25.5,-49.5]],
    RJ: [[-22.2,-42.7],[-22.9,-43.2],[-21.3,-41.3],[-22.8,-44.5]],
    RN: [[-5.8,-36.6],[-5.2,-35.4],[-6.5,-37.1],[-6.0,-38.0]],
    RO: [[-10.9,-62.8],[-9.0,-64.5],[-12.5,-61.0],[-11.5,-63.5]],
    RR: [[2.0,-61.4],[3.8,-61.0],[1.0,-61.5],[4.5,-63.0]],
    RS: [[-30.2,-53.5],[-28.0,-51.5],[-32.5,-52.0],[-29.5,-56.0],[-31.0,-51.0]],
    SC: [[-27.5,-50.9],[-26.3,-49.0],[-28.5,-52.0],[-27.5,-48.5]],
    SE: [[-10.6,-37.5],[-10.0,-37.0],[-11.2,-37.8]],
    SP: [[-22.5,-48.5],[-21.0,-50.5],[-23.5,-46.5],[-23.0,-51.5],[-24.5,-47.5]],
    TO: [[-10.0,-48.3],[-7.0,-48.0],[-12.5,-49.5],[-10.0,-46.0]],
  };

  // ── Estados Unidos ──
  // STATE_NAMES_US tem mais entradas que os 50 estados: territórios e endereços militares
  // aparecem em pedido real e precisam de nome. FIPS_UF cobre o caso de um GeoJSON que traga
  // o código numérico; o arquivo que usamos hoje traz só properties.name, resolvido por
  // NAME_TO_UF_US, montado logo abaixo a partir de STATE_NAMES_US.
  const STATE_NAMES_US = {
    AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
    CO:'Colorado',CT:'Connecticut',DC:'Washington D.C.',DE:'Delaware',FL:'Florida',
    GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',
    IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',
    MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',
    MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',
    NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',
    NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',
    PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',
    TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',
    WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
    // Territórios dos EUA, endereços militares (APO/FPO) e bucket de estrangeiros.
    // Não são um dos 50 estados nem pintam o mapa, mas aparecem no ranking. Ver CLAUDE.md 4.10.
    PR:'Porto Rico',VI:'Ilhas Virgens',GU:'Guam',AS:'Samoa Americana',MP:'Marianas',
    AA:'Militar (Américas)',AE:'Militar (Europa)',AP:'Militar (Pacífico)',
    INTL:'Outros (internacional)',
  };
  const FIPS_UF = {
    '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT',
    '10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL',
    '18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD',
    '25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE',
    '32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND',
    '39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD',
    '47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV',
    '55':'WI','56':'WY',
  };
  const CENTROIDS_US = {
    AL:[32.7,-86.8],AK:[64.2,-153.0],AZ:[34.3,-111.9],AR:[34.8,-92.4],CA:[36.8,-119.4],
    CO:[39.1,-105.4],CT:[41.6,-72.7],DC:[38.9,-77.0],DE:[39.0,-75.5],FL:[27.8,-81.6],
    GA:[32.6,-83.4],HI:[20.3,-156.4],ID:[44.2,-114.5],IL:[40.0,-89.2],IN:[39.9,-86.3],
    IA:[42.1,-93.5],KS:[38.5,-98.4],KY:[37.5,-85.3],LA:[30.9,-91.8],ME:[45.4,-69.0],
    MD:[39.1,-76.8],MA:[42.2,-71.5],MI:[44.3,-85.4],MN:[46.5,-94.7],MS:[32.7,-89.7],
    MO:[38.5,-92.5],MT:[46.9,-110.5],NE:[41.5,-99.9],NV:[39.3,-117.1],NH:[43.7,-71.6],
    NJ:[40.1,-74.6],NM:[34.3,-106.0],NY:[42.9,-75.5],NC:[35.5,-79.6],ND:[47.5,-100.5],
    OH:[40.4,-82.8],OK:[35.6,-96.9],OR:[44.0,-120.5],PA:[40.9,-77.8],RI:[41.7,-71.5],
    SC:[33.9,-80.9],SD:[44.5,-100.3],TN:[35.9,-86.2],TX:[31.2,-99.3],UT:[39.3,-111.1],
    VT:[44.1,-72.7],VA:[37.4,-78.7],WA:[47.4,-120.5],WV:[38.6,-80.6],WI:[44.5,-89.8],
    WY:[43.1,-107.6],
  };
  const SUB_REGIONS_US = {
    AK:[[64.2,-153.0],[66.0,-162.0],[60.0,-149.0]],
    AZ:[[34.3,-111.9],[32.7,-111.8],[36.2,-112.0]],
    CA:[[36.8,-119.4],[34.0,-118.3],[37.8,-122.4],[33.7,-117.8],[40.6,-122.5]],
    CO:[[39.1,-105.4],[39.7,-104.9],[38.8,-104.8]],
    FL:[[27.8,-81.6],[28.5,-81.4],[25.8,-80.2],[30.3,-81.7]],
    GA:[[32.6,-83.4],[33.7,-84.4],[32.1,-81.2]],
    ID:[[44.2,-114.5],[46.4,-116.9],[43.0,-112.4]],
    IL:[[40.0,-89.2],[41.8,-87.6],[39.8,-88.9]],
    KS:[[38.5,-98.4],[39.0,-95.7],[37.7,-100.0]],
    KY:[[37.5,-85.3],[38.2,-85.8],[37.0,-84.5],[37.2,-82.5]],
    LA:[[30.9,-91.8],[29.9,-90.1],[30.4,-91.2],[32.5,-93.8]],
    MI:[[44.3,-85.4],[42.4,-83.0],[46.5,-84.5]],
    MN:[[46.5,-94.7],[44.9,-93.2],[47.5,-92.0]],
    MO:[[38.5,-92.5],[38.6,-90.2],[37.0,-94.5]],
    MT:[[46.9,-110.5],[48.0,-106.0],[45.5,-108.5],[47.0,-115.0]],
    NE:[[41.5,-99.9],[41.3,-96.0],[41.1,-103.0]],
    NM:[[34.3,-106.0],[35.1,-106.6],[32.3,-106.8],[36.7,-105.9]],
    NV:[[39.3,-117.1],[36.2,-115.2],[41.2,-117.7]],
    NY:[[42.9,-75.5],[40.7,-74.0],[42.7,-74.0]],
    NC:[[35.5,-79.6],[35.2,-80.9],[35.9,-78.5],[35.4,-82.6]],
    ND:[[47.5,-100.5],[46.8,-96.8],[47.9,-102.8]],
    OH:[[40.4,-82.8],[41.5,-81.7],[39.2,-84.5]],
    OK:[[35.6,-96.9],[35.5,-97.5],[34.6,-99.0],[36.2,-95.8]],
    OR:[[44.0,-120.5],[45.5,-122.7],[44.0,-121.3],[42.3,-118.5]],
    PA:[[40.9,-77.8],[40.4,-80.0],[40.0,-75.1]],
    SD:[[44.5,-100.3],[43.5,-96.7],[45.5,-100.4]],
    TN:[[35.9,-86.2],[35.1,-89.9],[35.6,-83.6],[36.1,-87.5]],
    TX:[[31.2,-99.3],[32.8,-96.8],[30.3,-97.7],[26.2,-97.9],[29.8,-95.4],[31.8,-106.4]],
    VA:[[37.4,-78.7],[38.8,-77.2],[36.8,-76.3],[37.2,-80.4]],
    WA:[[47.4,-120.5],[47.6,-122.3],[47.0,-121.0],[47.8,-118.5]],
    WI:[[44.5,-89.8],[43.0,-88.0],[46.0,-90.0]],
    WY:[[43.1,-107.6],[44.5,-104.9],[41.5,-110.6]],
  };

  const NAME_TO_UF_US = {};
  for (const [uf, nome] of Object.entries(STATE_NAMES_US)) NAME_TO_UF_US[nome] = uf;
  NAME_TO_UF_US['District of Columbia'] = 'DC';

  const porMercado = (br, us) => ({ br, us });
  const STATE_NAMES = porMercado(STATE_NAMES_BR, STATE_NAMES_US);
  const CENTROIDS   = porMercado(CENTROIDS_BR, CENTROIDS_US);
  const SUB_REGIONS = porMercado(SUB_REGIONS_BR, SUB_REGIONS_US);

  // ── Fundo do mapa ──
  // Esri "Light Gray Canvas", sem chave de API. A CartoDB, usada até então, passou a exigir
  // chave e devolvia o tile com "API KEY REQUIRED" carimbado por cima do mapa: HTTP 200, imagem
  // válida, nada falhando no código, só a marca d'água na tela do usuário. São duas camadas
  // porque a base do Esri não traz nome de cidade nenhum.
  const TILE_URL = camada =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_${camada}/MapServer/tile/{z}/{y}/{x}`;
  const TILE_ATTR = 'Tiles &copy; Esri, DeLorme, NAVTEQ';
  const TILE_MAX_ZOOM = 16;

  // Adiciona base e rótulos a um mapa Leaflet e devolve as duas camadas, pra quem precisar
  // removê-las depois. Ordem importa: rótulo por cima da base.
  function addBasemap(map) {
    const base = L.tileLayer(TILE_URL('Base'), { attribution: TILE_ATTR, maxZoom: TILE_MAX_ZOOM }).addTo(map);
    const rotulos = L.tileLayer(TILE_URL('Reference'), { maxZoom: TILE_MAX_ZOOM }).addTo(map);
    return { base, rotulos };
  }

  // ── Contorno dos estados ──
  // Cache por mercado: trocar de país ida e volta não rebusca o que já veio.
  // O do Brasil vem do IBGE em tempo de execução (fonte oficial). O dos EUA é servido do
  // próprio domínio — vinha de um repositório de terceiros no jsDelivr e o mapa parava de
  // desenhar se aquele repositório sumisse, sem aviso nenhum.
  const cache = {};
  async function loadGeoJSON(market) {
    if (cache[market]) return cache[market];
    if (market === 'br') {
      const res = await fetch('https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&formato=application/vnd.geo+json&qualidade=minima');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      data.features.forEach(f => { f.properties._uf = IBGE_UF[String(f.properties?.codarea)] || null; });
      cache[market] = data;
    } else {
      const res = await fetch('/geo/us-states.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      data.features.forEach(f => {
        const fips = String(f.properties?.id ?? '').padStart(2, '0');
        f.properties._uf = FIPS_UF[fips] || NAME_TO_UF_US[f.properties?.name || ''] || null;
      });
      cache[market] = data;
    }
    return cache[market];
  }

  // ── Rampas de cor ──
  const hexToRGB = hex => {
    const h = String(hex).replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const lerpRGB = (c1, c2, t) => c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
  // Verde → amarelo → vermelho, com o amarelo no meio exato da escala.
  function heatColor(t, cores = ['#22c55e', '#eab308', '#ef4444']) {
    const s = Math.max(0, Math.min(1, t));
    const [c0, c1, c2] = cores.map(hexToRGB);
    const [r, g, b] = s < 0.5 ? lerpRGB(c0, c1, s * 2) : lerpRGB(c1, c2, (s - 0.5) * 2);
    return `rgb(${r},${g},${b})`;
  }

  window.CocoGeo = {
    STATE_NAMES, CENTROIDS, SUB_REGIONS,
    STATE_NAMES_BR, STATE_NAMES_US, CENTROIDS_BR, CENTROIDS_US, SUB_REGIONS_BR, SUB_REGIONS_US,
    IBGE_UF, FIPS_UF, NAME_TO_UF_US,
    TILE_URL, TILE_ATTR, TILE_MAX_ZOOM, addBasemap,
    loadGeoJSON,
    hexToRGB, lerpRGB, heatColor,
  };
})();
