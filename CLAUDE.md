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
- Amazon BR: Marketplace ID `A2Q3Y263D00KWC`. Conta de vendedor **CocoandLuna** — app SP-API próprio (`AMAZON_BR_CLIENT_ID`/`AMAZON_BR_CLIENT_SECRET`/`AMAZON_BR_REFRESH_TOKEN`), separado do app dos EUA desde 04/08/2026 (ver 4.7.11). IAM Role/chaves AWS continuam compartilhados. Endpoint: `sellingpartnerapi-na.amazon.com` (região NA — não SA). Ver 4.7.1/4.7.11.

### EUA
- Shopify US: **vita-pet-life.myshopify.com** · ~99 pedidos/30 dias confirmados.
- Amazon US: SP-API configurado com LWA + AWS SigV4 via IAM AssumeRole. Conta de vendedor **VITA PET LIFE**.
  - IAM User: `arn:aws:iam::354674816862:user/usdashboard`
  - IAM Role: `arn:aws:iam::354674816862:role/SellingPartnerAPIRole` — política `SPAPIInvokePolicy` (`execute-api:Invoke` em `*`); trust policy inclui o user `usdashboard`.
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
src/shopifyYucaloo.js   OAuth da Yucaloo (2ª marca, app via Dev Dashboard) — só o handshake por enquanto, ver 4.20
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
public/unificador.html   Tela Unificador: agrupamento manual global de produtos entre canais (admin only) — ver 4.18
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
public/logos-integracao/Yucaloo1.webp Logo Yucaloo (versão maior/completa) — enviada pelo Luan
public/logos-integracao/Yucaloo2.webp Logo Yucaloo (versão menor/ícone) — usada no card da tela Integrações
```

Fluxo: `sync.js` busca pedidos/sessões → grava em `store` → `metrics.js` calcula → `/api/dashboard`
devolve JSON → `public/*.html` desenham. As interfaces NÃO falam com Shopify/Shopee/ML/Amazon direto.

### Store (store.js) — detalhes importantes
- Variável `DATABASE_URL` presente → usa Postgres (Railway). Ausente → JSON em `data/db.json`.
- `initStore()` é async e DEVE ser chamado com `await` antes de `app.listen()`.
- Tabelas Postgres: `orders` (id TEXT PK, data JSONB), `sessions_daily` (date TEXT PK, data JSONB), `kv` (key TEXT PK, value JSONB).
- `kv` guarda: `shopeeTokens`, `mlTokens`, `mlAdCosts`, `googleAdsTokens`, `productFinance`, `productStock`, `productStockAgg`, `metaInsightsDaily`, `metaUSInsightsDaily`, `lastSync`, `amazonBackoff`(+`Count`), `amazonBRBackoff`(+`Count`), `amazonCursors`, `amazonBackfill`, `amazonProductImages`, `amazonImagesJob`, `users`, `authConfig`, `authSessions`.
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
- **Ativa ✅** — credenciais de produção configuradas: `SHOPEE_PARTNER_ID` 2037711, `SHOPEE_SHOP_ID` 1502160212 (+ `SHOPEE_PARTNER_KEY`). Chunking de 15 dias em `src/shopee.js`.
- **Analytics da Shopee (tráfego, insights) não disponível via API** — só no Seller Center; os endpoints retornam `error_not_found`.
- **Estado do comprador indisponível — confirmado, é limitação da própria Shopee (17/07/2026):**
  pedidos Shopee nunca aparecem na Geografia BR. O código já pedia `recipient_address` no
  `get_order_detail` e já mapeava `recipient_address.state` pra UF via `toUF()` — o pipeline sempre
  esteve pronto. **Confirmado ao vivo em produção** via `GET /api/shopee/probe-order` (`probeOrder()`
  em `shopee.js`, devolve o `recipient_address` cru de pedidos recentes): a Shopee devolve **TODOS os
  campos do endereço mascarados como o literal `"****"`** — `name`, `phone`, `town`, `district`,
  `city`, `state`, `region`, `zipcode`, `full_address` — em pedidos `READY_TO_SHIP`, `SHIPPED` e até
  `CANCELLED`. Não é um problema de formato nem de status do pedido: é mascaramento de PII do lado da
  Shopee (política de privacidade da plataforma, não documentada publicamente), e o app não tem (nem
  parece existir uma forma de solicitar) permissão de decriptação desses campos pela Open Platform API
  — diferente da Amazon (papel PII aprovável, ver 4.7.4) ou do ML (state vem via `/shipments/{id}`, sem
  mascaramento). **Não há correção via código do lado da própria API da Shopee.** `toUF("****")` já
  devolve `null` graciosamente (não quebra nada). `GET /api/shopee/probe-order` fica como diagnóstico
  caso a Shopee mude essa política no futuro.
  - **⚠️ Atualização (29/07/2026): a frase acima ("pedidos Shopee simplesmente não entram em
    byState/Geografia BR") não é mais o comportamento final.** O Bling (ERP que recebe pedidos de todos
    os canais, ver seção "Integração Bling ERP" na memória do projeto) traz o endereço de entrega
    completo e sem máscara, inclusive de pedidos Shopee. `reconcileGeoFromBling` (`src/sync.js`)
    preenche `state` desses pedidos a partir do Bling, contornando a limitação da API da Shopee sem
    depender dela. Rodar `POST /api/bling/sync-geo?market=br` recupera o histórico.

### 4.6 Mercado Livre
- Implementado em `src/mercadolivre.js`. OAuth 2.0 com refresh_token automático.
- **CRÍTICO — domínio correto:** `https://api.mercadolibre.com` (espanhol "libre", NÃO "livre"). Não reverter.
- Tokens persistidos no Postgres (`kv`, chave `mlTokens`). **Após cada novo deploy, re-autorizar via `/mercadolivre/connect`.**
- Cancelados ML: status `cancelled` ou `invalid`. Sem tokens → retorna `[]`, canal fica 0, nada quebra.
- Estado do pedido: buscado via `/shipments/{id}` → `receiver_address.state.id` (formato "BR-SP" → "SP").
- **Breakdown de listagem:** cada pedido tem campo `listingType: 'organic' | 'premium' | null`.
  - `PREMIUM_LISTING_TYPES = {'gold_pro', 'gold_premium'}` → `'premium'` (Destaque/Diamante — exposição paga de verdade). Qualquer outro `listing_type_id` (incluindo `gold_special` e `free`) → `'organic'`.
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
  - **⚠️ Bug corrigido (30/07/2026) — quase todo pedido ML aparecia como "100% Campanha":** a regra
    original era `ltid === 'free' ? 'organic' : 'premium'` — ou seja, tudo que não fosse literalmente
    `'free'` virava `'premium'`. Só que `'free'` é um tipo de listagem **legado**, raro hoje; o tipo
    padrão de praticamente todo anúncio no Brasil desde a mudança de política da própria plataforma é
    `gold_special`, que a Central de Devs do Mercado Livre chama de **"Clássico"** — o equivalente
    moderno do antigo grátis, com comissão normal e **sem** exposição paga nenhuma (confirmado contra
    a doc oficial, "Tipos de publicação"). Só `gold_pro` ("Premium") e `gold_premium` ("Diamante") são
    exposição paga de verdade — o que a tela chama de "Destaque". Como `gold_special` caía em
    `'premium'` pela regra antiga, o card "Orgânico x Campanha" mostrava Mercado Livre como 100%
    Campanha mesmo sem nenhum anúncio de Destaque ativo (reportado pelo Luan, print do card mostrando
    Mercado Livre 100% Campanha vs. Shopee/Amazon 100% Orgânico e Shopify 56/44 via Meta). **Corrigido:**
    a checagem agora é uma allowlist positiva (`PREMIUM_LISTING_TYPES`) em vez de negativa — só
    `gold_pro`/`gold_premium` marcam `'premium'`; `gold_special`, `free` e qualquer tipo legado
    desconhecido (`bronze`/`silver`/`gold` simples) caem em `'organic'` por padrão, coerente com o
    princípio geral do app de nunca inflar atribuição por engano. Afeta `mlBreakdown` (Clássico vs
    Destaque no dashboard principal), `salesSplitByChannel` (card "Orgânico x Campanha") e "Vendas
    Atribuídas Geral" em Campanhas — os três liam o mesmo `o.listingType`, então a correção é única na
    fonte (`mercadolivre.js`), sem mudança em `metrics.js`.
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
- **Correção:** um **job separado** (`reconcileAmazonNames` em `sync.js`, agendado em `server.js`)
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
- **⚠️ Receita por item escalada ao total capturado (`itemRevFactor`, corrigido 10/07/2026, generalizado 03/08/2026):**
  os itens da Amazon vêm do relatório com **preço bruto**, e pedidos **Pending** têm `total: 0` até a captura no
  envio. Como Segmentos/Produtos/Top Produtos somavam `item.amount` (bruto), num dia de **US$ 5k capturado** a tela
  de Segmentos mostrava **US$ 17k** (contava pedidos ainda não capturados a preço cheio). `itemRevFactor(o)` em
  `metrics.js` (renomeada de `amazonRevFactor` — deixou de ser exclusiva da Amazon, ver abaixo) escala a receita dos
  itens para o `o.total` do pedido (fonte de verdade em todo o app): captado → itens somam o total; Pending → 0. Só
  afeta a Amazon (outros canais seguem fator 1, ver exceção abaixo). **Unidades continuam contando todas** (unidades
  pedidas), só a receita respeita a captura. Aplicado em `aggregateProductsByChannel` (Produtos/Estoque/Top Produtos)
  e na agregação de Segmentos.
  - **⚠️ Generalizado para qualquer canal — pedido Shopify US "atacado/fulfillment" com `total: 0` mas item com
    preço de catálogo (achado 03/08/2026, verificando a exportação de Produtos):** ao implementar o botão de
    exportar quantidade vendida (Shopify US, ver 4.13.2), a soma de receita exportada por produto (US$ 16.196) veio
    quase o dobro do total que a própria tela de Produtos já reportava pro canal (US$ 7.364) — não era um bug da
    exportação nova, era um problema pré-existente em `aggregateProductsByChannel`/`computeProducts`, só mais visível
    numa planilha somada linha a linha. Causa: pedidos com `customer: "Walmart DFW6s"` — o Shopify é só o registro de
    **fulfillment por atacado** (quem cobra é o Walmart, não a loja) — chegam com `status: PAID`, `cancelled: false`
    e **`total: 0`** (nada foi cobrado via Shopify), mas o(s) item(ns) ainda carregam o **preço de catálogo cheio**
    (`amount`) em quantidade grande (ex: 10 un. de "Allergy Support" a US$ 32,99 = US$ 329,90 de "receita" fantasma
    por pedido). É o mesmo padrão já documentado pra Amazon MCF/"Non-Amazon" (ver 4.7.9), só que do lado do Shopify,
    onde nunca tinha sido guardado. **Correção:** `itemRevFactor` ganhou uma segunda regra, válida pra qualquer
    canal (não só Amazon): se `o.total === 0` mas algum item tem `amount > 0`, o fator é `0` — zera a receita mas
    **preserva a unidade vendida** (mesmo princípio da regra da Amazon acima). Pedido com `total` não-zero em
    qualquer canal não-Amazon continua com fator `1`, sem nenhuma mudança de comportamento pro caso normal.
    Confirmado ao vivo: 17 pedidos Walmart no período (10-72 un. cada, `total:0`), soma de receita por produto caiu
    de US$ 16.196,40 para US$ 7.369,76 (bate com o total real do canal), unidades vendidas inalteradas.
- **Tela de Segmentos (`segmentos.html`, 10/07/2026):** ganhou **seletor de canal** (dropdown por mercado — o backend
  já filtra os segmentos pelo `channel` do `/api/dashboard`) e **"ver mais/ver menos"** nos top produtos (o backend
  passou a devolver a lista completa em `segments[k].topProducts`, a tela mostra 5 e expande).
- **Card "Onde os produtos vendem" (`segmentos.html`, 16/07/2026):** abaixo dos cards de Gato/Cão, lista os produtos
  do período **separados por segmento**, ranqueados por unidades; clicar num produto expande (accordion, só um
  aberto por vez) um painel com **mini-mapa Leaflet coroplético + ranking de estados** e a **quebra por canal**.
  Dado vem de `productGeo` (novo campo do payload de `/api/dashboard`, `metrics.js`): mesma passada que já monta
  `segments` (mesmo `itemRevFactor`, mesma normalização de estado do `byState` — `normalizeUsState` + bucket
  `INTL` para endereço não-EUA quando `market==='us'`), agrupando por **título de produto** em vez de por segmento:
  `{ title, seg, qty, revenue, byChannel:[{channel,qty,revenue}], byState:[{state,qty,revenue,orders}] }`, ambos
  ordenados desc por `qty`. O mini-mapa reaproveita as tabelas de referência (`IBGE_UF`/`STATE_NAMES`/`FIPS_UF` etc.)
  e a rampa `choroColor` das páginas de Geografia (ver 4.10), mas **copiadas inline** (sem tile, sem interação,
  `dragging:false`/`zoomControl:false`) — é um widget leve por produto, não a tela de Geografia completa; GeoJSON
  carregado sob demanda no primeiro expand de cada mercado e cacheado em memória (`geoJsonCache`).
- **Ajustes visuais do card (16/07/2026, mesmo dia, feedback do Luan olhando produção):** primeira versão ficou
  confusa (mapa minúsculo com UFs sobrepostas, produtos sem separação visual). Correções, todas client-side:
  - **Cada produto vira um card com borda** (`.geo-prod-card`) em vez de linha solta numa lista corrida.
  - **3 modos pro "Por estado"** — Ranking (pills, como antes, `max-height` maior: 320px em vez de 150px),
    **Tabela** (`<table>` Estado/UF/Unidades/Receita/%, sem limite de altura) e **Gráfico** (barra horizontal
    Chart.js, top 12 estados — a lib já está carregada nesta página pro donut de segmentos). Toggle
    (`geoViewMode`) é **global** (persistido em `localStorage('coco_seg_geoview')`), não por produto.
  - **Botão "Ocultar/Mostrar mapa"** (`geoMapHidden`, global, persistido em `coco_seg_geohide`) — some com a
    coluna do mini-mapa, a coluna de dados ocupa a largura toda (`.geo-detail-body.no-map`).
  - **Faixa de estatísticas** no topo do painel expandido (`.geo-detail-stats`): Estados alcançados, Canal
    principal (+%), Maior estado (+%) — tudo derivado do `productGeo` já recebido, nenhuma chamada nova.
  - **Botão "⤢" no mini-mapa abre um modal** (`.geo-modal-overlay`/`.geo-modal`, mesmo padrão estrutural do
    modal de estado de `geografia.html` — overlay fixo + modal fixo centralizado, `z-index` 4000/4001) com o
    mapa grande, **tile de fundo** (CartoDB Voyager) e toggle **Coroplético/Calor** (`geoModalMode`, não
    persistido, sempre abre em Coroplético). Fecha no ✕, clique fora ou Esc. **Modo Calor no MESMO estilo das
    páginas de Geografia completas** (pedido do Luan, ver correção abaixo — a 1ª versão simplificava pra só
    trocar a paleta do polígono, ele preferiu o estilo de mancha de verdade).
- **Correções do modal + layout (16/07/2026, mesmo dia, 2ª rodada de feedback):**
  - **⚠️ Bug: mapa ampliado abria em branco.** Causa: `.geo-modal` tinha só `max-height` (sem `height`
    definido) e era `display:flex;flex-direction:column`; o filho `.geo-modal-map` usava `flex:1`
    (que zera o `flex-basis`). Sem altura definida no pai, o container flex "abraça" o conteúdo em vez
    de esticar até o `max-height`, então o mapa nascia com altura ~0 e o Leaflet inicializava num
    container sem tamanho — mapa em branco (clássico gotcha de Leaflet dentro de modal/aba escondida).
    **Correção:** `.geo-modal` ganhou `height:min(640px,88vh)` (definida, não só máxima) — com isso
    `flex:1` no mapa passa a ter espaço real pra crescer. Reforço: `map.invalidateSize()` via
    `requestAnimationFrame` logo após criar o mapa, garantindo que o Leaflet recalcule o tamanho depois
    que o layout se assenta (defesa adicional, prática recomendada pela própria doc do Leaflet pra
    mapas dentro de elementos que trocam de `display:none` pra visível).
  - **Otimização — parar de recriar mapa/tiles a cada clique em Coroplético/Calor:** antes, alternar o
    modo dentro do modal já aberto recriava o `L.map` inteiro (incluindo re-baixar os tiles) — pesado e
    lento. Agora `initModalMap()` cria o mapa+tile **uma vez** por abertura; alternar o modo só troca a
    camada de polígonos coloridos (`renderModalLayer()`, remove a camada antiga e desenha a nova com a
    rampa de cor certa), sem tocar no mapa/tile. Bem mais leve.
  - **Ranking de estados com espaço gigante entre nome e valor:** `.geo-rank-list` era uma coluna única
    (`flex-direction:column`) — quando o painel ficava largo (mapa oculto, ou tela grande), o
    `flex:1` do nome do estado esticava até o fim, empurrando unidades/% pra beira direita com um vão
    enorme no meio. **Correção:** virou um grid responsivo (`repeat(auto-fill,minmax(200px,1fr))`) —
    cada estado ocupa uma célula compacta (~200px) e nome/valor ficam colados; o espaço extra vira mais
    estados por linha, não um vão maior.
  - **Nova opção "Linhas / Colunas" pra lista de produtos** (botões com ícone no cabeçalho do card,
    `geoLayoutMode`, persistido em `localStorage('coco_seg_geolayout')`): modo Colunas usa
    `.geo-prod-list.cols{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}` — os
    cards de produto (fechados) ficam lado a lado em vez de empilhados. **Cuidado pra não "bugar" ao
    expandir:** o card aberto ganha `grid-column:1/-1` (ocupa a largura toda da grade), senão o painel
    de mapa+dados ficaria espremido numa coluna estreita.
- **Modo Calor do modal no MESMO estilo da Geografia completa (16/07/2026, 3ª rodada — o Luan confirmou que
  prefere as manchas de calor de verdade, não só uma paleta diferente no polígono):** `drawModalHeat()` replica
  fielmente `drawHeatmap()` de `geografia.html`/`geografia-us.html` — bordas finas dos estados (sem preenchimento)
  + **manchas de calor** (múltiplos círculos `L.circle` por estado, dispersos pelas coordenadas de
  `SUB_REGIONS_BR`/`SUB_REGIONS_US`, raio escalado por `√(qty/maxQty)`, cor via `geoHeatColor`) + **pill** de
  rótulo (UF + unidades) no centróide (`CENTROIDS_BR`/`CENTROIDS_US`), cor laranja (`HEAT_PILL_COLOR #f97316`,
  mesma cor de `HEAT_DEFAULTS.pillColor`). Tabelas de coordenadas **copiadas** das páginas de Geografia (mesma
  duplicação deliberada de tabela estática já aceita em outros pontos do arquivo, ver GeoJSON/STATE_NAMES acima).
  Território/militar/`INTL` sem centróide cadastrado não desenha mancha (mesmo comportamento das páginas
  completas — segue disponível no Ranking/Tabela). Modo Coroplético continua preenchendo o polígono inteiro
  (`drawGeoPolygons`, inalterado). Clique numa mancha ou na pill abre o mesmo popup usado no coroplético
  (`geoStatePopupHtml`, extraído como helper único pra não duplicar o HTML do popup 3 vezes).
- **Correções da Tabela + imagem do produto (16/07/2026, 4ª rodada):**
  - **⚠️ Bug: cabeçalho e dado desalinhados no modo Tabela.** `.geo-table` usava `table-layout:auto`
    (padrão) sem larguras fixas — o navegador sobra espaço e distribui entre as colunas de forma
    imprevisível; como o cabeçalho das colunas numéricas era `text-align:left` mas o dado era
    `text-align:right`, cada um ficava numa ponta de uma coluna larga demais, parecendo "fora do
    lugar". **Correção:** `table-layout:fixed` + `<colgroup>` com largura fixa por coluna (Estado
    flexível, UF/Unidades/Receita/% com largura definida) — cabeçalho e dado sempre caem exatamente
    no mesmo lugar, independente do conteúdo — e o cabeçalho das colunas numéricas passou a ser
    `text-align:right` também (`th.num`), igual ao dado.
  - **Imagem do produto:** `productGeo` (`metrics.js`) ganhou o campo `image` — capturado na mesma
    passada que já monta a geografia por produto, reaproveitando exatamente a mesma fonte de
    `aggregateProductsByChannel()` (ver 4.13): `it.image` (Shopify/Shopee/Mercado Livre já vêm com
    isso no pedido) com fallback pro cache `amazonProductImages[it.asin]` (Amazon, hoje vazio por
    causa do bloqueio de role "Product Listing", ver backlog aberto 4 — quando for destravado, entra
    sozinho aqui também, sem mudança de código). Miniatura de 28px em cada linha de produto
    (`.geo-prod-thumb`/`.geo-prod-thumb-ph`, mesmo padrão visual — inclusive o fallback via `onerror`
    — de `produtos.html`/`estoque.html`). Sem imagem (Amazon, hoje) mostra o placeholder de ícone,
    igual às outras telas — nunca quebra o layout.
- **Correções de tipo/combo fragmentados + busca (16/07/2026, 5ª rodada — "Tablet 120"/"3 Pack - Tablet"
  aparecendo como pills separadas de "Tablets" em Por tipo de produto):**
  - **⚠️ Bug 1 — `classifyType()` confiava cegamente no `productType` cru do Shopify.** Produtos
    cadastrados com grafias diferentes do mesmo tipo ("Tablets", "Tablet 120", "3 Pack - Tablet")
    viravam 3 pills distintas em vez de uma. **Correção:** `classifyType()` (`metrics.js`, usada tanto
    em Segmentos quanto em `aggregateProductsByChannel`/Produtos/Estoque) agora roda o `productType`
    pelas mesmas palavras-chave (`TYPE_KW`) já usadas no fallback por título, em vez de devolver o
    valor cru — "Tablet 120"/"3 Pack - Tablet" viram "Tablets". Tipo sem palavra-chave reconhecida
    (ex: "Pó") continua devolvendo o valor cru, sem regressão — "Pó" (BR) e "Powder" (US) seguem
    distintos de propósito (nunca aparecem juntos, sempre filtrado por mercado).
  - **⚠️ Bug 2 — o loop de segmentos/`productGeo` não reaproveitava a normalização de combo legado.**
    `aggregateProductsByChannel()` (Produtos/Estoque/Top Produtos) já sabia, desde 4.13.1, que um item
    "- 3 Pack" vendido como SKU próprio representa N unidades do produto-base (`legacyComboSize` +
    `stripComboSuffix` + `canonicalTitle`) — mas o loop que monta `segments`/`productGeo` (adicionado
    nesta mesma branch) fazia sua própria agregação simples, sem essas funções: contava "3 Pack" como
    **1 título próprio com `qty=nº de pacotes`**, não como N unidades do produto-base. Resultado: 16
    vendas de "3 Pack" apareciam como 16 un. de um tipo à parte, em vez de somarem 48 un. de Tablets
    ao produto certo. **Correção:** o loop agora chama as mesmas três funções antes de agrupar — grupo
    por `title` canônico, `qty = pacotes × tamanho` quando é combo legado (`comboQty`/`comboBySize`
    preenchidos igual a `aggregateProductsByChannel`). Testado localmente: 4 pacotes de "3 Pack"
    (productType "3 Pack - Tablet") + 10 un. "Tablet 120" + 5 un. "Tablets" → `byType.Tablets = 27`
    (10 + 4×3 + 5), confirmando os dois bugs corrigidos juntos.
  - **Campo de busca no card** (pedido do Luan, "semelhante ao campo de busca de Top Produtos" — na
    prática o único campo de busca existente hoje é o de Pedidos Recentes, `index.html #ordersSearch`;
    reaproveitado o mesmo estilo visual `.geo-search`): filtra `lastProductGeo` **no cliente** por
    título (substring, case-insensitive) — sem endpoint novo, os dados do card já estão carregados
    inteiros pra o período/canal/mercado atual (diferente da busca de Pedidos Recentes, que precisa de
    backend porque só os pedidos recentes ficam carregados). Com busca ativa, mostra **todos** os
    resultados de cada segmento (ignora o corte de 5 + "ver mais"). Reseta ao trocar mercado/canal.
- **"Unificar" — agrupamento manual de produtos entre canais (16/07/2026, 6ª rodada):** o mesmo produto
  físico (ex: Lysine em pó) aparece fragmentado em várias linhas porque cada canal nomeia diferente —
  Shopify usa o nome oficial, Mercado Livre/Shopee às vezes descrevem por ingrediente, Amazon usa
  título de marketing; no mercado US, muitos produtos existem tanto no Shopify quanto na Amazon com
  nomes completamente distintos. **Decisão deliberada: nenhum matching automático por nome** — o risco
  de juntar produtos diferentes (sabores/tamanhos parecidos) foi levantado e o Luan confirmou que quer
  **100% manual, pela tela** (mesmo espírito do `TITLE_ALIASES` que já existe em `metrics.js`, só que
  generalizado, persistido e editável pela UI em vez de hardcoded).
  - **Modelo de dados** (`kv.productGroups`, `store.js`): `{ [market]: { [nomeDoGrupo]: [tituloBruto,...] } }`.
    Um título pertence a **no máximo um grupo** por mercado (BR e US nunca se misturam, mesma regra de
    todo o resto do app). `upsertProductGroup(market, name, members)` **une** os membros novos aos já
    existentes do grupo (reusar o mesmo nome = adicionar a ele) e **remove** cada membro de qualquer
    outro grupo do mesmo mercado onde estivesse antes — nunca duplica. `removeFromProductGroup` tira só
    um título (operação de subtração, diferente do upsert que só une). `deleteProductGroup` apaga o
    grupo inteiro ("desfazer unificação"). Mesmo padrão de persistência de `getProductFinance`/
    `setProductFinance` (`load()` → muta → `saveJson()` → `pgKv` se Postgres).
  - **Endpoints** (`server.js`): `GET /api/product-groups?market=` (lê os grupos do mercado),
    `POST /api/product-groups` (`{market,name,members}`, cria/adiciona), `POST
    /api/product-groups/remove-member` (`{market,name,title}`, tira um membro),
    `DELETE /api/product-groups?market=&name=` (apaga o grupo).
  - **`productGeo`/`metrics.js` não mudou** — continua devolvendo dado cru por título. A junção
    acontece **no cliente** (`mergeProductGroups()`, função pura em `segmentos.html`, soma qty/receita
    e re-soma `byChannel`/`byState` por chave, primeira `image` não-nula entre os membros vence — é o
    "fotos unificadas" que o Luan mencionou como benefício colateral), então o toggle **Unificar**
    liga/desliga na hora, sem round-trip, e a mesma função é reaproveitável em Produtos/Estoque depois
    sem mexer no backend de novo (só essa rodada mexeu na UI, o modelo já nasceu genérico).
  - **UI:** botão "Unificar" (🔗, persistido `coco_seg_unify`) alterna entre ver produtos crus ou
    agrupados. Botão "Selecionar" (☑) mostra checkbox em cada linha e **força a visão crua** enquanto
    ativo (senão não dá pra escolher membros que já estão dentro de um grupo); com 2+ selecionados,
    "Unificar selecionados" abre um modal pequeno pra nomear o grupo (sugere o título mais curto dos
    selecionados; digitar um nome já existente adiciona a esse grupo). Confirmar liga "Unificar"
    automaticamente. Uma linha agrupada mostra um badge (🔗 N) e, expandida, uma seção "Produtos
    unificados" listando os membros com "✕" pra tirar um específico e "Desfazer unificação" pra apagar
    o grupo inteiro.
  - **Escopo desta rodada:** só o card "Onde os produtos vendem". Reaproveitar em Produtos/Estoque é um
    próximo passo natural (o Luan sinalizou isso), mas não foi pedido ainda.
  - **Aviso de grupo já existente no modo Selecionar (mesmo dia):** ao marcar um produto que já
    pertence a outro grupo, a linha dele mostra um badge âmbar `⚠ faz parte de "Nome do grupo"`
    (`findGroupForTitle()`, busca reversa em `geoGroups`) — evita clicar "Unificar" sem perceber que
    aquele produto já estava em outro lugar (o `upsertProductGroup` já tira ele do grupo antigo
    automaticamente, mas o aviso deixa isso visível *antes* de confirmar, não só depois).
  - **⚠️ Superado (05/08/2026):** o "Unificar" local desta tela (toggle, Selecionar, modal de criação,
    badge de aviso) foi removido — a unificação virou **global**, gerida na tela `unificador.html`
    (Configurações) e aplicada automaticamente pelo backend em toda tela de produto, não só aqui. Ver
    4.18. `productGeo` chega já mesclado; a tela só exibe o badge 🔗 e a lista de membros (leitura).
- **Nota de limite:** o nome do produto vem, mas o **nome do comprador (PII)** continua vazio nos dois caminhos —
  é dado restrito, exige o papel PII aprovado pela Amazon (ver 4.7.4 e backlog aberto 2).

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
     passou por ela — nenhum backfill BR rodado, backlog aberto 3): **(a) item titulado** (pedido US enviado/
     pendente vazado) e **(b) `status === 'Cancelled'` com R$ 0 e sem item** — a grafia com DOIS L que só o
     relatório grava (a Orders API grava `'Canceled'`, um L); pega o pedido US cancelado, que no relatório não
     vira linha de item (fica sem título/R$ 0) e escaparia do sinal (a). **Cuidado:** casar `'Canceled'` (um L)
     apagaria cancelamento BR real — casar sempre exatamente `'Cancelled'`. Idempotente. **Rodar UMA vez após
     o deploy.** ⚠️ Não re-rodar se um dia um backfill BR de verdade for feito (aí pedido BR real teria título/
     grafia de relatório).

#### 4.7.9 Nome de produto do Amazon BR: caminho getOrderItems + o 400 nos pedidos 701-/702- (13/07/2026)
- **Contexto:** tentativa de obter os nomes de produto do Amazon BR (backlog aberto 3). O relatório (Reports API)
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

#### 4.7.10 Toggle "Receita da Amazon": Total cobrado × Vendas de produto (implementado 29/07/2026)
- **O quê:** painel de Configurações (⚙) ganhou um switch pra escolher, só pra Amazon, entre
  **"Total cobrado"** (`o.total`, igual aos outros canais — produto + imposto + frete) e
  **"Vendas de produto"** (`o.productSales`, a métrica que a Amazon chama de "Ordered Product
  Sales" no Seller Central — só o valor do produto). Persistido em
  `localStorage('coco_amazon_rev_mode')`, mandado como `?amazonRevenueMode=total|product` pro
  `/api/dashboard`. `orderRevenue(o, mode)` em `metrics.js` decide por pedido; aplicado em KPI,
  tendência e `byChannel` — **não** em geografia/marketing/segmentos/produtos (fora de escopo
  dessa rodada). `productSales` só existe pra pedido que passou pela Reports API (backfill ou
  `reconcileAmazonNames`, ver 4.7.6) — pedido não reconciliado cai automaticamente no total cheio
  (`orderRevenue` nunca mostra 0/quebra).
- **⚠️ Bug corrigido no mesmo dia — "zero falso" de pedido Pending no relatório:**
  `ordersFromRows()` pula TODAS as linhas de um pedido que estava `Pending`/`PendingAvailability`
  no instante em que o relatório rodou (mesma regra de "só pedido pago conta", ver 6f1eb2c),
  deixando `productSales` parado em `0` — um "não processado", não "vendas zero". Como a
  reconciliação usa janela curta (`AMAZON_NAMES_DAYS`, 2 dias) e roda a cada poucas horas, um
  pedido pode estar Pending nesse instante e já ter sido capturado/enviado (total real) quando o
  dashboard é consultado depois. `patchOrderItems()` (`store.js`) copiava esse `0` falso por cima
  do pedido já existente sem checar isso — o modo "Vendas de produto" saía ~41% abaixo do
  "Total" num dia só. **Corrigido:** só aplica `productSales` quando o pedido do relatório não
  veio marcado `cancelled` (não usa `items.length` como proxy — pedido pode ter `productSales`
  real com `items` vazio, linhas todas "-", frete/ajuste).
- **⚠️ Limitação conhecida, NÃO é bug (apurada 29/07/2026) — "Vendas de produto" pode ficar bem
  abaixo do real em vários dias:** mesmo corrigido o zero falso, comparar `productSales` contra
  o `total` real (Orders API) mostrou gap de até ~40% em dias fechados — bem acima do ~1,5%
  validado contra um print real do Seller Central (23/07, ver histórico). Causa: o relatório
  `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL` frequentemente vem com `item-tax`/
  `shipping-price`/`shipping-tax` **em branco** (string vazia, não `"0.00"`) pra boa parte dos
  pedidos — não é bug de parsing (os campos ficam consistentemente vazios juntos, `item-price`
  continua presente) — parece ser porque a Amazon recolhe/repassa esse imposto sem detalhar por
  pedido nesse relatório específico (Marketplace Facilitated Tax). Como `existing.total` (a fonte
  confiável, vinda da Orders API) inclui esse imposto/frete de verdade, e `o.productSales`
  (relatório) não tem como refletir o que não veio, o gap fica maior e mais inconsistente do que
  o gap "de definição" puro (produto vs total, calculado **dentro do próprio relatório**, que fica
  em ~7% — plausível pra frete individual de pedido avulso). Também existem linhas
  `sales-channel: "Non-Amazon"/"Non-Amazon US"` (Multi-Channel Fulfillment — Amazon só despachando
  pedido de fora, ver 4.7.9) com **todos os campos de preço em branco**; não é a causa principal
  do gap (poucos pedidos, ~9 num teste de 2 dias), mas contribuem. **Decisão do Luan:** manter o
  toggle, com aviso na própria tela (`public/index.html`, texto do `.arev-caption`) — "Total
  cobrado" continua sendo o número confiável por padrão; "Vendas de produto" é uma aproximação
  que pode subestimar. Diagnóstico: `GET /api/amazon/report-columns?market=us&days=` (`inspectReport`)
  expõe os campos financeiros crus por linha do relatório pra investigar um dia específico.

#### 4.7.11 ⚠️ Amazon BR "sem pedidos" — o token BR autorizava a conta errada (resolvido 04/08/2026)
- **Sintoma (reportado pelo Luan):** Amazon BR parou de mostrar pedidos no dashboard, apesar de a
  loja ter vendas reais recentes (confirmadas direto no Seller Central). Isso reabre e **resolve
  definitivamente** a ambiguidade deixada em aberto no backlog desde 13/07 (duas teorias nunca
  reconciliadas — ver histórico do item 2 do backlog).
- **Diagnóstico (mesmo dia, com o token real do Railway em mãos):** com `AMAZON_BR_REFRESH_TOKEN`
  configurado localmente, `whoAmI('br')` mostrava **10 marketplaces participando** (MX, CA, BR, US)
  — exatamente a assinatura da conta **VITA PET LIFE**, não da CocoandLuna (que deveria enxergar só
  `Brazil`, ver 4.7.1). Prova definitiva: consultando o marketplace **dos EUA**
  (`ATVPDKIKX0DER`) usando esse mesmo token "BR", vieram **50 pedidos reais americanos**
  (`111-.../112-...`, valores em USD) — e consultando o marketplace BR (`A2Q3Y263D00KWC`) com o
  mesmo token, **0 pedidos**. Ou seja: o valor salvo como `AMAZON_BR_REFRESH_TOKEN` em produção
  **não era da conta CocoandLuna** — era (ou tinha virado, num re-authorize anterior) um token da
  conta VITA PET LIFE, que "participa" do marketplace BR só porque as contas são vinculadas, mas
  não tem nenhum pedido lá de verdade. É a MESMA assinatura já documentada em 4.7.1 pra explicar por
  que a conta errada "parece" ter acesso ao BR sem realmente vender lá.
- **Decisão: app SP-API próprio pra CocoandLuna, em vez de só reautorizar o app existente.** A ideia
  inicial (reautorizar a CocoandLuna dentro do mesmo app "Dashboard Amazon", criado sob a conta
  VITA PET LIFE) foi descartada a pedido do Luan — o app atual já é usado em produção pelos EUA, que
  "deu muito trabalho pra funcionar direito" (ver todo o histórico de 4.7.2 a 4.7.10), e mexer nele
  de novo trazia risco desnecessário pro que já está estável. Em vez disso, criado um **app privado
  novo, registrado e autorizado inteiramente dentro do Seller Central/Solution Provider Portal da
  própria conta CocoandLuna** — sem nenhuma relação com o app da Vita Pet Life.
  - **O código já estava pronto pra isso, sem precisar de nenhuma mudança:** `amazon.js` já tinha
    (desde a investigação registrada em 4.7.9) o fallback `CLIENT_ID_BR = process.env.AMAZON_BR_CLIENT_ID
    || CLIENT_ID` / `CLIENT_SECRET_BR = process.env.AMAZON_BR_CLIENT_SECRET || CLIENT_SECRET` — ou
    seja, o app já sabia usar um client_id/secret **diferente** pro BR se essas variáveis existissem,
    e cai de volta pro client_id/secret compartilhado (dos EUA) se não existirem. Só faltava
    preencher as variáveis.
  - **Nova variável:** `AMAZON_BR_CLIENT_ID` / `AMAZON_BR_CLIENT_SECRET` (além do já existente
    `AMAZON_BR_REFRESH_TOKEN`, agora reemitido pelo app novo). O IAM Role (`AMAZON_ROLE_ARN`) e as
    chaves AWS continuam **compartilhados** com os EUA — só o client_id/secret/refresh_token do BR
    ficam num app totalmente separado.
- **⚠️ A jornada de descobrir o caminho certo no site da Amazon foi o gargalo real, não o código.**
  A UI da Amazon mudou bastante desde a última vez que esse fluxo foi documentado (4.7.1, 09/07):
  - O menu antigo documentado ("Seller Central → Apps and Services → Develop Apps") hoje **redireciona
    direto pro Solution Provider Portal** — os dois sistemas parecem ter sido unificados.
  - Criar um app novo, hoje, exige **duas etapas prévias obrigatórias** que não existiam antes:
    **Verify your Identity** (documento de identidade + registro da empresa, ~20 min) e depois
    **Set up Solution Provider Account Profile and Permissions** (formulário com "primary business
    activity", roles, use case, security controls) — e essa segunda etapa entra em **revisão manual
    da Amazon** antes de liberar a criação de app de **produção** (sem revisão aprovada, só dá pra
    criar app de **Sandbox**, que não vê pedido real nenhum).
  - As **roles** (permissões) também mudaram de nome — não existe mais um role chamado "Orders".
    Usado **`Inventory and Order Tracking`** ("Analyze and manage inventory. Does not include
    information required to generate shipping labels" — o mais próximo do antigo Orders) +
    **`Product Listing`** (pedido de propósito: o app dos EUA não tem esse role, por isso a Catalog
    Items API dá 403 e nunca trouxe imagem de produto Amazon — ver backlog aberto 3 — então o app
    novo do BR já nasceu pedindo essa permissão, pra não herdar a mesma limitação).
  - No formulário do app em si, cuidado pra não confundir **três identificadores parecidos** que a
    tela mostra em pontos diferentes: **Application ID** (`amzn1.sp.solution.<uuid>`, é só o ID do
    registro dentro do portal), algo tipo **Account/Merchant ID** (`amzn1.pa.o.<...>`, identifica a
    conta vendedora, não o app) e o que realmente importa pro código, o **Client ID** (formato
    `amzn1.application-oa2-client.<hex>`) + **Client Secret** (`amzn1.oa2-cs.v1.<hex>`) — esses dois
    ficam numa seção separada chamada **"LWA credentials"** (link "View" na listagem de apps do
    Solution Provider Portal), não na tela principal do app.
- **Verificado ao vivo (04/08/2026), com o app novo:** `whoAmI('br')` passou a mostrar **só**
  `A2Q3Y263D00KWC` (Amazon.com.br) — a assinatura correta da CocoandLuna, batendo com 4.7.1. E
  `/orders/v0/orders` nos últimos 14 dias trouxe **29 pedidos reais** (`701-.../702-...`, `Shipped`,
  `AFN`, valores em BRL) — confirmação definitiva de que a causa raiz era mesmo o token/app errado,
  não limitação de código nem de permissão de app.
- **Concluído em produção (04/08/2026):** as três variáveis coladas no Railway, `POST /api/sync`
  disparado — mas o sync incremental sozinho voltou `amazon_br: 0`. **Causa:** o cursor
  (`kv.amazonCursors.br`) avança pra "agora" a cada sync bem-sucedido, mesmo com 0 resultados
  (`if (cursorKey) setAmazonCursor(cursorKey, safeUntil)`, sem checar `out.length`) — durante todo o
  tempo em que o token estava errado, cada sync "funcionava" (200 OK, vazio) e o cursor foi
  avançando no vazio. Resultado: o sync incremental, já com o token certo, só olhou os ~15 min desde
  o último cursor — não o histórico represado. **Corrigido rodando um backfill** (Reports API, já
  existia, não precisou de código novo): `POST /api/amazon/backfill?days=90&market=br` →
  **121 pedidos recuperados** dos últimos 90 dias. A preocupação antiga de contaminação de mercado no
  relatório BR (ver 4.7.8) não se repetiu — fazia sentido só com o token antigo (conta vinculada
  multi-país); o token novo só participa do marketplace BR, então o relatório vem limpo.
- **Bônus confirmado:** o job `enrichAmazonItems` (nome de produto via `getOrderItems`, backlog
  aberto 2) rodou em paralelo e avançou normalmente (`40/77` nomeados durante o teste) — sem repetir
  o erro 400 que os pedidos `701-/702-` davam com o token antigo. Reforça que aquele erro também era
  causado pela autorização errada, não por limitação do app no marketplace BR (a teoria de 4.7.9).

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
- **Sidebar compartilhada (`public/sidebar.js`):** IIFE auto-executável que injeta o markup, **todo o CSS do componente** (`.sidebar`, `.brand*`, `.nav-*`, toggle, overlay, botão de abrir, transforms `body.sidebar-*` + `.nav-flag`/`.side-user`) via `<style id="sidebarComponentStyle">`, e o comportamento — em qualquer página com `<script src="sidebar.js"></script>`. Idempotente — checa `nav.sidebar` existente antes de montar. Marca o item ativo via `location.pathname` vs `data-page`. **Desde 15/07/2026 o CSS da sidebar vive SÓ aqui** (fonte única, não mais duplicado por página, ver Resolvidos na seção 9): cada página cuida apenas do próprio layout (`.main`/`.content`/`.topbar`). As páginas de Geografia sobrescrevem só o z-index (`body .sidebar{z-index:3000}`, maior especificidade que a regra injetada, por causa do Leaflet). O CSS injetado usa as variáveis de tema (`--side-*` etc.) do `:root` de cada página, que resolvem normalmente por herança. **NÃO duplicar o markup nem o CSS da sidebar por página — sempre usar o script.**
- **Sidebar ocultável:** botão `☰` (`#sidebarToggle`) dentro da própria sidebar. Desktop: toggle com animação + `localStorage('coco_sidebar')`. Mobile (≤768px): sidebar começa oculta, abre como overlay com `#sidebarOverlay`. Classe `body.sidebar-hidden` oculta no desktop; `body.sidebar-mobile-open` abre como drawer no mobile.
- **Responsivo:** breakpoint 768px — KPIs em 2 colunas (5º ocupa linha inteira), charts em coluna única, padding reduzido. Breakpoint 520px — labels dos filtros e texto dos botões de mercado ocultos.

### 4.9b Seletor de mercado, canais e cards
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
- Pedidos Recentes: linha de resumo com total dos pedidos válidos. Tem **campo de busca GERAL** (implementado
  15/07/2026): digitar consulta `GET /api/orders/search?market=&q=` (`searchOrders()` em `metrics.js`), que varre
  **todo o histórico do mercado** (todos os canais, sem janela de data) — não só os recentes carregados no card.
  Busca por termos (AND) em nº, cliente, status (cru + rótulo pt-BR), canal (id + rótulo) e valor; **não** busca
  nome de produto (o card mostra só a contagem de itens). Escopo por mercado (não mistura BRL/USD). Debounce de
  300ms, resposta fora de ordem descartada por sequência, teto de 200 resultados (`limited`). Campo vazio volta
  a exibir os recentes do `/api/dashboard`.
  - **Vocabulário de status estilo Bling (30/07/2026):** a coluna Status trocou os rótulos genéricos
    "OK"/"Pendente"/"Não pago" pelo vocabulário de NF-e que o Bling usa (pedido do Luan, olhando a
    tabela de pedidos do Bling) — **"Autorizado"** (verde, pedido válido/pago), **"Em aberto"** (âmbar,
    qualquer coisa ainda não concluída, inclusive o caso "Não pago" da Amazon) e **"Cancelado"** (vermelho,
    inalterado). Só o texto do rótulo mudou — `statusTag()` (`index.html`) continua lendo exatamente os
    mesmos `o.cancelled`/`o.status`/`UNPAID_STATUS_BY_CHANNEL` de sempre, sem nenhuma mudança em cálculo
    de receita/cancelamento. `statusLabelPt()` (`metrics.js`, usada pela busca geral) foi atualizada junto,
    pra buscar "em aberto" ou "autorizado" continuar encontrando os pedidos certos. Ícones por canal (como
    os que o Bling mostra por tipo de documento/certificado) foram cogitados e descartados pelo Luan — o
    canal já aparece como badge colorido por extenso na coluna Canal, que já cobre essa necessidade.
  - **Toggle "Nº produtos"/"Qtd. total" na coluna Itens + exportação CSV (implementado 03/08/2026):**
    pedido do Luan — a coluna "Itens" sempre mostrou `o.items.length` (nº de linhas de produto
    distintas do pedido), e um pedido com **1 linha e `qty: 70`** (comum em B2B/atacado) aparecia como
    "1 item", o que confundia. `sumItemsQty(o)` (`metrics.js`) soma `it.qty` de todas as linhas; o
    payload de `/api/dashboard` (`recent`) e de `/api/orders/search` passaram a expor os dois valores
    (`items` = contagem de linhas, `itemsQty` = soma de quantidades). Um toggle de pill (`#roItemsToggle`,
    "Nº produtos" / "Qtd. total", persistido em `localStorage('coco_orders_items_mode')`) no cabeçalho
    do card alterna qual valor a coluna mostra, tanto na tela quanto na exportação — sem chamada nova
    ao trocar (o dado já vem nos dois formatos).
    - **`GET /api/orders/export?market=&channel=&since=&until=&status=&itemsMode=`** (`server.js`,
      via `exportOrdersList()` novo em `metrics.js`) baixa um CSV com **todos** os pedidos do
      período/canal/mercado escolhidos — diferente do `recent` do payload normal, que é capado em
      `RECENT_MAX` por segurança de tamanho; a exportação é sob demanda, sem teto, direto no store.
      Filtro opcional de **status** (`todos`/`autorizado`/`em_aberto`/`cancelado`, mesmo vocabulário de
      `statusLabelPt()` que a coluna Status já usa — ver acima) escolhido num popover (`#roExportPop`)
      antes de baixar. Colunas: Código do pedido, Cliente, Status, Nº de produtos (ou Qtd. de itens,
      conforme o toggle), Data, Valor. CSV com `;` como separador + BOM UTF-8 — abre direto no Excel
      em pt-BR sem passar pelo assistente de importação (a vírgula já é o separador decimal na
      configuração regional brasileira). Mesmo padrão de CSV reaproveitado pela exportação de
      Produtos (ver 4.13.2).
  - **Coluna "Produto" (implementado 05/08/2026):** pedido do Luan — mostra o(s) produto(s) vendidos
    naquele pedido, entre Cliente e Nº produtos. `productTitles(o)` (`metrics.js`, ao lado de
    `sumItemsQty`) devolve os títulos únicos do pedido (mesmo filtro de "-"/vazio de
    `aggregateProductsByChannel`, ver 4.13 — placeholder de frete/serviço da Amazon não conta como
    produto), exposto como `products: string[]` em `recentOrders` (`/api/dashboard`) e em
    `/api/orders/search`. A célula mostra o primeiro título + `+N` se houver mais de um, com o texto
    completo no `title` do elemento (tooltip ao passar o mouse) — largura máxima com reticências
    (`.ro-prod-cell`) pra não estourar a tabela com título longo. Coluna nova soma no `colspan`/
    `nth-child` do responsivo (escondida junto com Cliente/Status abaixo de 768px, mesmo padrão de
    antes). **Não** entra no CSV de exportação (`exportOrdersList`) nesta rodada — só a tela.
- **Card Orgânico x Campanha (`#cardSalesSplit`, alterado 02/07/2026):** uma **pizza por canal** (não é mais um único donut agregado nem gráfico de linha) — grid `.ss-grid` com uma célula por canal do mercado atual (BR: Shopify/Shopee/ML/Amazon; US: Shopify US/Amazon US). Dados vêm de `salesSplitByChannel` (`{ [channel]: { campaign, organic, campaignOrders, organicOrders } }`) calculado em `computeDashboard()` a partir de **todos** os pedidos do mercado (independente do filtro de canal selecionado na tela — por isso sempre mostra as 4/2 pizzas). Canais sem tracking de origem/listing type (Shopee, Amazon) sempre caem 100% em orgânico, naturalmente (não é caso especial no código — `isCampaignOrder()` nunca retorna `true` pra esses canais). Canal sem nenhum pedido no período mostra o anel cinza "sem dados" do `drawDonut()` (não confundir com "100% orgânico"). `#cardSalesSplit` é `grid-column:span 12` direto (não fica dentro de um `.right-col-stack` compartilhado com `#cardMarketing` — essa frase antiga aqui estava desatualizada).
- **Pente-fino de espaço branco / cards desproporcionais (30/07/2026):** o Luan reportou, com print, cards "gigantes sem sentido" ao filtrar um canal específico — ex. Shopee com "Orgânico x Campanha" mostrando uma pizza de 88px perdida numa faixa branca com quase 1400px de largura. Causa raiz: o grid principal (`#editGrid`, 12 colunas) tem `trend`(7)+`channelSplit`(5) e `topProducts`(8)+`marketing`(4) como pares fixos — quando o card vizinho some (`updateCardVisibility()` esconde `#cardChannelSplit` fora de "todos" e `#cardMarketing` fora de "todos"/Shopify), o outro card do par ficava com a largura fixa de sempre, deixando metade da linha em branco. `#cardSalesSplit` é sempre `span 12` full-width, mas com só 1 canal (não "todos") o `.ss-grid` continuava usando a célula pequena de sempre (88px), sem motivo pra ocupar tanto espaço.
  - **Correção 1 — Tendência/Top produtos ganham a linha inteira quando o par some:** `updateCardVisibility()` agora também define `grid-column` dinamicamente: `trend` vira `span 12` quando `#cardChannelSplit` está escondido (senão `span 7`); `topProducts` vira `span 12` quando `#cardMarketing` está escondido (senão `span 8`). Não interfere no modo Editar (`.edit-grid>.edit-card{grid-column:1/-1!important}` já força largura total ali, `!important` sempre vence).
  - **Correção 2 — canal único no "Orgânico x Campanha" fica maior e ganha KPIs, não só mais espaço vazio:** `.ss-grid.single` (aplicada via JS quando `ssChannels.length===1`, i.e. qualquer canal que não seja "todos") vira flex centralizado com a pizza crescendo de 88px para 150px, e ao lado aparece um painel "Pedidos de campanha"/"Pedidos orgânicos" (dado real de `salesSplitByChannel[canal]`, que já existia mas não era mostrado aqui) — a largura extra passa a ser usada pra mostrar mais informação, não só decoração. Modo "todos" (4/2 pizzas) fica exatamente igual a antes.
  - **Correção 3 — "Top produtos" mentia "Sem vendas no período" quando havia venda real sem nome de produto:** Amazon BR é o caso de hoje (nomes de item bloqueados, ver 4.7.9/backlog 2) — a receita do pedido conta normalmente (`o.total`), mas como nenhum item tem título, `aggregateProductsByChannel()` pula todos os itens (guarda `if (!it.title) return`) e a lista de produtos fica vazia mesmo com `kpis.revenue > 0`. Antes disso sempre virava "Sem vendas no período", que é enganoso (parece que não teve pedido nenhum). Agora, se `kpis.revenue > 0` mas a lista está vazia, mostra "R$X em vendas no período, mas sem nome de produto disponível ainda pra este canal" em vez do genérico.
  - **Correção 4 (achado pelo Luan direto na conferência visual) — linha "Custo ads" aparecia em canais sem nenhuma relação com Meta:** a linha tracejada "Custo ads" da Tendência (gasto do Meta Ads/Instagram/Facebook) era desenhada sempre que `metric==='receita'`, **sem checar o canal selecionado** — então filtrar por Shopee/Mercado Livre/Amazon mostrava a mesma linha de gasto do Meta (que só atribui a Shopify) do lado da receita daquele canal, parecendo (errado) que aquele canal tinha custo de anúncio próprio. Ficou mais visível depois da correção do dia 30/07 que fez essa linha passar a mostrar dado real (antes ficava fixa em zero, ver commit anterior). **Corrigido:** `showAdsLine = metric==='receita' && (channel==='todos'||channel==='shopify'||channel==='shopify_us')` — mesma regra de canal já usada por `#cardMarketing`. Dataset e legenda ("Custo ads") só entram no gráfico quando `showAdsLine` é verdadeiro; Shopee/Mercado Livre/Amazon mostram só a linha de Receita.
- **KPI strip principal (alterado 02/07/2026):** 5 células — Receita Total, Pedidos, Ticket Médio, **ROAS**, **ACOS** (`#kpiRoas`/`#kpiAcos`). O KPI "Conversão" foi removido daqui (a métrica de conversão de sessão→compra continua existindo no card de Tráfego, `#mConv`, que é outro contexto). ROAS = `kpis.roas` (metaRevenue ÷ adCost, já calculado no backend). ACOS = `100/roas` (gasto ÷ vendas atribuídas, em %) — a grade CSS do `.kpi-strip` já era `repeat(5,1fr)` antes dessa mudança (pensada pra isso).
  - **ROAS/ACOS sensível ao canal selecionado, sem toggle (reformulado 05/08/2026):** a primeira
    versão (30/07/2026) tinha um switch "Incluir Mercado Ads" — opcional, desligado por padrão. O
    Luan pediu pra remover: "não deve ser uma opção, mas sim uma obrigação" — Mercado Ads (Product
    Ads + receita de Destaque) agora **sempre** entra no cálculo quando faz sentido, sem switch
    nenhum (`#toggleRoasMlAds`/`isRoasIncludeMlAds()`/`localStorage('coco_roas_include_mlads')`
    removidos por completo, junto com o CSS `.kpi-roas-toggle*`).
    - Ao mesmo tempo, corrigido um problema mais antigo (nunca reportado, achado nessa reformulação):
      o ROAS/ACOS **sempre** misturava Meta+ML no cálculo, **mesmo com Shopee/Amazon selecionado**
      — canais que não têm nenhuma relação com Meta Ads nem Mercado Ads. Mostrava um número
      tecnicamente calculado mas sem significado nenhum pro canal escolhido.
    - **Regra atual, por canal** (`d.channel`): **"todos"** → Meta Ads sempre; no mercado BR, soma
      Mercado Ads também (`mlBreakdown.adCost`/`mlBreakdown.premium`) — visão do negócio inteiro.
      **Shopify/Shopify US** → só Meta Ads (é quem leva tráfego pra lá; misturar Mercado Ads aqui
      diluiria o número com gasto que não tem nada a ver com esse canal). **Mercado Livre** → só
      Mercado Ads dele mesmo (Meta não direciona venda pro ML). **Shopee/Amazon/Amazon US** → **"—"**,
      sem cálculo nenhum, com o subtítulo explicando "sem rastreamento de Ads ainda" (nenhum desses
      canais tem Ads integrado, ver 4.5/4.7). Implementa o princípio geral pedido pelo Luan: "quando
      o canal é todos, tudo deve aparecer; quando é individual, só o que está disponível daquele
      canal."
    - **Cálculo 100% no cliente**, como antes — os campos já vêm no payload de `/api/dashboard`
      (`kpis.metaRevenue`/`kpis.adCost` + `mlBreakdown`), então trocar de canal recalcula na hora
      (`render(lastData)`) sem round-trip ao backend.
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
- Usa dados reais de dois endpoints: `/api/dashboard` (KPIs, tendência, gasto diário Meta, faturamento total por canal) e `/api/campaigns` (campanha a campanha, ao vivo).
- **Painel "Visão Geral":** KPIs de receita, pedidos, gasto, ROAS por canal. Mini charts de tendência com `trend.byChannel` e `trend.metaSpendDaily`.
- **KPI strip do topo — todos "geral" (alterado 02/07/2026):** `render()` é `async` porque busca `/api/campaigns` (via `loadCampaigns()`, já cacheado) além de `/api/dashboard`. 5 células: **Gasto Total** (Meta + Mercado Ads + Google Ads), **Pedidos** (`kpis.orders`), **Vendas Atribuídas Geral** (Meta + ML Destaque/premium + Google Ads), **Faturamento Geral** (`kpis.revenue`, receita total do período — não é atribuição, é o total da loja), **ROAS Geral** (vendas atribuídas geral ÷ gasto geral). O KPI de "Cliques" foi removido.
- **Painel "Gastos":** ao clicar em um canal, exibe cards individuais de cada campanha retornados por `/api/campaigns`. Cada card mostra: nome, status, gasto, receita, ROAS, pedidos, cliques, impressões, CTR, ACoS (ML).
  - Logo do canal em cada card: `logo_mercadolivre.png` com `.camp-logo-fill` (sem borda/padding, `object-fit:cover`). Meta/Shopee/Amazon com `.camp-logo-img` (fundo branco, borda, padding — para logos com transparência).
  - `.cmp-status.on` / `.cmp-status.off` indicam campanha ativa/pausada.
- Mercado Livre e Meta BR aparecem no mercado BR; apenas Meta US no mercado US. Google Ads aparece só no mercado US (card `#card-google_us`).
- Período sincronizado com o seletor da própria página (não herda do `index.html`).

#### 4.11.1 ⚠️ Cards de canal (topo) divergiam da lista de campanhas embaixo deles (corrigido 04/08/2026)
- **Sintoma (reportado pelo Luan, com print):** o card resumo do Mercado Livre mostrava "Gasto Ads
  R$ 2.588" **em qualquer período escolhido** — o número nunca mudava — enquanto a soma das 4
  campanhas listadas logo abaixo dava só R$ 290. O card do Meta também "parecia incoerente": "Vendas
  Atribuídas R$ 2.104" contra uma soma de "Receita" das campanhas de baixo de quase R$ 4.855 (mais do
  dobro). O KPI geral do topo da tela ("Gasto Total"/"Vendas Atribuídas Geral"/"ROAS Geral") herdava
  os dois problemas, por somar exatamente esses mesmos números quebrados.
- **Causa raiz nº 1 — Mercado Livre nunca respeitava o período:** o card lia `mlBreakdown.adCost`
  (payload de `/api/dashboard`), que por sua vez vem de `kv.mlAdCosts` — um **valor único**, gravado
  pelo **sync periódico** (`sync.js`, a cada `SYNC_INTERVAL_MINUTES`) chamando `ml.fetchAdCosts()` com
  a janela fixa de 60 dias do próprio sync (`defaultWindow()`), **sem nenhuma relação com o
  `since`/`until` escolhido na tela**. Trocar o período em `campanhas.html` nunca recalculava esse
  valor — ele só mudava quando o sync rodava de novo, e sempre pro mesmo range de 60 dias. Os cards
  de campanha individuais, por outro lado, sempre estiveram certos: vêm de `/api/campaigns`, que
  chama `ml.fetchCampaigns()`/`meta.fetchCampaigns()` **ao vivo**, com o `since`/`until` exato da tela.
- **Causa raiz nº 2 — Meta usava uma metodologia de atribuição diferente da mostrada embaixo:** "Vendas
  Atribuídas" do card vinha de `kpis.metaRevenue` (`/api/dashboard`) — soma do `total` de pedidos cujo
  `customerJourneySummary.lastVisit.source` é Instagram/Facebook (atribuição por origem do pedido no
  Shopify, ver 4.4). Os cards de campanha, por sua vez, mostram `revenue` vindo de `action_values` da
  própria API do Meta (conversões que a Meta atribui ao pixel/Conversions API, com a janela de
  atribuição dela, tipicamente mais ampla/generosa que "a origem do último clique registrada no
  Shopify"). São duas métricas **legítimas mas diferentes** — nenhuma das duas está "errada" — só que
  aparecerem lado a lado sem nenhuma explicação parecia incoerente. Confirmado ao vivo (7 dias,
  04/08/2026): `kpis.metaRevenue` = R$ 2.104,01 vs soma de `revenue` das campanhas = R$ 4.855,03.
- **Correção:** os cards de canal (Mercado Livre e Meta, BR e US) e o KPI geral do topo **pararam de
  ler `/api/dashboard` pra gasto/vendas de Ads** e passaram a somar a **mesma lista de campanhas** já
  buscada de `/api/campaigns` (`loadCampaigns()`) que preenche os cards individuais logo abaixo —
  exatamente o padrão que o card do Google Ads já usava desde 01/07 (ver "Card Google Ads" abaixo).
  Por construção, o resumo do canal nunca mais pode divergir da soma do que está listado embaixo dele.
  `render()` agora busca `/api/campaigns` **sempre** (antes só buscava eager pra `market==='us'`, por
  causa do Google) e deriva `metaSpend/metaRev/metaClicks` e `mlSpend/mlClicks` via `sumField(campos,
  'spend'|'revenue'|'clicks')`. Disponibilidade (`mlAvail`/`metaAvail`) passou a vir do campo
  `available` da resposta de `/api/campaigns`, não mais de "gasto > 0" — antes, um período com gasto
  real igual a zero (campanha pausada, por exemplo) aparecia incorretamente como "não conectado".
  **O que ficou intocado, de propósito:** `cs.mercadolivre` (Faturamento total do canal ML, todas as
  vendas — não só as de Ads) continua vindo de `/api/dashboard`, já período-correto, sem relação com
  o bug. `mlBreakdown.premium` ("ML Destaque" no KPI geral) continua vindo da tag de listagem paga do
  pedido, não de Ads — metodologia deliberadamente diferente, já documentada acima, não mexida.
  **O dashboard principal (`index.html`) NÃO foi tocado** — `kpis.adCost`/`metaRevenue`/
  `mlBreakdown.adCost` em `/api/dashboard` continuam existindo do jeito que estavam, alimentando o
  ROAS/ACOS do topo e o toggle "Incluir Mercado Ads" (ver 4.9b) com a mesma metodologia de sempre.
  - **⚠️ Efeito colateral esperado, não é bug:** como "Vendas Atribuídas" do Meta nesta tela passou a
    usar a receita que a própria Meta reporta (em vez da atribuição por origem do pedido), o número
    fica **bem maior** que antes (no teste acima, mais que dobrou) — isso é a correção funcionando,
    não uma regressão; a Meta conta conversões que a atribuição por "origem do último clique no
    Shopify" não capturava (ex: clique no anúncio hoje, compra alguns dias depois vindo direto/busca).
  - **⚠️ Bug relacionado, ENCONTRADO mas NÃO corrigido nesta rodada (mesma causa raiz nº 1):** o toggle
    "Incluir Mercado Ads" no KPI de ROAS/ACOS do dashboard principal (`index.html`, ver 4.9b) também
    lê `mlBreakdown.adCost` — herda exatamente o mesmo problema (número preso na janela de 60 dias do
    sync, não respeita o período escolhido no dashboard principal). Não foi corrigido porque exigiria
    ou (a) tornar `/api/dashboard` (o endpoint mais chamado do app, sem nenhuma dependência de API
    externa até hoje, por design — ver seção 3) dependente de uma chamada ao vivo à API do Mercado
    Ads a cada request, ou (b) sincronizar o gasto do ML como série diária (como o Meta já faz via
    `metaInsightsDaily`) — não confirmado se a API de Mercado Ads suporta agregação diária num único
    request (haveria indício de um parâmetro `aggregation_type=DAILY`, mas a documentação oficial
    bloqueia acesso automatizado e não foi possível confirmar o formato exato da resposta). Qualquer
    uma das duas é uma mudança de arquitetura maior que o escopo desta correção (só a tela de
    Campanhas). Revisitar se o Luan quiser esse toggle corrigido também.
- **Card Google Ads (só EUA):** ao contrário dos demais cards (que agora também puxam de
  `/api/campaigns`, ver acima), o card do Google Ads (`loadGoogleCard()`) sempre buscou
  `/api/campaigns` diretamente e somou `spend/revenue/clicks` das campanhas retornadas — era o padrão
  já certo que os outros dois canais passaram a seguir nesta correção. Não está integrado ao payload
  de `/api/dashboard` nem ao `mlBreakdown`/`salesSplit` (decisão consciente, ver 4.12). Mini-chart
  mostra gasto por campanha (barras), não série diária (a API do Google Ads aqui só é consultada
  agregada por período, sem `segments.date`).

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
  - **Reescrito (17/07/2026) — trocado Drag and Drop API nativa por arraste customizado por ponteiro:** o Luan reportou que "o card deveria sempre vir junto com o mouse" — na prática, a API nativa (`dragstart`/`dragover`/`dragend`) deixa o elemento de origem no DOM durante o arraste inteiro (só com `opacity:.5` via classe `.dragging`; é dele que o navegador tira a própria "imagem fantasma" que segue o cursor, fora do nosso controle), enquanto o placeholder tracejado (`.prod-card-ghost`) se move separadamente pela lista — dava a sensação de **duas cópias do card**: uma parada meio-transparente no lugar original e outra "puxando" em outro ponto, sem ligação visual clara com a posição do mouse. **Correção:** `attachDragHandlers()` não usa mais `draggable`/eventos `drag*` nativos — o `mousedown` na alça inicia um arraste rastreado por `mousemove`/`mouseup` no `document`. Só ao passar de um limiar de 4px de movimento (`DRAG_MOVE_THRESHOLD`, evita disparar num simples clique) o `beginDrag()` roda: o card real é **removido do DOM** (só sobra o placeholder tracejado no lugar) e um **clone dele** (`card.cloneNode(true)`, classe `.prod-card-floating`, `position:fixed`) é inserido em `document.body` e reposicionado a cada `mousemove` (`left/top = clientX/Y − offset de onde a alça foi agarrada`) — o clone segue o cursor de verdade, pixel a pixel, sempre a única cópia visível. `getDragAfterElement()` (inalterada) continua movendo o placeholder pra posição de soltar. No `mouseup`, o card real volta pro lugar do placeholder, o clone e o placeholder somem juntos, e `persistOrder()` roda como antes. `.prod-card-floating` tem `max-height:70vh;overflow:hidden` pra um card expandido (tabela grande) não cobrir a tela inteira enquanto é arrastado. Mesma reescrita aplicada em `produtos.html` e `estoque.html` (mecanismo idêntico nos dois, só o nome da chave de `localStorage` em `persistOrder()` muda).
- **Imagem do produto por canal:**
  - Shopify (BR/US): `LineItem.image.url` já vem na mesma query GraphQL de pedidos — sem custo extra.
  - Shopee: `item_list[].image_info.image_url` já vem no `get_order_detail` — sem custo extra.
  - Mercado Livre: **não** vem no pedido. `fetchOrders()` faz uma chamada em lote extra (`GET /items?ids=...`, multiget de até 20 ids) para resolver `thumbnail` por `item.id`, mesmo padrão já usado para resolver `state` via `/shipments/{id}`. Falha graciosamente (sem imagem) se o item não for encontrado. **Esse mesmo lote também resolve `o.listingType`** (Clássico/Destaque, ver 4.6) a partir de `listing_type_id` do recurso do item — campo que não existe na resposta de `/orders/search`.
  - Amazon (BR/US): nome real já vem do backfill (ver 4.7.5), mas **imagem nunca vinha de nenhum lugar** — nem a Orders API nem o relatório de backfill trazem URL de imagem. **Implementado 15/07/2026:** `fetchProductImages(asins, market, onProgress)` em `amazon.js` consulta o **Catalog Items API** (`GET /catalog/2022-04-01/items/{asin}?includedData=images`), um lookup por ASIN — balde de cota próprio, não concorre com `/orders` nem `/reports`. Throttle fixo de 600ms entre chamadas (deliberadamente conservador dado o histórico de 429 desta conta, ver 4.7.2/4.7.4) e até 3 tentativas por ASIN em caso de 429. Resultado cacheado em `kv.amazonProductImages` (`{ asin: url }`), consultado por `aggregateProductsByChannel()` em `metrics.js` via `it.asin` (fallback quando `it.image` não veio). **Pré-requisito:** `ordersFromRows()` (backfill) agora também captura `asin` por item (coluna `asin` do relatório) — pedidos que vieram só do sync contínuo (Orders API) não têm `asin`/título (ver 4.7.6) e continuam sem imagem até passarem por um backfill. **Endpoint:** `POST /api/amazon/images?market=us|br` — roda em background (um ASIN por vez), responde na hora, progresso em `GET /api/status` → `amazon.images`. Não dispara backfill sozinho: se não houver ASIN novo pra buscar, retorna aviso pedindo pra rodar o backfill primeiro. **Só funciona depois de rodar um backfill/re-backfill após esse deploy** (para os pedidos já existentes ganharem `asin`) — merge sozinho não faz nada aparecer, é preciso chamar `POST /api/amazon/backfill?days=90&market=us` e depois `POST /api/amazon/images?market=us` em produção.
  - **⚠️ BLOQUEIO (confirmado em produção 15/07/2026) — Catalog Items API dá 403:** rodar
    `POST /api/amazon/images` retornou "0 de 35 imagens". O diagnóstico `GET /api/amazon/probe-image?market=us`
    devolveu **HTTP 403 "Access to requested resource is denied"** para todo ASIN. Causa: o app SP-API
    "Dashboard Amazon" só tem os roles de **Orders** e **Reports** — a Catalog Items API exige o role
    **"Product Listing"** (destrava Catalog Items + Listings Items), que o app não tem. **Não é código.**
    Correção (só no portal, feita pelo Luan): Solution Provider Portal → app "Dashboard Amazon" → Edit App →
    marcar role **"Product Listing"** → salvar → **re-autorizar** o app (o refresh token atual não carrega o
    novo escopo) e atualizar `AMAZON_REFRESH_TOKEN` (US) / `AMAZON_BR_REFRESH_TOKEN` (BR) no Railway. Depois,
    sem mudar código: `POST /api/amazon/images?market=us` preenche as imagens. Endpoint de diagnóstico
    `GET /api/amazon/probe-image?asin=&market=` mostra a resposta crua do Catalog Items API.
  - **Bug corrigido no mesmo dia — produto fantasma "-" com receita 0:** algumas linhas do relatório da Amazon trazem `product-name` como o literal `"-"` (frete/serviço/ajuste, sem produto de verdade) — não é vazio, então passava batido pelo filtro `if (r['product-name'])` e virava um "produto" chamado "-" agregando dezenas/centenas de unidades com receita R$0/US$0 (confirmado pelo Luan: linha "-" com 156 unidades, $0). Corrigido em dois pontos: `ordersFromRows()` em `amazon.js` agora descarta `product-name` igual a `"-"` na origem (novos backfills não geram mais essa linha), e `aggregateProductsByChannel()`/o loop de Segmentos em `metrics.js` também tratam `it.title.trim() === '-'` como ausente (mesmo efeito de `!it.title`) — isso corrige a exibição imediatamente para pedidos **já gravados** em produção, sem precisar rodar backfill de novo.
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

#### 4.13.2 Exportar quantidade vendida — só Shopify US por enquanto (implementado 03/08/2026)
- Botão "Exportar" (canto superior do card, ao lado do título) só aparece nos canais de
  `EXPORTABLE_PRODUCT_CHANNELS` (hoje só `shopify_us`, tanto em `produtos.html` quanto no endpoint —
  os outros canais ganham o botão quando o backend abrir, sem mudança de contrato). Pedido explícito
  do Luan de escopo reduzido ("por enquanto, vai ser apenas do Shopify dos EUA").
- **`GET /api/products/export?market=us&channel=shopify_us&since=&until=`** (`server.js`) reaproveita
  `computeProducts()` — a mesma agregação que já alimenta a tela (exclui cancelado, já desconta
  devolução via `LineItem.currentQuantity`, ver 4.15) — em vez de duplicar a lógica de contagem, então
  a planilha exportada sempre bate com o que a tela mostra. Colunas: Produto, Quantidade vendida,
  Receita (US$), Ticket médio (US$). CSV com `;` + BOM UTF-8 (mesmo padrão de 4.9b), abre direto no
  Excel pt-BR sem assistente de importação.
- **Verificação de correção dos dados (pedido explícito do Luan, "veja se ele pega apenas as vendas
  certa"):** somar a receita exportada linha a linha divergia do total que a própria tela de Produtos
  já reportava pro canal (US$ 16.196 vs US$ 7.364) — não era bug da exportação, era um problema
  pré-existente em `aggregateProductsByChannel`, só mais visível numa planilha. Corrigido generalizando
  `itemRevFactor` (ver 4.7.6) pra zerar receita de pedido `total:0` com item de preço de catálogo —
  padrão de fulfillment por atacado (`customer: "Walmart DFW6s"`), não exclusivo da Amazon. Depois da
  correção, a soma bate com o total do canal; unidades vendidas não mudam (só a receita é afetada).

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
- **Amazon — placeholder "Produto TESTE":** o **US já tem nome de produto** (Reports API, ver 4.7.6), mas o
  **BR ainda vem incompleto** (só via `getOrderItems`; pedidos `701-/702-` dão 400 — ver 4.7.9 / backlog aberto 3).
  Quando `catalogByChannel[amazonCh].products` fica vazio (Amazon BR sem itens em TODO o histórico, não só nos
  últimos 30 dias — ver merge de catálogo abaixo), `computeStock()` injeta uma linha sintética `"Produto TESTE"`
  (métricas de venda zeradas) nesse canal pra não bloquear o controle manual de estoque — editável como qualquer
  produto, mas excluída do card agregado (ver acima). Some sozinho quando o canal passa a ter produto real.
- **⚠️ Bug corrigido (17/07/2026) — Estoque mostrava muito menos produtos que Produtos (144 vs 33 no EUA):**
  `computeStock()` só agregava pedidos da **janela fixa de 30 dias** — um produto sem NENHUMA venda nesse período
  simplesmente não gerava linha, mesmo tendo `stock`/`incoming` cadastrados manualmente em `kv.productStock` (o
  dado continuava salvo, só ficava inacessível pela UI). `computeProducts()` (Produtos) já mesclava com o catálogo
  completo do canal (todo o histórico, sem filtro de data — ver 4.13) desde 15/07; `computeStock()` nunca ganhou
  esse merge. No EUA a diferença ficava enorme porque a Amazon US foi populada por um **backfill de 365 dias**
  (ver 4.7.5/4.7.7) — muitos ASINs venderam alguma vez no ano mas não nos últimos 30 dias. **Mesmo mecanismo
  válido pra BR e qualquer canal** (código é `market`-agnóstico), só que com magnitude menor lá por causa do
  catálogo/histórico bem menor. **Correção:** `computeStock()` agora também busca `catalogByChannel` (todo o
  histórico, mesmo padrão de `computeProducts`) e mescla com a janela de 30 dias — produto sem venda recente
  continua aparecendo, com `salesDaily`/`salesMonth` zerados mas `stock`/`incoming` preservados. O card "Estoque"
  agregado (por família) passou a reaproveitar essa mesma lista já mesclada em vez de reagregar só a janela de
  30 dias, então ganha a correção também. Testado localmente: produto com pedido só há 6+ meses e `stock`/
  `incoming` cadastrados manualmente aparece na tabela com vendas zeradas e o estoque intacto (antes, sumia).
- **"Unificar" no card agregado "Estoque" (implementado 30/07/2026, ajustado no mesmo dia — ver abaixo):**
  mesma função de agrupamento manual já usada em Segmentos (ver 4.7.6, "Unificar"), adicionada ao card
  "Estoque" — reaproveita o endpoint genérico `/api/product-groups` (market-agnóstico, sem mudança de
  backend pra isso). Útil pra juntar famílias que `classifyFamily()` não reconhece como o mesmo produto
  (ex: um item que não bate com "lisina"/"daily" e acaba com o próprio título como família própria,
  fragmentado do resto — inclusive entre marcas diferentes, ex: Yucaloo, ver `project_yucaloo_segunda_marca`
  na memória). Botões "Unificar" (mostra os grupos já criados como uma linha só) e "Selecionar" (força a
  visão crua, com checkbox por linha; 2+ selecionados abre um modal pra nomear o grupo) no topo da tabela —
  mesmo padrão visual/CSS de Segmentos, prefixo de classe `stk-` em vez de `geo-`. Um badge (🔗 N) ao lado
  do nome abre o modal "produtos no grupo" (lista os membros com venda/estoque reais de referência, botão
  "✕" pra tirar um membro e "Desfazer unificação" pra apagar o grupo inteiro).
  - **Vendas/dia, Vendas/mês, Estoque, Recebendo e Meses de Estoque** na linha unificada são a SOMA real
    dos membros (dado de venda/estoque físico — sem ambiguidade em somar, `mergeStockGroups()` no cliente).
  - **⚠️ Ordem Projetada/Nova/Andamento — corrigido no mesmo dia (30/07/2026):** a 1ª versão também somava
    esses 3 campos e os deixava só leitura na linha unida (exigia abrir o modal e editar produto por
    produto). O Luan pediu o oposto: "já que se tratam do mesmo produto, devemos ter esse controle
    enquanto eles estão unificados" — ou seja, depois de unificar, ele quer digitar UM valor pro grupo
    inteiro, direto na linha, não um valor por marca/canal que soma sozinho. **Correção:** esses 3 campos
    NÃO somam mais os membros — o **nome do grupo** passou a funcionar como uma família própria só pra
    eles, igual Lysine/Daily. `computeStock()` (`metrics.js`) calcula `agg.groupOrders = { [nomeDoGrupo]:
    {orderInProgress, orderNew, projected} }` lendo `kv.productStockAgg["market|||NomeDoGrupo"]` (mesma
    chave que `POST /api/stock/agg-finance` já grava) pra cada grupo existente (`getProductGroups()`) —
    e devolve isso dentro de `/api/stock`. No cliente, `mergeStockGroups()` usa esse valor em vez de somar
    os membros, e a linha unida renderiza os 3 inputs **editáveis normalmente** (`data-title` = nome do
    grupo) — mesmo `onStockAggEdit`/`POST /api/stock/agg-finance` de sempre, sem caso especial: editar
    grava em `market|||NomeDoGrupo`, e o próximo load lê de volta do mesmo lugar via `groupOrders`. Round
    -trip estável mesmo quando o nome do grupo não bate com nenhuma família real de venda.
  - `mergeStockGroups()` nunca toca nos totais do rodapé da tabela (`current.agg.totals`, sempre a soma
    real por família vinda do servidor, sem passar pelo agrupamento manual) — a unificação é só uma visão
    de agrupamento, o dado bruto por família continua existindo por trás pra qualquer conferência.
  - **⚠️ Superado (05/08/2026):** os botões "Unificar"/"Selecionar" e os dois modais (nomear grupo,
    gerenciar grupo) foram removidos desta tela — a unificação virou **global**, gerida em
    `unificador.html` (Configurações). `agg.products` já chega do backend agrupado por grupo manual
    (com prioridade sobre a família automática Lysine/Daily) — `mergeStockGroups()` no cliente não
    existe mais. Os 3 campos de ordem continuam **editáveis direto na linha**, exatamente como descrito
    acima (o mecanismo de `groupOrders` não mudou) — só a criação/gestão do grupo saiu daqui. Ver 4.18.
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
  `produtos.html`. Isso expôs um problema estrutural do projeto — **resolvido em 15/07/2026** movendo
  todo o CSS da sidebar para o `sidebar.js` (ver 4.9 e Resolvidos na seção 9); esse tipo de bug não
  pode mais acontecer, já que a página não declara mais o CSS da sidebar.

### 4.17 Tela de Integrações — `public/integracoes.html` (implementado 29/07/2026)
- **Acesso:** dentro de Configurações (`configuracoes.html` ganhou uma seção nova com botão "Ver
  integrações"), não é item próprio da barra lateral. Admin only, mesmo padrão de guarda de
  `configuracoes.html` (client em `sidebar.js` `applyAuth()`, servidor no portão de acesso e no
  `SLUG_TO_FILE`/redirect de `server.js`).
- **O que mostra:** cada integração (Shopify, Shopee, Mercado Livre, Amazon, Meta Ads, Google Ads,
  Bling), agrupada por país (Brasil/Estados Unidos) e por categoria (Geral/Marketing), com selo de
  status ao vivo (Conectada, Aguardando autorização, Não configurada, Pausada só Amazon com backoff
  ativo, Desativada) e um switch por integração. Inclui também Amazon Ads (BR e EUA) e TikTok Shop
  (BR) como "Planejadas", sem switch, só o selo "Em breve" — ainda não têm nenhum código de
  integração por trás.
- **`GET /api/integrations`** (admin) monta a lista reaproveitando os mesmos checks já usados em
  `/api/status` (`isConfigured()`/tokens salvos de cada módulo) mais o liga/desliga persistido.
  **`POST /api/integrations/:key/toggle`** (admin) valida a chave contra uma allowlist
  (`TOGGLEABLE_KEYS`) e grava.
- **Persistência:** `kv.integrationsConfig` (`{ [chave]: { enabled } }`), mesmo padrão de
  `authConfig` — `getIntegrationsConfig`/`setIntegrationEnabled`/`isIntegrationEnabled` em
  `store.js`. **Opt-out por padrão:** sem registro salvo pra uma chave, `isIntegrationEnabled`
  devolve `true` — a feature nunca desativa sozinha uma integração já funcionando.
- **O switch tem efeito real**, não é só visual: `sync.js` (`doSync`) checa
  `isIntegrationEnabled()` antes de cada bloco de canal (`shopify_br`, `shopify_us`, `shopee`,
  `mercadolivre`, `mercadolivre_ads`, `meta_br`, `meta_us`) e pula o bloco inteiro se desativado —
  o pedido pulado entra em `report.disabled` (informativo), não em `report.errors`. `/api/campaigns`
  ganhou a mesma checagem pra `meta_br`/`meta_us`/`mercadolivre_ads`/`google_ads` (chamada ao vivo da
  tela de Campanhas), pra desligar valer também ali, não só no sync agendado.
- **Amazon BR/EUA — decisão deliberada de não mexer em `amazon.js`:** `fetchOrders()` busca os dois
  mercados numa chamada só (ou duas, dependendo de `SAME_TOKEN`) e devolve tudo junto — não dá pra
  desligar só um lado por dentro dessa função sem tocar na parte mais frágil e sensível do projeto
  (histórico extenso de incidentes, ver 4.7). Em vez disso, `sync.js` filtra o array **depois** que
  `fetchOrders()` já respondeu, conforme `isIntegrationEnabled('amazon_br')`/`'amazon_us'`, antes do
  `upsertOrders`. Efeito real (pedido daquele mercado para de ser gravado), mas **a chamada de rede
  em si continua acontecendo pros dois mercados** mesmo com um desativado — não reduz a cota
  consumida, só o que é gravado no banco. Documentado assim de propósito, sem tentar otimizar isso
  agora.
- **Bling:** o toggle desativa tanto a rodada automática quanto a manual (`force`) de
  `reconcileGeoFromBling` — desativado é desativado, mesmo forçando pelo endpoint de diagnóstico.
- **Fora do escopo desta rodada:** os jobs de reconciliação da Amazon (`reconcileAmazonNames`,
  `enrichAmazonItems`, backfill, imagens) não respeitam o toggle — continuam rodando mesmo com
  Amazon BR/EUA desativado. São enriquecimento patch-only, de baixo risco, e desligá-los também
  expandiria o escopo sem necessidade real agora.
- **Logos:** `public/logos-integracao/` (pasta nova, o Luan subiu os arquivos). Nomes reais não
  seguem um padrão único (`Shopify_logo.png`, `logo-shopee.png`, `Logotipo_MercadoLivre.png` etc.) —
  mapeados um a um em `computeIntegrationsList()` (`server.js`). `<img onerror>` troca por um ícone
  Bootstrap Icons genérico por categoria se o arquivo não carregar, então nada quebra se um nome
  mudar.

### 4.18 Unificador — agrupamento manual global de produtos (implementado 05/08/2026)
- **Antes:** a unificação manual de produtos entre canais ("mesmo produto físico, nomes diferentes
  por canal") existia separada em duas telas — Segmentos (card "Onde os produtos vendem", ver
  histórico em 4.7.6) e Estoque (card agregado "Estoque", ver 4.14) — cada uma com seu próprio botão
  Unificar/Selecionar, modal de criação de grupo e lógica de merge **no cliente**. Pedido do Luan:
  centralizar num lugar só, aplicar automaticamente em **todas** as telas que mostram produto
  (Revenue/Top Produtos, Segmentos, Produtos, Estoque), e um liga/desliga global (padrão ligado).
- **Nova tela `public/unificador.html`** (admin only, mesmo padrão de `configuracoes.html`/
  `integracoes.html` — gate em `server.js` linha do portão de acesso + `sidebar.js` `applyAuth()`,
  não entra em `auth.PAGES`): lista **todo o catálogo** do mercado selecionado (todos os canais, todo
  o histórico, via `GET /api/product-groups/catalog?market=`) organizado por **grupo** — cada grupo
  já criado aparece como um card com seus membros (miniatura, canal, unidades/receita de referência,
  botão "✕" pra tirar um membro, "🗑" pra desfazer o grupo inteiro, "+ Adicionar produtos" pra somar
  mais um produto a ele depois); os produtos sem grupo ficam numa lista única abaixo, com busca por
  título e um modo **Selecionar** (checkbox por linha, mínimo 1 selecionado — diferente do mínimo 2
  das versões antigas em Segmentos/Estoque, porque aqui um único produto selecionado também serve pra
  **adicionar a um grupo já existente**, não só criar um novo). Acessível a partir de Configurações
  (`configuracoes.html`, seção "Unificador", botão "Abrir Unificador").
- **Liga/desliga global** (`kv.productGroupsConfig.enabled`, padrão **ligado** quando ausente — mesmo
  padrão opt-out de `isIntegrationEnabled`): switch tanto em `configuracoes.html` (seção "Unificador")
  quanto na própria `unificador.html` (os dois batem no mesmo endpoint, refletem o mesmo estado).
  `GET/POST /api/product-groups/config`. Desligado, **todas** as telas voltam a mostrar os produtos
  sem agrupar — o merge no backend simplesmente não roda (`activeProductGroups()` devolve `{}`).
- **Modelo de dados inalterado:** continua `kv.productGroups` (`{ [market]: { [nomeDoGrupo]:
  [tituloBruto,...] } }`, ver `store.js` `getProductGroups`/`upsertProductGroup`/
  `removeFromProductGroup`/`deleteProductGroup`) — só o **liga/desliga** (`productGroupsConfig`) é
  novo. Endpoints de CRUD de grupo (`GET/POST/DELETE /api/product-groups*`) são os mesmos de antes,
  só que agora **admin only** (`requireAdmin`), já que a única tela que os chama é `unificador.html`.
- **Aplicação passou de client-side (por tela) para server-side (uma vez só, em `metrics.js`):**
  `applyProductGroups(list, groups, opts)` é uma função genérica — soma campos numéricos (`sumKeys`),
  soma objetos chave→número (`objSumKeys`, ex: `comboBySize`), soma arrays de sub-linhas por id
  (`arrayKeys`, ex: `byChannel`/`byState`), junta valores únicos de um campo num array (`collectKeys`,
  ex: canais presentes no grupo) e usa o primeiro valor não-nulo entre os membros pra metadado
  (`pickFirst`, ex: imagem/tipo). `activeProductGroups(market)` já filtra pelo liga/desliga. Aplicada
  em quatro pontos:
  - **`computeDashboard` → `topProducts`/`topProductsAll`:** merge **entre canais** (linhas eram por
    canal×título). Linha agrupada ganha `channels: [...]` (lista, não mais um `channel` singular) —
    `index.html` mostra um badge por canal presente em vez de um só. Badge extra 🔗 N mostra os
    membros (tooltip).
  - **`computeDashboard` → `productGeo` (Segmentos, "Onde os produtos vendem"):** mesmo mecanismo que
    já existia (ver histórico em 4.7.6), só que agora client-side virou server-side — `segmentos.html`
    perdeu o botão Unificar/Selecionar/modal de criação e o `mergeProductGroups()` local; só exibe
    `p._grouped`/`p._members` (badge 🔗, painel expandido lista os membros só leitura com link
    "gerenciar" pra `/unificador`).
  - **`computeProducts` (Produtos, um card por canal):** merge **dentro do mesmo canal** (dois títulos
    do mesmo canal que descrevem o mesmo produto). `mergeProductRows()` — helper próprio, não usa o
    genérico, porque precisa decidir o que fazer com os campos financeiros (COG/frete/%imposto/
    %comissão são **por produto**, editáveis inline): soma qty/receita/lucro (lucro só quando algum
    membro tem COG preenchido, mesmo critério do total do canal), mas os 4 campos editáveis viram
    `null`/"—" na linha unificada — a tela desabilita o `<input>` nela (edição continua normal em cada
    produto individual, fora do grupo).
  - **`computeStock` → `agg.products` (card agregado "Estoque", por família):** grupo manual tem
    **prioridade** sobre a família automática por palavra-chave (Lysine/Daily, `classifyFamily`) —
    `titleToGroup[título] || classifyFamily(título) || título`. `estoque.html` perdeu o botão Unificar/
    Selecionar/os dois modais e o `mergeStockGroups()` local — `agg.products` já chega agrupado do
    backend. Os 3 campos de ordem (Projetada/Nova/Andamento) continuam editáveis **um valor por linha**
    (pedido do Luan: "já que o grupo vai ter os mesmos produtos" — não há por-membro pra editar aqui,
    nunca houve; o nome do grupo já funcionava como família própria pra esses 3 campos desde 4.14,
    via `groupOrders`, inalterado). `_grouped`/`_members` só são marcados quando a família bate com um
    nome real de grupo manual (`productGroupsMkt`) — a família automática (Lysine/Daily) nunca teve
    badge, e continua sem.
  - **Não aplicado** ao Card "Estoque" por canal (`channels[ch].products` em `computeStock`) nem a
    `channels[ch].products` cru de `computeProducts` antes do merge — cada um só usa o merge no nível
    que fazia sentido pro pedido original (por-canal em Produtos, agregado-por-família em Estoque).
  - **Cuidado de correção (achado testando, não durante uso normal):** `applyProductGroups` guarda
    **todas** as linhas por título antes de juntar por grupo, não só a última — necessário porque
    `topProducts`/`topProductsAll` têm uma linha por combinação canal×título, e um título de grupo
    coincidindo em 2 canais (raro, mas possível) perderia a receita de um deles se o lookup guardasse
    só uma linha por título. `productGeo`/`computeProducts` não têm esse risco (já vêm com título único
    por linha antes do merge), mas o guard genérico protege todos os chamadores igual.
- **Testado localmente (05/08/2026, sem rede — só `store.js`+`metrics.js` contra o catálogo real do
  `data/db.json`, sem subir o servidor pra não disparar o sync automático em cima de credenciais de
  produção salvas no `.env` local, ver aviso em 4.7.4):** criado um grupo de teste com 2 produtos
  reais (Shopify BR) → confirmado aparecendo agrupado em `topProductsAll` (com `channels`), em
  `computeProducts` (por canal, com `cog:null`), em `computeStock.agg.products` (com `_grouped`/
  `_members`) e em `productGeo` (com `byChannel`/`byState` somados corretamente); desligando o toggle
  global, a linha agrupada some de `topProductsAll` (volta a mostrar separado); grupo de teste
  removido ao final, `data/db.json` conferido limpo.
- **⚠️ Bug corrigido no mesmo dia (05/08/2026) — "ficou sem unificar" em Segmentos:** o "Top produtos"
  de cada card (Gato/Cão, topo do card, ANTES do card "Onde os produtos vendem") lê `segments[k].
  topProducts`, uma quarta lista agregada por produto (`segAcc[seg].products` em `computeDashboard`)
  que ficou de fora da rodada acima por engano — só `topProducts`/`topProductsAll`, `productGeo` e
  `computeProducts`/`computeStock` foram cobertos. Reportado pelo Luan com print mostrando as
  variações de "Lisina para gatos" todas separadas ali, mesmo com o grupo criado. Corrigido: `p[title]`
  dentro de `segAcc[seg].products` passou a guardar `type` também, e a lista final passa pelo mesmo
  `applyProductGroups()` antes de virar `segments[k].topProducts`. Testado localmente (mesmo método
  sem rede): grupo de teste aparece agrupado dentro de `dash.segments.cat.topProducts`.
- **Top produtos separado por tipo (implementado 05/08/2026, mesmo pedido):** o Luan pediu pra
  organizar essa mesma lista por tipo de produto em vez de uma lista só misturando areia (marca
  Yucaloo, ver `project_yucaloo_segunda_marca` na memória) com suplementos (Lysine/Daily/etc) —
  clicar no tipo abre/fecha o que já existia. `segmentos.html`: `prodByTypeGroupHtml()` substitui a
  renderização direta — separa em baldes por `p.typeGroup` (ver "Tipos de produto" abaixo), ordena os
  baldes por unidades desc, e renderiza cada um como um bloco `.seg-type-group` com cabeçalho
  clicável (nome + contagem + soma) e chevron; só o maior balde vem aberto por padrão na 1ª
  renderização de cada card (`segTypeOpen`, mesmo princípio de "só o primeiro aberto" já usado em
  Produtos/Estoque — ver 4.13), resetado ao trocar mercado/canal. O "ver mais/ver menos" de cada
  balde (`segExpanded`) passou a usar uma chave composta (`'cat__NomeDoTipo'`) em vez de só `'cat'`,
  então cada tipo dentro do mesmo card mostra/esconde independente do outro. O card "Por tipo de
  produto" (pills finas: Pó/Tablets/etc, `s.byType`) não mudou — é uma métrica complementar diferente
  (granularidade mais fina, sempre por `classifyType`/`TYPE_KW`, nunca editável), continua abaixo.
  - **⚠️ Superado no mesmo dia — "Areia x Suplementos" era hardcoded, virou dinâmico:** a 1ª versão
    tinha `classifyTypeGroup(type)` decidindo por código (`type` contém "areia" → Areia, senão
    Suplementos, só essas duas). O Luan pediu pra generalizar: "Vamos criar uma função de criar esses
    tipos na dashboard, para que não seja algo fixo no código" — e que a busca seja "nas tags do
    produto, no nome, em qualquer lugar", não só no `productType` já normalizado. Ver 4.19 — é a
    versão atual, sem nada fixo no código.

### 4.19 "Tipos de produto" — regras de palavra-chave criadas pela UI (implementado 05/08/2026)
- Substitui o `classifyTypeGroup` hardcoded do item acima (mesmo dia) por um sistema onde o próprio
  usuário cria as categorias, pela tela — botão no cabeçalho de Segmentos (`#manageTypesBtn`, canto
  direito do título "Segmentos") abre um modal (`#trModal`) pra criar/editar tipos: nome do tipo +
  uma ou mais palavras-chave por tipo. Não é admin-only (ao contrário do Unificador, ver 4.18) —
  qualquer usuário com acesso a Segmentos usa.
- **Modelo de dados:** `kv.productTypeGroups` (`store.js`): `{ [market]: { [nomeDoTipo]:
  [palavraChave,...] } }` — mesmo formato de `productGroups`, mas SEM a exclusividade de "um item só
  pode estar num grupo" (não faz sentido pra palavra-chave: nada impede duas regras diferentes de
  baterem no mesmo produto, a primeira criada vence). `getProductTypeGroups`/`upsertProductTypeGroup`
  (une palavras-chave a um tipo, cria se não existir)/`removeProductTypeKeyword`/
  `deleteProductTypeGroup`.
- **`classifyTypeGroup(it, market)`** (`metrics.js`, reescrita — antes recebia só `type` já
  processado, agora recebe o item cru): monta um "haystack" com `it.title` + `it.productType` +
  TODAS as `it.tags` (array, já vem em cada line item do Shopify — mesmo campo que `classifySeg` usa
  pra Gato/Cão, ver 4.1) e testa `.includes()` (case-insensitive) da palavra-chave de cada regra, na
  ordem em que os tipos foram criados — primeira que bater vence. Nenhuma regra cadastrada, ou
  nenhuma batendo, cai em `'Outros'` (nunca quebra, sempre uma string). Calculado dentro do loop que
  já monta `segAcc[seg].products` (guardado como `p[title].typeGroup`, "primeiro valor vence" se o
  mesmo título aparecer em mais de um pedido — mesmo padrão de `p[title].type`).
  - **⚠️ Correção no mesmo dia — grupo do Unificador perdia o tipo se só UM canal tivesse a
    palavra-chave:** reportado pelo Luan — criou o tipo "Suplemento" com a palavra "suplemento", e
    dentro do grupo "Lysine" (unificado entre canais, ver 4.18) só o Daily entrou no tipo; o Lysine
    ficou em "Outros", porque só a listagem do Shopify tinha a palavra nas tags/título — Mercado Livre/
    Shopee descrevem o produto diferente. A 1ª versão usava `pickFirst: ['type', 'typeGroup']` em
    `applyProductGroups` — "primeiro valor não-nulo, na ordem dos membros" —, e o membro processado
    primeiro por acaso não batia na regra. **Correção:** `applyProductGroups` ganhou a opção
    `preferNonDefault: [{ key, default }]` — em vez de "primeiro valor", pega o primeiro membro cujo
    valor seja DIFERENTE do padrão (`'Outros'`), varrendo TODOS os membros, não só o primeiro. Raciocínio
    do Luan, direto: "como cada grupo vai ter um só produto [físico], acredito que podemos adicionar o
    grupo a esse tipo quando pelo menos um produto tem essa palavra-chave" — é exatamente essa a regra.
    `typeGroup` passou de `pickFirst` pra `preferNonDefault: [{ key: 'typeGroup', default: 'Outros' }]`
    na montagem de `segments[k].topProducts`; `type` (usado só para exibição, sem essa ambiguidade)
    continua em `pickFirst`. Testado localmente: grupo com 2 membros, palavra-chave batendo só num
    deles → grupo inteiro classificado no tipo certo.
- **Endpoints** (não admin-gated, mesmo padrão de `/api/products/finance`): `GET /api/product-types
  ?market=` lê as regras do mercado. `POST /api/product-types` (`{market,name,keywords}`) cria/
  adiciona palavra(s) a um tipo. `POST /api/product-types/remove-keyword` (`{market,name,keyword}`)
  tira uma palavra-chave (tipo sem nenhuma palavra-chave some sozinho, mesmo comportamento de
  `productGroups`). `DELETE /api/product-types?market=&name=` apaga o tipo inteiro.
- **Escopo desta rodada:** só Segmentos (onde o tipo já era usado). O modelo já nasceu genérico o
  bastante (mesmo formato de `productGroups`) pra reaproveitar em outras telas se pedido depois.
- **Testado localmente (sem rede, mesmo método das rodadas acima):** sem nenhuma regra cadastrada,
  todo produto cai em `'Outros'`; criando um tipo "Suplemento" com a palavra-chave "lisina", os
  produtos com "lisina" no título migram pra esse balde e o resto continua em "Outros"; apagando o
  tipo, tudo volta a `'Outros'`.

### 4.20 Yucaloo — 2ª marca, integração Shopify em andamento (iniciada 06/08/2026)
- **Yucaloo é uma marca própria da Vita Pet Life, distinta da Coco and Luna**, com loja(s) Shopify
  separadas (BR confirmado; US mencionado pelo Luan, ainda não configurado).
- **⚠️ Decisão de negócio (confirmada pelo Luan, 06/08/2026) — NÃO existe (por enquanto) uma dimensão
  de "marca" separada de `market`:** a suposição inicial era que, como a Yucaloo convive no mesmo país
  (BR) que a Coco and Luna, seria necessário um campo `brand` novo e ortogonal ao `market` de sempre,
  tocando `store.js`/`shopify.js`/`metrics.js`/`server.js`/UI. **O Luan corrigiu isso:** no Brasil a
  Yucaloo é vendida junto com os mesmos marketplaces da Coco and Luna, e ele quer ver tudo junto ao
  escolher só "Brasil"/"EUA" — sem escolher marca e depois país. Por isso os pedidos da Yucaloo usam
  o **mesmo `market`** (`'br'`/`'us'`) que a Coco and Luna, só com `channel` próprio
  (`'yucaloo_br'`/`'yucaloo_us'`) pra manter rastreável de onde vieram. Ver o histórico completo
  dessa decisão (e a reversão de uma tentativa inicial de isolar por `market`) mais abaixo, no bloco
  "Sync de pedidos ligado". Uma dimensão de marca de verdade só faria sentido "quando tiver mais
  marcas" (palavras do Luan) — não é um problema a resolver agora.
- **Diferença-chave do app Shopify da Coco and Luna:** a loja Yucaloo BR já nasceu no sistema **Dev
  Dashboard novo da Shopify** (`dev.shopify.com/dashboard`) — o botão clássico "Desenvolver apps"
  dentro do admin da própria loja (usado pela Coco and Luna, ver seção 6) hoje só redireciona pra lá,
  sem opção de criar um app customizado clássico. Isso muda o fluxo de autenticação por completo:
  - **Coco and Luna:** app customizado clássico → instala na loja → Shopify mostra um **Admin API
    access token estático** (`shpat_...`) na hora, sem OAuth nenhum. Token nunca expira, é só colar
    no `.env` (`SHOPIFY_ADMIN_TOKEN`/`SHOPIFY_US_ADMIN_TOKEN`).
  - **Yucaloo:** app criado na Dev Dashboard → tem Client ID/Secret (como Mercado Livre/Google Ads),
    e **exige um handshake OAuth de verdade** — mesmo marcando "Usar fluxo de instalação legado" na
    configuração do app (o que, na prática, testamos e não eliminou a necessidade do handshake).
- **⚠️ Descoberta (06/08/2026) — clicar "Instalar app" na Dev Dashboard NÃO dá o token direto:** ao
  contrário do fluxo clássico, clicar "Instalar app" → escolher a loja não abre uma tela de permissões
  com um botão "Instalar" — a Shopify chama direto a **"URL do app"** configurada, com os parâmetros
  `hmac`, `host`, `shop`, `timestamp` assinados na query string (sem `code`, sem `state` — não é um
  callback OAuth pronto). Isso é o "bounce" padrão que a Shopify manda pra abrir/instalar um app: cabe
  ao **próprio app** (nosso servidor) validar essa assinatura e então redirecionar o navegador pra
  `https://{shop}/admin/oauth/authorize?...` — só depois disso a Shopify chama de volta o
  `redirect_uri` cadastrado, aí sim com `?code=...`, pra trocar por um access_token de verdade.
  Confirmado ao vivo: configurar a "URL do app" como a raiz do domínio ou preencher o campo errado
  (URL do app vs. URLs de redirecionamento — são coisas diferentes, fáceis de confundir na tela nova)
  só fazia a Shopify bater na raiz do site sem nenhum efeito.
- **`src/shopifyYucaloo.js` (implementado 06/08/2026):** só o handshake, nada de leitura de pedidos
  ainda. Um app por mercado (mesmo padrão da Amazon BR/US — `creds(mkt)` lê
  `YUCALOO_<MKT>_CLIENT_ID`/`_CLIENT_SECRET`/`_REDIRECT_URL` do `.env`).
  - `verifyRequest(mkt, req)` — valida a assinatura HMAC-SHA256 que a Shopify manda (mesmo algoritmo
    nos dois casos: bounce da URL do app e callback do OAuth). **Recebe o `req` inteiro, não
    `req.query`** — de propósito: o parser padrão do Express (`qs`) trata `+` como espaço, e o
    parâmetro `host` vem em **base64** (alfabeto que usa `+`) — decodificar pelo caminho normal
    quebraria a verificação toda vez que `+` aparecesse no meio do base64. A função reconstrói a query
    a partir de `req.originalUrl` e decodifica com `decodeURIComponent` puro, sem essa armadilha.
  - `buildAuthorizeUrl(mkt, shop, state)` — monta a URL de `/admin/oauth/authorize` da loja.
  - `exchangeCode(mkt, shop, code)` — troca o `code` do callback pelo access_token permanente
    (offline, não expira — mesmo tipo de token que o app clássico já dava direto), salva em
    `kv.yucalooTokens[mkt] = { shop, accessToken, scope, obtainedAt }` (`store.js`
    `getYucalooTokens`/`setYucalooTokens`, mesmo padrão de `googleAdsTokens`/`mlTokens`).
- **Rotas em `server.js`** (liberadas do portão de login como as outras OAuth, prefixo
  `/shopify-yucaloo/`, ver 4.16): diferente de `/mercadolivre/connect` etc. (que o usuário clica), aqui
  quem chama é a própria Shopify.
  - `GET /shopify-yucaloo/:mkt(br|us)/connect` — recebe o bounce da Shopify, valida a assinatura,
    gera um `state` (cookie CSRF, mesmo padrão de `oauth_state_ml`/`oauth_state_google`) e redireciona
    pro `/admin/oauth/authorize` da loja.
  - `GET /shopify-yucaloo/:mkt(br|us)/callback` — valida o `state` (cookie) + a assinatura de novo,
    troca o `code` pelo token via `exchangeCode`.
- **Configuração exigida no app da Dev Dashboard** (aba do app → versão → campos "URLs"): **"URL do
  app"** = `https://live-dashboard-vitapetlife.up.railway.app/shopify-yucaloo/br/connect` (não a raiz
  do domínio — tem que ser esse caminho específico, é ele que recebe o bounce e inicia o OAuth).
  **"URLs de redirecionamento"** = `https://live-dashboard-vitapetlife.up.railway.app/shopify-yucaloo/br/callback`
  (tem que bater exatamente com `YUCALOO_BR_REDIRECT_URL` do `.env`/Railway). "Incorporar app no admin
  da Shopify" desmarcado (não construímos nenhuma tela embarcada) e "Usar fluxo de instalação legado"
  marcado (não confirmado se muda algo de fato nesse fluxo, mas não atrapalha).
- **Variáveis novas** (`.env`/Railway, ver seção 6): `YUCALOO_BR_CLIENT_ID`, `YUCALOO_BR_CLIENT_SECRET`,
  `YUCALOO_BR_REDIRECT_URL`. Futuramente `YUCALOO_US_*` quando o app US existir.
  **⚠️ Pra funcionar de verdade, precisa estar em produção (branch `master`)** — o callback é chamado
  pela própria Shopify batendo na URL pública do Railway, que só roda o que está em `master` (ver
  seção 1). Só ter isso na branch `dev` não é suficiente pra completar o handshake ao vivo.
- **Loja BR confirmada:** domínio real `pii90z-nz.myshopify.com` (o "myshopify.com" gerado pela
  Shopify não tem relação com o nome "Yucaloo" — normal, só o nome de exibição/domínio próprio é
  `yucaloo.com.br`). Escopos pedidos: `read_orders,read_all_orders,read_analytics,read_customers,
  read_products,read_reports` (mais amplo que o `read_orders` sozinho da Coco and Luna —
  `read_all_orders` não tem o limite de 60 dias de histórico, mas exige `read_orders` junto na chamada
  de autorização — `missing_read_orders_scope` se faltar, corrigido no mesmo dia).
- **⚠️ Handshake concluído em produção (06/08/2026):** app Yucaloo BR instalado e autorizado com
  sucesso — `kv.yucalooTokens.br` populado (`{ shop, accessToken, scope, obtainedAt }`). Confirmado
  pelo Luan ("Conectado!").
- **Card na tela de Integrações (implementado 06/08/2026):** `yucaloo_br` (Brasil · Geral, ao lado do
  Shopify BR) e `yucaloo_us` (Estados Unidos · Geral, ao lado do Shopify US) em
  `computeIntegrationsList()`/`TOGGLEABLE_KEYS` (`server.js`) — mesmo padrão dos outros canais:
  `configured` via `shopifyYucaloo.isConfigured(mkt)` (variáveis de ambiente presentes), `authorized`
  via `Boolean(getYucalooTokens()[mkt])` (token já obtido). `yucaloo_us` aparece como "Sem credenciais
  configuradas ainda" até o app US existir — **de propósito**, já fica pronto pra virar "Conectada"
  assim que `YUCALOO_US_CLIENT_ID/SECRET/REDIRECT_URL` forem preenchidos e o handshake rodar, sem
  precisar de nenhuma mudança de código. Logo: `logo: 'Yucaloo2.webp'` (a versão pequena, enviada pelo
  Luan em `public/logos-integracao/` junto com `Yucaloo1.webp`, a versão maior — não usada em nenhuma
  tela ainda; formato trocado de `.svg` pra `.webp` pelo Luan no mesmo dia). Sem o arquivo presente, o
  `onerror` do `integracoes.html` já cai no ícone genérico de categoria "geral" (🏪) sem quebrar nada,
  mesmo padrão de qualquer outro logo faltando (ver 4.17).
- **Sync de pedidos ligado (implementado 06/08/2026, a pedido do Luan — "vamos puxar os pedidos...
  puxe primariamente do Shopify"):** `shopifyYucaloo.fetchOrders(sinceISO, untilISO, mkt)` reaproveita
  `shopify.js`'s `fetchOrders()` (a mesma função já usada por Shopify BR/US — aceita `cfg.store`/
  `cfg.token` por chamada, então não duplicou a query GraphQL) passando o `shop`/`accessToken` salvos
  em `kv.yucalooTokens[mkt]`. Devolve `[]` sem erro se ainda não conectado (não quebra o sync). Wiring
  em `sync.js`: bloco próprio logo depois do Shopify BR, atrás do toggle `isIntegrationEnabled
  ('yucaloo_br')` (já criado no card de Integrações) — `report.yucaloo_br` no retorno de `runSync()`/
  `POST /api/sync`. **Fora de escopo, de propósito:** sessões/funil (ShopifyQL) da Yucaloo — só
  pedidos foram pedidos. Bling **não** é a fonte, mesmo os pedidos também aparecendo lá — decisão
  explícita do Luan de puxar primariamente do Shopify.
- **⚠️ REVERTIDO no mesmo dia — `market` É `'br'`/`'us'` (o MESMO da Coco and Luna), não um valor à
  parte:** a primeira versão desta seção (linhas acima, já corrigidas) tagueava os pedidos como
  `market: 'yucaloo_br'`, deliberadamente isolado, com a justificativa de que misturar marcas
  distintas no mesmo balde de mercado inflaria a receita da Coco and Luna por engano. O Luan corrigiu
  essa premissa: **no Brasil a Yucaloo é vendida junto com os mesmos marketplaces da Coco and Luna**
  ("estamos vendendo elas junto com o marketplaces da Coco and Luna") — ele **quer** ver tudo junto
  ao escolher só "Brasil"/"EUA", sem um passo extra de escolher marca e depois país ("é algo que
  podemos pensar depois, quando tiver mais marcas"). Ou seja, o pressuposto de que marcas diferentes
  = mercados diferentes estava errado pra este caso de negócio específico. **Correção:**
  `shopifyYucaloo.fetchOrders()` agora usa `market: mkt` (literal `'br'`/`'us'`, igual a qualquer
  outro canal desse mercado) — os pedidos da Yucaloo passam a contar em TODOS os agregados de
  `market==='br'` automaticamente: KPI de receita/pedidos (`computeDashboard`, `getOrders({channel:
  'todos', market})` não filtra por canal), `channelSplit`/"Canais" (`byChannel[o.channel]` é
  populado dinamicamente por canal encontrado, não uma lista fixa — ganha a chave `yucaloo_br`
  sozinho), catálogo do Unificador (`listProductCatalog`), Segmentos, Produtos — **sem precisar de
  nenhuma mudança de código nesses lugares**, confirmado com um teste local inserindo um pedido
  sintético `market:'br', channel:'yucaloo_br'` e rodando `computeDashboard`/`listProductCatalog`
  contra ele. **O `channel` continua próprio** (`'yucaloo_br'`, não virou `'shopify'`) — é o que
  permite ainda saber que aquele pedido veio da loja Shopify da Yucaloo (badge, filtro futuro) sem
  misturar com o canal "shopify" da Coco and Luna, mesmo os dois estando agora no mesmo `market`.
  - **O terceiro botão "Yucaloo BR" que tinha sido adicionado ao Unificador nesse meio-tempo (ver
    histórico do commit — market isolado, seletor dedicado) foi REMOVIDO no mesmo dia** — ficou
    redundante: escolher "Brasil" normalmente já mostra os produtos da Yucaloo junto com os da Coco
    and Luna, exatamente como pedido. Não sobrou nenhum vestígio dessa UI à parte.
  - **Cores dos canais desconhecidos NÃO caem mais no cinza genérico:** `colors.js` (`DEFAULT_CH`)
    ganhou uma entrada própria pro canal `yucaloo_br` — cor primária da marca, **`#4466FF`** (fornecida
    pelo Luan), label "Yucaloo". Badges em qualquer tela que já usa `CocoColors.chBadgeHTML()`
    (Unificador, Top Produtos, etc.) mostram essa cor automaticamente.
  - **Não afetado por essa mudança:** `kv.yucalooTokens`, o handshake OAuth, o toggle de Integrações
    (`yucaloo_br`/`yucaloo_us`) — nada disso dependia do valor de `market`, só o `fetchOrders()` que
    grava os pedidos mudou.
- **Ainda parcial, de propósito — nem tudo mostra a Yucaloo automaticamente:** telas que iteram uma
  lista FIXA de canais conhecidos (em vez de descobrir canais dinamicamente pelos dados, como
  `channelSplit` faz) — `CHANNELS_BR` em `produtos.html`/`estoque.html` (um card por canal),
  `campanhas.html`, o dropdown de canal do `index.html` (`buildChannelDropdown()`) — **não** ganham
  uma entrada "Yucaloo" só por causa dessa mudança; a receita dela entra nos agregados "Todos" dessas
  telas, mas ela não vira um card/filtro dedicado ainda. Adicionar isso a cada tela é trabalho
  separado, não pedido nesta rodada (o pedido foi "colocar os produtos junto com os outros", que já
  está resolvido pro catálogo/Segmentos/receita geral).
- **Unificador mostrando só produto já vendido, corrigido (06/08/2026, mesmo dia — reportado pelo
  Luan: "mostrou apenas um tipo de areia, pois a outra ninguém pediu ainda"):** todo o app (Produtos,
  Estoque, Segmentos e, até então, o Unificador) sempre derivou "produto" a partir de pedidos —
  `aggregateProductsByChannel(orders)` — então um SKU cadastrado mas nunca vendido simplesmente não
  existia em lugar nenhum. Pras telas orientadas a venda isso é o comportamento certo; pro
  Unificador (que existe pra ORGANIZAR o catálogo, inclusive antes de vender) não — o Luan quer poder
  agrupar um produto novo desde o dia 1, sem esperar o primeiro pedido.
  - **`fetchProductCatalog(cfg)` (novo em `shopify.js`):** query GraphQL separada de `fetchOrders`,
    pagina `products(first:100)` e devolve `{title, image, productType, tags}` de TODO produto
    cadastrado na loja — vendido ou não. Mesmo padrão multi-loja de `fetchOrders`/
    `fetchSessionsDaily` (`cfg.store`/`cfg.token`). Espelhado em `shopifyYucaloo.fetchProductCatalog
    (mkt)` (devolve `[]` sem token, mesmo padrão de `fetchOrders`).
  - **Sincronizado em `sync.js`** junto com os pedidos de cada loja Shopify (BR, US, Yucaloo BR) —
    salvo em `kv.shopifyProductCatalog[canal]` (`store.js` `getShopifyProductCatalog`/
    `setShopifyProductCatalog`). Só canais Shopify têm essa sincronização hoje — Shopee/Mercado
    Livre/Amazon não têm um endpoint de "listar catálogo" integrado neste projeto ainda, então
    continuam só derivados de pedido (limitação conhecida, não corrigida nesta rodada).
  - **`listProductCatalog()` (`metrics.js`) mescla os dois:** primeiro monta a lista de sempre (a
    partir de `aggregateProductsByChannel`), depois passa pelo catálogo bruto de
    `SHOPIFY_CATALOG_CHANNELS[market]` (`{br:['shopify','yucaloo_br'], us:['shopify_us']}`) e
    adiciona qualquer título que ainda não apareceu (`qty:0, revenue:0`, tipo via `classifyType()`
    reaproveitado). Nenhuma outra tela foi tocada — o merge é só na função que alimenta o Unificador.
  - Testado localmente (mesmo método sem rede desta seção): com `kv.shopifyProductCatalog.shopify`
    tendo um título que nunca apareceu em `db.orders`, `listProductCatalog({market:'br'})` devolve
    esse título com `qty:0`/`revenue:0`, sem duplicar os que já tinham venda.
- **Yucaloo EUA conectada (06/08/2026):** app criado e autorizado, mesmo processo do BR
  (`kv.yucalooTokens.us` populado). **⚠️ Faltava wiring em dois lugares, corrigido no mesmo dia** —
  quando a BR foi implementada, a US ainda não existia, e o código só tinha o bloco BR:
  - `sync.js`: bloco `yucaloo_us` (pedidos + catálogo, atrás de `isIntegrationEnabled('yucaloo_us')`)
    logo depois do bloco Shopify EUA — espelha exatamente o bloco `yucaloo_br`, só trocando `'br'`
    por `'us'` nas chamadas de `shopifyYucaloo.fetchOrders`/`fetchProductCatalog`.
  - `metrics.js`: `SHOPIFY_CATALOG_CHANNELS.us` só tinha `['shopify_us']` — sem `'yucaloo_us'` ali,
    o catálogo do Unificador nunca ia buscar produtos da Yucaloo EUA em `kv.shopifyProductCatalog`,
    mesmo depois de sincronizados. Corrigido: `us: ['shopify_us', 'yucaloo_us']`.
  - **`unificador.html` não tinha nenhum botão de sincronizar** (reportado pelo Luan: "o botão de
    sincronizar não é mostrado em nosso header lá") — a página nunca passou pela padronização de
    header (`#syncBtn`) que `index.html`/`campanhas.html`/`produtos.html`/`estoque.html` já tinham
    desde 07/07 (ver 4.9c), porque foi criada depois. Adicionado `#syncBtn` no topbar (mesmo padrão:
    `POST /api/sync` + recarrega o catálogo).
  - Testado localmente (mesmo método sem rede): produto sintético em `kv.shopifyProductCatalog.
    yucaloo_us` aparece em `listProductCatalog({market:'us'})` normalmente.
- **Ainda faltando:** um card/filtro dedicado da Yucaloo nas telas de lista fixa (Produtos/Estoque/
  Campanhas, ver bullet "Ainda parcial" acima), se o Luan quiser depois.
- **Badges de canal renomeados pra deixar a marca explícita (06/08/2026, ajustado no mesmo dia):**
  com duas marcas rodando em cima do Shopify (Coco and Luna e Yucaloo), o rótulo genérico
  "Shopify"/"Shopify US" ficou ambíguo — não dava pra saber, só olhando o badge, se era Coco and Luna
  ou Yucaloo. `colors.js` (`DEFAULT_CH`) atualizado: `shopify` → **"Shopify - Coco and Luna BR"**,
  `shopify_us` → **"Shopify - Coco and Luna EUA"**, cor **`#ee4144`** nos dois (vermelho da marca, no
  lugar do verde do Shopify — cor da plataforma, não da marca); `yucaloo_br` → **"Shopify - Yucaloo
  BR"**, `yucaloo_us` → **"Shopify - Yucaloo EUA"**, mantendo o azul `#4466FF` já usado. **Rótulo
  separado por mercado** (não um texto único "BR ou EUA" — 1ª versão, corrigida pelo Luan no mesmo
  dia: "a tag do Shopify deve ser Shopify - Coco and Luna BR (Para pedidos do brasil) e EUA para
  pedidos dos EUA"). Como `label` nunca é sobrescrito por customização do usuário (só `bg` pode, via
  o color picker), o texto novo vale pra todo mundo. Efeito é global — `chBadgeHTML()` é
  compartilhado entre Unificador, Top Produtos (`index.html`) e o donut/legenda "Canais" do
  dashboard principal, que também passam a usar essas cores/rótulos automaticamente.

### 4.21 "Ocultar produtos" — card "Ocultos" em Segmentos (implementado 06/08/2026)
- Pedido do Luan: uma forma de ocultar produtos (por palavra-chave buscada na TAG do item, não
  título/productType — diferente de propósito de "Tipos de produto", ver 4.19) dos cards normais de
  Segmentos, jogando-os pra um card à parte chamado "Ocultos". Caso de uso: produto de atacado/
  fulfillment por terceiro, teste, ou qualquer coisa que não deveria contar na análise por
  espécie/tipo mas ainda precisa existir no sistema.
- **Modelo de dados** (`kv.productHiddenTags`, `store.js`): `{ [market]: [palavraChave,...] }` — lista
  simples por mercado, sem nome de grupo (só existe um destino possível, o card "Ocultos", diferente
  do `productTypeGroups` que tem N tipos nomeados). `getProductHiddenTags`/`upsertProductHiddenTags`
  (une, dedup)/`removeProductHiddenTag`.
- **`isHiddenItem(it, market)` (`metrics.js`):** testa CADA tag do item (`it.tags`, contains
  case-insensitive) contra as palavras-chave cadastradas — só tags, de propósito (pedido do Luan foi
  literalmente "produtos com as tags que o usuário escrever"). Chamada no mesmo loop que já monta
  `segAcc`/`productGeoAcc` (dentro de `computeDashboard`): quando um item bate, `seg = 'hidden'` (em
  vez do resultado normal de `classifySeg` — cat/dog/other) e o item é **excluído** da agregação de
  `productGeoAcc` (não aparece em "Onde os produtos vendem"). `totalSegUnits` (denominador do `pct`
  de cat/dog na legenda) também exclui a chave `hidden` — não é uma fatia real da distribuição
  Gato/Cão, só o balde de itens ocultados.
- **`segments.hidden` nasce automaticamente** com a mesma forma de `segments.cat`/`segments.dog`
  (`revenue`, `units`, `orders`, `byType`, `topProducts` — já passando por `applyProductGroups`/
  `classifyTypeGroup` igual aos demais) porque `segAcc` é uma agregação genérica por chave, sem lista
  fixa de segmentos — nenhuma mudança adicional foi necessária nessa parte do pipeline.
- **UI dividida entre duas telas, de propósito:** a exibição do efeito (o card "Ocultos") mora em
  `segmentos.html` — `#hiddenCard`/`renderHidden`, cópia do padrão já usado pro card "Produtos não
  classificados" (`#otherCard`/`renderOther`), escondido via `display:none` quando `segments.hidden`
  está vazio ou ausente, reaproveitando `prodByTypeGroupHtml()` (mesmo agrupamento por "Tipos de
  produto" dentro do card, "ver mais/ver menos" etc. — tudo de graça). O controle (cadastrar/remover
  palavra-chave) mora só em `unificador.html`.
- **⚠️ Controle movido pro Unificador no mesmo dia (a pedido do Luan: "essa função deve estar no
  unificador, que é onde iremos controlar tudo"):** a 1ª versão tinha o botão "Ocultar produtos" e o
  modal de gestão dentro de `segmentos.html` (mesmo padrão visual do modal de "Tipos de produto",
  classes `.tr-modal*`). Removido de lá — `segmentos.html` ficou só com a exibição somente-leitura
  (`#hiddenCard`), com um link "Gerenciar palavras-chave no Unificador →" apontando pra
  `/unificador`. O botão + modal reais agora vivem em `unificador.html` (`#hideBtn`/`#hideModal`,
  CSS própria `.hide-tag-chip`/`.hide-add-row` — reaproveita as classes genéricas `.modal-overlay`/
  `.modal` já existentes lá, não as `.tr-*` de Segmentos), chamando os mesmos endpoints — nenhuma
  mudança no modelo de dados (`kv.productHiddenTags`) ou em `isHiddenItem`/`metrics.js`, só de onde a
  UI de controle é servida. Mesmo padrão de separação já usado pro Unificador "de verdade" (grupos de
  produto, ver 4.18): controle centralizado, efeito exibido onde faz sentido pro negócio.
- **Endpoints agora admin-only** (`server.js`, `requireAdmin` — mudou de não-admin pra admin nessa
  mesma correção, já que a única tela que os chama virou o Unificador, que já é admin-only):
  `GET /api/product-hidden-tags?market=`, `POST /api/product-hidden-tags` (`{market,tags}`, array —
  adiciona), `POST /api/product-hidden-tags/remove` (`{market,tag}`).
- **Testado localmente (sem rede, mesmo método das rodadas anteriores):** pedido sintético com tag
  "atacado" — antes de cadastrar a palavra-chave, cai em "Outros" e aparece em `productGeo`; depois de
  cadastrar "atacado" como oculto, o produto sai de "Outros" e de `productGeo`, e `segments.hidden`
  aparece com a receita/unidades certas.
- **⚠️ Bug corrigido no mesmo dia — cadastrar a tag não movia nada pro card "Ocultos" (reportado pelo
  Luan testando com os produtos "Areia" da Yucaloo, que nunca venderam nada):** `segments.hidden` só
  existe dentro de `computeDashboard()`, alimentado exclusivamente pelo loop que percorre **itens de
  pedido de verdade** — um produto com **zero vendas** (como as Areias recém-cadastradas, ou "Teste
  de Gateway", visíveis no Unificador graças ao catálogo bruto da Shopify, ver "Sync de pedidos
  ligado" acima) nunca entra nesse loop, então nunca poderia aparecer em "Ocultos" — nem antes nem
  depois de marcado, porque ele **já era invisível em Segmentos de qualquer jeito** (Segmentos é
  100% orientado a venda). A confusão do Luan era legítima: ele esperava ver o efeito de "ocultar" em
  algum lugar visível, e não havia nenhum.
  - **Causa secundária, também corrigida:** mesmo um produto **já vendido** com a tag certa não tinha
    como ser identificado como oculto no **Unificador** — `aggregateProductsByChannel()` (usada tanto
    por `listProductCatalog` quanto por Produtos/Estoque) nunca guardava as tags do item no
    acumulador por produto (`c.products[title]`), só `revenue`/`qty`/`type`/`image`. Sem tags
    guardadas, não tinha como o catálogo do Unificador saber se aquele produto batia com uma
    palavra-chave de "Ocultar produtos".
  - **Correção:** `aggregateProductsByChannel()` passou a acumular `p.tags` (união das tags vistas
    em cada pedido daquele título — o mesmo produto pode aparecer com tags um pouco diferentes entre
    canais/tempos). `listProductCatalog()` (`metrics.js`) agora calcula e expõe um campo **`hidden`**
    (boolean) em CADA item do catálogo — via `isHiddenItem(p, market)`, reaproveitado tal qual,
    funciona igual pra produto vendido (tags vêm do acumulador acima) e pra produto só-catálogo
    (tags já vinham de `fetchProductCatalog`, ver "Sync de pedidos ligado").
  - **`unificador.html` ganhou uma 3ª área, "Ocultos"** (`#hiddenSection`, abaixo das colunas "Sem
    grupo"/"Com grupo", full-width, some quando vazia): `ungroupedTitles()` passou a excluir título
    com `c.hidden` (não aparece mais em "Sem grupo"), e uma nova `hiddenTitles()` alimenta a lista à
    parte — reaproveita `.plain-list`/`.plain-row` (mesmo visual de "Sem grupo", só sem drag/seleção,
    já que a gestão é só pelo botão "Ocultar produtos" no topo). `hideAddTag`/`hideRemoveTag` passaram
    a chamar `load()` depois de salvar, pra recarregar o catálogo com o `hidden` atualizado na hora
    (antes só atualizavam a lista de palavras-chave do modal, sem refletir no catálogo).
  - **Resultado:** agora o efeito de "ocultar" é visível IMEDIATAMENTE no Unificador (onde o controle
    mora), pra qualquer produto — vendido ou não —, e continua alimentando `segments.hidden` em
    Segmentos pros que JÁ têm alguma venda. Testado localmente (mesmo método): produto só-catálogo
    (nunca vendido) e produto já vendido, ambos com tag cadastrada, os dois retornam `hidden:true` de
    `listProductCatalog()`; sem a tag, `hidden:false` nos dois.
- **Card "Ocultos" (Segmentos) ganhou botão de esconder/mostrar (06/08/2026):** pedido do Luan —
  `#hiddenCollapseBtn` (chevron no canto do título) alterna a visibilidade do corpo do card
  (`#hiddenCardBody` — a lista de produtos + o link "Gerenciar no Unificador"), sem afetar o
  cálculo/efeito de ocultar em si (só esconde o CARD, não desfaz a ocultação de nenhum produto).
  Estado persistido em `localStorage('coco_seg_hiddencard_collapsed')`, sobrevive a reload — mesmo
  princípio de coleção de estado já usado nos cards de Produtos/Estoque, só que aqui é um card único
  (não uma lista deles), então não precisou da lógica de "só o primeiro aberto".
- **⚠️ Correção no mesmo dia — o Luan queria dizer a área "Ocultos" do UNIFICADOR, não a de
  Segmentos:** mesmo botão de esconder/mostrar, agora também em `unificador.html`
  (`#hiddenSectionCollapseBtn`/`#hiddenSectionBody`, `localStorage
  ('coco_uni_hiddensection_collapsed')`) — CSS `.other-card-collapse` duplicada ali (não existia
  nesse arquivo antes). As duas versões (Segmentos e Unificador) ficaram implementadas, cada uma na
  tela onde já existia sua própria área "Ocultos" — não são a mesma UI compartilhada, só o mesmo
  padrão de chevron+persistência replicado.

### 4.22 Dashboard principal (Revenue) reconhece a Yucaloo + export dinâmico de Pedidos Recentes (06/08/2026)
- **Canais/gráficos da tela Revenue (`index.html`) passam a mostrar a Yucaloo separada, pedido do
  Luan** ("separando ainda daquele jeito: Shopify - Yucaloo BR e Shopify - Coco and Luna BR"):
  - `MARKET_CHANNELS` (dropdown de canal) ganhou `yucaloo_br`/`yucaloo_us`, com rótulo completo
    ("Shopify - Yucaloo BR"/"EUA") — e os itens `shopify`/`shopify_us` do dropdown também passaram a
    usar o rótulo completo ("Shopify - Coco and Luna BR"/"EUA"), só ali (o `CHAN` compartilhado,
    usado em textos mais curtos como o subtítulo da página, continua com "Shopify"/"Shopify US" —
    evita redundância tipo "Coco and Luna · Shopify - Coco and Luna BR").
  - **`chOrder` (donut "Canais") deixou de ter rótulo próprio hardcoded** — antes tinha uma 2ª cópia
    do nome ("Shopify", "Amazon"...) desatualizada em relação às cores/labels de `colors.js`
    (`CocoColors.ch`), que é quem esse gráfico já usava pra COR mas não pro texto. Motivo real do
    bug ("os gráficos não mostravam"): a correção anterior de rótulo (ver seção 4.20, "Badges de
    canal renomeados") nunca alcançou esse donut, porque ele lia o nome de um array próprio, não de
    `colors.js`. Corrigido: `chOrder` agora só lista OS CANAIS (chaves), e o texto vem sempre de
    `CocoColors.ch[k].label` — corrige o donut/legenda "Canais" retroativamente e automaticamente
    pra qualquer rótulo futuro, sem precisar editar dois lugares de novo.
  - `ssChannels` ("Orgânico x Campanha", uma pizza por canal) ganhou `yucaloo_br`/`yucaloo_us` na
    lista "Todos"; o título de cada célula também passou a preferir `CocoColors.ch[ch].label` (com
    fallback pro `CHAN` curto) — mesmo motivo acima, pra Shopify/Shopify US também mostrarem o nome
    completo lado a lado com a Yucaloo, em vez de ficar assimétrico ("Shopify" vs "Shopify -
    Yucaloo BR").
  - **⚠️ Bug real encontrado e corrigido nessa mesma auditoria (não reportado, achado revisando o
    código):** o cálculo de ROAS/ACOS por canal (`kpiRoas`/`kpiAcos`, ver 4.9b) tinha um `if/else`
    que tratava "shopee, amazon, amazon_us" como "sem rastreamento de Ads" e jogava QUALQUER outro
    canal (inclusive um ainda não previsto, como `yucaloo_br`/`yucaloo_us`) no branch de
    "todos/shopify/shopify_us", que soma o gasto de Meta Ads da Coco and Luna. Sem a correção,
    escolher "Shopify - Yucaloo BR" no dropdown mostraria um ROAS calculado com o gasto de anúncio
    de OUTRA marca — número sem nenhum sentido pro canal selecionado. Corrigido adicionando
    `yucaloo_br`/`yucaloo_us` à lista "sem rastreamento de Ads ainda" (correto — a Yucaloo não tem
    Meta Ads própria integrada ainda). `showAdsLine` (linha tracejada "Custo ads" na Tendência) e a
    disponibilidade de Tráfego/Funil (`hasTraffic`) já excluíam a Yucaloo corretamente sem
    precisar de nenhuma mudança (checam channel === 'shopify'/'shopify_us' explicitamente, não uma
    lista negativa).
  - **`updateCardVisibility()` não precisou de mudança:** `isShopify` (controla se Marketing/
    Tráfego/Funil aparecem) já é uma checagem positiva `channel==='shopify'||channel==='shopify_us'`
    — selecionar um canal Yucaloo cai fora dela por padrão, escondendo esses 3 cards (correto, a
    Yucaloo não tem Meta Ads nem sessões ShopifyQL sincronizadas ainda — mesmo comportamento de
    Shopee/ML/Amazon hoje).
  - **Continua parcial, de propósito:** `CHANNELS_BR`/`CHANNELS_US` (cards por canal em
    Produtos/Estoque) e o dropdown de Campanhas não ganharam Yucaloo nesta rodada — escopo desta vez
    foi só a tela Revenue, como pedido.
- **"Pedidos Recentes" reorganizado (pedido do Luan — nova ordem: Pedido, Data/Hora da compra,
  Cliente, Situação, Valor, Canal):**
  - Tabela em tela caiu de 8 pra 6 colunas — **Produto e Itens saíram da tela**, viraram colunas
    OPCIONAIS só na exportação (ver abaixo). O toggle "Nº produtos"/"Qtd. total" (`#roItemsToggle`)
    foi removido inteiro (tela e código) — não fazia mais sentido sem a coluna Itens visível.
  - CSS responsivo (`@media max-width:768px`) ajustado pra esconder Cliente(3)/Situação(4) no
    mobile — antes escondia posições 3/4/8 (Cliente/Produto/Status) num layout de 8 colunas; a
    posição 8 não existe mais.
- **Exportar pedidos virou um modal completo com colunas dinâmicas** (pedido do Luan: "coloque um
  pop-up dando a opção de reorganizar as colunas, adicionar mais colunas... e tirar colunas
  também... nós também deve-se mostrar os dados e como eles ficarão em uma planilha"). Substituiu o
  antigo popover pequeno (só filtro de status) — `#expModal`/`#expModalOverlay` (novo, `index.html`
  não tinha nenhum componente de modal antes desta mudança; CSS `.exp-modal*` própria, não reaproveita
  nada de `unificador.html`/`segmentos.html`).
  - **Colunas disponíveis** (`EXPORT_COLUMN_DEFS`): Pedido, Data/Hora da compra, Cliente, Situação,
    Valor, Canal, **Produto(s) da compra** (títulos únicos do pedido, `o.products`, já existia no
    payload desde a coluna "Produto" da tela — ver seção 4.9b — junta com ", " no CSV), Nº de
    produtos, Qtd. de itens.
  - **Reordenar** é por setas ▲▼ por linha, não drag-and-drop — decisão deliberada dado o histórico
    de bugs do HTML5 DnD nativo já documentado neste projeto (produtos.html/estoque.html precisaram
    reescrever pra ponteiro customizado por causa disso, ver 4.13). Pra uma lista simples e plana
    como essa, considerou-se que arrasto não vale o risco/esforço — setas são "algo dinâmico" o
    suficiente (reordena, liga/desliga, tudo sem reload).
  - **Pré-visualização "como vai ficar na planilha"** (`renderExportPreview`): tabela real (`<table>`)
    com as colunas marcadas, na ordem escolhida, preenchida com até 5 linhas de `_roAll` (os pedidos
    recentes já carregados em memória — sem chamada de rede nova só pra pré-visualizar) passadas
    pelos mesmos formatadores usados na tela (`statusTag`, `fmtMoney`, `CocoColors.ch[...].label`).
  - **Estado persistido** em `localStorage('coco_export_cols')` — array ordenado de
    `{key, on}` cobrindo TODAS as colunas conhecidas (não só as ativas), então a ordem escolhida
    pelo usuário (inclusive de colunas desmarcadas) sobrevive a reload. Migração simples: colunas
    novas que não existiam num save antigo entram desmarcadas no fim.
  - **Backend (`server.js`):** `/api/orders/export` ganhou o parâmetro `cols` (lista de chaves
    separada por vírgula, controla COLUNAS e ORDEM) — `EXPORT_COLUMNS` (server-side, com
    `CHANNEL_LABEL_PT`, cópia deliberada dos rótulos de `colors.js` só pra exportação, mesmo padrão
    de duplicação estática já aceito no projeto) substitui o array fixo de 6 colunas de antes. Sem
    `cols` (chamada antiga/direta), cai no mesmo padrão de 6 colunas de sempre — não quebra nada que
    já apontava pra essa URL. Parâmetro `itemsMode` (antigo) foi removido — `itemsCount`/`itemsQty`
    viraram colunas independentes, sem precisar de um "modo".
  - **`exportOrdersList()` (`metrics.js`)** ganhou o campo `products` (reaproveita `productTitles()`,
    a mesma função da coluna "Produto" da tela) no objeto devolvido por pedido.
  - Testado localmente (sem rede, mesmo método de sempre): `exportOrdersList()` devolve `products`
    populado corretamente; simulação da seleção de colunas (`cols=name,products,channel,total`)
    gera cabeçalho e linhas na ordem certa, com "Shopify - Coco and Luna BR"/"Shopify - Yucaloo BR"
    corretos por pedido.

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
  items: [{ title, qty, amount, asin? }]  // asin só em itens Amazon vindos do backfill, ver 4.13
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
| `AMAZON_BR_REFRESH_TOKEN` | LWA Refresh Token do app próprio da conta **CocoandLuna** (BR). **Nunca igual ao de cima** — ver 4.7.1/4.7.11 |
| `AMAZON_BR_CLIENT_ID` | LWA Client ID do app SP-API próprio da CocoandLuna (BR) — app separado do dos EUA desde 04/08/2026. Ver 4.7.11 |
| `AMAZON_BR_CLIENT_SECRET` | LWA Client Secret do mesmo app BR acima |
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
| `YUCALOO_BR_CLIENT_ID` | Client ID do app Yucaloo BR criado na Dev Dashboard da Shopify. Ver 4.20 |
| `YUCALOO_BR_CLIENT_SECRET` | Client Secret do mesmo app |
| `YUCALOO_BR_REDIRECT_URL` | Precisa bater exatamente com "URLs de redirecionamento" cadastrada no app (`.../shopify-yucaloo/br/callback`). Ver 4.20 |
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
  - `GET /api/orders/search?market=br|us&q=&limit=` — busca geral de pedidos em todo o histórico do mercado (`searchOrders()`), sem janela de data. Usado pelo campo de busca do card "Pedidos Recentes" (`index.html`). Ver 4.9b.
  - `GET /api/orders/export?market=br|us&channel=&since=&until=&status=todos|autorizado|em_aberto|cancelado&itemsMode=count|qty` — exporta CSV com TODOS os pedidos do período/canal/mercado (sem teto, ao contrário do `recent` do `/api/dashboard`), via `exportOrdersList()`. Usado pelo botão "Exportar" do card "Pedidos Recentes". Ver 4.9b.
  - `GET /api/products/export?market=us&channel=shopify_us&since=&until=` — exporta CSV com quantidade vendida/receita/ticket médio por produto. Só Shopify US por enquanto. Usado pelo botão "Exportar" da tela de Produtos. Ver 4.13.2.
  - `GET /api/product-groups?market=br|us` (admin) — grupos de unificação manual de produtos do mercado (Unificador, ver 4.18). `POST /api/product-groups` (`{market,name,members}`) cria/adiciona a um grupo. `POST /api/product-groups/remove-member` (`{market,name,title}`) tira um membro. `DELETE /api/product-groups?market=&name=` apaga o grupo. Persistido em `kv.productGroups`. `GET/POST /api/product-groups/config` (`{enabled}`) — liga/desliga global, padrão ligado. `GET /api/product-groups/catalog?market=` — catálogo completo (todo canal, todo histórico) achatado, pra tela escolher produtos. Todos usados só por `unificador.html`.
  - `GET /api/product-types?market=br|us` — regras de "Tipos de produto" do mercado (Segmentos, ver 4.19), não admin. `POST /api/product-types` (`{market,name,keywords}`) cria/adiciona palavra(s)-chave a um tipo. `POST /api/product-types/remove-keyword` (`{market,name,keyword}`) tira uma palavra-chave. `DELETE /api/product-types?market=&name=` apaga o tipo. Persistido em `kv.productTypeGroups`.
  - `GET /api/product-hidden-tags?market=br|us` (admin) — palavras-chave de "Ocultar produtos", controladas no Unificador (efeito exibido em Segmentos, ver 4.21). `POST /api/product-hidden-tags` (`{market,tags}`) adiciona palavra(s)-chave. `POST /api/product-hidden-tags/remove` (`{market,tag}`) tira uma. Persistido em `kv.productHiddenTags`.
  - `POST /api/products/finance` — salva/edita COG, frete, % impostos ou % comissão de um produto (`{ channel, title, cog?, shipping?, taxPct?, commissionPct? }`), persistido em `kv.productFinance`. Ver 4.13.1.
  - `GET /api/stock?market=br|us` — estoque + produção por canal (`channels`) e por família de produto somando todos os canais (`agg`), janela fixa de 30 dias (sem `since`/`until` — calculado internamente). Usado pela tela de Estoque (`estoque.html`). Ver 4.14.
  - `POST /api/stock/finance` — salva/edita estoque ou recebendo de um produto, por canal (`{ channel, title, stock?, incoming? }`), persistido em `kv.productStock`. Ver 4.14.
  - `POST /api/stock/agg-finance` — salva/edita ordem projetada, ordem nova ou ordem em andamento de uma família de produto, somando todos os canais (`{ market, title, orderInProgress?, orderNew?, projected? }`), persistido em `kv.productStockAgg`. Ver 4.14.
  - `POST /api/sync`
  - `GET /api/status` — diagnóstico: credenciais configuradas, backoff Amazon, último sync
  - `POST /api/amazon/reset-backoff` — zera o backoff da Amazon manualmente (`?delay=N` define um backoff de N minutos)
  - `POST /api/amazon/force-sync` — zera backoff + executa sync atomicamente
  - `POST /api/amazon/backfill?days=90&market=us` — backfill histórico via Reports API, em background.
    Responde na hora; progresso em `GET /api/status` → `amazon.backfill`. Ver 4.7.5.
  - `POST /api/amazon/images?market=us|br` — preenche o cache de imagem de produto (Catalog Items
    API por ASIN), em background. Responde na hora; progresso em `GET /api/status` → `amazon.images`.
    Só acha ASIN em pedidos que já passaram pelo backfill. Ver 4.13.
  - `POST /api/amazon/sync-names?market=us|br` — reconcilia nomes de produto (Reports API), em background,
    ignorando o throttle. Sem `market` → US e BR. Ver 4.7.6.
  - `POST /api/amazon/cleanup-market-leak` — remove pedidos US que foram gravados como Amazon BR (vazamento
    de mercado). Idempotente; rodar uma vez após o deploy da correção. Ver 4.7.8.
  - `GET /shopee/connect` e `GET /shopee/callback`
  - `GET /api/shopee/probe-order` — diagnóstico: `recipient_address` cru de pedidos recentes, sem normalizar. Ver 4.5.
  - `GET /mercadolivre/connect` e `GET /mercadolivre/callback`
  - `GET /googleads/connect` e `GET /googleads/callback`
  - `GET /shopify-yucaloo/:mkt(br|us)/connect` e `GET /shopify-yucaloo/:mkt(br|us)/callback` — chamadas
    pela própria Shopify (não pelo usuário), handshake OAuth do app Yucaloo. Ver 4.20.
  - `GET /health`
  - **Autenticação (branch `feat/auth-usuarios`, ver 4.16):**
    - `POST /api/login` / `POST /api/logout` / `GET /api/me` — públicas (sessão por cookie `coco_session`).
    - `GET /api/users` / `POST /api/users` / `PUT /api/users/:id` / `DELETE /api/users/:id` — gestão de usuários (admin).
    - `POST /api/auth/config` — liga/desliga a exigência de login (admin), `{ enabled }`.
    - `POST /api/me/password` — troca a própria senha (qualquer usuário logado), `{ current, next }`.
    - `GET /login.html`, `GET /configuracoes.html`, `GET /integracoes.html`, `GET /unificador.html`
  - **Integrações (dentro de Configurações, ver 4.17):**
    - `GET /api/integrations` (admin) — status ao vivo de cada canal, agrupado por país/categoria.
    - `POST /api/integrations/:key/toggle` (admin) — liga/desliga a sincronização automática de um canal, `{ enabled }`.

## 8. Status das integrações

Resumo do estado de cada canal — o "como funciona" e as armadilhas ficam na seção 4.x indicada.

| Canal | Estado | Detalhes-chave | Ver |
|---|---|---|---|
| Shopify BR/US | ✅ | Admin API 2026-04; pedidos GraphQL + sessões ShopifyQL | 4.1, 4.2 |
| Shopee | ✅ | Partner ID 2037711, Shop ID 1502160212; analytics e endereço do comprador (estado) indisponíveis via API | 4.5 |
| Mercado Livre | ✅ | OAuth (re-autorizar após deploy); ML Ads ativo (escopo `write:product_ads`) | 4.6 |
| Amazon US | ✅ | `ATVPDKIKX0DER`, token conta VITA PET LIFE; sync por cursor + backfill Reports API | 4.7 |
| Amazon BR | ✅ | `A2Q3Y263D00KWC`, app próprio da conta CocoandLuna desde 04/08/2026 (era token da conta errada) | 4.7.11 |
| Meta Ads BR/US | ✅ | contas separadas (`META_AD_ACCOUNT_ID` / `META_US_AD_ACCOUNT_ID`) | 4.4 |
| Google Ads | ✅ | só EUA, Customer ID `1344114329`; aparece na tela de Campanhas (US) | 4.12 |
| Yucaloo BR (Shopify) | 🟡 | conectada e sincronizando pedidos — `market:'br'`, MESCLADA com a Coco and Luna (decisão do Luan); `channel:'yucaloo_br'` rastreável, sem card/filtro dedicado ainda | 4.20 |
| Yucaloo US (Shopify) | 🟡 | conectada e sincronizando pedidos+catálogo — `market:'us'`, mesclada com a Coco and Luna EUA | 4.20 |

- **Amazon — dois apps SP-API separados desde 04/08/2026** (ver 4.7.11): o app dos EUA (`AMAZON_CLIENT_ID/SECRET`,
  conta VITA PET LIFE) e um app próprio do BR (`AMAZON_BR_CLIENT_ID/SECRET`, conta CocoandLuna) — IAM Role/chaves
  AWS continuam compartilhados; endpoint `sellingpartnerapi-na.amazon.com` serve os dois marketplaces.

## 9. Próximos passos (backlog)

### Abertos
1. **Amazon — nome do comprador (PII):** `customer` vem vazio nos dois caminhos (Orders API e Reports) — dado
   restrito. Exige o papel PII aprovado no Solution Provider Portal; depois é só `AMAZON_FETCH_PII=1` no Railway
   (código pronto). Ver 4.7.4.
2. **Amazon — imagem de produto bloqueada (403):** Catalog Items API retorna 403 **pro app dos EUA**
   — não tem o role "Product Listing". Habilitar no portal + re-autorizar (novo refresh token); depois
   `POST /api/amazon/images`. Código pronto. Ver 4.13. (O app novo do BR já nasceu com esse role — ver
   4.7.11 — então essa limitação já não existe mais pro Brasil, só continua pros EUA.)
3. **Amazon Ads e TikTok Shop — integrações ainda não construídas.** Aparecem como "Planejadas" na tela
   de Integrações (`/integracoes`, ver 4.17), sem código por trás ainda.
4. **Toggle "Incluir Mercado Ads" (dashboard principal, `index.html`, ver 4.9b) não respeita o período:**
   mesma causa raiz do bug de Campanhas corrigido em 4.11.1 — lê `mlBreakdown.adCost`, um valor único
   preso na janela fixa de 60 dias do sync periódico. Não corrigido junto porque a correção da tela de
   Campanhas usou `/api/campaigns` (chamada ao vivo), e `/api/dashboard` é, por design, o único endpoint
   do app que nunca depende de chamada externa em tempo de request (ver seção 3) — corrigir aqui exige
   ou quebrar esse princípio ou sincronizar o gasto do ML como série diária (como o Meta já faz), o que
   não foi confirmado como viável na API de Mercado Ads sem acesso à documentação oficial (bloqueada pra
   fetch automatizado). Ver 4.11.1.
### Resolvidos (referência rápida — o detalhe está na seção citada)
- **"Tipos de produto" dinâmico em Segmentos** (05/08) — o "Top produtos" de cada card volta a
  respeitar o Unificador (bug: uma 4ª lista tinha ficado de fora) e passou a separar por tipo — não
  mais hardcoded (Areia x Suplementos), e sim tipos criados pela própria UI com palavra-chave buscada
  em título/productType/tags. Ver 4.18 (bug) e 4.19 (feature).
- **Unificador global de produtos** (05/08) — o "Unificar" que existia separado em Segmentos e Estoque
  virou uma tela própria (`unificador.html`, dentro de Configurações), aplicado automaticamente pelo
  backend em Revenue/Top Produtos, Segmentos, Produtos e Estoque, com liga/desliga global (padrão
  ligado). Ver 4.18.
- **Amazon BR sem pedidos** (04/08) — `AMAZON_BR_REFRESH_TOKEN` autorizava a conta errada (VITA PET
  LIFE, não CocoandLuna). Resolvido com app SP-API próprio pra CocoandLuna, sem mexer no app dos EUA;
  backfill de 90 dias recuperou 121 pedidos históricos. Ver 4.7.11.
- **Amazon BR — nome de produto incompleto / 400 em getOrderItems nos pedidos 701-/702-** (04/08) —
  mesma causa raiz do item acima (token da conta errada). Confirmado com o app novo: `POST
  /api/amazon/fetch-items?market=br` rodou **77/77 pedidos escaneados e corrigidos, 0 erros** — sem
  nenhum 400. A teoria de "limitação de autorização do app no marketplace BR" (4.7.9) não era a causa
  real. Ver 4.7.11.
- **CSS da sidebar duplicado por página** (15/07) — o CSS do componente (`.sidebar`, `.brand*`, `.nav-*`,
  toggle, overlay, botão de abrir, transforms `body.sidebar-*`) foi movido para `sidebar.js`
  (injetado em `<style id="sidebarComponentStyle">`); cada página perdeu a duplicata e mantém só o
  layout próprio (`.main`/`.content`/`.topbar`, incluindo `body.sidebar-hidden .main{margin-left:0}`).
  A divergência de z-index das Geografias foi resolvida com um override de MAIOR ESPECIFICIDADE nelas —
  `body .sidebar{z-index:3000}` (vence a regra `.sidebar` injetada mesmo carregando depois), por causa
  das camadas do Leaflet. Ver 4.9.
- **Google Ads** (09/07) — ativo, só EUA. Ver 4.12.
- **Google Ads** (09/07) — ativo, só EUA. Ver 4.12.
- **ML Ads ROAS por campanha** (07/07) — `listing_type_id` movido pra ler do recurso `/items`. Ver 4.6.
- **Login/usuários** (14/07) — branch `feat/auth-usuarios`. Ver 4.16.
- **Amazon US em produção** (09/07) — era paginação, não cota. Ver 4.7.2.
- **Amazon backfill histórico US** (09/07) — Reports API, 83.897 pedidos/90 dias. Ver 4.7.5.
- **Amazon `byState` grafia inconsistente** (10/07) — `normalizeUsState`. Ver 4.7.4.
- **Amazon sync sem nome de produto (US)** (10/07) — job `reconcileAmazonNames`. Ver 4.7.6.
- **Decisão sobre pedido Pix/boleto pendente** (29/07) — só pedido pago conta como venda, aplicado nos
  4 canais. Ver 4.1 e commit `6f1eb2c`.
- **Shopee sem endereço na Geografia BR** (29/07) — não era limitação da Shopee, era `upsertOrders()`
  (`store.js`) apagando o `state` que a reconciliação via Bling preenchia a cada sync seguinte (mesmo
  bug afetava `productSales` da Amazon). Corrigido com uma guarda que só protege contra apagar, nunca
  trava um valor novo real. Ver `project_bling_erp_integracao`/`project_amazon_ops_toggle_limitacao`
  na memória (ainda não escrito em CLAUDE.md como seção própria).
- **Tela de Integrações** (29/07) — status e liga/desliga por canal, dentro de Configurações. Ver 4.17.
- **Performance do `store.js`** (10/07) — índice em memória + busca binária (~60×). Ver seção 3.

## 10. Convenções

- Código em ES Modules (`"type": "module"`). Node 18+ (usa `fetch` nativo).
- Dependências mínimas: `express`, `dotenv`, `pg`. Manter simples — sem aws-sdk, sem axios.
- Toda a UI e textos em **pt-BR**. Valores em **BRL** (`Intl`/`toLocaleString('pt-BR')`).
- `.gitignore` inclui: `node_modules/`, `.env`, `data/db.json`, `*.log`, `.DS_Store`, `.claude/`.
