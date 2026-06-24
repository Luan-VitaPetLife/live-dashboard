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
public/index.html       A dashboard (interface) — lê de /api/dashboard
public/Logo.svg         Logotipo exibido no topo do menu lateral
```

Fluxo: `sync.js` busca pedidos/sessões → grava em `store` → `metrics.js` calcula → `/api/dashboard`
devolve JSON → `public/index.html` desenha. A interface NÃO fala com Shopify/Shopee/ML direto.

### Store (store.js) — detalhes importantes
- Variável `DATABASE_URL` presente → usa Postgres (Railway). Ausente → JSON em `data/db.json`.
- `initStore()` é async e DEVE ser chamado com `await` antes de `app.listen()` (top-level await em ESM).
- Interface pública síncrona: cache em memória carregado no startup; escritas disparam upserts async em background.
- Tabelas Postgres: `orders` (id TEXT PK, data JSONB), `sessions_daily` (date TEXT PK, data JSONB), `kv` (key TEXT PK, value JSONB).
- `kv` guarda: `shopeeTokens`, `mlTokens`, `lastSync`.

## 4. Decisões e conhecimento de domínio (IMPORTANTE — não reinventar)

### 4.1 Receita precisa EXCLUIR pedidos cancelados/expirados
- **Bug descoberto:** ShopifyQL (`FROM sales`) **conta pedidos cancelados/expirados**. Não há como filtrar
  por status no ShopifyQL (colunas `financial_status` etc. não existem no dataset `sales`).
- **Solução adotada:** receita/pedidos/ticket/tendência/top-produtos vêm da **API GraphQL de pedidos**.
  Regra de exclusão (`isCancelled`): `cancelledAt != null` OU `displayFinancialStatus ∈ {EXPIRED, VOIDED, CANCELLED}`.
  Valor do pedido = `currentTotalPriceSet.shopMoney.amount`.
- **Decisão em aberto:** pedidos **PENDING** (Pix/boleto aguardando) HOJE ainda contam. Luan decide se quer só pagos.

### 4.2 Sessões / funil / conversão → ShopifyQL (não afetado por cancelamento)
- Query: `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions,
  sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day SINCE -90d UNTIL today`.
- Guardamos uma linha **por dia** (últimos 90 dias). Conversão = completados/sessões.
- **Formato da resposta (API 2026-04+):** `shopifyqlQuery { tableData { columns { name } rows } parseErrors }`.
  `rows` é array de objetos com chaves nomeadas. `parseErrors` pode ser `[]` (truthy!) — checar com `.length`.
- **Escopos necessários:** `read_analytics` + `read_reports`. Sem `read_analytics`, `shopifyqlQuery` some do schema sem aviso.

### 4.3 Marketing por origem = atribuição, NÃO custo
- Referrer por pedido: `order.customerJourneySummary.lastVisit.source` (Instagram, Facebook, Google, etc.).
- O card "Marketing por origem" usa isso (consistente com a receita corrigida, pois sai dos mesmos pedidos válidos).

### 4.4 Custo de Ads / ROAS → NÃO existe no Shopify
- Custo, ROAS e ACOS ficam **0** com nota. Próximo passo: integrar Google Ads API e Meta Marketing API (OAuth separados).

### 4.5 Shopee
- Usar **Open Platform API v2** direto (implementada em `src/shopee.js`).
- Host produção: `https://partner.shopeemobile.com`.
- Assinatura: `HMAC_SHA256(partner_key, partner_id + path + timestamp [+ access_token + shop_id])` em hex.
- OAuth: `/shopee/connect` → autoriza → callback troca `code` por `access_token` (~4h) + `refresh_token` (~30d).
  Token renovado automaticamente em `validToken()`.
- Enquanto não autorizada, `fetchOrders` retorna `[]` — canal fica 0, nada quebra.
- **Pendente:** cadastrar `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID` no Railway e autorizar via `/shopee/connect`.

### 4.6 Mercado Livre
- Implementado em `src/mercadolivre.js`. OAuth 2.0 (authorization_code + refresh_token automático).
- **CRÍTICO — domínio correto:** `https://api.mercadolibre.com` (espanhol "libre", NÃO "livre"). A URL errada
  resulta em `ENOTFOUND` — já corrigido, mas não reverter.
- `buildAuthUrl()` → redireciona para ML → callback em `/mercadolivre/callback` troca `code` por tokens.
- Tokens persistidos no Postgres (tabela `kv`, chave `mlTokens`). **Após cada novo deploy no Railway, re-autorizar
  via `/mercadolivre/connect` se os tokens não estiverem no Postgres.**
- Cancelados ML: status `cancelled` ou `invalid`.
- Se não configurado ou sem tokens, retorna `[]` — canal fica 0, nada quebra.

### 4.7 Canais e UI
- Canais: `todos`, `shopify`, `shopee`, `amazon`, `mercadolivre`. Amazon é **placeholder** (sem integração) — mostra 0, sem aviso.
- **Cores de canal — fonte única de verdade (`CH` em `public/index.html`):**
  ```js
  const CH = {
    shopify:      { bg:'#95BF47', text:'#fff',  label:'Shopify' },
    shopee:       { bg:'#EE4D2D', text:'#fff',  label:'Shopee' },
    mercadolivre: { bg:'#FFE600', text:'#333',  label:'Mercado Livre' },
    amazon:       { bg:'#FF9900', text:'#333',  label:'Amazon' },
  };
  ```
  Sempre usar `chBadgeHTML(chKey)` para badges (Top Produtos, Pedidos Recentes) e `CH[k].bg` para o donut de channel split.
- **Seletores** (Métrica, Canal, Atualizar) são **custom dropdowns** (`.csel`) — não são `<select>` nativos.
  Frequência de atualização persistida em localStorage (`coco_refresh`), padrão 5 min.
- Paleta/design: tema "earthy" com variáveis CSS no `:root`. Manter visual.

## 5. Modelo de dados (pedido normalizado)

```js
{
  id, channel,            // 'shopify' | 'shopee' | 'mercadolivre' | 'amazon'
  name, createdAt,        // ISO (UTC)
  status, cancelled,      // cancelled = bool já calculado
  total,                  // número (BRL)
  source,                 // origem de marketing ('Instagram' | 'Shopee' | 'Mercado Livre' | '')
  customer,
  items: [{ title, qty, amount }]
}
```

## 6. Configuração (.env)

Veja `.env.example`. Principais variáveis:

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
| `ML_REDIRECT_URL` | URL de callback OAuth do ML (ex: `https://live-dashboard-vitapetlife.up.railway.app/mercadolivre/callback`) |
| `DATABASE_URL` | Connection string Postgres (Railway injeta via `${{Postgres.DATABASE_URL}}`) |

**Armadilhas conhecidas do token Shopify:**
- `read_customers` ausente → campo `customer` vazio nos pedidos, mas receita chega normalmente.
- `read_analytics` ausente → `shopifyqlQuery` some do schema sem aviso (não dá erro de permissão).

**Railway — configuração do DATABASE_URL:**
- O serviço Postgres do Railway NÃO injeta `DATABASE_URL` automaticamente no serviço da app.
- É preciso adicionar manualmente na aba Variables do serviço `live-dashboard`:
  `DATABASE_URL = ${{Postgres.DATABASE_URL}}`

## 7. Como rodar / endpoints

- `npm install` → `npm start` (porta 3000). Sync roda ao subir e a cada `SYNC_INTERVAL_MINUTES`.
- `npm run sync` faz uma sincronização única (útil para testar credenciais).
- Endpoints:
  - `GET /api/dashboard?channel=&metric=&since=YYYY-MM-DD&until=YYYY-MM-DD`
  - `POST /api/sync`
  - `GET /shopee/connect` e `GET /shopee/callback`
  - `GET /mercadolivre/connect` e `GET /mercadolivre/callback`
  - `GET /health`
- Testado sem credenciais: servidor sobe, `/health` ok, `/api/dashboard` devolve zeros (não quebra).

## 8. Próximos passos (backlog priorizado)

1. **Autorizar a Shopee** (`SHOPEE_PARTNER_ID/KEY/SHOP_ID` no Railway + `/shopee/connect`) e validar campos de valor/itens com dados reais.
2. **Google Ads + Meta Ads** para custo/ROAS/ACOS reais (preencher KPI "Custo Campanhas").
3. Decidir tratamento de **PENDING** (contar só pagos?) — ver 4.1.
4. Amazon como canal real (mesma lógica do ML/Shopee).
5. Login/usuários se mais pessoas precisarem acessar.

## 9. Convenções

- Código em ES Modules (`"type": "module"`). Node 18+ (usa `fetch` nativo).
- Dependências mínimas: `express`, `dotenv`, `pg`. Manter simples.
- Toda a UI e textos em **pt-BR**. Valores em **BRL** (`Intl`/`toLocaleString('pt-BR')`).
- `.gitignore` inclui: `node_modules/`, `.env`, `data/db.json`, `*.log`, `.DS_Store`, `.claude/`.
