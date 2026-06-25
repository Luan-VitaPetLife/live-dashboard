# CLAUDE.md — Contexto do projeto (handoff para o terminal)

> Este arquivo é lido automaticamente pelo Claude Code ao abrir o projeto.
> Ele resume **tudo** que já foi decidido e descoberto, para retomar o trabalho sem repetir investigação.

## 1. O que é

Dashboard de vendas **multi-mercado e multicanal** das lojas de Luan (suplementos para pets).
- **Brasil 🇧🇷:** loja Shopify BR (`cocoandluna.com.br`) + Shopee + Mercado Livre
- **EUA 🇺🇸:** loja Shopify US (`vita-pet-life.myshopify.com`) + Amazon SP-API

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

### EUA
- Shopify US: **vita-pet-life.myshopify.com** · ~99 pedidos/30 dias confirmados.
- Amazon: SP-API configurado com LWA + AWS SigV4 via IAM AssumeRole.
  - IAM User: `arn:aws:iam::354674816862:user/usdashboard`
  - IAM Role: `arn:aws:iam::354674816862:role/SellingPartnerAPIRole`
  - Marketplace ID: `ATVPDKIKX0DER` (Amazon.com US)

## 3. Arquitetura

```
server.js               Express: serve public/ + API + agendador (sync a cada N min)
src/store.js            Banco híbrido: Postgres em produção (DATABASE_URL), JSON local no dev
src/shopify.js          Pedidos via GraphQL Admin API + sessões via ShopifyQL (multi-store via cfg)
src/shopee.js           Shopee Open API v2: assinatura HMAC, OAuth, refresh de token
src/mercadolivre.js     Mercado Livre OAuth 2.0 + API de pedidos
src/amazon.js           Amazon SP-API: LWA token + AWS SigV4 + STS AssumeRole + Orders API
src/meta.js             Meta Marketing API: gasto diário de anúncios (Instagram + Facebook)
src/metrics.js          Calcula o payload da dashboard por mercado (receita SEMPRE exclui cancelados)
src/sync.js             Orquestra a busca de todos os canais BR e US e grava no store
public/index.html       Dashboard principal (seletor de mercado, receita, tendência, canais, pedidos)
public/geografia.html   Página de mapa geográfico por estado (Leaflet.js) — mercado BR
public/Logo.svg         Logotipo exibido no topo do menu lateral
```

Fluxo: `sync.js` busca pedidos/sessões → grava em `store` → `metrics.js` calcula → `/api/dashboard`
devolve JSON → `public/*.html` desenham. As interfaces NÃO falam com Shopify/Shopee/ML/Amazon direto.

### Store (store.js) — detalhes importantes
- Variável `DATABASE_URL` presente → usa Postgres (Railway). Ausente → JSON em `data/db.json`.
- `initStore()` é async e DEVE ser chamado com `await` antes de `app.listen()`.
- Tabelas Postgres: `orders` (id TEXT PK, data JSONB), `sessions_daily` (date TEXT PK, data JSONB), `kv` (key TEXT PK, value JSONB).
- `kv` guarda: `shopeeTokens`, `mlTokens`, `metaInsightsDaily`, `lastSync`.
- `getOrders({ channel, since, until, market })` — filtra por mercado. Pedidos legados sem campo `market` são inferidos como `'br'` (exceto `channel === 'shopify_us'` → `'us'`).

## 4. Decisões e conhecimento de domínio (IMPORTANTE — não reinventar)

### 4.1 Receita precisa EXCLUIR pedidos cancelados/expirados
- **Bug descoberto:** ShopifyQL (`FROM sales`) **conta pedidos cancelados/expirados**. Não há como filtrar por status no ShopifyQL.
- **Solução adotada:** receita/pedidos/ticket/tendência/top-produtos vêm da **API GraphQL de pedidos**.
  Regra de exclusão (`isCancelled`): `cancelledAt != null` OU `displayFinancialStatus ∈ {EXPIRED, VOIDED, CANCELLED}`.
  Valor do pedido = `currentTotalPriceSet.shopMoney.amount`.
- **Decisão em aberto:** pedidos **PENDING** (Pix/boleto aguardando) HOJE ainda contam. Luan decide se quer só pagos.

### 4.2 Sessões / funil / conversão → ShopifyQL (apenas BR)
- Query: `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day SINCE -90d UNTIL today`.
- **Formato da resposta (API 2026-04+):** `shopifyqlQuery { tableData { columns { name } rows } parseErrors }`.
  `rows` é array de objetos com chaves nomeadas. `parseErrors` pode ser `[]` (truthy!) — checar com `.length`.
- **Escopos necessários:** `read_analytics` + `read_reports`. Sem `read_analytics`, `shopifyqlQuery` some do schema sem aviso.
- **Mercado US não tem sessões** — `hasSessionData = market === 'br' && (channel === 'todos' || channel === 'shopify')`.

### 4.3 Marketing por origem = atribuição, NÃO custo
- Referrer por pedido: `order.customerJourneySummary.lastVisit.source` (Instagram, Facebook, Google, etc.).

### 4.4 Meta Ads (Instagram + Facebook)
- Implementado em `src/meta.js`. Graph API v20.0, endpoint `act_{id}/insights`, paginação cursor.
- Gasto diário persistido no store (`kv`, chave `metaInsightsDaily`).
- ROAS calculado em `metrics.js`: receita de pedidos com source Instagram/Facebook ÷ gasto Meta.
- Credenciais: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`.

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

### 4.7 Amazon SP-API
- Implementado em `src/amazon.js`. Sem dependências externas (SigV4 e HMAC via `crypto` nativo do Node).
- **Fluxo de autenticação:**
  1. LWA token via `https://api.amazon.com/auth/o2/token` (refresh_token grant)
  2. STS AssumeRole em `https://sts.amazonaws.com/` usando AWS IAM User credentials (SigV4)
  3. Credenciais temporárias do role usadas para assinar chamadas ao SP-API (SigV4 + `x-amz-access-token`)
- **Endpoint:** `https://sellingpartnerapi-na.amazon.com/orders/v0/orders`
- **Restrição SP-API:** `CreatedBefore` deve ser pelo menos 2 min antes do momento atual — código já aplica margem de 3 min.
- **Rate limit:** ~1 req/min para o endpoint de orders. Sync a cada 15 min não tem problema.
- Sem `AMAZON_AWS_ACCESS_KEY` / `AMAZON_AWS_SECRET_KEY` → retorna `[]` com aviso no console, nada quebra.
- Pedidos Amazon: `channel: 'amazon'`, `market: 'us'`, moeda USD, sem items detalhados (requer chamada extra).

### 4.8 Multi-mercado — `market` field
- Campo `market: 'br' | 'us'` em todos os pedidos.
- Pedidos legados no banco (sem campo `market`) são inferidos como `'br'`.
- Canal `shopify_us` implica `market: 'us'`.
- `computeDashboard({ market })` separa tudo: byChannel, sessões, pedidos recentes.
- `byChannel` BR: `{ shopify, shopee, amazon, mercadolivre }`. US: `{ shopify_us, amazon }`.
- `getOrders({ market })` em store.js filtra corretamente legacy + novos pedidos.

### 4.9 Canais e UI — `public/index.html`
- **Seletor de mercado** no header: 🇧🇷 Brasil / 🇺🇸 EUA. Persiste em `localStorage('coco_market')`.
- **Canal dropdown dinâmico** por mercado — gerado por `buildChannelDropdown()` no JS. Não há opções fixas no HTML.
  - BR: Todos, Shopify, Shopee, Mercado Livre
  - US: Todos, Shopify US, Amazon
- Ao trocar mercado, canal reseta para `'todos'` automaticamente.
- **Cores customizáveis pelo usuário** via painel de configurações (ícone ⚙ no topbar):
  - Padrão canal: Shopify `#95BF47`, Shopify US `#7EAD3C`, Shopee `#EE4D2D`, ML `#FFE600`, Amazon `#111111`
  - Padrão marketing: Instagram `#E1306C`, Facebook `#1877F2`, Google `#6a8c6e`, etc.
  - Cores salvas em `localStorage('coco_colors')`. Reset restaura os padrões.
  - `DEFAULT_CH` e `DEFAULT_MKT` são as fontes de verdade. `CH` e `MKT_COLORS` são os objetos vivos mutados por `loadColors()`.
  - `contrastText(hex)` calcula texto branco/escuro por luminância automática.
  - `chBadgeHTML(chKey)` gera o badge colorido de canal.
- **Seletores** (Mercado, Métrica, Canal, Período, Atualizar) são **custom dropdowns** (`.csel`) — não são `<select>` nativos.
- O canal é o único dropdown com handler via delegação (`#channelPop`) — os outros usam `setupCsel`.
- Frequência de atualização persistida em `localStorage('coco_refresh')`, padrão 5 min.
- `lastData` armazena último payload da API para re-render ao trocar cores sem nova requisição.
- Card de tráfego/sessões: zerado automaticamente para mercado US ou canais não-Shopify.
- Top Produtos: quando canal = `todos`, exibe badge de canal + soma total no rodapé.
- Pedidos Recentes: linha de resumo com total dos pedidos válidos.
- Paleta/design: tema "earthy" com variáveis CSS no `:root`. Manter visual.

### 4.10 Página de Geografia — `public/geografia.html`
- **Biblioteca:** Leaflet.js 1.9.4 (CDN unpkg). Tile layer neutro CartoDB (sem labels de rua).
- **GeoJSON do Brasil:** carregado da API do IBGE em runtime.
  Cada feature tem `properties.codarea` (código IBGE 2 dígitos) → mapeado para UF via `IBGE_UF` no JS.
- **Dois modos de visualização:**
  - **Coropleto:** estados coloridos por intensidade. Labels permanentes UF + R$ sobre estados com dados.
  - **Calor:** bolhas proporcionais nos centroides com gradiente + glow. Labels em div icon.
- **Configurações do coropleto** (`choroConfig`) — persistidas em `localStorage('coco_choro_cfg')`: lowColor, midColor, highColor, borderColor, borderWeight, fillOpacity.
- **Popup ao clicar:** receita, pedidos, ticket médio, % do total.
- **Modal de estado:** clique em card de ranking abre modal com 4 KPIs + gráfico de barras comparativo.
- **Dados:** campo `byState` do `/api/dashboard` → `{ [UF]: { revenue, orders } }`.
  `byState` filtra `o.total > 0` para excluir cancelados.
- Mercado US: `byState` pode conter códigos de estado americanos (ex: "CA", "TX"), mas a página de geografia só renderiza estados brasileiros por ora.

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
| `META_ACCESS_TOKEN` | Token de acesso de longa duração (System User) |
| `META_AD_ACCOUNT_ID` | ID da conta de anúncios (sem o prefixo `act_`) |
| `AMAZON_CLIENT_ID` | LWA Client ID do app SP-API |
| `AMAZON_CLIENT_SECRET` | LWA Client Secret |
| `AMAZON_REFRESH_TOKEN` | LWA Refresh Token (obtido via autorização do app) |
| `AMAZON_ROLE_ARN` | ARN do IAM Role com permissões SP-API |
| `AMAZON_AWS_ACCESS_KEY` | Access Key do IAM User com permissão `sts:AssumeRole` no role acima |
| `AMAZON_AWS_SECRET_KEY` | Secret Key do mesmo IAM User |
| `DATABASE_URL` | Connection string Postgres (Railway injeta via `${{Postgres.DATABASE_URL}}`) |

**Armadilhas conhecidas:**
- `read_analytics` ausente → `shopifyqlQuery` some do schema sem aviso (não dá erro de permissão).
- Railway NÃO injeta `DATABASE_URL` automaticamente — adicionar manualmente: `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.
- Amazon SP-API `CreatedBefore` deve ser ≥2 min antes do momento atual — código já aplica margem de 3 min.
- O IAM User precisa de política `sts:AssumeRole` no Role E o Role precisa ter o User no Trust Policy.

## 7. Como rodar / endpoints

- `npm install` → `npm start` (porta 3000). Sync roda ao subir e a cada `SYNC_INTERVAL_MINUTES`.
- `npm run sync` faz uma sincronização única (útil para testar credenciais).
- Endpoints:
  - `GET /api/dashboard?channel=&metric=&since=YYYY-MM-DD&until=YYYY-MM-DD&market=br|us`
  - `POST /api/sync`
  - `GET /shopee/connect` e `GET /shopee/callback`
  - `GET /mercadolivre/connect` e `GET /mercadolivre/callback`
  - `GET /health`

## 8. Próximos passos (backlog priorizado)

1. **Autorizar a Shopee** (`SHOPEE_PRODUCTION=1` + `/shopee/connect` após aprovação da Shopee).
2. Decidir tratamento de **PENDING** (contar só pagos?) — ver 4.1.
3. **Google Ads** para custo/ROAS de Google.
4. Login/usuários se mais pessoas precisarem acessar.
5. Página de Geografia para mercado US (mapa dos EUA por estado).

## 9. Convenções

- Código em ES Modules (`"type": "module"`). Node 18+ (usa `fetch` nativo).
- Dependências mínimas: `express`, `dotenv`, `pg`. Manter simples — sem aws-sdk, sem axios.
- Toda a UI e textos em **pt-BR**. Valores em **BRL** (`Intl`/`toLocaleString('pt-BR')`).
- `.gitignore` inclui: `node_modules/`, `.env`, `data/db.json`, `*.log`, `.DS_Store`, `.claude/`.
