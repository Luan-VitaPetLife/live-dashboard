# CLAUDE.md — Contexto do projeto (handoff para o terminal)

> Este arquivo é lido automaticamente pelo Claude Code ao abrir o projeto.
> Ele resume **tudo** que já foi decidido e descoberto, para retomar o trabalho sem repetir investigação.

## 1. O que é

Dashboard de vendas **multi-mercado e multicanal** da marca **Coco and Luna** (suplementos para pets),
que nasceu nos EUA e hoje também vende no Brasil. A empresa por trás da marca é a **Vita Pet Life**.
- **Brasil 🇧🇷:** loja Shopify BR (`cocoandluna.com.br`) + Shopee + Mercado Livre + Amazon BR (SP-API)
- **EUA 🇺🇸:** loja Shopify US (`vita-pet-life.myshopify.com`) + Amazon US (SP-API)

**Importante (alinhado 06/07/2026):** "Vita Pet Life" é a **empresa**, não uma marca/loja separada da
Coco and Luna — ela aparece no domínio da loja Shopify US e no nome da conta de anúncios Meta EUA por
motivos administrativos/históricos, mas a marca vendida em ambos os mercados é sempre **Coco and Luna**.
Textos de UI (títulos, subtítulos, rodapés) não devem tratar "Vita Pet Life" como o nome da loja do
mercado EUA em paralelo a "Coco and Luna" da loja BR — ambas as lojas são Coco and Luna.

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
- Amazon BR: Marketplace ID `A2Q3Y263D00KWC`. Conta de vendedor **CocoandLuna** — token próprio (`AMAZON_BR_REFRESH_TOKEN`), mesmo app/Client ID da US. Endpoint: `sellingpartnerapi-na.amazon.com` (região NA — não SA). Ver 4.7.1.

### EUA
- Shopify US: **vita-pet-life.myshopify.com** · ~99 pedidos/30 dias confirmados.
- Amazon US: SP-API configurado com LWA + AWS SigV4 via IAM AssumeRole. Conta de vendedor **VITA PET LIFE**.
  - IAM User: `arn:aws:iam::354674816862:user/usdashboard`
  - IAM Role: `arn:aws:iam::354674816862:role/SellingPartnerAPIRole`
  - Marketplace ID: `ATVPDKIKX0DER` (Amazon.com US)
  - Volume: **~1.000 pedidos/dia** — muito acima dos demais canais. Ver 4.7.3 (sync incremental).
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
src/us-states.js        normalizeUsState(): reduz grafias de estado dos EUA ao código de 2 letras (Geografia US)
src/sync.js             Orquestra a busca de todos os canais BR e US e grava no store
public/index.html       Dashboard principal (toggle de mercado, receita, tendência, canais, pedidos)
public/campanhas.html   Tela de Campanhas: visão de gastos reais por canal + cards por campanha
public/produtos.html    Tela de Produtos: catálogo completo por canal (tabela com foto, tipo, qtd, receita)
public/estoque.html     Tela de Estoque: estoque + produção por canal, híbrido real (vendas) + manual (estoque/produção)
public/sidebar.js       Componente de sidebar compartilhado (IIFE) — incluído em todos os HTMLs
public/colors.js        Sistema de cores compartilhado (IIFE) — cores de canal/marketing + novo color picker (ver 4.9c)
src/auth.js              Login/usuários: hash scrypt+salt, sessão por cookie, CRUD de usuários, permissão por página — ver 4.16
public/login.html        Tela de login (standalone, sem sidebar) — ver 4.16
public/configuracoes.html Tela de Configurações: geral, ativar/desativar login, gestão de usuários (admin only) — ver 4.16
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
- `getOrders({ channel, since, until, market })` — filtra por mercado. Pedidos legados sem campo `market` são inferidos como `'br'` (exceto `channel === 'shopify_us'` → `'us'`, e `channel === 'amazon'` com id `amazon-us:` → `'us'`).
- **Índice em memória do `getOrders` (10/07/2026):** para aguentar centenas de milhares de pedidos (backfills grandes), o `getOrders` não faz mais `Object.values()` + `.filter()` encadeado a cada chamada. Mantém, por mercado (`ordersByMarket`), um array de pedidos ordenado por timestamp + um array paralelo dos timestamps parseados (`tsByMarket`), e recorta a janela de datas por **busca binária** (`lowerBound`/`upperBound`), filtrando o canal numa única passada. O índice é reconstruído **preguiçosamente** — `upsertOrders` só marca `indexDirty = true`; a reconstrução (`rebuildOrdersIndex`) roda na próxima leitura, então um backfill que faz muitos upserts em lote paga uma reconstrução só. A inferência de mercado (`inferMarket`) é a mesma de antes. Interface pública **inalterada** (continua síncrona). Ver seção 9, item 9.

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
  - **Bug corrigido (07/07/2026):** o código lia `listing_type_id` de dentro de `order_items[].item`
    na resposta de `/orders/search` — mas esse campo **não existe** nessa resposta (confirmado
    contra a doc oficial e exemplos reais de JSON da API; `order_items[].item` só tem `id, title,
    category_id, variation_id, seller_custom_field, variation_attributes, seller_sku, condition`).
    Resultado: `ltid` era sempre `null`, todo pedido ML caía em `'organic'`, `mlBreakdown.premium`
    ficava sempre 0, e por isso "Vendas Atribuídas Geral" em Campanhas nunca somava Mercado Livre
    (só Meta), mesmo com gasto real de Mercado Ads > 0. **Corrigido:** `listing_type_id` agora é
    lido do recurso do item de verdade, via a mesma chamada em lote `/items?ids=...` (multiget) que
    já existia pra buscar a thumbnail (ver 4.13) — sem custo extra de requisição. `fetchOrders()`
    monta `typeMap` junto com `thumbMap` nesse lote e só resolve `o.listingType` depois, usando o
    `_itemId` do primeiro item do pedido.
- **ML Product Ads — fluxo correto (Mercado Ads API, exige header `Api-Version: 1`):**
  1. Resolver advertiser: `GET /advertising/advertisers?product_id=PADS` → `advertiser_id` + `site_id` (helper `getPadsAdvertiser()`).
  2. Métricas agregadas: `GET /marketplace/advertising/{site_id}/advertisers/{advertiser_id}/product_ads/campaigns/search`
     com `metrics=clicks,prints,cost` + `date_from`/`date_to` → `fetchAdCosts()` soma tudo.
  3. Métricas por campanha: mesmo endpoint com `metrics=clicks,prints,cost,acos,total_amount,units_quantity` → `fetchCampaigns()` retorna array `{ name, status, spend, revenue, orders, clicks, impressions, ctr, acos, roas }`.
  - **Por que vinha zero antes:** código antigo usava `seller_id` num endpoint inexistente, sem `Api-Version: 1`. Corrigido. Dados confirmados: ~R$ 1.937 de gasto real exibidos na tela.
  - **Pré-requisito:** o app ML precisa ter permissão **Mercado Ads** e token gerado via `/mercadolivre/connect`. Sem isso, `/advertising/advertisers` retorna 403 e as funções devolvem zeros/vazio graciosamente.
- `mlBreakdown` exposto em `metrics.js`: `{ organic, premium, adCost, adClicks, roas }`.

### 4.7 Amazon SP-API (EUA + BR) — ativo ✅ (US destravada em 09/07/2026)
- Implementado em `src/amazon.js`. Sem dependências externas (SigV4 e HMAC via `crypto` nativo do Node).
- **Endpoint único:** `sellingpartnerapi-na.amazon.com` (região NA) serve os dois marketplaces (BR é região NA, não SA).
- **Fluxo de autenticação:** 1) LWA token (getter próprio por token) · 2) STS AssumeRole (IAM User, compartilhado) · 3) SigV4 + `x-amz-access-token`.

#### 4.7.1 Duas contas de vendedor distintas (descoberto 09/07/2026)
No Solution Provider Portal (`solutionproviderportal.amazon.com`, app "Dashboard Amazon"), a aba
**Manage Authorizations → Revoke Authorizations → Self Authorizations** lista DUAS contas:
- **`CocoandLuna (Seller)`** → marketplace **Brazil** → é a loja Amazon BR de verdade.
- **`VITA PET LIFE (Seller)`** → **Mexico, Canada, Brazil, United States** → é a loja Amazon US.

Apesar de a conta VITA PET LIFE aparecer como participante do `A2Q3Y263D00KWC` (Amazon.com.br) em
`marketplaceParticipations`, ela **não tem pedidos lá** — confirmado ao vivo: `/orders/v0/orders` com
`MarketplaceIds=A2Q3Y263D00KWC` e o token dela devolve `0 pedidos`, enquanto o mesmo token no
`ATVPDKIKX0DER` devolve centenas. Ou seja:
- `AMAZON_REFRESH_TOKEN` = token da conta **VITA PET LIFE** (US).
- `AMAZON_BR_REFRESH_TOKEN` = token da conta **CocoandLuna** (BR).
- **Nunca colar o mesmo token nas duas.** Isso ativa `SAME_TOKEN` (chamada combinada) e o BR para de
  receber pedidos silenciosamente — aconteceu em 09/07/2026. Tokens diferentes → `SAME_TOKEN === false`
  → duas chamadas separadas, com backoff independente (`kv.amazonBackoff` / `kv.amazonBRBackoff`).
- Gerar/renovar token: portal → Edit App → Manage Authorizations → **Authorize app** na linha da conta.
  Gerar um novo **não invalida** os anteriores. Para a conta CocoandLuna use o link "sign in to that account".

#### 4.7.2 O bug do 429: era a paginação, não a cota (corrigido 09/07/2026)
- **Sintoma que durou semanas:** `amazon_us` sempre 0 no dashboard; Amazon BR sempre funcionando.
  Mesmo app, mesmo token, mesma cota. Suspeitas anteriores (token não autorizado, cota penalizada,
  chamada dupla) estavam **todas erradas** — a US sempre esteve autorizada.
- **Causa real:** a cota de `/orders/v0/orders` é `0.0167 req/s` = **1 requisição por minuto** (burst 20).
  O código pedia a página seguinte **2 segundos** depois (`await sleep(2000)`). Como a US passa de 100
  pedidos por janela (`MaxResultsPerPage: 100`), sempre havia `NextToken` → sempre 429 na página 2 → o
  429 era lançado como exceção → **os 100 pedidos da página 1 iam junto para o lixo**. O BR cabia numa
  página só, nunca paginava, nunca dava 429. Determinístico, não intermitente: esperar jamais resolveria.
- **Por que demorou tanto para achar:** `fetchOrders()` tinha `.catch(e => { console.error(...); return []; })`
  em cada chamada. O erro só ia para o log do container; `/api/sync` e `/api/amazon/force-sync` sempre
  respondiam `errors: []`. **Nunca engolir erro de integração** — a primeira correção foi propagar a falha
  para o relatório do sync, e o `429 QuotaExceeded` apareceu na tentativa seguinte.
- **Correções aplicadas:**
  - Paginação aproveita o burst (dispara as páginas em sequência) e só espera `RATE_WAIT_MS` (61s) quando
    de fato leva 429, com até `PAGE_MAX_TRIES` (3) tentativas por página.
  - `RateLimitError` (`e.isRateLimit`) distingue 429 de erro real. Páginas já lidas viram **upsert parcial**
    em vez de serem perdidas; o cursor **não** avança nesse caso, então o próximo sync completa o resto.
  - Trava `syncInFlight` em `sync.js`: o timer de `SYNC_INTERVAL_MINUTES` não dispara um segundo sync por
    cima de um em andamento (a Amazon pode paginar por minutos), o que dobrava requisições no mesmo balde.
- **Verificado ao vivo (09/07/2026):** 1638 pedidos US em 10s (17 páginas, zero 429) no teste local;
  em produção o sync das 18:30 gravou **2.353 pedidos / US$ 34.390** no `channelSplit.amazon_us`.

#### 4.7.3 Sync incremental por cursor (implementado 09/07/2026)
- **Motivo:** a conta US faz **~1.000 pedidos/dia**. A janela antiga de 7 dias significava rebaixar ~7.000
  pedidos (~70 páginas ≈ 70 min) **a cada 15 minutos**, sendo que 99% já estavam no banco.
- `kv.amazonCursors` (`store.js`: `getAmazonCursor(key)` / `setAmazonCursor(key, iso)`) guarda o ISO do
  último sync **completo** por balde: `'us'`, `'br'` ou `'combined'`.
- Com cursor → `LastUpdatedAfter` / `LastUpdatedBefore` (traz **mudança de status** — cancelamento, reembolso,
  captura de pagamento de um `Pending` — que `CreatedAfter` nunca pegava). Sem cursor (1ª execução) →
  `CreatedAfter` / `CreatedBefore`. Sobreposição de 10 min (`CURSOR_OVERLAP_MS`) ao retomar; upsert é por id.
- Sync típico depois da 1ª carga: ~10 pedidos, **1 requisição, ~1s**.
- **`AMAZON_BACKFILL_DAYS`** (padrão `2`) — janela só da primeira carga, dimensionada para caber no burst.

#### 4.7.5 Backfill histórico via Reports API (implementado 09/07/2026)
- **Por que não paginar `/orders` para trás:** 100 pedidos/página a 1 req/min. Com ~890 pedidos/dia na conta US,
  90 dias seriam ~840 requisições ≈ 14 h, disputando a cota com o sync. Inviável.
- **`backfillOrders({ market, days, onProgress, onChunk })`** em `amazon.js`: quebra o período em janelas de
  `REPORT_CHUNK_DAYS` (30, limite da Amazon) e para cada uma faz
  `createReport` → poll `processingStatus` até `DONE` → `getReportDocument` → baixa → `gunzip` → parse TSV.
  Cada lote vai para `onChunk()` e é gravado na hora: falha adiante não desfaz o que já veio.
  Report type: `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL`.
- **`POST /api/amazon/backfill?days=90&market=us`** dispara em background e responde na hora.
  Progresso em `GET /api/status` → `amazon.backfill` (`{ status, orders, message }`).
- **A Reports API usa balde de cota próprio** — não concorre com `/orders/v0/orders`. Rodar backfill não provoca
  429 no sync (ao contrário de paginar pedidos, ver 4.7.4).
- **O relatório traz uma linha POR ITEM, com `product-name`** — é a única forma de obter o título do produto da
  Amazon (a API de pedidos nunca devolve). `ordersFromRows()` agrupa por `amazon-order-id`, soma
  `item-price + item-tax + shipping-* + gift-wrap-* − promotion-discounts` para o `total`, e monta `items[]`.
  Item com `item-status: Cancelled` (ou pedido cancelado) não soma receita nem unidade.
- **Executado em produção 09/07/2026:** 90 dias US → **83.897 pedidos em 4min40s** (3 relatórios).
  `channelSplit.amazon_us` = US$ 2.014.895 em 90 dias. Amazon passou a aparecer em Produtos com nome real.
- **`ship-state` normalizado para maiúsculas** aqui e em `fetchOrders()`: a Amazon devolve `"UT"` e `"Ut"` para o
  mesmo estado, criando duas chaves distintas em `byState` e quebrando a contagem no mapa de Geografia US.
- **⚠️ O backfill roda no processo do servidor** (`backfillOrders` em background, não é um worker separado). Um
  **deploy/restart do Railway no meio mata a execução** — o estado em `kv.amazonBackfill` congela no último
  `running` e `backfillRunning` (flag em memória) volta a `false` no restart. Aconteceu em 10/07/2026: um backfill
  de 365 dias começou às 17:17 e foi morto pelo deploy da otimização do `store.js` minutos depois, deixando o status
  preso em "criando relatório ... → 0 pedidos". **Regra:** só disparar backfill quando não houver deploy pendente,
  e não mergear/deployar nada até ele terminar (~15-20 min p/ 365 dias). Se morrer, é só re-disparar (upsert por id,
  idempotente).

#### 4.7.6 Reconciliação de nomes de produto (resolvido 10/07/2026)
- **O problema (era):** o backfill (Reports API) preenche `items[{ title, qty, amount }]`, mas o **sync contínuo**
  (`fetchOrders`, Orders API) cria `items` com `title: ''` — a Orders API nunca devolve o título do item. Pedidos da
  Amazon posteriores ao backfill entravam sem nome, e Top Produtos/Produtos/Estoque desatualizavam com o tempo.
- **Correção (backlog item 8):** um **job separado** (`reconcileAmazonNames` em `sync.js`, agendado em `server.js`)
  busca um relatório curto dos últimos `AMAZON_NAMES_DAYS` dias (padrão 2) via `amazon.fetchRecentNamedOrders()` —
  a Reports API tem **balde de cota próprio**, então não concorre com o sync de pedidos nem provoca 429 — e preenche
  os títulos por id com `store.patchOrderItems()`.
- **`patchOrderItems(orders)` (`store.js`):** casa por id e **só sobrescreve `items[]`** (quando o relatório trouxe
  título), **sem tocar em `total`/`status`/`state`** — que continuam vindo da Orders API. Isso evita flip-flop do
  valor entre as duas fontes (o `total` do relatório é somado dos itens e pode divergir do `OrderTotal`). Pedido que
  ainda não existe no store é inserido inteiro (não se perde). Marca o índice em memória como sujo.
- **Agendamento:** job próprio, **fora do `runSync`** (para não travar o "Sincronizar agora", já que o relatório leva
  ~1-2 min). Roda 3 min após subir e a cada 6h; a função só dispara um relatório se já passou
  `AMAZON_NAMES_EVERY_HOURS` (padrão 12h) desde o último, **por mercado** (throttle via cursor `names-<market>` em
  `kv.amazonCursors`). Pulado enquanto um backfill roda (não disputar a cota da Reports API).
- **Disparo manual:** `POST /api/amazon/sync-names?market=us|br` (ignora o throttle, roda em background). Útil para
  verificar logo após deploy sem esperar o job automático. Sem `market` → US e BR.
- **Cobertura:** com janela de 2 dias e cadência de 12h, todo pedido novo é visto várias vezes na sua primeira
  janela, então o título entra em até ~12h após a criação (o pedido e o valor aparecem na hora, via Orders API).
- **⚠️ Preservação de título no `upsertOrders` (corrigido 10/07/2026 — bug que esvaziava Segmentos/Produtos):** o sync
  de pedidos (Orders API) roda a cada 15 min re-baixando pedidos **recém-atualizados** (pending→shipped, captura de
  pagamento) — e regravava esses pedidos com `items` de **título vazio**, apagando os nomes que o backfill/reconciliação
  tinham preenchido. Resultado: num dia de US$ 4k, a tela de Segmentos mostrava só ~3 unidades (só os poucos pedidos que
  não foram re-sincronizados depois de nomeados). **Correção:** `upsertOrders` agora **preserva `items` já titulados**
  quando o pedido que chega vem 100% sem título (`o.items.every(!title)` e o existente tem título) — mantém `total`/
  `status` do pedido novo (Orders API é a fonte deles), só não deixa apagar os nomes. Para outros canais o item sempre
  tem título, então a guarda nunca dispara. **Depois de deployar, rodar `POST /api/amazon/sync-names?market=us` uma vez**
  para re-preencher os títulos já apagados — a partir daí eles **grudam**.
- **⚠️ Receita por item escalada ao total capturado (`amazonRevFactor`, corrigido 10/07/2026):** os itens da Amazon
  vêm do relatório com **preço bruto**, e pedidos **Pending** têm `total: 0` até a captura no envio. Como Segmentos/
  Produtos/Top Produtos somavam `item.amount` (bruto), num dia de **US$ 5k capturado** a tela de Segmentos mostrava
  **US$ 17k** (contava pedidos ainda não capturados a preço cheio). `amazonRevFactor(o)` em `metrics.js` escala a
  receita dos itens para o `o.total` do pedido (fonte de verdade em todo o app): captado → itens somam o total;
  Pending → 0. Só afeta a Amazon (outros canais retornam fator 1). **Unidades continuam contando todas** (unidades
  pedidas), só a receita respeita a captura. Aplicado em `aggregateProductsByChannel` (Produtos/Estoque/Top Produtos)
  e na agregação de Segmentos.
- **Tela de Segmentos (`segmentos.html`, 10/07/2026):** ganhou **seletor de canal** (dropdown por mercado — o backend
  já filtra os segmentos pelo `channel` do `/api/dashboard`) e **"ver mais/ver menos"** nos top produtos (o backend
  passou a devolver a lista completa em `segments[k].topProducts`, a tela mostra 5 e expande).
- **Nota de limite:** o nome do produto vem, mas o **nome do comprador (PII)** continua vazio nos dois caminhos —
  é dado restrito, exige o papel PII aprovado pela Amazon (ver 4.7.4 e backlog item 10).

#### 4.7.7 ⚠️ INCIDENTE 10/07/2026 — disco do Postgres cheio (recuperado via resize)
- **O que aconteceu:** o backfill de **365 dias** trouxe **359.626 pedidos** US. O `upsertOrders` fazia **um `INSERT`
  autocommit por pedido** — ~30 mil por chunk despejados de uma vez geraram um **pico de WAL** que **encheu o volume
  do Postgres**, que estava em **apenas 500 MB**. O banco caiu com `No space left on device` no `pg_wal` e entrou em
  **loop de recuperação** (o health check reiniciava antes de o replay concluir; sem espaço, o checkpoint não fechava).
- **Como foi recuperado (SEM perda de dados):** o volume do Railway tem um botão **"Live resize"** e o plano **Hobby
  permite até 5 GB** de storage (estava em 500 MB por padrão — não é limite do plano). Aumentar para **5 GB** deu espaço
  para a recuperação concluir; o banco voltou com **todos os 359.626 pedidos, tokens e dados manuais intactos**. Não
  houve reset. Custo: o Railway cobra só pelo uso real, então subir o teto do volume é barato.
- **Lição:** o `pg_wal` bloat de um bulk insert autocommit derruba um volume pequeno; **o padrão de 500 MB era o gargalo
  invisível**. Se o disco encher de novo, o primeiro reflexo é **Live resize** (até 5 GB no Hobby), não reset.
- **Correção 1 — gravação em lote (`store.js`):** `pgUpsertOrders` faz `INSERT` multi-linha (lotes de `PG_BATCH`=500,
  `ON CONFLICT DO UPDATE SET data=EXCLUDED.data`) em vez de uma query por pedido. ~60 statements por chunk em vez de
  30 mil → uma fração do WAL. `upsertOrders` e `patchOrderItems` passam por ele. **É o que impede o pico de WAL repetir.**
- **Correção 2 — poda de retenção (`store.js` `pruneOrders` + `sync.js`):** a cada sync, remove pedidos **só da Amazon**
  (`amazon`/`amazon_us`) mais antigos que `AMAZON_RETENTION_DAYS`. **Opt-in: padrão `0` = DESLIGADA** — de propósito,
  para um deploy nunca apagar dados sozinho (com padrão 90 teria apagado 9 meses recém-recuperados). Defina a env var
  para ativar: **`AMAZON_RETENTION_DAYS=365`** = janela móvel de 1 ano (o que rodamos hoje — cabe nos 5 GB com o batch
  insert). Shopify/Shopee/ML ficam completos. `DELETE ... WHERE data->>'channel' = ANY($1) AND data->>'createdAt' < $2`.
  Autovacuum reaproveita o espaço; para devolver disco ao SO de fato, rodar `VACUUM FULL orders` uma vez após uma poda.
- **Estado (10/07/2026):** 365 dias de Amazon US mantidos no Hobby com volume de 5 GB. `AMAZON_RETENTION_DAYS=365` no
  Railway mantém a janela móvel; o sync diário adiciona ~30 mil/mês e a poda tira o que passa de 1 ano → tamanho estável.

#### 4.7.8 ⚠️ Vazamento de mercado: pedidos US gravados como Amazon BR (corrigido 13/07/2026)
- **Sintoma:** o card de Produtos do **Brasil** mostrava pedidos da Amazon **US** — canal `amazon` (BR) com
  US$ 97.762 / 3.367 pedidos / 32 produtos, **todos com título em inglês** ("Cranberry for Dogs",
  "L-Lysine for Cats 900mg", "Turmeric for Dogs"). Inflava a receita do BR em todas as telas (dashboard,
  Produtos, Estoque, Segmentos, Geografia BR — todas leem `getOrders({market:'br'})`).
- **Causa raiz — relatório cego-tagueado + insert na reconciliação:** `reconcileAmazonNames` roda para
  `['us','br']` (job a cada 6h). Para `br`, `fetchRecentNamedOrders` pede o relatório `ALL_ORDERS` e
  `ordersFromRows(rows, MARKETPLACE_ID_BR)` **tagueava toda linha** como `market:'br'`/`channel:'amazon'`/
  id `amazon-br:<id>`, **sem checar o marketplace real da linha**. O relatório "BR" vinha contaminado com
  pedidos US (tokens iguais / a conta US enxerga o relatório), e `patchOrderItems` **inseria** esses ids
  inexistentes como pedidos Amazon BR novos. (A Orders API do sync tagueia por `o.MarketplaceId` e vem sem
  título, então **só o caminho da Reports API** produzia esse lixo — por isso todos tinham nome em inglês.)
- **Correções (defesa em profundidade):**
  1. **`patchOrderItems` não insere mais** (`allowInsert` padrão `false`) — a reconciliação só CORRIGE TÍTULO
     de pedido que a Orders API (fonte de verdade do pedido e do mercado) já gravou. O sync roda a cada 15 min
     e sempre insere o pedido antes da reconciliação (12h), então o insert nunca era necessário.
  2. **`ordersFromRows` valida o mercado real por linha** (`rowMarket`) e descarta linha de outro mercado —
     um backfill/relatório contaminado não grava mais pedido no mercado errado.
     - ⚠️ **A 1ª versão usava a MOEDA (`currency`) e FALHOU** (13/07/2026): o backfill BR gravou o catálogo US
       de novo. Motivo: as contas **CocoandLuna (BR)** e **VITA PET LIFE (US)** são **VINCULADAS na Amazon**
       (tokens são DIFERENTES — não é o bug de token igual), e o relatório ALL_ORDERS **ignora o filtro
       `marketplaceIds`** e devolve os dois mercados juntos, reportando **tudo em BRL** no contexto BR — então
       `currency` não discrimina. (A Orders API respeita o filtro; por isso o sync traz só o mercado certo.)
     - **Correção:** `rowMarket` usa o **país de entrega (`ship-country`)** — físico, não reescrito pelo
       contexto do relatório (pedido entregue nos EUA é `US` sempre); fallback por `sales-channel`. NÃO usar
       moeda nem `ship-state` (siglas de UF BR colidem com estados US: SC, PA, MA, MT, MS, AL, PR, AP).
     - **Diagnóstico:** `GET /api/amazon/report-columns?market=br` (`inspectReport`) devolve as COLUNAS reais
       do relatório + amostra dos campos de mercado + proporção US/BR — confirmar o discriminador certo antes
       de reconfiar no backfill BR. Enquanto não confirmado, **não rodar `backfill?market=br`**.
  3. **`inferMarket` (store.js)** passou a mapear `channel === 'amazon_us'` → `us` (defensivo; pedido US sem
     campo `market` não cai mais em BR).
  4. **Limpeza do já gravado:** `POST /api/amazon/cleanup-market-leak` (`removeAmazonMarketLeak`) remove
     `channel:'amazon'` + `market:'br'` por dois sinais, ambos exclusivos da Reports API (o Amazon BR nunca
     passou por ela — nenhum backfill BR rodado, backlog item 11): **(a) item titulado** (pedido US enviado/
     pendente vazado) e **(b) `status === 'Cancelled'` com R$ 0 e sem item** — a grafia com DOIS L que só o
     relatório grava (a Orders API grava `'Canceled'`, um L); pega o pedido US cancelado, que no relatório não
     vira linha de item (fica sem título/R$ 0) e escaparia do sinal (a). **Cuidado:** casar `'Canceled'` (um L)
     apagaria cancelamento BR real — casar sempre exatamente `'Cancelled'`. Idempotente. **Rodar UMA vez após
     o deploy.** ⚠️ Não re-rodar se um dia um backfill BR de verdade for feito (aí pedido BR real teria título/
     grafia de relatório).

#### 4.7.9 Nome de produto do Amazon BR: caminho getOrderItems + o 400 nos pedidos 701-/702- (13/07/2026)
- **Contexto:** tentativa de obter os nomes de produto do Amazon BR (backlog item 11). O relatório (Reports API)
  NÃO serve pro BR: `inspectReport?market=br` (2 dias) devolveu 1815 linhas, **1811 US / 0 BR** — o relatório do
  marketplace BR vem dominado por pedidos US (`ship-country=US`, `sales-channel="Non-Amazon US"`). Por isso o
  caminho passou a ser o `getOrderItems` (por-pedido).
- **HIPÓTESE DESCARTADA (eu errei):** cheguei a concluir que `AMAZON_BR_REFRESH_TOKEN` autorizava a conta US
  errada. **`getMarketplaceParticipations` (`/api/amazon/whoami`) provou o contrário:** os dois tokens
  (`AMAZON_REFRESH_TOKEN` e `AMAZON_BR_REFRESH_TOKEN`) enxergam **exatamente os mesmos 10 marketplaces**,
  **incluindo `A2Q3Y263D00KWC` (Amazon.com.br) com `participating: true`**. Ou seja, é **uma conta unificada da
  América do Norte** (US+CA+MX+BR) e o token TEM acesso ao Brasil. Não é problema de token/conta.
- **CAUSA REAL (apurada 13/07/2026):** o app tem acesso de **LISTAGEM** aos pedidos BR, mas **NÃO** aos
  **detalhes**. Prova via `probe-order` num pedido `701-`: `getOrder` devolve `{ payload: {} }` (vazio, sem
  erro) e `getOrderItems` dá **400 InvalidInput COM e SEM RDT** (logo não é LGPD/RDT). Decisivo: o **mesmo token
  BR** lê itens de pedido **US** (`111-/112-`) mas falha no pedido **BR** (`701-/702-`) — muda só o pedido, então
  a trava é do **marketplace Brasil**. Bate com o relatório BR vir sem os pedidos BR. Ou seja: **participar do
  marketplace (whoami) ≠ ter autorização de detalhe de pedido nele**. É uma **limitação de autorização do app no
  lado da Amazon, específica do Brasil** — resolver no portal (Seller Central / autorização do app pro
  marketplace BR), NÃO no código. Enquanto isso, o Amazon BR mostra valor/qtd/pedidos corretos, só sem nome de
  produto. Diagnósticos deixados prontos: `GET /api/amazon/whoami`, `GET /api/amazon/probe-order?id=<id>&market=`,
  `GET /api/amazon/report-columns?market=`.
- **Caminho de nome de produto BR:** `enrichAmazonItems({market:'br'})` em `sync.js` — busca
  `/orders/v0/orders/{id}/orderItems` (traz `Title`) pedido a pedido (BR tem volume baixo; o US continua na
  Reports API). Disparo manual: `POST /api/amazon/fetch-items?market=br`; progresso em `/api/status →
  amazon.items`. Trava `ABORT_AFTER=15` (aborta a rodada se muitas chamadas seguidas falham, pra não desperdiçar).
  Funciona para os pedidos que o getOrderItems aceita; os `701-/702-` ficam pendentes até entendermos o 400.

#### 4.7.4 Detalhes operacionais
- **Funções exportadas:** `fetchOrders(since, until)` devolve US+BR juntos (combinado ou não). `fetchOrdersBR()` é no-op (compat).
- **Pedidos `Pending` vêm com `total: 0`** — a SP-API omite `OrderTotal` enquanto o pagamento não é capturado.
  Não é bug nosso. O valor entra sozinho num sync incremental posterior, via `LastUpdatedAfter`.
- **RDT (nome do comprador):** desativado por padrão — o app não tem o papel PII (retornava 403 e gastava requisição).
  Reative com `AMAZON_FETCH_PII=1` só se o papel for aprovado. Na tela de roles do app, a opção "delegate access
  to PII to another developer's application" **não** é isso — é para delegar a apps de terceiros; manter em "No".
- **Restrição SP-API:** `CreatedBefore` ≥ 2 min antes de agora — código aplica margem de 3 min.
- **Backoff:** só dispara em 429 que esgotou as tentativas; degraus 15→30→60→120 min; contador zera após sucesso.
  Reset/force via `POST /api/amazon/{reset-backoff,force-sync}`.
  - **⚠️ A cota é da CONTA, não do processo.** Um teste local paginando muitas páginas drena o mesmo balde que a
    produção usa. Em 09/07/2026 um teste local às 20:55 fez o primeiro sync do deploy (21:00) levar 429 e recuar
    30 min. **Não rodar teste local e sync de produção colados**, e não usar force-sync em loop — deixar o backoff agir.
- Sem `AMAZON_AWS_ACCESS_KEY` / `SECRET_KEY` → retorna `[]` com aviso, nada quebra.
- **IDs de pedido:** `amazon-us:` (EUA) e `amazon-br:` (BR) — evita colisão.
- **Variável fantasma:** `AMAZON_RESET_BACKOFF` já existiu como variável no Railway mas **nunca foi lida por nenhum
  código** (nem hoje, nem no histórico do git) — não faz nada, pode remover. O reset real é o endpoint
  `POST /api/amazon/reset-backoff`.
- **`byState` da Amazon US traz grafias inconsistentes** (`"California"`, `"CALIFORNIA"`, `"CA"`, `"CA."`, `"N.Y."`,
  `"PUERTO RICO"`... como chaves distintas), porque `ShippingAddress.StateOrRegion` / `ship-state` não são
  normalizados pela Amazon. **Resolvido 10/07/2026** — `src/us-states.js` (`normalizeUsState`) reduz qualquer variante
  ao código de 2 letras. Aplicado (a) na agregação, em `metrics.js` ao montar `byState` quando `market==='us'` (conserta
  os 359 mil pedidos já gravados sem re-gravar nada) e (b) na gravação, em `amazon.js` (`fetchOrders`/`ordersFromRows`),
  para dado novo já entrar limpo. Ver 4.10.

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
- **Cores customizáveis pelo usuário** via painel de configurações (ícone ⚙ no topbar) — mecanismo
  agora vive em `public/colors.js` (compartilhado entre páginas), ver 4.9c.
- **Seletores** (Métrica, Canal, Período, Atualizar) são **custom dropdowns** (`.csel`) — não são `<select>` nativos.
- O canal é o único dropdown com handler via delegação (`#channelPop`) — os outros usam `setupCsel`.
- Frequência de atualização persistida em `localStorage('coco_refresh')`, padrão 5 min.
- `lastData` armazena último payload da API para re-render ao trocar cores sem nova requisição.
- Top Produtos: quando canal = `todos`, exibe badge de canal + soma total no rodapé.
- Pedidos Recentes: linha de resumo com total dos pedidos válidos.
- **Card Orgânico x Campanha (`#cardSalesSplit`, alterado 02/07/2026):** uma **pizza por canal** (não é mais um único donut agregado nem gráfico de linha) — grid `.ss-grid` com uma célula por canal do mercado atual (BR: Shopify/Shopee/ML/Amazon; US: Shopify US/Amazon US). Dados vêm de `salesSplitByChannel` (`{ [channel]: { campaign, organic, campaignOrders, organicOrders } }`) calculado em `computeDashboard()` a partir de **todos** os pedidos do mercado (independente do filtro de canal selecionado na tela — por isso sempre mostra as 4/2 pizzas). Canais sem tracking de origem/listing type (Shopee, Amazon) sempre caem 100% em orgânico, naturalmente (não é caso especial no código — `isCampaignOrder()` nunca retorna `true` pra esses canais). Canal sem nenhum pedido no período mostra o anel cinza "sem dados" do `drawDonut()` (não confundir com "100% orgânico"). Agrupado em `.right-col-stack` com `#cardMarketing`.
- **KPI strip principal (alterado 02/07/2026):** 5 células — Receita Total, Pedidos, Ticket Médio, **ROAS**, **ACOS** (`#kpiRoas`/`#kpiAcos`). O KPI "Conversão" foi removido daqui (a métrica de conversão de sessão→compra continua existindo no card de Tráfego, `#mConv`, que é outro contexto). ROAS = `kpis.roas` (metaRevenue ÷ adCost, já calculado no backend). ACOS = `100/roas` (gasto ÷ vendas atribuídas, em %) — a grade CSS do `.kpi-strip` já era `repeat(5,1fr)` antes dessa mudança (pensada pra isso).
- Paleta/design: tema "earthy" com variáveis CSS no `:root`. Manter visual.

### 4.9c Header/footer padronizados + `public/colors.js` (implementado 07/07/2026)
- **Motivação:** cada tela era construída isoladamente e foi divergindo — `campanhas.html`,
  `produtos.html` e `estoque.html` não tinham dropdown de "Atualizar" (refresh automático), botão
  "Sincronizar agora" nem o painel de Configurações; os footers tinham textos explicativos longos
  e desatualizados; e o motor de seleção de cor (`<input type="color">` nativo do navegador) foi
  considerado lento/feio/inconsistente entre SOs pelo Luan. Implementado com 5 agentes em paralelo
  (um por página + um pro módulo compartilhado), cada um só editando seu próprio arquivo.
- **`public/colors.js` (novo arquivo, IIFE, mesmo padrão de `sidebar.js` — incluir via
  `<script src="colors.js">` logo depois de `sidebar.js`, antes do `<script>` principal da
  página):** expõe `window.CocoColors` com:
  - `DEFAULT_CH`/`DEFAULT_MKT` — as fontes de verdade dos padrões de cor (canal e marketing;
    mesmos valores de sempre, só que centralizados aqui em vez de duplicados por página).
  - `.ch`/`.mkt` — objetos **vivos** com as cores atuais (populados por `.load()`, que já roda
    uma vez sozinho ao carregar o script).
  - `.load()` / `.save(key, value)` / `.resetAll()` — persistência em `localStorage('coco_colors')`
    (mesma chave/formato de sempre: `ch.<canal>`, `mkt.<nome>`).
  - `.contrastText(hex)` / `.chBadgeHTML(chKey)` — mesmos helpers de sempre.
  - `.buildSection(container, defaults, prefix, getCurrent, onChange)` — monta as linhas `.sp-row`
    do painel de Configurações (usado por `index.html`, `campanhas.html`, `produtos.html`,
    `estoque.html` pras seções "Cores dos canais"/"Cores de marketing").
  - `.openPicker(anchorEl, currentHex, onPick)` — abre o **novo seletor de cor** (ver abaixo) perto
    de qualquer elemento; usado tanto pelo `.buildSection()` quanto diretamente pelas páginas de
    Geografia (que têm seu próprio painel de cores de mapa, plugado no mesmo picker).
- **Novo motor de seleção de cor (substitui `<input type="color">` nativo em todo o app):** popover
  leve (classe `.ccp-pop`, CSS injetado sozinho pelo `colors.js` via `<style id="ccp-style">`, não
  precisa declarar CSS nenhum na página) com um grid de ~28 swatches curados (`SWATCHES` em
  `colors.js`) + um campo de hex com preview ao lado, pra ajuste fino. Clique num swatch aplica e
  fecha; digitar um hex válido (`#RRGGBB`) aplica ao vivo sem fechar. O elemento clicável (antes o
  `<input type="color">`, classe `.sp-color-inp`) virou um `<button class="ccp-trigger">` — mesmo
  footprint visual (40×28px), só troca o widget por trás.
  - **`index.html`, `campanhas.html`, `produtos.html`, `estoque.html`:** o trigger é gerado
    automaticamente por `CocoColors.buildSection(...)` — nada a mexer manualmente.
  - **`geografia.html`/`geografia-us.html`:** o painel de cores do MAPA (coroplético/calor) é
    **hardcoded** no HTML de cada página (não usa `buildSection`, que é só pras cores de
    canal/marketing) — por isso lá cada `<button class="ccp-trigger" id="...">` foi escrito à mão
    (mesmos ids de sempre: `chCold`, `chMid`, `chHigh`, `chBorder`, `hcCold`, `hcMid`, `hcHot`,
    `hcPill`, `hcText`, `hcBorder`), com um `setColorBtn(id, hex)` local pra sincronizar
    `dataset.hex`/`style.background`, e um listener de clique que chama `CocoColors.openPicker(...)`
    diretamente. **Decisão deliberada (confirmada com o Luan):** as páginas de Geografia **não**
    ganharam a seção "Cores dos canais" — o painel delas continua só sobre a paleta visual do mapa,
    os dois sistemas de configuração ficam separados.
  - Produtos/Estoque têm seu próprio `CH_META` hardcoded (cores só usadas como fallback quando não
    há logo — na prática todo canal tem logo, então o fallback quase nunca aparece) — **não foi
    ligado** ao `CocoColors.ch`: o painel de Configurações fica disponível/consistente em toda
    página por causa da experiência única de navegação, mesmo nas telas onde ele ainda não repinta
    nada visualmente hoje.
- **Header padronizado** — `campanhas.html`, `produtos.html` e `estoque.html` ganharam, copiado de
  `index.html`: botão `#syncBtn` ("Sincronizar", `POST /api/sync` + recarrega), botão `#settingsBtn`
  (abre o painel de Configurações com as seções de cor) e o dropdown `#cselRefresh` ("Atualizar":
  1/5/15/30 min ou Desligar, mesma chave `localStorage('coco_refresh')` compartilhada entre TODAS as
  páginas — mudar em uma reflete nas outras na próxima visita). Cada página reaproveita sua própria
  função de carregamento já existente (`load()`) como alvo do `setInterval`, não criou nada novo.
  `estoque.html` é a única sem seletor de Período (correto, continua fixo em 30 dias) — as outras
  duas têm.
- **Footer padronizado** — trocado o texto explicativo fixo de cada página por uma linha dinâmica
  de status, mesma ideia de `index.html` (`<footer id="footerDate">`, preenchido dentro do
  `render()` de cada página): `Coco and Luna · [contexto] · última sincronização: {timestamp}`.
  `[contexto]` varia por página (canal+período em `index.html`; período em `campanhas.html`/
  `produtos.html`; "últimos 30 dias" em `estoque.html`, que não tem seletor de período; mercado+
  período nas páginas de Geografia). Também removido o prefixo **"Dashboard - Vita Pet Life · "**
  que existia em `index.html`/`geografia*.html` — "Vita Pet Life" é a empresa, não deve aparecer em
  texto de UI genérico como se fosse o nome de uma loja (ver seção 1).

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
- **Normalização de estado US:** as chaves de `byState` no mercado US passam por `normalizeUsState` (`src/us-states.js`),
  que reduz as várias grafias da Amazon (`"California"`/`"CALIFORNIA"`/`"CA"`/`"CA."`/`"N.Y."`, e o typo `"MARULAND"`→MD)
  ao código de 2 letras — senão cada variante virava uma linha no ranking e o mapa (que casa por código `_uf`) subcontava.
- **Agrupamento de não-EUA (`INTL`):** ainda em `byState` US, o que **não** é uma região dos EUA (`isUsRegionCode` falso —
  ex.: províncias do Canadá) é agrupado num único bucket **`'INTL'`**, em vez de aparecer como cada país no ranking. Não
  perde receita. Territórios (PR, DC, VI, GU, AS) e endereços militares (AA/AE/AP) **contam como EUA** e ficam como linha
  própria. Em `geografia-us.html`, `STATE_NAMES` rotula território/militar/`INTL` ("Porto Rico", "Militar (Europa)",
  "Outros (internacional)"), e o KPI "Estados com vendas" conta só os 50 estados de fato (`US_50`). Ver 4.7.5.

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
- **Produto sem venda no período continua listado (implementado 15/07/2026):** `computeProducts()` agora agrega os produtos de **todos os pedidos** do canal (sem filtro de período, `catalogByChannel`) só para saber quais produtos existem (título/tipo/imagem) e faz merge com a agregação filtrada pelo período (que dá qty/receita, 0 quando não vendeu no período). Antes, um produto do marketplace sumia da tabela inteira se não tivesse vendido nada na janela escolhida — errado numa tela de catálogo. Custo: mais uma passada em `getOrders`/`aggregateProductsByChannel` sem filtro de data a cada request — aceitável hoje, mas soma ao problema de performance já registrado no item 9 do backlog (mais um `Object.values()` completo do store por request de Produtos).
- Cada card mostra: logo do canal, receita total, nº de pedidos, e uma tabela rolável (`max-height` com `overflow-y`) de todos os produtos vendidos no período, ordenada por receita: **Produto** (com miniatura da imagem, tag de tipo — Pó/Soft Chews/Tablets/Liquid — e a quebra avulso/combo quando aplicável), **Qtd**, **Receita**, **Ticket médio**.
- **Botão de minimizar por card** (canto superior direito, chevron): colapsa/expande a tabela. Toggle manual só dura a sessão — **não é mais persistido em localStorage** (mudou em 06/07/2026, ver regra de colapso padrão abaixo).
- **Cards sempre reabrem só com o primeiro expandido (implementado 06/07/2026):** `applyDefaultCollapse(orderedChannels)` zera `collapsedState` e marca `collapsedState[ch] = i !== 0` pra cada canal na ordem atual — chamada no carregamento inicial da página, ao trocar de mercado (`setMarket()`) e ao terminar de arrastar um card (`persistOrder()`). Entre essas chamadas, `collapsedState` é só mutado em memória pelo botão de minimizar (`toggleCollapse()`) — por isso editar um campo (que recarrega os dados via `load()`/`render()`) não fecha o card que você está editando; só os 3 gatilhos acima resetam pro padrão "só o primeiro aberto".
- **Arrastar para reordenar os cards de canal (implementado 06/07/2026, mecanismo de ativação corrigido 07/07/2026):** cada card tem um handle de 6 pontos (`bi-grip-vertical`) no canto superior esquerdo do cabeçalho. Drag and drop nativo (HTML5, sem biblioteca). `dragover` no grid usa `getDragAfterElement()` (compara o Y do cursor com o meio de cada card) pra mover um placeholder tracejado (`.prod-card-ghost`) ao vivo no DOM, sem mover o card real durante o arraste (mover o próprio nó de origem durante o `dragover` é conhecido por fazer o Chrome abortar o drag silenciosamente); no `dragend`, o card real é movido pra posição do placeholder e `persistOrder()` lê a ordem final direto do DOM (`data-ch` de cada `.prod-card`) e salva em `localStorage('coco_produtos_order')`, por mercado. `getOrderedChannels(market)` aplica essa ordem salva por cima da lista padrão (`CHANNELS_BR`/`CHANNELS_US`), preservando canais novos que ainda não estão na ordem salva. Mesmo mecanismo (handle, funções, chaves só com prefixo diferente) implementado igual em `estoque.html` — ver 4.14.
  - **Bug corrigido (07/07/2026) — arrastar não funcionava de jeito nenhum:** a primeira versão deixava `draggable="true"` fixo no `.prod-card` inteiro e restringia o início do arraste checando `e.target.closest('.drag-handle')` dentro do `dragstart`, chamando `e.preventDefault()` caso contrário. Essa checagem nunca era satisfeita: quando `draggable=true` está num ancestral e o gesto começa num filho não-draggable (o handle), o navegador resolve o alvo do evento `dragstart` como o próprio ancestral (o card), nunca o filho — então `e.target.closest('.drag-handle')` sempre falhava e **todo** arraste era cancelado antes de começar, em qualquer ponto do card, inclusive segurando exatamente no handle. O cursor `grab` (CSS puro, não prova nada sobre o JS) enganava, parecendo que só faltava "pegar certinho". Duas tentativas de correção anteriores (adiar a classe `dragging` pro próximo tick, aumentar a hitbox do handle, `draggable="false"` nas imagens aninhadas) não tocavam nessa linha e por isso não resolviam. **Correção real:** o card não tem mais `draggable="true"` no HTML — o handle liga `card.draggable = true` só no seu próprio `mousedown`, e o `dragend` (ou um `mouseup` global de segurança, caso o usuário solte sem chegar a arrastar) desliga de novo. Isso elimina a ambiguidade por completo: só a alça pode iniciar o gesto, e o `dragstart` não precisa mais checar `e.target`.
- **Imagem do produto por canal:**
  - Shopify (BR/US): `LineItem.image.url` já vem na mesma query GraphQL de pedidos — sem custo extra.
  - Shopee: `item_list[].image_info.image_url` já vem no `get_order_detail` — sem custo extra.
  - Mercado Livre: **não** vem no pedido. `fetchOrders()` faz uma chamada em lote extra (`GET /items?ids=...`, multiget de até 20 ids) para resolver `thumbnail` por `item.id`, mesmo padrão já usado para resolver `state` via `/shipments/{id}`. Falha graciosamente (sem imagem) se o item não for encontrado. **Esse mesmo lote também resolve `o.listingType`** (Clássico/Destaque, ver 4.6) a partir de `listing_type_id` do recurso do item — campo que não existe na resposta de `/orders/search`.
  - Amazon (BR/US): **sem imagem, tipo ou nome real do produto** — ver item 6 do backlog (seção 9): itens do pedido nunca são buscados.
- **Tipo de produto:** reaproveita `classifyType()` já usada em Segmentos (productType do Shopify como fonte autoritativa, fallback por palavras-chave no título para os demais canais).

#### 4.13.1 Colunas financeiras editáveis (implementado 02/07/2026; frete adicionado 06/07/2026)
- Colunas adicionadas na tabela: **COG** (custo do produto, por unidade), **Frete** (custo de frete, por unidade), **Impostos %**, **Comissão %**, **Lucro** (R$) e **Lucro %** — todas calculadas em `computeProducts()` (`metrics.js`) e as 4 primeiras são **editáveis inline** na tabela (`<input type="number">`), com botão de edição em massa (aplica a todos os produtos do canal de uma vez) no cabeçalho de cada uma.
- **Persistência:** `POST /api/products/finance` (`{ channel, title, cog?, shipping?, taxPct?, commissionPct? }`) salva em `store.js` → `productFinance[ "canal|||título" ]` (mesma chave de agrupamento usada em Top Produtos). `null`/`''` limpa o campo (volta a usar o padrão); `0` é um valor explícito válido e fica salvo normalmente. Editar um input recarrega a tela inteira (`load()`) pra recalcular tudo com o novo valor — simples e sempre consistente, sem duplicar a fórmula no front.
- **Fórmula:** `Lucro = Receita − (COG × Qtd) − (Frete × Qtd) − (Receita × Impostos%) − (Receita × Comissão%)`. `Lucro % = Lucro ÷ Receita`. Se **COG não estiver preenchido** (nem override nem padrão), `profit`/`profitPct` ficam `null` e a linha mostra "—" (não assume custo zero, pra não inflar o lucro por engano).
- **Padrão de Impostos — 2,64% fixo** (Simples Nacional, alíquota efetiva do DAS informada pelo Luan em 02/07/2026 — **não varia por produto**, é da empresa toda). Editável por linha se algum produto tiver regra tributária diferente.
- **Padrão de COG** (`defaultCog()` em `metrics.js`): valores de referência informados pelo Luan em 02/07/2026 — **R$ 15,21** para produtos com "lisina"/"lysine" no título, **R$ 17,32** para "daily" no título. Variações de tamanho/combo do mesmo produto (240g, 360g, combos) herdam o mesmo valor por enquanto — o custo real por grama pode ser diferente e precisa ser ajustado manualmente linha a linha.
- **Padrão de Frete — sempre 0** (sem valor de referência conhecido, ao contrário do COG). Diferente do COG, frete não preenchido **não bloqueia** o cálculo de lucro (é tratado como 0, igual impostos/comissão) — editável por produto ou em massa por canal quando o Luan souber o custo real.
- **Padrão de Comissão** (`DEFAULT_COMMISSION_PCT` em `metrics.js`): valores de referência típicos por canal, não confirmados com o Luan — **Shopee 18%, Mercado Livre 14%, Amazon 12%** (BR e US), **Shopify BR/US 0%** (não é marketplace, a taxa de gateway de pagamento é outro assunto, não modelada aqui). Editável por produto se a taxa real for diferente.
- **Totais por canal:** `channels[ch].totalProfit`/`profitPct` somam só os produtos com COG preenchido (`profitProductsCount`) — a tabela mostra "X de Y produtos c/ custo" no rodapé pra deixar claro que o total pode estar parcial. O total de Frete no rodapé soma todos os produtos (sempre um número, nunca "—", já que frete nunca fica `null`).
- **Produtos com tag "combo" somem da listagem (implementado 02/07/2026):** produtos Shopify vendidos como o combo em si (tag `combo`, case-insensitive, **não** via Shopify Bundles/`lineItemGroup`) não aparecem como linha própria — a venda é atribuída ao produto-base via `stripComboSuffix()` (remove o sufixo `" - Combo de N unidades"` do título) e contabilizada em `comboBySize`, exatamente como os combos vendidos via Bundles. O "produto-base" precisa ter esse título exato (sem o sufixo de combo) pra a mesclagem funcionar — se não existir, cria uma linha nova só com a quantidade do combo. A contagem aparece no textinho `.prod-combo` sob o nome do produto-base (mesmo lugar de sempre), não em resumo separado.

### 4.14 Tela de Estoque — `public/estoque.html` (implementado 06/07/2026)
- **Origem:** substitui progressivamente um board do Monday.com ("Stock + Produção") que o sócio do
  Luan mantinha manualmente, misturando venda por canal com controle de estoque/produção. Luan
  confirmou (06/07/2026) que a abordagem é **híbrida**: dado real onde já temos (venda), manual
  onde só existe na cabeça de quem gerencia produção (estoque físico, a caminho, pedido ao
  laboratório) — **sem integração com a API do Monday**.
  - **"Ordem em Andamento" x "Ordem Nova"**: dois estágios do mesmo fluxo de reposição junto ao
    laboratório fabricante — pedido feito quando o estoque/tempo está acabando, pra dar tempo da
    produção nova chegar antes de zerar (ponto de reposição / lead time).
- **Mesma estrutura visual de Produtos** — um card por canal (`CH_META`/`CHANNELS_BR`/`CHANNELS_US`
  idênticos), com collapse/expand, popover de edição em massa por coluna, toggle linha/coluna,
  arrastar para reordenar (handle de 6 pontos) e a regra de "sempre só o primeiro card aberto" —
  mecanismo idêntico ao de Produtos (`applyDefaultCollapse`, `getOrderedChannels`, `persistOrder`),
  só com chaves de localStorage próprias (`coco_estoque_order`/`coco_estoque_expanded`). Ver 4.13
  pros detalhes de como o drag and drop e o colapso padrão funcionam. **Sem seletor de período**:
  a janela de venda é sempre fixa (ver abaixo), não depende de filtro na tela.
- **Card "Estoque" agregado no topo (substituiu o resumo de 5 KPIs em 07/07/2026):** o resumo geral
  deixou de ser uma faixa de KPIs somada e virou um card colapsável igual aos de canal (mesmo
  componente `.prod-card`, header com logo/nome/2 stats + botão de colapsar), rotulado só "Estoque",
  fixo no topo (não entra no grid arrastável dos canais — sem drag handle, sem persistir ordem).
  Ao expandir mostra uma tabela agrupada **por família física do produto** (não por canal) — no
  Brasil hoje só existem 2: **"Lysine"** (título com "lisina"/"lysine") e **"Daily"** (título com
  "daily") — com TODAS as 11 colunas da tabela original (as 6 que ficaram nos cards de canal +
  as 5 que saíram de lá, ver abaixo). Motivo da mudança: o pedido de reposição ao laboratório
  fabricante não é por canal — é um lote só de produção que abastece Shopify, Shopee, Mercado
  Livre e Amazon ao mesmo tempo — então não fazia sentido editar "Ordem Nova"/"Ordem em
  Andamento" separadamente em cada card de canal.
- **`classifyFamily(title)` em `metrics.js`:** classificação por palavra-chave no título (mesma
  regra que já existia dentro de `defaultCog`, agora extraída pra função própria e reaproveitada
  nos dois lugares) — contém "daily" → família `'Daily'`; contém "taurina", "espirulina" ou
  "spirulina" → família `'Daily'`; contém "lisina" ou "lysine" → família `'Lysine'`; caso contrário
  `null` (nesse caso o agrupamento usa o próprio título como família, não existe uma família
  genérica "Outro"). `defaultCog()` chama `classifyFamily()` internamente em vez de duplicar a
  checagem de palavra-chave.
  - **Bug corrigido (07/07/2026) — "Daily" não somava as vendas de ML/Shopee:** o produto que o
    Luan chama de "Daily" só se chama assim literalmente no Shopify. No Mercado Livre e na Shopee
    ele é listado pelo nome dos ingredientes: **"Suplemento Para Gatos Com Taurina, Espirulina E
    L-Lisina"** — que não contém "daily", mas contém "lisina" (é um dos ingredientes da fórmula) e
    por isso caía errado na checagem de `lisina`/`lysine`, sendo contado como "Lysine" em vez de
    "Daily" (confirmado direto contra `/api/products` de produção: ML tinha 8 unidades e Shopee 12
    unidades desse produto indo pro balde errado — por isso o card agregado só mostrava as 2
    unidades do Shopify). A checagem de taurina/espirulina precisa vir **antes** da de lisina para
    não ser mascarada. Efeito colateral esperado e correto: como `defaultCog()` reaproveita
    `classifyFamily()`, o COG de referência desses produtos em ML/Shopee também passou de R$ 15,21
    (Lysine) pra R$ 17,32 (Daily) — mais preciso, já que são o mesmo produto físico.
- **`computeStock({ market })` em `metrics.js` — dois níveis de dado agora:**
  - `aggregateProductsByChannel(orders)` continua igual (extraída de `computeProducts`, reaproveitada
    aqui — mesma regra de agrupamento avulso/combo/tipo/imagem).
  - **Janela fixa de 30 dias corridos** (hoje − 29 até hoje, `STOCK_WINDOW_DAYS`) pra calcular
    velocidade de venda — `salesMonth` é a **soma real** das unidades vendidas nos últimos 30 dias e
    `salesDaily = salesMonth / 30`.
  - `channels[canal].products`/`totals`: agora só tem `salesDaily, salesMonth, stock, incoming,
    monthsOfStock` — **perdeu** `orderInProgress`, `orderNew`, `projected`, `totalMonthsOfStock`,
    `suggestion` (mudaram pro nível agregado, ver abaixo). `monthsOfStock = (stock + incoming) /
    salesMonth` (`null` quando `salesMonth` é 0, mostrado como "—").
  - **`agg.products`/`agg.totals` (novo em 07/07/2026):** agrupa produtos de **todos os canais do
    mercado** por `classifyFamily()`. `stock`/`incoming`/`salesDaily`/`salesMonth` são a **soma**
    dos valores por canal já calculados acima (derivados, só leitura nesse nível). `orderInProgress`,
    `orderNew`, `projected` são um dado **novo**, independente de canal, lido de
    `getProductStockAgg()` (chave `"market|||família"`) — não somam nada de canal, são editados
    direto aqui. `totalMonthsOfStock = (stock + projected + orderNew + orderInProgress) /
    salesMonth` e `suggestion = stockSuggestion(totalMonthsOfStock)` — mesmas fórmulas de antes,
    só que agora calculadas em cima da família agregada em vez do canal.
  - O placeholder sintético `"Produto TESTE"` (Amazon, ver abaixo) é **excluído** do agrupamento
    `agg` — ele não é um produto real, não faz sentido aparecer misturado com Lysine/Daily.
- **Persistência em dois níveis agora:**
  - **Por canal** (`productStock` em `store.js`, chave `"canal|||título"`): só `stock` (estoque
    físico/FBA) e `incoming` (recebendo). `POST /api/stock/finance` (`{ channel, title, stock?,
    incoming? }`) — perdeu `orderInProgress`/`orderNew`/`projected` (não são mais por canal).
  - **Por família de produto** (`productStockAgg` em `store.js`, chave `"market|||família"`, novo
    em 07/07/2026, mesmo padrão de `productStock`): `orderInProgress`, `orderNew`, `projected`.
    `POST /api/stock/agg-finance` (`{ market, title, orderInProgress?, orderNew?, projected? }`) —
    editado só no card "Estoque" agregado, não nos cards de canal.
  - Ambos: todos os campos numéricos, **padrão 0** quando não preenchidos, `0` explícito sempre
    aceito e persiste, `null`/`''` limpa o campo.
- **`projected` ("Ordem Projetada"):** campo de **simulação**, não um pedido real como
  `orderNew`/`orderInProgress` — o Luan digita uma quantidade que está cogitando pedir ao
  laboratório só para ver o efeito em `totalMonthsOfStock` antes de decidir, e limpa depois. Vive
  no nível agregado (card "Estoque") desde 07/07/2026, junto com `orderNew`/`orderInProgress`.
- **Ordem das colunas:**
  - **Cards de canal individual (6 colunas, reduzido em 07/07/2026):** Produto · Vendas/dia ·
    Vendas/mês · Estoque · Recebendo · **Meses de Estoque** (`monthsOfStock`) — Estoque/Recebendo
    ainda editáveis por canal, com popover de edição em massa.
  - **Card "Estoque" agregado (11 colunas — as 6 acima, com Estoque/Recebendo agora só leitura,
    somados, + as 5 que saíram dos cards de canal):** Produto · Vendas/dia · Vendas/mês · Estoque ·
    Recebendo · Meses de Estoque · **Ordem Projetada** · Ordem Nova · Ordem em Andamento ·
    **Tempo de Estoque Total** (`totalMonthsOfStock`) · **Sugestão** (última coluna) — essas 3
    últimas colunas de pedido são as únicas editáveis aqui.
- **`suggestion` / coluna "Sugestão":** ajuda o Luan a decidir quando fazer um novo pedido ao
  laboratório, calculada a partir de `totalMonthsOfStock` (`stockSuggestion()` em `metrics.js`,
  agora só chamada no nível agregado). Limites: **< 3 meses → `urgente`** (badge vermelho, "Pedir
  urgente"), **3 a <7 meses → `atencao`** (badge âmbar, "Atenção"), **>= 7 meses → `aguardar`**
  (badge verde, "Aguardar"). `null` (sem venda no período) não mostra badge, só "—". Calculado
  também para a linha de Total do card agregado.
- **Amazon (BR/US) — placeholder "Produto TESTE":** hoje os pedidos da Amazon não trazem título de
  item (ver backlog item 6 — `fetchOrders()` em `src/amazon.js` só lê quantidade, nunca busca
  `/orders/v0/orders/{id}/orderItems`), então a tabela de Amazon em Estoque ficaria vazia como já
  acontece em Produtos. Pra não bloquear o controle manual de estoque enquanto isso não é resolvido
  (deliberadamente adiado pelo risco de 429 documentado em 4.7), `computeStock()` injeta uma linha
  sintética `"Produto TESTE"` (métricas de venda zeradas) nos canais `amazon`/`amazon_us` sempre que
  não há nenhum produto real agregado — editável manualmente como qualquer outro produto, mas
  excluída do card agregado (ver acima). Remover esse placeholder é consequência natural de
  resolver o backlog item 6 (quando `byChannel[amazonCh].products` deixar de vir vazio).
- Fora de escopo por ora (não pedido, evitar scope creep): canais que só existem no Monday e não no
  nosso sistema (Chewy, Walmart, Website separado, Wholesale) e qualquer chamada à API do Monday.

### 4.15 Quantidade e receita por produto precisam EXCLUIR unidades devolvidas (implementado 08/07/2026)
- **Bug descoberto:** o Luan desconfiou da quantidade de Lysine vendida em junho depois de notar que
  o Shopify trocou o modo de venda dos combos no meio do mês (produto separado → app de bundles).
  Investigando isso, confirmamos via introspecção do schema GraphQL real do Shopify (não documentação
  — teste ao vivo contra a loja) que **dois campos usados em `fetchOrders()` (`src/shopify.js`)
  incluíam unidades/valor já devolvidos**:
  - `LineItem.quantity` inclui unidades devolvidas/removidas. `LineItem.currentQuantity` **exclui**
    — trocado diretamente (mesmo tipo `Int`, drop-in, único uso no arquivo).
  - `LineItem.discountedTotalSet` (usado pra `amount`, receita por item — Top Produtos/Produtos)
    também inclui valor devolvido. Corrigido buscando `order.refunds { refundLineItems { lineItem { id }
    subtotalSet } }` e subtraindo do `discountedTotalSet` de cada item, casado por `lineItem.id`
    (mapa `refundByLineItemId` montado por pedido dentro de `fetchOrders`). **Não** persistimos os
    campos crus de refund no pedido salvo — só o `amount` já líquido, mantendo o formato normalizado
    da seção 5 sem mudança de forma.
  - `Order.currentTotalPriceSet` (usado pro `total` a nível de pedido, receita da KPI principal) **já
    era** refund-adjusted ("after returns") — não precisou de mudança. Confirmado ao vivo: pedido
    totalmente devolvido mostra `currentTotalPriceSet: 0.0` mesmo com `discountedTotalSet` do item
    ainda cheio — por isso a receita total (KPI "Receita") sempre esteve correta; só a quebra **por
    produto** (Top Produtos/Produtos) tinha o problema.
  - Validado ao vivo (25/06/2026, pedidos #19591 e #19621, "Lisina para gatos - 120g"): ambos
    `REFUNDED`, `currentQuantity: 0`, `discountedTotalSet: 119.0` igual ao `refundLineItems.subtotalSet`
    → `amount` líquido calculado corretamente em `0`.
- **`aggregateProductsByChannel()` (`metrics.js`) não precisou de nenhuma mudança de código** — as três
  lógicas de contagem (avulso, combo legado via tag, Shopify Bundle) já tratavam `qty`/`amount` como "o
  que importa" e se autocorrigem com os novos valores líquidos.
- **Limitação cosmética conhecida (não corrigida, não vale código extra por ora):** `comboBySize` (a
  legenda "N combos de tamanho X") usa `lineItemGroup.quantity`, campo diferente de `LineItem.currentQuantity`
  cujo comportamento com devolução parcial não foi confirmado. Se alguém devolver 1 unidade de dentro
  de um "combo de 3", o total de unidades (`comboQty`) fica certo, mas a legenda por tamanho pode não
  bater exatamente com o total. Não corrompe totais de venda/estoque, só a legenda de detalhe.
- **ShopifyQL (`FROM sales`) não tem filtro de status disponível** — testado ao vivo: `financial_status`
  e `order_status` não existem como dimensão em `sales`, e `FROM orders` retorna erro "Invalid dataset
  in FROM clause". Ou seja, pedidos cancelados/expirados continuam inflando `quantity_ordered`/`net_sales`
  em qualquer relatório nativo do Shopify (Exploração/Notebooks) — **não é bug nosso, é limitação da
  plataforma**, sem solução via query. Existe uma métrica real `quantity_returned` ("Quantidade
  devolvida") que pode ser somada à query pra pelo menos mostrar devolução, mas não resolve cancelados.
- **Autocorreção via sync, sem backfill:** `sync.js` re-busca e sobrescreve (upsert completo) todos os
  pedidos com `created_at` nos últimos 60 dias a cada ciclo — então pedidos recentes se autocorrigem no
  próximo sync após o deploy, sem rodar nada manual. Pedidos com mais de 60 dias que forem devolvidos
  depois **não** se autocorrigem sozinhos (o filtro do sync é por `created_at`, não `updated_at`) — Luan
  decidiu (08/07/2026) que não vale a pena um script de backfill agora; revisitar se aparecer um caso real.

### 4.16 Login/usuários — branch `feat/auth-usuarios`, aguardando merge (implementado 14/07/2026)
- Implementado em `src/auth.js` (novo, sem libs externas — só `crypto` nativo do Node) + wiring em
  `server.js` + `public/login.html` (novo) + `public/configuracoes.html` (novo) + `public/sidebar.js`
  (chip de usuário no rodapé). Construído com uma equipe de agentes em paralelo, um arquivo por agente,
  a partir de um contrato de API fixo combinado antes — igual ao padrão já usado em 4.9c.
- **Senha:** scrypt + salt (`crypto.scryptSync`), comparação em tempo constante (`timingSafeEqual`).
  Nunca fica em texto puro — nem no banco, nem em memória além do momento do hash.
- **Sessão:** cookie `coco_session` (HttpOnly, SameSite=Lax, `Secure` sob HTTPS via `app.set('trust
  proxy',1)`), validade 30 dias, guardada em `kv.authSessions` (mesmo padrão Postgres/JSON do resto do
  store — `kv.users`, `kv.authConfig`, `kv.authSessions`, ver `store.js`).
- **Dois níveis:** `admin` (acessa tudo, gerencia usuários e o toggle de login) e `padrao` (só as páginas
  liberadas por usuário, array `pages`). A página `configuracoes.html` é sempre admin-only, mesmo que
  esteja marcada em `pages` por engano.
- **Portão de acesso** em `server.js`: middleware ANTES do `express.static` que decide por `req.path` —
  libera sempre `/health`, `/login.html`, `/api/login|logout|me|sync`, assets estáticos e as rotas de
  OAuth (`/shopee/`, `/mercadolivre/`, `/googleads/`); sem sessão válida → 401 em `/api/*` ou redirect
  pra `/login.html`; com sessão mas sem permissão na página pedida → redirect pra a primeira página
  permitida do usuário (ou 403 se não tiver nenhuma). Quando `authConfig.enabled === false`, o portão
  deixa tudo passar (comportamento de hoje, sem login).
- **`GET /api/me`** é o contrato entre backend e front: `{ enabled, user, pages }` — `sidebar.js` usa isso
  pra montar o chip de usuário (avatar de iniciais coloridas por hash do nome, nome, tag de nível "Admin"/
  "Padrão", botão sair), esconder itens de navegação sem acesso e mostrar/ocultar o item "Configurações".
- **Primeiro usuário semente:** `admin` / `123456`, criado automaticamente por `initAuth()` no boot
  (chamado logo após `await initStore()`) se `kv.users` estiver vazio. `initAuth()` também **liga o login
  por padrão** (`authConfig.enabled = true`) na primeira vez que roda — **decisão deliberada do Luan**:
  ao mergear essa branch, o próximo deploy passa a **exigir login imediatamente**, sem passo manual extra.
- **Recuperação se o acesso travar** (ex.: perdeu a senha do admin e não sobrou nenhum outro admin):
  editar o kv direto no Postgres do Railway — `UPDATE kv SET value='{"enabled":false}' WHERE
  key='authConfig';` reabre a dashboard, ou apagar a linha `key='users'` re-semeia o admin no próximo
  boot. Endpoint normal (com sessão admin): `POST /api/auth/config {enabled:false}`.
- **Testado localmente (modo JSON, 14/07/2026):** login certo/errado, gate de página por permissão
  (usuário `padrao` redirecionado das páginas não liberadas), `configuracoes.html`/`/api/users`
  bloqueados pra não-admin, proteção do último admin (`DELETE` recusado), toggle liga/desliga (modo
  aberto libera `/api/dashboard`, `/api/users` etc. mesmo sem sessão), logout limpa o cookie,
  persistência confirmada com hash+salt no `db.json` (sem senha em texto puro). PR draft aberto:
  `feat/auth-usuarios` → `master` (branch criada a partir de `master`, sem os commits da branch da
  Amazon — merge independente).
- **⚠️ Bug encontrado e corrigido no mesmo dia:** `configuracoes.html` foi montado copiando a estrutura
  de `produtos.html`, mas o agente trouxe só o CSS do toggle/responsivo da sidebar — **esqueceu o bloco
  base** (`.sidebar`, `.brand`, `.brand-logo`, `.brand-name`, `.nav-group`, `.nav-label`, `.nav-item`,
  `.nav-icon`, `.sidebar-header`, `.sidebar-close-btn`). Resultado visual: logo em tamanho natural
  (gigante) e menu como uma lista de links sem estilo nenhum. Corrigido copiando o bloco exato de
  `produtos.html`. Isso expôs um problema estrutural do projeto — ver backlog item 12.

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
| `AMAZON_CLIENT_ID` | LWA Client ID do app SP-API "Dashboard Amazon" — mesmo app para US e BR |
| `AMAZON_CLIENT_SECRET` | LWA Client Secret |
| `AMAZON_REFRESH_TOKEN` | LWA Refresh Token da conta **VITA PET LIFE** (US). Ver 4.7.1 |
| `AMAZON_BR_REFRESH_TOKEN` | LWA Refresh Token da conta **CocoandLuna** (BR). **Nunca igual ao de cima** — ver 4.7.1 |
| `AMAZON_BACKFILL_DAYS` | Janela só da 1ª carga, antes de existir cursor (padrão `2`). Ver 4.7.3 |
| `AMAZON_FETCH_PII` | `1` liga a busca do nome do comprador via RDT — só se o papel PII for aprovado pela Amazon |
| `AMAZON_NAMES_EVERY_HOURS` | Intervalo mínimo entre reconciliações de nome de produto da Amazon, por mercado (padrão `12`). Ver 4.7.6 |
| `AMAZON_NAMES_DAYS` | Janela (dias) do relatório de reconciliação de nomes (padrão `2`). Ver 4.7.6 |
| `AMAZON_RETENTION_DAYS` | Só Amazon: poda pedidos mais antigos que N dias a cada sync. **Opt-in, padrão `0` (desligada)**. `365` = janela móvel de 1 ano (em uso). Ver 4.7.7 |
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
  - `POST /api/products/finance` — salva/edita COG, frete, % impostos ou % comissão de um produto (`{ channel, title, cog?, shipping?, taxPct?, commissionPct? }`), persistido em `kv.productFinance`. Ver 4.13.1.
  - `GET /api/stock?market=br|us` — estoque + produção por canal (`channels`) e por família de produto somando todos os canais (`agg`), janela fixa de 30 dias (sem `since`/`until` — calculado internamente). Usado pela tela de Estoque (`estoque.html`). Ver 4.14.
  - `POST /api/stock/finance` — salva/edita estoque ou recebendo de um produto, por canal (`{ channel, title, stock?, incoming? }`), persistido em `kv.productStock`. Ver 4.14.
  - `POST /api/stock/agg-finance` — salva/edita ordem projetada, ordem nova ou ordem em andamento de uma família de produto, somando todos os canais (`{ market, title, orderInProgress?, orderNew?, projected? }`), persistido em `kv.productStockAgg`. Ver 4.14.
  - `POST /api/sync`
  - `GET /api/status` — diagnóstico: credenciais configuradas, backoff Amazon, último sync
  - `POST /api/amazon/reset-backoff` — zera o backoff da Amazon manualmente
  - `POST /api/amazon/force-sync` — zera backoff + executa sync atomicamente
  - `POST /api/amazon/backfill?days=90&market=us` — backfill histórico via Reports API, em background.
    Responde na hora; progresso em `GET /api/status` → `amazon.backfill`. Ver 4.7.5.
  - `POST /api/amazon/sync-names?market=us|br` — reconcilia nomes de produto (Reports API), em background,
    ignorando o throttle. Sem `market` → US e BR. Ver 4.7.6.
  - `POST /api/amazon/cleanup-market-leak` — remove pedidos US que foram gravados como Amazon BR (vazamento
    de mercado). Idempotente; rodar uma vez após o deploy da correção. Ver 4.7.8.
  - `GET /shopee/connect` e `GET /shopee/callback`
  - `GET /mercadolivre/connect` e `GET /mercadolivre/callback`
  - `GET /googleads/connect` e `GET /googleads/callback`
  - `GET /health`
  - **Autenticação (branch `feat/auth-usuarios`, ver 4.16):**
    - `POST /api/login` / `POST /api/logout` / `GET /api/me` — públicas (sessão por cookie `coco_session`).
    - `GET /api/users` / `POST /api/users` / `PUT /api/users/:id` / `DELETE /api/users/:id` — gestão de usuários (admin).
    - `POST /api/auth/config` — liga/desliga a exigência de login (admin), `{ enabled }`.
    - `POST /api/me/password` — troca a própria senha (qualquer usuário logado), `{ current, next }`.
    - `GET /login.html`, `GET /configuracoes.html`

## 8. Status das integrações (09/07/2026)

### Amazon US + BR SP-API — ativo ✅ (US destravada em 09/07/2026)
- **Um app** ("Dashboard Amazon", `AMAZON_CLIENT_ID/SECRET`), **dois tokens** — um por conta de vendedor:
  VITA PET LIFE (US, `ATVPDKIKX0DER`) e CocoandLuna (BR, `A2Q3Y263D00KWC`). Ver 4.7.1.
- **Endpoint:** `sellingpartnerapi-na.amazon.com` (região NA) serve os dois marketplaces.
- **IAM Role `SellingPartnerAPIRole`**: política `SPAPIInvokePolicy` com `execute-api:Invoke` em `*`. Trust policy inclui `usdashboard` user. ✅
- **Rate limit:** 0.0167 req/s = 1 req/min (burst 20). O bug histórico de `amazon_us` sempre 0 era a paginação
  pedindo a página seguinte 2s depois — ver 4.7.2. Corrigido; produção gravou 2.353 pedidos US em 09/07/2026.
- **Sync incremental por cursor** (`kv.amazonCursors`) — ver 4.7.3. Sync típico: 1 requisição, ~1s.
- **Endpoint `POST /api/amazon/reset-backoff?delay=N`:** aceita `delay` em minutos para backoff customizado.

### Shopee — ativa ✅
- Credenciais de produção configuradas: Partner ID 2037711, Shop ID 1502160212.
- 83 pedidos confirmados no banco. Chunking de 15 dias implementado em `src/shopee.js`.
- Analytics da Shopee (tráfego, insights) **não disponível via API** — só no Seller Center. Endpoints retornam `error_not_found`.

### Mercado Livre — ativo ✅
- OAuth autorizado. Tokens persistidos no Postgres. Re-autorizar após deploy via `/mercadolivre/connect`.
- 140 pedidos no banco.
- **ML Ads:** dados de gasto por campanha confirmados (~R$ 1.937 no período testado). `fetchCampaigns()` e `fetchAdCosts()` operacionais. Escopo `write:product_ads` já habilitado no token atual.

### Google Ads (EUA) — ativo ✅ (autorizado em 09/07/2026)
- Implementado em `src/googleads.js` (ver 4.12). OAuth autorizado via `/googleads/connect`. Token persistido no Postgres (`kv.googleAdsTokens`).
- Só EUA (conta "Coco and Luna", Customer ID `1344114329`, roda campanhas apenas nos EUA hoje).
- Dados aparecem na tela de Campanhas → mercado US → card Google Ads.

## 9. Próximos passos (backlog priorizado)

1. Decidir tratamento de **PENDING** (contar só pagos?) — ver 4.1.
2. ~~**Google Ads:** falta configurar credenciais e autorizar via `/googleads/connect`.~~ **Resolvido 09/07/2026** — ativo ✅.
3. ~~**ML Ads ROAS por campanha:** verificar se `listing_type_id` nos pedidos ML está preenchido corretamente.~~ **Resolvido 07/07/2026** — ver 4.6: o campo nunca vinha de `/orders/search` mesmo, foi movido pra ler do recurso `/items`.
4. ~~Login/usuários se mais pessoas precisarem acessar.~~ **Implementado 14/07/2026** — branch
   `feat/auth-usuarios` aguardando merge em `master`. Ver 4.16.
5. ~~**Amazon US na produção.**~~ **Resolvido 09/07/2026** — ver 4.7.2. Era paginação, não cota/autorização.
6. ~~**Amazon — backfill histórico dos EUA.**~~ **Resolvido 09/07/2026** — ver 4.7.5. 83.897 pedidos (90 dias) em 4min40s.
7. ~~**Amazon — `byState` com grafia inconsistente.**~~ **Resolvido 09/07/2026** — `ship-state`/`StateOrRegion` normalizados para maiúsculas.
8. ~~**Amazon — sync contínuo não traz nome de produto.**~~ **Resolvido 10/07/2026** — ver 4.7.6. Job separado
   (`reconcileAmazonNames`) busca um relatório curto (últimos 2 dias, Reports API, balde de cota próprio) e preenche
   `items[].title` por id via `patchOrderItems`, sem tocar em `total`/`status`. Roda a cada 6h com throttle de 12h por
   mercado; disparo manual em `POST /api/amazon/sync-names`.
9. ~~**Performance do `store.js` com volume alto.**~~ **Resolvido 10/07/2026** — ver 3 (índice em memória do
   `getOrders`). Era `Object.values()` + várias passadas de `.filter()` reparsando `Date.parse()` a cada request
   (~6×/dashboard). Trocado por índice por mercado ordenado por timestamp + busca binária na janela de datas.
   Benchmark local (300 mil pedidos, dataset sintético maior que o alvo de 365 dias): ~288ms → ~4,7ms por request
   (~60×), com os 9 cenários de filtro batendo exatamente contra a lógica antiga. Pré-requisito do backfill de
   365 dias da Amazon US (ver 4.7.5).
10. **Amazon — nome do comprador (PII):** hoje `customer` vem vazio. Exige o papel PII aprovado pela Amazon no
   Solution Provider Portal; depois é só ligar `AMAZON_FETCH_PII=1` no Railway (código já pronto). Ver 4.7.4.
   (O relatório de backfill também não traz o nome — é dado restrito nos dois caminhos.)
11. **Amazon BR — sem itens:** o backfill/Reports foi rodado só para `market=us`. A Amazon BR continua sem
   `items[].title`, e por isso a tela de Estoque ainda injeta o placeholder "Produto TESTE" nela (ver 4.14).
   Rodar `POST /api/amazon/backfill?days=90&market=br` resolve — não foi feito por ora (volume BR é baixo).
12. **⚠️ PENDENTE — CSS da sidebar duplicado por página:** cada HTML repete o CSS **base** da sidebar
   (`.sidebar`, `.brand`, `.brand-logo`, `.brand-name`, `.nav-group`, `.nav-label`, `.nav-item`,
   `.nav-icon`, `.sidebar-header`, `.sidebar-close-btn`, mais o CSS do toggle/responsivo) no próprio
   `<style>`, em vez de vir só do `sidebar.js`. Foi exatamente essa duplicação que causou o bug de
   `configuracoes.html` sem estilo nenhum (logo gigante, menu como links soltos) — ver 4.16. Ideia:
   mover esse bloco pro `<style id="sidebarComponentStyle">` que `sidebar.js` já injeta sozinho (mesmo
   mecanismo hoje usado só pro `.nav-flag`), e então remover a duplicata de cada página (`index.html`,
   `segmentos.html`, `geografia.html`, `geografia-us.html`, `produtos.html`, `estoque.html`,
   `campanhas.html`, `configuracoes.html`).
   **Cuidado antes de mexer — já detectada uma divergência real entre páginas:** `geografia.html` e
   `geografia-us.html` usam `.sidebar{z-index:3000}` **sem** a `transition` de slide, enquanto as demais
   usam `z-index:200` **com** `transition:transform .25s cubic-bezier(.4,0,.2,1)` — provavelmente por
   causa das camadas do Leaflet (mapa) competindo em z-index com a sidebar. Confirmar se dá pra unificar
   num valor só sem quebrar o mapa (ou manter um override pontual nessas duas páginas) antes de remover a
   duplicata delas. Investigação começou em 14/07/2026 e foi pausada a pedido do Luan para não atrasar o
   registro desta atualização — retomar quando for mexer nisso.

## 10. Convenções

- Código em ES Modules (`"type": "module"`). Node 18+ (usa `fetch` nativo).
- Dependências mínimas: `express`, `dotenv`, `pg`. Manter simples — sem aws-sdk, sem axios.
- Toda a UI e textos em **pt-BR**. Valores em **BRL** (`Intl`/`toLocaleString('pt-BR')`).
- `.gitignore` inclui: `node_modules/`, `.env`, `data/db.json`, `*.log`, `.DS_Store`, `.claude/`.
