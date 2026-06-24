# CLAUDE.md — Contexto do projeto (handoff para o terminal)

> Este arquivo é lido automaticamente pelo Claude Code ao abrir o projeto.
> Ele resume **tudo** que já foi decidido e descoberto, para retomar o trabalho sem repetir investigação.

## 1. O que é

Dashboard de vendas **multicanal** da loja **Coco and Luna** (suplementos para pets, Brasil).
Objetivo do dono (Luan, perfil de negócio, não-dev): uma tela única, ao vivo, com Shopify + Shopee
(e depois Amazon) e, no futuro, custo/ROAS de Ads. Idioma da interface: **pt-BR**.

**Produção:** `https://live-dashboard-vitapetlife.up.railway.app` (Railway, auto-deploy do branch `master`
do repositório `https://github.com/Luan-VitaPetLife/live-dashboard.git`).

## 2. Dados da loja (fatos confirmados)

- Loja Shopify: **cocoandluna.com.br** · domínio admin **ebb5cd.myshopify.com**
- Moeda **BRL**, país **Brasil**, fuso **-03** (use `STORE_OFFSET_MINUTES=-180` para bucketizar por hora/dia).
- Volume **baixo**: ~73 pedidos/30 dias. Paginação simples já dá conta.
- Produto principal: **"Lisina para gatos - 120g"** (e combos de 2/3 unidades); também "Daily".
- Versão da Admin API em uso: **2026-04** (`SHOPIFY_API_VERSION`). Não usar versões anteriores a 2025-10.

## 3. Arquitetura

```
server.js               Express: serve public/ + API + agendador (sync a cada N min)
src/store.js            Banco híbrido: Postgres em produção (DATABASE_URL), JSON local no dev
src/shopify.js          Pedidos via GraphQL Admin API + sessões via ShopifyQL
src/shopee.js           Shopee Open API v2: assinatura HMAC, OAuth, refresh de token
src/mercadolivre.js     Mercado Livre OAuth 2.0 + API de pedidos
src/metrics.js          Calcula o payload da dashboard a partir do store (receita SEMPRE exclui cancelados)
src/sync.js             Orquestra a busca de todos os canais e grava no store
public/index.html       Dashboard principal (receita, tendência, canais, marketing, funil, pedidos)
public/geografia.html   Página de mapa geográfico por estado (Leaflet.js)
public/Logo.svg         Logotipo exibido no topo do menu lateral
```

Fluxo: `sync.js` busca pedidos/sessões → grava em `store` → `metrics.js` calcula → `/api/dashboard`
devolve JSON → `public/*.html` desenham. As interfaces NÃO falam com Shopify/Shopee/ML direto.

### Store (store.js) — detalhes importantes
- Variável `DATABASE_URL` presente → usa Postgres (Railway). Ausente → JSON em `data/db.json`.
- `initStore()` é async e DEVE ser chamado com `await` antes de `app.listen()`.
- Tabelas Postgres: `orders` (id TEXT PK, data JSONB), `sessions_daily` (date TEXT PK, data JSONB), `kv` (key TEXT PK, value JSONB).
- `kv` guarda: `shopeeTokens`, `mlTokens`, `lastSync`.

## 4. Decisões e conhecimento de domínio (IMPORTANTE — não reinventar)

### 4.1 Receita precisa EXCLUIR pedidos cancelados/expirados
- **Bug descoberto:** ShopifyQL (`FROM sales`) **conta pedidos cancelados/expirados**. Não há como filtrar por status no ShopifyQL.
- **Solução adotada:** receita/pedidos/ticket/tendência/top-produtos vêm da **API GraphQL de pedidos**.
  Regra de exclusão (`isCancelled`): `cancelledAt != null` OU `displayFinancialStatus ∈ {EXPIRED, VOIDED, CANCELLED}`.
  Valor do pedido = `currentTotalPriceSet.shopMoney.amount`.
- **Decisão em aberto:** pedidos **PENDING** (Pix/boleto aguardando) HOJE ainda contam. Luan decide se quer só pagos.

### 4.2 Sessões / funil / conversão → ShopifyQL (não afetado por cancelamento)
- Query: `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day SINCE -90d UNTIL today`.
- **Formato da resposta (API 2026-04+):** `shopifyqlQuery { tableData { columns { name } rows } parseErrors }`.
  `rows` é array de objetos com chaves nomeadas. `parseErrors` pode ser `[]` (truthy!) — checar com `.length`.
- **Escopos necessários:** `read_analytics` + `read_reports`. Sem `read_analytics`, `shopifyqlQuery` some do schema sem aviso.

### 4.3 Marketing por origem = atribuição, NÃO custo
- Referrer por pedido: `order.customerJourneySummary.lastVisit.source` (Instagram, Facebook, Google, etc.).

### 4.4 Custo de Ads / ROAS → NÃO existe no Shopify
- Custo, ROAS e ACOS ficam **0** com nota. Próximo passo: integrar Google Ads API e Meta Marketing API.

### 4.5 Shopee
- Usar **Open Platform API v2** direto (`src/shopee.js`). Host: `https://partner.shopeemobile.com`.
- Assinatura: `HMAC_SHA256(partner_key, partner_id + path + timestamp [+ access_token + shop_id])` em hex.
- OAuth: `/shopee/connect` → autoriza → callback troca `code` por tokens. Token renovado automaticamente.
- **Pendente:** cadastrar `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID` no Railway e autorizar via `/shopee/connect`.

### 4.6 Mercado Livre
- Implementado em `src/mercadolivre.js`. OAuth 2.0 com refresh_token automático.
- **CRÍTICO — domínio correto:** `https://api.mercadolibre.com` (espanhol "libre", NÃO "livre"). Não reverter.
- Tokens persistidos no Postgres (`kv`, chave `mlTokens`). **Após cada novo deploy, re-autorizar via `/mercadolivre/connect`.**
- Cancelados ML: status `cancelled` ou `invalid`. Sem tokens → retorna `[]`, canal fica 0, nada quebra.

### 4.7 Canais e UI — `public/index.html`
- Canais: `todos`, `shopify`, `shopee`, `amazon`, `mercadolivre`. Amazon é placeholder (sem integração).
- **Cores customizáveis pelo usuário** via painel de configurações (ícone ⚙ no topbar):
  - Padrão canal: Shopify `#95BF47`, Shopee `#EE4D2D`, ML `#FFE600`, Amazon `#111111`
  - Padrão marketing: Instagram `#E1306C`, Facebook `#1877F2`, Google `#6a8c6e`, etc.
  - Cores salvas em `localStorage('coco_colors')`. Reset restaura os padrões.
  - `DEFAULT_CH` e `DEFAULT_MKT` são as fontes de verdade. `CH` e `MKT_COLORS` são os objetos vivos mutados por `loadColors()`.
  - `contrastText(hex)` calcula texto branco/escuro por luminância automática.
  - `chBadgeHTML(chKey)` gera o badge colorido de canal.
- **Seletores** (Métrica, Canal, Período, Atualizar) são **custom dropdowns** (`.csel`) — não são `<select>` nativos.
- Frequência de atualização persistida em `localStorage('coco_refresh')`, padrão 5 min.
- `lastData` armazena último payload da API para re-render ao trocar cores sem nova requisição.
- Top Produtos: quando canal = `todos`, exibe badge de canal + soma total no rodapé.
- Pedidos Recentes: linha de resumo com total dos pedidos válidos.
- Paleta/design: tema "earthy" com variáveis CSS no `:root`. Manter visual.

### 4.8 Página de Geografia — `public/geografia.html`
- **Biblioteca:** Leaflet.js 1.9.4 (CDN unpkg). Tile layer neutro CartoDB (sem labels de rua).
- **GeoJSON do Brasil:** carregado da API do IBGE em runtime:
  `https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&formato=application/vnd.geo+json&qualidade=minima`
  Cada feature tem `properties.codarea` (código IBGE 2 dígitos) → mapeado para UF via `IBGE_UF` no JS.
- **Dois modos de visualização:**
  - **Coropleto:** estados coloridos por intensidade (creme→laranja→vinho escuro). Labels permanentes com UF + R$ sobre cada estado com dados. Hover destaca borda.
  - **Calor:** bolhas proporcionais nos centroides (`CENTROIDS`) com gradiente verde→amarelo→vermelho + glow externo. Labels em div icon.
- **Popup ao clicar** (em ambos os modos): receita, pedidos, ticket médio, % do total.
- **Dados:** campo `byState` do `/api/dashboard` → `{ [UF]: { revenue, orders } }`.
  Alimentado por `o.state` nos pedidos Shopify, que vem de `shippingAddress.provinceCode`.
  Pedidos antigos no banco não têm `state` — é preciso sincronizar após o deploy.
- **Bug de sync corrigido:** layers são removidos (`map.removeLayer`) e redesenhados a cada chamada de `loadData()`.
  Não reusar instâncias de chart — sempre `clearLayers()` antes de `drawMap()`.

## 5. Modelo de dados (pedido normalizado)

```js
{
  id, channel,            // 'shopify' | 'shopee' | 'mercadolivre' | 'amazon'
  name, createdAt,        // ISO (UTC)
  status, cancelled,      // cancelled = bool já calculado
  total,                  // número (BRL)
  source,                 // origem de marketing ('Instagram' | 'Shopee' | 'Mercado Livre' | '')
  customer,
  state,                  // código UF do endereço de entrega ('SP', 'RJ', ...) — só Shopify por ora
  items: [{ title, qty, amount }]
}
```

## 6. Configuração (.env)

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (Railway injeta automaticamente) |
| `SYNC_INTERVAL_MINUTES` | Frequência do sync automático (padrão 15) |
| `STORE_OFFSET_MINUTES` | Fuso da loja em minutos do UTC. Brasil = `-180` |
| `SHOPIFY_STORE` | Domínio `.myshopify.com` |
| `SHOPIFY_ADMIN_TOKEN` | Token do custom app (escopos: `read_orders`, `read_products`, `read_reports`, `read_analytics`, `read_customers`) |
| `SHOPIFY_API_VERSION` | Manter `2026-04` ou posterior |
| `SHOPEE_PARTNER_ID/KEY/SHOP_ID` | Credenciais Shopee Open Platform |
| `SHOPEE_REDIRECT_URL` | URL de callback OAuth da Shopee |
| `SHOPEE_PRODUCTION` | `1` para produção Shopee |
| `ML_CLIENT_ID` | App ID do Mercado Livre |
| `ML_CLIENT_SECRET` | Secret do app Mercado Livre |
| `ML_REDIRECT_URL` | URL de callback OAuth do ML |
| `DATABASE_URL` | Connection string Postgres (Railway injeta via `${{Postgres.DATABASE_URL}}`) |

**Armadilhas conhecidas:**
- `read_analytics` ausente → `shopifyqlQuery` some do schema sem aviso (não dá erro de permissão).
- Railway NÃO injeta `DATABASE_URL` automaticamente — adicionar manualmente: `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.

## 7. Como rodar / endpoints

- `npm install` → `npm start` (porta 3000). Sync roda ao subir e a cada `SYNC_INTERVAL_MINUTES`.
- `npm run sync` faz uma sincronização única (útil para testar credenciais).
- Endpoints:
  - `GET /api/dashboard?channel=&metric=&since=YYYY-MM-DD&until=YYYY-MM-DD`
  - `POST /api/sync`
  - `GET /shopee/connect` e `GET /shopee/callback`
  - `GET /mercadolivre/connect` e `GET /mercadolivre/callback`
  - `GET /health`

## 8. Próximos passos (backlog priorizado)

1. **Autorizar a Shopee** (`SHOPEE_PARTNER_ID/KEY/SHOP_ID` no Railway + `/shopee/connect`).
2. **Google Ads + Meta Ads** para custo/ROAS/ACOS reais.
3. Decidir tratamento de **PENDING** (contar só pagos?) — ver 4.1.
4. Amazon como canal real.
5. Login/usuários se mais pessoas precisarem acessar.

## 9. Convenções

- Código em ES Modules (`"type": "module"`). Node 18+ (usa `fetch` nativo).
- Dependências mínimas: `express`, `dotenv`, `pg`. Manter simples.
- Toda a UI e textos em **pt-BR**. Valores em **BRL** (`Intl`/`toLocaleString('pt-BR')`).
- `.gitignore` inclui: `node_modules/`, `.env`, `data/db.json`, `*.log`, `.DS_Store`, `.claude/`.
