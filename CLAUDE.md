# CLAUDE.md — Contexto do projeto (handoff para o terminal)

> Este arquivo é lido automaticamente pelo Claude Code ao abrir o projeto.
> Ele resume **tudo** que já foi decidido e descoberto, para retomar o trabalho sem repetir investigação.

## 1. O que é

Dashboard de vendas **multi-mercado e multicanal** das lojas de Luan (suplementos para pets).
- **Brasil 🇧🇷:** loja Shopify BR (`cocoandluna.com.br`) + Shopee + Mercado Livre + Amazon BR (SP-API)
- **EUA 🇺🇸:** loja Shopify US (`vita-pet-life.myshopify.com`) + Amazon US (SP-API)

Objetivo do dono (Luan, perfil de negócio, não-dev): uma tela única, ao vivo, com todos os canais.
Idioma da interface: **pt-BR**. Valores BR em **BRL**, valores US em **USD**.

**Produção:** `https://live-dashboard-vitapetlife.up.railway.app` (Railway, auto-deploy do branch `master`
do repositório `https://github.com/Luan-VitaPetLife/live-dashboard.git`).

## 2. Dados das lojas (fatos confirmados)

### Brasil
- Shopify BR: **cocoandluna.com.br** · domínio admin **ebb5cd.myshopify.com**
- Moeda **BRL**, fuso **-03** (`STORE_OFFSET_MINUTES=-180`).
- Volume ~73 pedidos/30 dias. Paginação simples já dá conta.
- Produto principal: **"Lisina para gatos - 120g"** (e combos); também "Daily".
- Versão da Admin API: **2026-04** (`SHOPIFY_API_VERSION`). Não usar versões anteriores a 2025-10.
- Amazon BR: Marketplace ID `A2Q3Y263D00KWC`. **Usa o mesmo app/token que a US** (`AMAZON_CLIENT_ID/SECRET/REFRESH_TOKEN`). Endpoint: `sellingpartnerapi-na.amazon.com` (região NA — não SA). Verificado via `marketplaceParticipations`.

### EUA
- Shopify US: **vita-pet-life.myshopify.com** · ~99 pedidos/30 dias confirmados.
- Amazon US: SP-API configurado com LWA + AWS SigV4 via IAM AssumeRole.
  - IAM User: `arn:aws:iam::354674816862:user/usdashboard`
  - IAM Role: `arn:aws:iam::354674816862:role/SellingPartnerAPIRole`
  - Marketplace ID: `ATVPDKIKX0DER` (Amazon.com US)
- Meta Ads EUA: conta `826249215807271` (Vita Pet Life) — separada da BR (Coco and Luna).

## 3. Arquitetura

```
server.js               Express: serve public/ + API + agendador (sync a cada N min)
src/store.js            Banco híbrido: Postgres em produção (DATABASE_URL), JSON local no dev
src/shopify.js          Pedidos via GraphQL Admin API + sessões via ShopifyQL (multi-store via cfg)
src/shopee.js           Shopee Open API v2: assinatura HMAC, OAuth, refresh de token
src/mercadolivre.js     Mercado Livre OAuth 2.0 + pedidos + fetchAdCosts + fetchCampaigns (Mercado Ads)
src/amazon.js           Amazon SP-API (EUA + BR): chamada combinada, LWA + SigV4 + STS AssumeRole
src/meta.js             Meta Marketing API: gasto diário + fetchCampaigns (nível campanha, BR e US)
src/googleads.js        Google Ads API: OAuth + fetchCampaigns (nível campanha, só EUA por enquanto)
src/metrics.js          Calcula o payload da dashboard por mercado; inclui salesSplit
src/sync.js             Orquestra a busca de todos os canais BR e US e grava no store
public/index.html       Dashboard principal (toggle de mercado, receita, tendência, canais, pedidos)
public/campanhas.html   Tela de Campanhas: visão de gastos reais por canal + cards por campanha
public/produtos.html    Tela de Produtos: catálogo completo por canal (tabela com foto, tipo, qtd, receita)
public/sidebar.js       Componente de sidebar compartilhado (IIFE) — incluído em todos os HTMLs
public/geografia.html   Mapa geográfico por estado BR (Leaflet.js, Voyager tile, coropleto + calor)
public/geografia-us.html Mapa geográfico por estado US (Leaflet.js, Voyager tile, coropleto + calor)
public/bandeira_brasil.webp  Imagem da bandeira BR usada nos botões de mercado
public/bandeira_eua.svg      Imagem da bandeira EUA usada nos botões de mercado
public/favicon.png      Favicon usado em todas as páginas (rel="icon") — antigo logo.png, renomeado
public/Logo1.svg        Logotipo wordmark (horizontal) — antigo Logo.svg, renomeado. Não está em uso ativo hoje.
public/Logo2.png        Logotipo em teste no topo do menu lateral (ícone quadrado 516x516, "CC") — ativo em sidebar.js/.brand-logo
public/logo_mercadolivre.png  Logo ML usada na tela de campanhas
public/logo_meta.png         Logo Meta usada na tela de campanhas
public/logo_shopee.svg       Logo Shopee usada na tela de campanhas
public/logo_amazon.webp      Logo Amazon usada na tela de campanhas
public/logo_shopify.png      Logo Shopify usada na tela de produtos (BR e US)
public/logo_google_ads.webp  Logo Google Ads usada na tela de campanhas
```

Fluxo: `sync.js` busca pedidos/sessões → grava em `store` → `metrics.js` calcula → `/api/dashboard`
devolve JSON → `public/*.html` desenham. As interfaces NÃO falam com Shopify/Shopee/ML/Amazon direto.

### Store (store.js) — detalhes importantes
- Variável `DATABASE_URL` presente → usa Postgres (Railway). Ausente → JSON em `data/db.json`.
- `initStore()` é async e DEVE ser chamado com `await` antes de `app.listen()`.
- Tabelas Postgres: `orders` (id TEXT PK, data JSONB), `sessions_daily` (date TEXT PK, data JSONB), `kv` (key TEXT PK, value JSONB).
- `kv` guarda: `shopeeTokens`, `mlTokens`, `metaInsightsDaily`, `metaUSInsightsDaily`, `mlAdCosts`, `amazonBackoff`, `amazonBRBackoff`, `lastSync`.
- `getOrders({ channel, since, until, market })` — filtra por mercado. Pedidos legados sem campo `market` são inferidos como `'br'` (exceto `channel === 'shopify_us'` → `'us'`).

## 4. Decisões e conhecimento de domínio (IMPORTANTE — não reinventar)

### 4.1 Receita precisa EXCLUIR pedidos cancelados/expirados
- **Bug descoberto:** ShopifyQL (`FROM sales`) **conta pedidos cancelados/expirados**. Não há como filtrar por status no ShopifyQL.
- **Solução adotada:** receita/pedidos/ticket/tendência/top-produtos vêm da **API GraphQL de pedidos**.
  Regra de exclusão (`isCancelled`): `cancelledAt != null` OU `displayFinancialStatus ∈ {EXPIRED, VOIDED, CANCELLED}`.
  Valor do pedido = `currentTotalPriceSet.shopMoney.amount`.
- **Decisão em aberto:** pedidos **PENDING** (Pix/boleto aguardando) HOJE ainda contam. Luan decide se quer só pagos.

### 4.2 Sessões / funil / conversão → ShopifyQL (apenas Shopify)
- Query: `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day SINCE -90d UNTIL today`.
- **Formato da resposta (API 2026-04+):** `shopifyqlQuery { tableData { columns { name } rows } parseErrors }`.
  `rows` é array de objetos com chaves nomeadas. `parseErrors` pode ser `[]` (truthy!) — checar com `.length`.
- **Escopos necessários:** `read_analytics` + `read_reports`. Sem `read_analytics`, `shopifyqlQuery` some do schema sem aviso.
- `hasSessionData` = `(market==='br' && channel ∈ {todos,shopify})` OU `(market==='us' && channel ∈ {todos,shopify_us})`.

### 4.3 Marketing por origem = atribuição, NÃO custo
- Referrer por pedido: `order.customerJourneySummary.lastVisit.source` (Instagram, Facebook, Google, etc.).

### 4.4 Meta Ads (Instagram + Facebook)
- Implementado em `src/meta.js`. Graph API v20.0, endpoint `act_{id}/insights`, paginação cursor.
- `fetchInsights(sinceISO, untilISO, accountId?)` — `accountId` padrão = `META_AD_ACCOUNT_ID` (BR). Grava série diária no store.
- `fetchCampaigns(sinceISO, untilISO, accountId?)` — consulta ao vivo (`level=campaign`). Retorna array `{ name, spend, revenue, orders, clicks, impressions, reach, ctr, cpc, roas }` ordenado por gasto. `pickAction()` extrai `purchase` dos arrays `actions`/`action_values`.
- **BR:** conta Coco and Luna → `META_AD_ACCOUNT_ID`. Store key: `metaInsightsDaily`.
- **EUA:** conta Vita Pet Life → `META_US_AD_ACCOUNT_ID` (`826249215807271`). Store key: `metaUSInsightsDaily`.
- `metrics.js` seleciona o dataset correto por `market`. Expõe `metaSpendDaily` (série alinhada aos buckets de tendência) no payload.
- ROAS calculado em `metrics.js`: receita de pedidos com source Instagram/Facebook ÷ gasto Meta.
- **`salesSplit`** em `metrics.js`: `{ campaign, organic, campaignOrders, organicOrders }` — separa receita entre pedidos de campanha (source Meta OU `listingType === 'premium'`) e orgânicos. Exposto no payload `/api/dashboard`.

### 4.5 Shopee
- Usar **Open Platform API v2** direto (`src/shopee.js`). Host: `https://partner.shopeemobile.com`.
- Assinatura: `HMAC_SHA256(partner_key, partner_id + path + timestamp [+ access_token + shop_id])` em hex.
- OAuth: `/shopee/connect` → autoriza → callback troca `code` por tokens. Token renovado automaticamente.
- **Pendente:** cadastrar `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID` no Railway e autorizar via `/shopee/connect`. `SHOPEE_PRODUCTION=0` até aprovação.

### 4.6 Mercado Livre
- Implementado em `src/mercadolivre.js`. OAuth 2.0 com refresh_token automático.
- **CRÍTICO — domínio correto:** `https://api.mercadolibre.com` (espanhol "libre", NÃO "livre"). Não reverter.
- Tokens persistidos no Postgres (`kv`, chave `mlTokens`). **Após cada novo deploy, re-autorizar via `/mercadolivre/connect`.**
- Cancelados ML: status `cancelled` ou `invalid`. Sem tokens → retorna `[]`, canal fica 0, nada quebra.
- Estado do pedido: buscado via `/shipments/{id}` → `receiver_address.state.id` (formato "BR-SP" → "SP").
- **Breakdown de listagem:** cada pedido tem campo `listingType: 'organic' | 'premium' | null`.
  - `free` → `'organic'` (Clássico — listagem grátis).
  - `bronze/silver/gold_*` → `'premium'` (Destaque — listagem paga).
- **ML Product Ads — fluxo correto (Mercado Ads API, exige header `Api-Version: 1`):**
  1. Resolver advertiser: `GET /advertising/advertisers?product_id=PADS` → `advertiser_id` + `site_id` (helper `getPadsAdvertiser()`).
  2. Métricas agregadas: `GET /marketplace/advertising/{site_id}/advertisers/{advertiser_id}/product_ads/campaigns/search`
     com `metrics=clicks,prints,cost` + `date_from`/`date_to` → `fetchAdCosts()` soma tudo.
  3. Métricas por campanha: mesmo endpoint com `metrics=clicks,prints,cost,acos,total_amount,units_quantity` → `fetchCampaigns()` retorna array `{ name, status, spend, revenue, orders, clicks, impressions, ctr, acos, roas }`.
  - **Por que vinha zero antes:** código antigo usava `seller_id` num endpoint inexistente, sem `Api-Version: 1`. Corrigido. Dados confirmados: ~R$ 1.937 de gasto real exibidos na tela.
  - **Pré-requisito:** o app ML precisa ter permissão **Mercado Ads** e token gerado via `/mercadolivre/connect`. Sem isso, `/advertising/advertisers` retorna 403 e as funções devolvem zeros/vazio graciosamente.
- `mlBreakdown` exposto em `metrics.js`: `{ organic, premium, adCost, adClicks, roas }`.

### 4.7 Amazon SP-API (EUA + BR) — pendente reautorizar US; combinação automática enquanto isso
- Implementado em `src/amazon.js`. Sem dependências externas (SigV4 e HMAC via `crypto` nativo do Node).
- **FATO CRÍTICO ATUAL (descoberto 01/07/2026):** o app **só foi autorizado no Brazil Seller Central**.
  `AMAZON_REFRESH_TOKEN` (US) e `AMAZON_BR_REFRESH_TOKEN` no Railway são **o mesmo valor** — ou seja, a US
  **nunca foi de fato autorizada** em `sellercentral.amazon.com` (NA Seller Central, conta Vita Pet Life).
  Uma afirmação anterior deste arquivo ("mesmo token cobre US e BR, verificado via `marketplaceParticipations`")
  estava **errada** ou descrevia um estado que não se sustentou — não confiar nela. `amazon_us` no payload do
  dashboard fica em 0 até a reautorização acontecer.
  - **Ação pendente (só o Luan pode fazer):** logar em `sellercentral.amazon.com` (conta US, Vita Pet Life — não a BR)
    e autorizar o app SP-API lá, gerando um `AMAZON_REFRESH_TOKEN` novo e **diferente** do `AMAZON_BR_REFRESH_TOKEN`.
    Atualizar só essa variável no Railway. Sem isso nenhuma mudança de código traz dado dos EUA.
- **Endpoint único:** `sellingpartnerapi-na.amazon.com` (região NA) serve os dois marketplaces (BR é região NA, não SA).
- **Combinação automática (`SAME_TOKEN` em `amazon.js`):** como os dois tokens hoje são idênticos (mesma conta, mesma
  cota real na Amazon), `fetchOrders()` detecta isso e faz **uma única chamada** a `/orders/v0/orders` com
  `MarketplaceIds=ATVPDKIKX0DER,A2Q3Y263D00KWC` (metade das requisições reais) em vez de duas chamadas separadas
  contra o mesmo balde. Cada pedido retornado traz seu próprio `MarketplaceId` → separado por `MARKET_BY_MP` em
  US (`channel: 'amazon_us'`, `market: 'us'`) e BR (`channel: 'amazon'`, `market: 'br'`).
  - **Por que isso importa:** entre 30/06 e 01/07 o código fazia sempre DUAS chamadas (US e BR) tratando-as como
    cotas independentes (`kv.amazonBackoff` e `kv.amazonBRBackoff` separados) — mas por serem o mesmo token, as duas
    batiam na MESMA cota real, dobrando as requisições por sync e um 429 de um lado não freava o outro. Isso é o
    suspeito nº 1 para a penalização sustentada de 429 que persistiu por dias.
  - **Quando a US for reautorizada com token próprio:** `SAME_TOKEN` vira `false` automaticamente e o código volta
    sozinho a fazer duas chamadas separadas com backoff independente (`getLwaTokenUS`/`getLwaTokenBR`,
    `kv.amazonBackoff`/`kv.amazonBRBackoff`) — não precisa mexer no código de novo, só trocar a variável no Railway.
- **Fluxo de autenticação:** 1) LWA token (getter próprio por token) · 2) STS AssumeRole (IAM User, compartilhado) · 3) SigV4 + `x-amz-access-token`.
- **Funções exportadas:** `fetchOrders(since, until)` devolve US+BR juntos (combinado ou não). `fetchOrdersBR()` é no-op (compat).
- **RDT (nome do comprador):** desativado por padrão — o app não tem o papel PII (retornava 403 e gastava requisição).
  Reative com `AMAZON_FETCH_PII=1` só se o papel for aprovado.
- **Restrição SP-API:** `CreatedBefore` ≥ 2 min antes de agora — código aplica margem de 3 min.
- **Backoff:** só dispara em 429; degraus 15→30→60→120 min; contador zera após sucesso. Enquanto `SAME_TOKEN`, usa o
  balde único `kv.amazonBackoff` (o `kv.amazonBRBackoff` fica sem uso até haver token BR de verdade distinto).
  Reset/force via `POST /api/amazon/{reset-backoff,force-sync}`.
  - **⚠️ Se levar 429 mesmo combinado:** a cota da conta pode estar penalizada por excesso sustentado de chamadas. A cura é
    PARAR de martelar (deixar o backoff agir, não usar force-sync em loop) e esperar a cota se restaurar — NÃO remover o backoff.
    **NÃO rodar `/api/sync` ou `/api/amazon/force-sync` só para "testar" enquanto a cota estiver se recuperando.**
- Sem `AMAZON_AWS_ACCESS_KEY` / `SECRET_KEY` → retorna `[]` com aviso, nada quebra.
- **IDs de pedido:** `amazon-us:` (EUA) e `amazon-br:` (BR) — evita colisão.
- **Variável fantasma:** `AMAZON_RESET_BACKOFF` já existiu como variável no Railway mas **nunca foi lida por nenhum
  código** (nem hoje, nem no histórico do git) — não faz nada, pode remover. O reset real é o endpoint
  `POST /api/amazon/reset-backoff`.

### 4.8 Multi-mercado — `market` field
- Campo `market: 'br' | 'us'` em todos os pedidos.
- Pedidos legados no banco (sem campo `market`) são inferidos como `'br'`.
- Canal `shopify_us` implica `market: 'us'`.
- `computeDashboard({ market })` separa tudo: byChannel, sessões, pedidos recentes.
- `byChannel` BR: `{ shopify, shopee, amazon, mercadolivre }`. US: `{ shopify_us, amazon_us }`.
- Pedidos Amazon BR (`channel: 'amazon'`, `market: 'br'`) aparecem no byChannel BR; Amazon US usa `channel: 'amazon_us'`.
  **Atenção:** o canal US é `amazon_us` em TODO lugar (amazon.js, metrics.js byChannel, `CHAN`/`DEFAULT_CH`, dropdown, chOrder). Não misturar com `amazon`.
- `getOrders({ market })` em store.js filtra corretamente legacy + novos pedidos.

### 4.9 Canais e UI — `public/index.html`
- **Sidebar compartilhada (`public/sidebar.js`):** IIFE auto-executável que injeta o markup da sidebar, o CSS (incluindo `.nav-flag { width:15px }`) e o comportamento em qualquer página com `<script src="sidebar.js"></script>`. Idempotente — checa `nav.sidebar` existente antes de montar. Marca o item ativo via `location.pathname` vs `data-page`. **NÃO duplicar o markup da sidebar por página — sempre usar o script.**
- **Sidebar ocultável:** botão `☰` (`#sidebarToggle`) dentro da própria sidebar. Desktop: toggle com animação + `localStorage('coco_sidebar')`. Mobile (≤768px): sidebar começa oculta, abre como overlay com `#sidebarOverlay`. Classe `body.sidebar-hidden` oculta no desktop; `body.sidebar-mobile-open` abre como drawer no mobile.
- **Responsivo:** breakpoint 768px — KPIs em 2 colunas (5º ocupa linha inteira), charts em coluna única, padding reduzido. Breakpoint 520px — labels dos filtros e texto dos botões de mercado ocultos.

### 4.9b (original)
- **Seletor de mercado:** dois botões toggle no canto esquerdo do topbar com imagens das bandeiras reais
  (`bandeira_brasil.webp`, `bandeira_eua.svg`). Botão ativo tem fundo escuro (estilo do botão Período).
  Persiste em `localStorage('coco_market')`. Troca de mercado reseta canal para `'todos'`.
  IDs: `#mktBtnBr` e `#mktBtnUs`. Handler em `#mktToggleWrap`. `syncControls()` alterna classe `.active`.
- **Canal dropdown dinâmico** por mercado — gerado por `buildChannelDropdown()` no JS.
  - BR: Todos, Shopify, Shopee, Mercado Livre
  - US: Todos, Shopify US, Amazon
- **Visibilidade de cards por canal** — `updateCardVisibility()` chamada após cada mudança de canal e após `render()`:
  - `channel === 'todos'`: todos os cards visíveis.
  - `channel === 'shopify'` ou `'shopify_us'`: oculta `#cardChannelSplit` e `#cardMarketing`.
  - Outros canais (shopee, mercadolivre, amazon_us): oculta também `#cardTraffic` e `#cardFunnel`.
  - `channel === 'mercadolivre'`: exibe `#cardMlBreakdown` (Clássico, Destaque, Custo ML Ads, ROAS ML Ads).
  - `#cardSalesSplit` visível apenas quando `channel === 'todos'` ou canal Shopify.
- **Cores customizáveis pelo usuário** via painel de configurações (ícone ⚙ no topbar):
  - Padrão canal: Shopify `#95BF47`, Shopify US `#7EAD3C`, Shopee `#EE4D2D`, ML `#FFE600`, Amazon `#111111`
  - Padrão marketing: Instagram `#E1306C`, Facebook `#1877F2`, Google `#6a8c6e`, etc.
  - Cores salvas em `localStorage('coco_colors')`. Reset restaura os padrões.
  - `DEFAULT_CH` e `DEFAULT_MKT` são as fontes de verdade. `CH` e `MKT_COLORS` são os objetos vivos mutados por `loadColors()`.
  - `contrastText(hex)` calcula texto branco/escuro por luminância automática.
  - `chBadgeHTML(chKey)` gera o badge colorido de canal.
- **Seletores** (Métrica, Canal, Período, Atualizar) são **custom dropdowns** (`.csel`) — não são `<select>` nativos.
- O canal é o único dropdown com handler via delegação (`#channelPop`) — os outros usam `setupCsel`.
- Frequência de atualização persistida em `localStorage('coco_refresh')`, padrão 5 min.
- `lastData` armazena último payload da API para re-render ao trocar cores sem nova requisição.
- Top Produtos: quando canal = `todos`, exibe badge de canal + soma total no rodapé.
- Pedidos Recentes: linha de resumo com total dos pedidos válidos.
- **Card Orgânico x Campanha (`#cardSalesSplit`, alterado 02/07/2026):** uma **pizza por canal** (não é mais um único donut agregado nem gráfico de linha) — grid `.ss-grid` com uma célula por canal do mercado atual (BR: Shopify/Shopee/ML/Amazon; US: Shopify US/Amazon US). Dados vêm de `salesSplitByChannel` (`{ [channel]: { campaign, organic, campaignOrders, organicOrders } }`) calculado em `computeDashboard()` a partir de **todos** os pedidos do mercado (independente do filtro de canal selecionado na tela — por isso sempre mostra as 4/2 pizzas). Canais sem tracking de origem/listing type (Shopee, Amazon) sempre caem 100% em orgânico, naturalmente (não é caso especial no código — `isCampaignOrder()` nunca retorna `true` pra esses canais). Canal sem nenhum pedido no período mostra o anel cinza "sem dados" do `drawDonut()` (não confundir com "100% orgânico"). Agrupado em `.right-col-stack` com `#cardMarketing`.
- **KPI strip principal (alterado 02/07/2026):** 5 células — Receita Total, Pedidos, Ticket Médio, **ROAS**, **ACOS** (`#kpiRoas`/`#kpiAcos`). O KPI "Conversão" foi removido daqui (a métrica de conversão de sessão→compra continua existindo no card de Tráfego, `#mConv`, que é outro contexto). ROAS = `kpis.roas` (metaRevenue ÷ adCost, já calculado no backend). ACOS = `100/roas` (gasto ÷ vendas atribuídas, em %) — a grade CSS do `.kpi-strip` já era `repeat(5,1fr)` antes dessa mudança (pensada pra isso).
- Paleta/design: tema "earthy" com variáveis CSS no `:root`. Manter visual.

### 4.11 Tela de Campanhas — `public/campanhas.html`
- Usa dados reais de dois endpoints: `/api/dashboard` (KPIs, tendência, gasto diário Meta) e `/api/campaigns` (campanha a campanha).
- **Painel "Visão Geral":** KPIs de receita, pedidos, gasto, ROAS por canal. Mini charts de tendência com `trend.byChannel` e `trend.metaSpendDaily`.
- **KPI strip do topo — todos "geral" (alterado 02/07/2026):** `render()` agora é `async` porque precisa buscar `/api/campaigns` (via `loadCampaigns()`, já cacheado) além de `/api/dashboard`, para somar o Google Ads no "geral" quando `market==='us'` (Google não entra em `/api/dashboard`, ver 4.12). 5 células: **Gasto Total** (Meta + Mercado Ads + Google Ads), **Pedidos** (`kpis.orders`), **Vendas Atribuídas Geral** (Meta + ML Destaque/premium + Google Ads), **Faturamento Geral** (`kpis.revenue`, receita total do período — não é atribuição, é o total da loja), **ROAS Geral** (vendas atribuídas geral ÷ gasto geral). O KPI de "Cliques" foi removido.
- **Painel "Gastos":** ao clicar em um canal, exibe cards individuais de cada campanha retornados por `/api/campaigns`. Cada card mostra: nome, status, gasto, receita, ROAS, pedidos, cliques, impressões, CTR, ACoS (ML).
  - Logo do canal em cada card: `logo_mercadolivre.png` com `.camp-logo-fill` (sem borda/padding, `object-fit:cover`). Meta/Shopee/Amazon com `.camp-logo-img` (fundo branco, borda, padding — para logos com transparência).
  - `.cmp-status.on` / `.cmp-status.off` indicam campanha ativa/pausada.
- Mercado Livre e Meta BR aparecem no mercado BR; apenas Meta US no mercado US. Google Ads aparece só no mercado US (card `#card-google_us`).
- Período sincronizado com o seletor da própria página (não herda do `index.html`).
- **Card Google Ads (só EUA):** ao contrário dos demais cards (que puxam o resumo do próprio `/api/dashboard`), o card do Google Ads (`loadGoogleCard()`) busca `/api/campaigns` diretamente e soma `spend/revenue/clicks` das campanhas retornadas para preencher os KPIs do próprio card — não está integrado ao payload de `/api/dashboard` nem ao `mlBreakdown`/`salesSplit` (decisão consciente, ver 4.12). Mini-chart mostra gasto por campanha (barras), não série diária (a API do Google Ads aqui só é consultada agregada por período, sem `segments.date`).

### 4.10 Páginas de Geografia — `public/geografia.html` e `public/geografia-us.html`
- **Biblioteca:** Leaflet.js 1.9.4 (CDN unpkg).
- **Tile layer:** CartoDB Voyager (`rastertiles/voyager`) — mostra nomes de cidades e estados. Usado em AMBOS os modos (coropleto e calor). Nunca remover o tile em nenhum modo.
- **Bounds restritos ao país:**
  - BR: `fitBounds([[-33.75,-73.99],[5.26,-28.84]])`, `setMaxBounds([[-36,-76],[8,-25]])`, `minZoom:4`.
  - US: `fitBounds([[24,-125],[49.5,-66.5]])`, `setMaxBounds([[18,-130],[52,-62]])`, `minZoom:4`.
- **GeoJSON BR:** carregado da API do IBGE em runtime. `properties.codarea` (2 dígitos) → UF via `IBGE_UF`.
- **GeoJSON US:** carregado de `us-states.json` ou fonte CDN. `properties._uf` = código de estado (ex: "CA").
- **Dois modos de visualização (ambas as páginas):**
  - **Coropleto:** polígonos dos estados coloridos por intensidade (`choroColor(t)`). Labels tooltip permanentes (UF + valor). Configurações em `choroConfig` → `localStorage('coco_choro_cfg')`.
  - **Calor:** **também usa preenchimento de polígono** com gradiente de calor (`heatGradientColor(t)`). Mesma estrutura do coropleto, só a cor muda. **NÃO usa mais círculos — foram removidos para evitar sobreposição entre estados.**
- **`heatGradientColor(t)`:** interpola `coldColor → midColor → hotColor` por `lerpRGB`. Configurações em `heatConfig`.
- **Popup ao clicar:** receita, pedidos, ticket médio, % do total.
- **Modal de estado:** clique em card de ranking abre modal com 4 KPIs + gráfico de barras comparativo.
- **Dados:** campo `byState` do `/api/dashboard` → `{ [UF]: { revenue, orders } }`. `byState` filtra `o.total > 0`.

### 4.12 Google Ads — EUA apenas (implementado 01/07/2026)
- Implementado em `src/googleads.js`. OAuth 2.0 (authorization_code) + refresh_token de longa duração, seguindo o mesmo padrão de `mercadolivre.js` (`/googleads/connect` → autoriza → `/googleads/callback` troca `code` por tokens, salvos no store via `kv.googleAdsTokens`).
- **Escopo atual — só EUA:** a conta Google Ads é chamada "Coco and Luna" (nome da marca BR) mas **só roda campanhas dos EUA** hoje. O negócio tem loja nos dois países — `cocoandluna.com.br` (BR) e **`thecocoandluna.com`** (EUA, além do já documentado `vita-pet-life.myshopify.com`) — mas o Luan confirmou que essa conta de Ads só serve o mercado americano por enquanto. Por isso a integração é exposta **apenas no mercado US** de `/api/campaigns`, e `fetchOrders`/`metrics.js`/`sync.js` **não foram tocados** — nenhuma mudança no cálculo de KPI/ROAS do dashboard principal.
- **Google Ads API é separada da UI do Google Ads** — requer projeto próprio no Google Cloud Console:
  1. Criar projeto em `console.cloud.google.com` e ativar a API "Google Ads API".
  2. Configurar a tela de consentimento OAuth (OAuth consent screen).
  3. Criar credencial OAuth Client ID do tipo **Web application**, com Redirect URI = `https://live-dashboard-vitapetlife.up.railway.app/googleads/callback` (mesmo padrão dos outros callbacks do projeto).
  4. Gerar um **Developer Token** no Google Ads API Center (dentro da conta Google Ads) — nasce em nível "Test accounts"; precisa solicitar aprovação de **"Basic access"** para consultar a conta real "Coco and Luna".
  5. Se o Developer Token tiver sido gerado sob uma conta gerenciadora (MCC) — fluxo comum ao criar o token — preencher também `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (Customer ID da MCC, sem hífen) para o header `login-customer-id`; sem MCC, deixar em branco.
- **Customer ID:** `134-411-4329` → sem hífen `1344114329` (variável `GOOGLE_ADS_CUSTOMER_ID`).
- **Consulta:** GAQL (Google Ads Query Language) via REST `POST /customers/{id}/googleAds:search`, paginado por `pageToken`/`nextPageToken`. `fetchCampaigns(sinceISO, untilISO)` agrega `cost_micros` (÷1e6 → moeda), `clicks`, `impressions`, `conversions`, `conversions_value` por `campaign.id` no intervalo — **agregado no período, sem granularidade diária** (não usa `segments.date` no SELECT).
- **Retorna zeros/vazio graciosamente** se não configurado ou não autorizado — nada quebra (mesmo padrão de todo o projeto).
- Exposto em `/api/campaigns?market=us` como `channels.google = { available, campaigns }`. **Não** entra no payload de `/api/dashboard` nem no cálculo de `adCost`/`roas` do dashboard principal — decisão deliberada para não expandir escopo além do pedido (fica restrito à tela de Campanhas, igual ao padrão de Meta/ML já usados ali).

### 4.13 Tela de Produtos — `public/produtos.html` (implementado 02/07/2026)
- Panorama do catálogo completo por canal (sem limite de top-N, ao contrário do card de Top Produtos do dashboard principal). Um card por canal, com toggle BR/EUA igual às outras telas (`ch-br`/`ch-us` + `body.market-us`).
- Endpoint próprio: `GET /api/products?market=br|us&since=&until=` → `computeProducts()` em `metrics.js`. Sem cache (é agregação local sobre o store, não chamada a API externa — rápido o suficiente para calcular a cada request).
- Cada card mostra: logo do canal, receita total, nº de pedidos, e uma tabela rolável (`max-height` com `overflow-y`) de todos os produtos vendidos no período, ordenada por receita: **Produto** (com miniatura da imagem, tag de tipo — Pó/Soft Chews/Tablets/Liquid — e a quebra avulso/combo quando aplicável), **Qtd**, **Receita**, **Ticket médio**.
- **Botão de minimizar por card** (canto superior direito, chevron): colapsa/expande a tabela. Estado persistido em `localStorage('coco_produtos_collapsed')`, por canal.
- **Imagem do produto por canal:**
  - Shopify (BR/US): `LineItem.image.url` já vem na mesma query GraphQL de pedidos — sem custo extra.
  - Shopee: `item_list[].image_info.image_url` já vem no `get_order_detail` — sem custo extra.
  - Mercado Livre: **não** vem no pedido. `fetchOrders()` faz uma chamada em lote extra (`GET /items?ids=...`, multiget de até 20 ids) para resolver `thumbnail` por `item.id`, mesmo padrão já usado para resolver `state` via `/shipments/{id}`. Falha graciosamente (sem imagem) se o item não for encontrado.
  - Amazon (BR/US): **sem imagem, tipo ou nome real do produto** — ver item 6 do backlog (seção 9): itens do pedido nunca são buscados.
- **Tipo de produto:** reaproveita `classifyType()` já usada em Segmentos (productType do Shopify como fonte autoritativa, fallback por palavras-chave no título para os demais canais).

#### 4.13.1 Colunas financeiras editáveis (implementado 02/07/2026)
- Colunas adicionadas na tabela: **COG** (custo do produto, por unidade), **Impostos %**, **Comissão %**, **Lucro** (R$) e **Lucro %** — todas calculadas em `computeProducts()` (`metrics.js`) e as 3 primeiras são **editáveis inline** na tabela (`<input type="number">`).
- **Persistência:** `POST /api/products/finance` (`{ channel, title, cog?, taxPct?, commissionPct? }`) salva em `store.js` → `productFinance[ "canal|||título" ]` (mesma chave de agrupamento usada em Top Produtos). `null`/`''` limpa o campo (volta a usar o padrão). Editar um input recarrega a tela inteira (`load()`) pra recalcular tudo com o novo valor — simples e sempre consistente, sem duplicar a fórmula no front.
- **Fórmula:** `Lucro = Receita − (COG × Qtd) − (Receita × Impostos%) − (Receita × Comissão%)`. `Lucro % = Lucro ÷ Receita`. Se **COG não estiver preenchido** (nem override nem padrão), `profit`/`profitPct` ficam `null` e a linha mostra "—" (não assume custo zero, pra não inflar o lucro por engano).
- **Padrão de Impostos — 2,64% fixo** (Simples Nacional, alíquota efetiva do DAS informada pelo Luan em 02/07/2026 — **não varia por produto**, é da empresa toda). Editável por linha se algum produto tiver regra tributária diferente.
- **Padrão de COG** (`defaultCog()` em `metrics.js`): valores de referência informados pelo Luan em 02/07/2026 — **R$ 15,21** para produtos com "lisina"/"lysine" no título, **R$ 17,32** para "daily" no título. Variações de tamanho/combo do mesmo produto (240g, 360g, combos) herdam o mesmo valor por enquanto — o custo real por grama pode ser diferente e precisa ser ajustado manualmente linha a linha.
- **Padrão de Comissão** (`DEFAULT_COMMISSION_PCT` em `metrics.js`): valores de referência típicos por canal, não confirmados com o Luan — **Shopee 18%, Mercado Livre 14%, Amazon 12%** (BR e US), **Shopify BR/US 0%** (não é marketplace, a taxa de gateway de pagamento é outro assunto, não modelada aqui). Editável por produto se a taxa real for diferente.
- **Totais por canal:** `channels[ch].totalProfit`/`profitPct` somam só os produtos com COG preenchido (`profitProductsCount`) — a tabela mostra "X de Y produtos c/ COG" no rodapé pra deixar claro que o total pode estar parcial.
- **Produtos com tag "combo" somem da listagem (implementado 02/07/2026):** produtos Shopify vendidos como o combo em si (tag `combo`, case-insensitive, **não** via Shopify Bundles/`lineItemGroup`) não aparecem como linha própria — a venda é atribuída ao produto-base via `stripComboSuffix()` (remove o sufixo `" - Combo de N unidades"` do título) e contabilizada em `comboBySize`, exatamente como os combos vendidos via Bundles. O "produto-base" precisa ter esse título exato (sem o sufixo de combo) pra a mesclagem funcionar — se não existir, cria uma linha nova só com a quantidade do combo. A contagem aparece no textinho `.prod-combo` sob o nome do produto-base (mesmo lugar de sempre), não em resumo separado.

## 5. Modelo de dados (pedido normalizado)

```js
{
  id, channel,            // 'shopify' | 'shopify_us' | 'shopee' | 'mercadolivre' | 'amazon' | 'amazon_us'
  market,                 // 'br' | 'us'
  name, createdAt,        // ISO (UTC)
  status, cancelled,      // cancelled = bool já calculado
  total,                  // número (BRL para BR, USD para US)
  source,                 // origem de marketing ('Instagram' | 'Shopee' | 'Mercado Livre' | 'Amazon' | '')
  customer,
  state,                  // código de estado do endereço de entrega ('SP', 'RJ', 'CA', 'TX', ...)
  listingType,            // ML only: 'organic' (Clássico/free) | 'premium' (Destaque/gold) | null
  items: [{ title, qty, amount }]
}
```

## 6. Configuração (.env)

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (Railway injeta automaticamente) |
| `SYNC_INTERVAL_MINUTES` | Frequência do sync automático (padrão 15) |
| `STORE_OFFSET_MINUTES` | Fuso da loja BR em minutos do UTC. Brasil = `-180` |
| `SHOPIFY_STORE` | Domínio `.myshopify.com` da loja BR |
| `SHOPIFY_ADMIN_TOKEN` | Token do custom app BR (escopos: `read_orders`, `read_products`, `read_reports`, `read_analytics`, `read_customers`) |
| `SHOPIFY_API_VERSION` | Manter `2026-04` ou posterior |
| `SHOPIFY_US_STORE` | Domínio `.myshopify.com` da loja US (`vita-pet-life.myshopify.com`) |
| `SHOPIFY_US_ADMIN_TOKEN` | Token do custom app US |
| `SHOPEE_PARTNER_ID/KEY/SHOP_ID` | Credenciais Shopee Open Platform |
| `SHOPEE_REDIRECT_URL` | URL de callback OAuth da Shopee |
| `SHOPEE_PRODUCTION` | `1` para produção Shopee (aguardando aprovação) |
| `ML_CLIENT_ID` | App ID do Mercado Livre |
| `ML_CLIENT_SECRET` | Secret do app Mercado Livre |
| `ML_REDIRECT_URL` | URL de callback OAuth do ML |
| `META_APP_ID` | ID do app Meta |
| `META_APP_SECRET` | Secret do app Meta |
| `META_ACCESS_TOKEN` | Token de acesso de longa duração (System User) — único token para BR e EUA |
| `META_AD_ACCOUNT_ID` | Conta de anúncios BR — Coco and Luna (sem prefixo `act_`) |
| `META_US_AD_ACCOUNT_ID` | Conta de anúncios EUA — Vita Pet Life (`826249215807271`, sem prefixo `act_`) |
| `AMAZON_CLIENT_ID` | LWA Client ID do app SP-API — cobre **US e BR** (mesmo app/token) |
| `AMAZON_CLIENT_SECRET` | LWA Client Secret |
| `AMAZON_REFRESH_TOKEN` | LWA Refresh Token (autorizado para US + BR via `marketplaceParticipations`) |
| `AMAZON_ROLE_ARN` | ARN do IAM Role com permissões SP-API — compartilhado entre EUA e BR |
| `AMAZON_AWS_ACCESS_KEY` | Access Key do IAM User com permissão `sts:AssumeRole` no role acima |
| `AMAZON_AWS_SECRET_KEY` | Secret Key do mesmo IAM User |
| `GOOGLE_ADS_CLIENT_ID` | OAuth Client ID (tipo Web application) do projeto Google Cloud |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth Client Secret do mesmo projeto |
| `GOOGLE_ADS_REDIRECT_URL` | URL de callback OAuth (`/googleads/callback`) |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Developer Token do Google Ads API Center — precisa de aprovação "Basic access" |
| `GOOGLE_ADS_CUSTOMER_ID` | Customer ID da conta "Coco and Luna" sem hífen (`1344114329`) — só EUA, ver 4.12 |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Customer ID da MCC (sem hífen) — só se o Developer Token tiver sido gerado sob uma conta gerenciadora |
| `DATABASE_URL` | Connection string Postgres (Railway injeta via `${{Postgres.DATABASE_URL}}`) |

**Armadilhas conhecidas:**
- `read_analytics` ausente → `shopifyqlQuery` some do schema sem aviso (não dá erro de permissão).
- Railway NÃO injeta `DATABASE_URL` automaticamente — adicionar manualmente: `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.
- Amazon SP-API `CreatedBefore` deve ser ≥2 min antes do momento atual — código já aplica margem de 3 min.
- O IAM User precisa de política `sts:AssumeRole` no Role E o Role precisa ter o User no Trust Policy.
- ML Product Ads (`fetchAdCosts`) requer escopo `write:product_ads` no OAuth do ML — token padrão não tem. Para ativar: adicionar escopo no app ML e re-autorizar via `/mercadolivre/connect`.

## 7. Como rodar / endpoints

- `npm install` → `npm start` (porta 3000). Sync roda ao subir e a cada `SYNC_INTERVAL_MINUTES`.
- `npm run sync` faz uma sincronização única (útil para testar credenciais).
- Endpoints:
  - `GET /api/dashboard?channel=&metric=&since=YYYY-MM-DD&until=YYYY-MM-DD&market=br|us`
  - `GET /api/campaigns?market=br|us&since=&until=` — campanha a campanha (ao vivo, cache 5 min). BR: Mercado Ads + Meta; US: Meta + Google Ads. Usado pelo painel "Gastos" da tela de Campanhas (`campanhas.html`). Shopee/Amazon não retornam (sem API de gasto).
  - `GET /api/products?market=br|us&since=&until=` — catálogo completo de produtos por canal (sem cache, direto do store). Usado pela tela de Produtos (`produtos.html`).
  - `POST /api/products/finance` — salva/edita COG, % impostos ou % comissão de um produto (`{ channel, title, cog?, taxPct?, commissionPct? }`), persistido em `kv.productFinance`. Ver 4.13.1.
  - `POST /api/sync`
  - `GET /api/status` — diagnóstico: credenciais configuradas, backoff Amazon, último sync
  - `POST /api/amazon/reset-backoff` — zera o backoff da Amazon manualmente
  - `POST /api/amazon/force-sync` — zera backoff + executa sync atomicamente
  - `GET /shopee/connect` e `GET /shopee/callback`
  - `GET /mercadolivre/connect` e `GET /mercadolivre/callback`
  - `GET /googleads/connect` e `GET /googleads/callback`
  - `GET /health`

## 8. Status das integrações (30/06/2026)

### Amazon US + BR SP-API — ativo ✅ (chamada combinada)
- **Um único app/token** (`AMAZON_CLIENT_ID/SECRET/REFRESH_TOKEN`) cobre US (`ATVPDKIKX0DER`) e BR (`A2Q3Y263D00KWC`). Confirmado via `marketplaceParticipations`.
- **Endpoint:** `sellingpartnerapi-na.amazon.com` (região NA) serve os dois marketplaces.
- **Chamada combinada:** `fetchOrders()` faz uma única requisição com `MarketplaceIds=US,BR`. Cada pedido separado por `MarketplaceId` → `channel: 'amazon_us' / market: 'us'` ou `channel: 'amazon' / market: 'br'`.
- **IAM Role `SellingPartnerAPIRole`**: política `SPAPIInvokePolicy` com `execute-api:Invoke` em `*`. Trust policy inclui `usdashboard` user. ✅
- **Rate limit:** 0.0167 req/s (burst 20), balde compartilhado. Backoff único (`kv.amazonBackoff`). Se levar 429 sustentados, **não** usar force-sync em loop — aguardar a cota se restaurar naturalmente.
- **Endpoint `POST /api/amazon/reset-backoff?delay=N`:** aceita `delay` em minutos para backoff customizado.

### Shopee — ativa ✅
- Credenciais de produção configuradas: Partner ID 2037711, Shop ID 1502160212.
- 83 pedidos confirmados no banco. Chunking de 15 dias implementado em `src/shopee.js`.
- Analytics da Shopee (tráfego, insights) **não disponível via API** — só no Seller Center. Endpoints retornam `error_not_found`.

### Mercado Livre — ativo ✅
- OAuth autorizado. Tokens persistidos no Postgres. Re-autorizar após deploy via `/mercadolivre/connect`.
- 140 pedidos no banco.
- **ML Ads:** dados de gasto por campanha confirmados (~R$ 1.937 no período testado). `fetchCampaigns()` e `fetchAdCosts()` operacionais. Escopo `write:product_ads` já habilitado no token atual.

### Google Ads (EUA) — código pronto ⏳, aguardando credenciais
- Implementado em `src/googleads.js` (ver 4.12). Código não quebra nada sem credenciais — só falta o Luan criar o projeto no Google Cloud, gerar Developer Token com Basic access, e rodar `/googleads/connect` uma vez.
- Só EUA (conta "Coco and Luna", Customer ID `1344114329`, roda campanhas apenas nos EUA hoje).

## 9. Próximos passos (backlog priorizado)

1. Decidir tratamento de **PENDING** (contar só pagos?) — ver 4.1.
2. **Google Ads:** falta o Luan configurar o projeto no Google Cloud + Developer Token e autorizar via `/googleads/connect` — ver 4.12. Código já implementado.
3. **ML Ads ROAS por campanha:** o campo `listingType === 'premium'` pode não estar capturando todos os pedidos Destaque — verificar se `listing_type_id` nos pedidos ML está preenchido corretamente.
4. Login/usuários se mais pessoas precisarem acessar.
5. **Amazon US na produção:** após quotas se recuperarem do período de sobrecarga, confirmar que pedidos US aparecem na dashboard (o código está correto — era problema de quota penalizada).
6. **Amazon — itens do pedido não são buscados:** `fetchOrders()` em `src/amazon.js` só lê `NumberOfItemsShipped/Unshipped` do pedido e cria itens com `title:''` (placeholder) — nunca chama o endpoint de item do pedido (`/orders/v0/orders/{id}/orderItems`). Por isso Amazon (BR e US) nunca aparece em Top Produtos, Segmentos ou na tela de Produtos (itens sem título são ignorados nessas telas). Corrigir exigiria uma chamada extra por pedido (mais lento, mais exposto a 429) — avaliar com cautela dado o histórico de penalização de cota (ver 4.7).

## 10. Convenções

- Código em ES Modules (`"type": "module"`). Node 18+ (usa `fetch` nativo).
- Dependências mínimas: `express`, `dotenv`, `pg`. Manter simples — sem aws-sdk, sem axios.
- Toda a UI e textos em **pt-BR**. Valores em **BRL** (`Intl`/`toLocaleString('pt-BR')`).
- `.gitignore` inclui: `node_modules/`, `.env`, `data/db.json`, `*.log`, `.DS_Store`, `.claude/`.
