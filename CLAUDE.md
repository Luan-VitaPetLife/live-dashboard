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
- Amazon BR: SP-API endpoint South America (`sellingpartnerapi-sa.amazon.com`), Marketplace ID `A2Q3Y263D00KWC`. Credenciais LWA separadas (`AMAZON_BR_*`), mas compartilha o mesmo IAM User/Role da conta US.

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
src/mercadolivre.js     Mercado Livre OAuth 2.0 + API de pedidos + fetchAdCosts (ML Product Ads)
src/amazon.js           Amazon SP-API (EUA + BR): LWA token por mercado + AWS SigV4 + STS AssumeRole + Orders API
src/meta.js             Meta Marketing API: gasto diário BR e US (fetchInsights aceita accountId)
src/metrics.js          Calcula o payload da dashboard por mercado (receita SEMPRE exclui cancelados)
src/sync.js             Orquestra a busca de todos os canais BR e US e grava no store
public/index.html       Dashboard principal (toggle de mercado, receita, tendência, canais, pedidos)
public/geografia.html   Mapa geográfico por estado BR (Leaflet.js, Voyager tile, coropleto + calor)
public/geografia-us.html Mapa geográfico por estado US (Leaflet.js, Voyager tile, coropleto + calor)
public/bandeira_brasil.webp  Imagem da bandeira BR usada nos botões de mercado
public/bandeira_eua.svg      Imagem da bandeira EUA usada nos botões de mercado
public/Logo.svg         Logotipo exibido no topo do menu lateral
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
- `fetchInsights(sinceISO, untilISO, accountId?)` — `accountId` padrão = `META_AD_ACCOUNT_ID` (BR).
- **BR:** conta Coco and Luna → `META_AD_ACCOUNT_ID`. Store key: `metaInsightsDaily`.
- **EUA:** conta Vita Pet Life → `META_US_AD_ACCOUNT_ID` (`826249215807271`). Store key: `metaUSInsightsDaily`.
- `metrics.js` seleciona o dataset correto por `market`.
- ROAS calculado em `metrics.js`: receita de pedidos com source Instagram/Facebook ÷ gasto Meta.

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
- **ML Product Ads (`fetchAdCosts`) — fluxo correto (Mercado Ads API, exige header `Api-Version: 1`):**
  1. Resolver advertiser: `GET /advertising/advertisers?product_id=PADS` → `advertiser_id` + `site_id`.
  2. Métricas: `GET /marketplace/advertising/{site_id}/advertisers/{advertiser_id}/product_ads/campaigns/search`
     com `metrics=clicks,prints,cost` + `date_from`/`date_to`; soma `cost`/`clicks`/`prints` dos `results`.
  - **Por que ainda vinha zero:** o código antigo usava `seller_id` num endpoint inexistente e SEM o header `Api-Version`. Corrigido.
  - **Pré-requisito:** o app precisa ter permissão de **Mercado Ads** habilitada e a conta reautorizada via `/mercadolivre/connect`. Sem isso, `/advertising/advertisers` retorna 403 e `fetchAdCosts` devolve zeros graciosamente.
- `mlBreakdown` exposto em `metrics.js`: `{ organic, premium, adCost, adClicks, roas }`.

### 4.7 Amazon SP-API (EUA + BR) — UM app, UMA chamada combinada
- Implementado em `src/amazon.js`. Sem dependências externas (SigV4 e HMAC via `crypto` nativo do Node).
- **FATO CRÍTICO (verificado via `/sellers/v1/marketplaceParticipations`):** o **mesmo** app/refresh-token
  (`AMAZON_CLIENT_ID/SECRET/REFRESH_TOKEN`) está autorizado para **US (`ATVPDKIKX0DER`) E BR (`A2Q3Y263D00KWC`)**.
  Não existem mais credenciais BR separadas. `AMAZON_BR_*` foi abandonado. `isConfiguredBR()` === `isConfigured()`.
- **Endpoint único:** `sellingpartnerapi-na.amazon.com` (região NA) serve **os dois** marketplaces (BR é região NA, não SA).
- **Chamada COMBINADA (a correção do bug "Amazon US nunca aparecia"):** uma única requisição a `/orders/v0/orders`
  com `MarketplaceIds=ATVPDKIKX0DER,A2Q3Y263D00KWC`. Cada pedido traz seu próprio `MarketplaceId` → separado por
  `MARKET_BY_MP` em US (`channel: 'amazon_us'`, `market: 'us'`) e BR (`channel: 'amazon'`, `market: 'br'`).
  - **Por que combinar:** a cota da Orders API (~0,0167 req/s, balde compartilhado por app/conta) era drenada pela
    BR (que rodava primeiro no `sync.js`); a US vinha logo depois e levava 429 → backoff escalante → **US nunca ganhava a vez**.
    Uma chamada só elimina a competição e usa metade da cota.
- **Fluxo de autenticação:** 1) LWA token (`getLwaToken`) · 2) STS AssumeRole (IAM User, compartilhado) · 3) SigV4 + `x-amz-access-token`.
- **Funções exportadas:** `fetchOrders(since, until)` devolve **US+BR juntos**. `fetchOrdersBR()` é no-op (compat) — BR já vem no `fetchOrders`.
- **RDT (nome do comprador):** desativado por padrão — o app não tem o papel PII (retornava 403 e gastava requisição).
  Reative com `AMAZON_FETCH_PII=1` só se o papel for aprovado.
- **Restrição SP-API:** `CreatedBefore` ≥ 2 min antes de agora — código aplica margem de 3 min.
- **Backoff (balde ÚNICO `kv.amazonBackoff`):** só dispara em 429; degraus 15→30→60→120 min; contador zera após sucesso.
  Reset/force via `POST /api/amazon/{reset-backoff,force-sync}` (os `/api/amazon-br/*` também resetam o balde compartilhado).
  - **⚠️ Se levar 429 mesmo combinado:** a cota da conta pode estar penalizada por excesso sustentado de chamadas. A cura é
    PARAR de martelar (deixar o backoff agir, não usar force-sync em loop) e esperar a cota se restaurar — NÃO remover o backoff.
- Sem `AMAZON_AWS_ACCESS_KEY` / `SECRET_KEY` → retorna `[]` com aviso, nada quebra.
- **IDs de pedido:** `amazon-us:` (EUA) e `amazon-br:` (BR) — evita colisão.

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
- **Sidebar ocultável:** botão `☰` (`#sidebarToggle`) no início da topbar. Desktop: toggle com animação + `localStorage('coco_sidebar')`. Mobile (≤768px): sidebar começa oculta, abre como overlay com `#sidebarOverlay`. Classe `body.sidebar-hidden` oculta a sidebar no desktop; `body.sidebar-mobile-open` abre como drawer no mobile.
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
  - Outros canais (shopee, mercadolivre, amazon): oculta também `#cardTraffic` e `#cardFunnel`.
  - `channel === 'mercadolivre'`: exibe `#cardMlBreakdown` (Clássico, Destaque, Custo ML Ads, ROAS ML Ads).
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
- Paleta/design: tema "earthy" com variáveis CSS no `:root`. Manter visual.

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

## 5. Modelo de dados (pedido normalizado)

```js
{
  id, channel,            // 'shopify' | 'shopify_us' | 'shopee' | 'mercadolivre' | 'amazon'
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
| `AMAZON_CLIENT_ID` | LWA Client ID do app SP-API (EUA) |
| `AMAZON_CLIENT_SECRET` | LWA Client Secret (EUA) |
| `AMAZON_REFRESH_TOKEN` | LWA Refresh Token (EUA) |
| `AMAZON_BR_CLIENT_ID` | LWA Client ID do app SP-API (Brasil) |
| `AMAZON_BR_CLIENT_SECRET` | LWA Client Secret (Brasil) |
| `AMAZON_BR_REFRESH_TOKEN` | LWA Refresh Token (Brasil) |
| `AMAZON_ROLE_ARN` | ARN do IAM Role com permissões SP-API — compartilhado entre EUA e BR |
| `AMAZON_AWS_ACCESS_KEY` | Access Key do IAM User com permissão `sts:AssumeRole` no role acima |
| `AMAZON_AWS_SECRET_KEY` | Secret Key do mesmo IAM User |
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
  - `POST /api/sync`
  - `GET /api/status` — diagnóstico: credenciais configuradas, backoff Amazon, último sync
  - `POST /api/amazon/reset-backoff` — zera o backoff da Amazon manualmente
  - `POST /api/amazon/force-sync` — zera backoff + executa sync atomicamente
  - `GET /shopee/connect` e `GET /shopee/callback`
  - `GET /mercadolivre/connect` e `GET /mercadolivre/callback`
  - `GET /health`

## 8. Status das integrações (29/06/2026)

### Amazon US SP-API — ativo ✅
- **IAM Role `SellingPartnerAPIRole`**: política `SPAPIInvokePolicy` com `execute-api:Invoke` em `*`. Trust policy inclui `usdashboard` user. ✅
- **Autenticação confirmada:** retornou pedidos reais de março/2026 com HTTP 200. ✅
- **Janela de sync:** 90 dias. Rate limit: 0.0167 req/s (burst 20). Backoff de 1h por sync.
- **Endpoint `POST /api/amazon/reset-backoff?delay=N`:** aceita `delay` em minutos para definir backoff customizado.

### Amazon BR SP-API — código implementado, aguardando credenciais ⏳
- Código em `src/amazon.js` (`fetchOrdersBR`) e bloco de sync em `src/sync.js` já prontos.
- **Pendente:** cadastrar `AMAZON_BR_CLIENT_ID`, `AMAZON_BR_CLIENT_SECRET`, `AMAZON_BR_REFRESH_TOKEN` no Railway. Requer criação/autorização de app SP-API separado para o marketplace Brasil (`A2Q3Y263D00KWC`).
- Sem as credenciais BR, o bloco é silenciosamente ignorado (nada quebra).

### Shopee — ativa ✅
- Credenciais de produção configuradas: Partner ID 2037711, Shop ID 1502160212.
- 83 pedidos confirmados no banco. Chunking de 15 dias implementado em `src/shopee.js`.
- Analytics da Shopee (tráfego, insights) **não disponível via API** — só no Seller Center. Endpoints retornam `error_not_found`.

### Mercado Livre — ativo ✅
- OAuth autorizado. Tokens persistidos no Postgres. Re-autorizar após deploy via `/mercadolivre/connect`.
- 140 pedidos no banco. ML Ads (`write:product_ads`) ainda não autorizado.

## 9. Próximos passos (backlog priorizado)

1. **Amazon BR:** criar/autorizar app SP-API para marketplace Brasil e cadastrar `AMAZON_BR_*` no Railway — código já está pronto.
2. Decidir tratamento de **PENDING** (contar só pagos?) — ver 4.1.
3. **Google Ads** para custo/ROAS de Google.
4. **ML Ads:** re-autorizar OAuth com escopo `write:product_ads` para ativar custo de campanha no card ML Breakdown.
5. Login/usuários se mais pessoas precisarem acessar.

## 10. Convenções

- Código em ES Modules (`"type": "module"`). Node 18+ (usa `fetch` nativo).
- Dependências mínimas: `express`, `dotenv`, `pg`. Manter simples — sem aws-sdk, sem axios.
- Toda a UI e textos em **pt-BR**. Valores em **BRL** (`Intl`/`toLocaleString('pt-BR')`).
- `.gitignore` inclui: `node_modules/`, `.env`, `data/db.json`, `*.log`, `.DS_Store`, `.claude/`.
