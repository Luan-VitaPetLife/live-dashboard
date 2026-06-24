# CLAUDE.md — Contexto do projeto (handoff para o terminal)

> Este arquivo é lido automaticamente pelo Claude Code ao abrir o projeto.
> Ele resume **tudo** que já foi decidido e descoberto, para retomar o trabalho sem repetir investigação.

## 1. O que é

Dashboard de vendas **multicanal** da loja **Coco and Luna** (suplementos para pets, Brasil).
Começou como um protótipo HTML que lia dados ao vivo via conectores (Cowork/MCP) e está sendo
transformado num **app web próprio** (backend Node + interface) para poder integrar a **Shopee**
e o **custo de anúncios**, que não são acessíveis pelo conector da Shopify.

Objetivo do dono (Luan, perfil de negócio, não-dev): uma tela única, ao vivo, com Shopify + Shopee
(e depois Amazon/Mercado Livre) e, no futuro, custo/ROAS de Ads. Idioma da interface: **pt-BR**.

## 2. Dados da loja (fatos confirmados)

- Loja Shopify: **cocoandluna.com.br** · domínio admin **ebb5cd.myshopify.com**
- Moeda **BRL**, país **Brasil**, fuso **-03** (use `STORE_OFFSET_MINUTES=-180` para bucketizar por hora/dia).
- Volume **baixo**: ~73 pedidos/30 dias. Paginação simples já dá conta.
- Produto principal: **"Lisina para gatos - 120g"** (e combos de 2/3 unidades); também "Daily".
- Versão da Admin API em uso: **2026-04** (`SHOPIFY_API_VERSION`). Não usar versões anteriores a 2025-10 — o `shopifyqlQuery` só foi introduzido nessa versão.

## 3. Arquitetura

```
server.js            Express: serve public/ + API + agendador (sync a cada N min)
src/store.js         "Banco" em JSON (data/db.json). Trocar por Postgres mantendo a mesma interface.
src/shopify.js       Pedidos via GraphQL Admin API + sessões via ShopifyQL (shopifyqlQuery)
src/shopee.js        Shopee Open API v2: assinatura HMAC, OAuth, refresh de token, get_order_list/detail
src/metrics.js       Calcula o payload da dashboard a partir do store (receita SEMPRE exclui cancelados)
src/sync.js          Orquestra a busca de todos os canais e grava no store
public/index.html    A dashboard (interface) — lê de /api/dashboard
```

Fluxo: `sync.js` busca pedidos/sessões → grava em `store` → `metrics.js` calcula → `/api/dashboard`
devolve JSON → `public/index.html` desenha. A interface NÃO fala com Shopify/Shopee direto.

## 4. Decisões e conhecimento de domínio (IMPORTANTE — não reinventar)

### 4.1 Receita precisa EXCLUIR pedidos cancelados/expirados
- **Bug descoberto:** o ShopifyQL (`FROM sales SHOW total_sales, orders`) **conta pedidos cancelados/expirados**.
  Ex.: 20/06 teve #19501 (PAID, R$119) + #19491 (**EXPIRED**, R$119) e o ShopifyQL somou os dois (2 pedidos / R$238).
  Período 16–22/06: ShopifyQL = 23 pedidos / R$3.004,10; **correto = 21 / R$2.766,10**.
- **Por que não dá pra filtrar no ShopifyQL:** o dataset `sales` NÃO expõe as colunas `financial_status`,
  `sale_kind`, `sales_reversals` nem `utm_*`. Não há WHERE de status. (Tudo isso foi testado e dá "Column Not Found".)
- **Solução adotada:** receita/pedidos/ticket/tendência/top-produtos vêm da **API GraphQL de pedidos**.
  Regra de exclusão (`isCancelled`): `cancelledAt != null` OU `displayFinancialStatus ∈ {EXPIRED, VOIDED, CANCELLED}`.
  Valor do pedido = `currentTotalPriceSet.shopMoney.amount`.
- **Atenção/decisão em aberto:** pedidos **PENDING** (aguardando pagamento, ex. Pix/boleto) HOJE ainda contam.
  O Luan ainda vai decidir se quer contar só **pagos**. Se sim, ajustar `isCancelled`/filtro em `shopify.js` e `metrics.js`.

### 4.2 Sessões / funil / conversão → ShopifyQL (não afetado por cancelamento)
- `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions,
  sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day SINCE -90d UNTIL today`.
- Guardamos uma linha **por dia** (últimos 90 dias) e agregamos por intervalo. Conversão = completados/sessões.
- Limitação atual: o gráfico de tráfego usa granularidade **diária** (a partir das linhas diárias guardadas),
  mesmo quando o período é curto. A tendência de receita/pedidos, sim, suporta granularidade por **hora**
  (vem dos pedidos crus). Melhoria possível: guardar sessões por hora para o dia corrente.
- **Formato da resposta (API 2026-04+):** `shopifyqlQuery { tableData { columns { name } rows } parseErrors }`.
  O campo `rows` é um array de objetos com chaves nomeadas pelas colunas (ex: `{ day, sessions, online_store_visitors, ... }`).
  Formato antigo (`... on TableResponse { tableData { rowData } }`) não existe mais nessa versão.
  `parseErrors` pode ser array vazio `[]` (truthy!) quando não há erros — checar com `.length`, não booleano.
- **Escopos necessários:** `read_analytics` + `read_reports` no custom app. Sem `read_analytics` o campo
  `shopifyqlQuery` não aparece no schema do GraphQL (nem dá erro de permissão — simplesmente some).

### 4.3 Marketing por origem (Instagram/Facebook/Google) = atribuição, NÃO custo
- O referrer por pedido vem de `order.customerJourneySummary.lastVisit.source`
  (valores reais vistos: Instagram, Facebook, Google) + `utmParameters` (campanha/medium "paid").
- 30 dias (referência): Instagram ~R$5.147, Facebook ~R$2.033, Google ~R$242, Direto, etc.
- O card "Marketing por origem" usa isso (consistente com a receita corrigida, pois sai dos mesmos pedidos válidos).

### 4.4 Custo de Ads / ROAS / ACOS → NÃO existe no Shopify
- `appInstallations` via GraphQL retorna **access denied** (sem escopo). Não há dataset de custo no ShopifyQL.
- Portanto **custo, ROAS e ACOS ficam 0** com nota. Para ter de verdade: integrar **Google Ads API** e
  **Meta Marketing API** (cada uma tem seu OAuth e seu endpoint de gasto). É um próximo passo previsto.

### 4.5 Shopee
- **Não há conector MCP pronto** (registry pesquisado). Usar a **Open Platform API v2** direto (já implementada em `src/shopee.js`).
- Host produção: `https://partner.shopeemobile.com` (test: `partner.test-stable.shopeemobile.com`).
- Assinatura: `HMAC_SHA256(partner_key, partner_id + path + timestamp [+ access_token + shop_id])` em hex.
- OAuth: `/shopee/connect` → autoriza → callback troca `code` por `access_token` (~4h) + `refresh_token` (~30d).
  O token é renovado automaticamente em `validToken()`.
- Pedidos: `get_order_list` (por `create_time`, paginação por `cursor`, máx 15 dias/chamada) →
  `get_order_detail` (lotes de até 50 `order_sn`). Normalizamos para o mesmo formato da Shopify.
- Status considerados cancelados na Shopee: `CANCELLED`, `UNPAID`, `INVOICE_PENDING` (revisar conforme a operação real).
- Enquanto a Shopee não for autorizada, `fetchOrders` retorna `[]` e o canal fica 0 — nada quebra.

### 4.6 Canais e UI
- Canais no seletor: `todos`, `shopify`, `shopee`, `amazon`, `mercadolivre`. Amazon e Mercado Livre são **placeholders 0** (sem integração ainda) — mostrar 0, **sem** aviso de "em breve" (decisão do Luan).
- Seletores de Métrica (Receita/Pedidos/Sessões) e Canal são `<select>` de verdade. Período é um calendário (de/até + presets), persistido em localStorage.
- Paleta/design: tema "earthy" com variáveis CSS no `:root` do `public/index.html`. Manter o visual.

## 5. Modelo de dados (pedido normalizado)

```js
{
  id, channel,            // 'shopify' | 'shopee' | ...
  name, createdAt,        // ISO (UTC)
  status, cancelled,      // cancelled = bool já calculado
  total,                  // número (BRL)
  source,                 // origem de marketing ('Instagram'... | 'Shopee' | '')
  customer,
  items: [{ title, qty, amount }]
}
```

## 6. Configuração (.env)

Veja `.env.example`. Principais: `SHOPIFY_STORE`, `SHOPIFY_ADMIN_TOKEN` (custom app — escopos obrigatórios:
`read_orders`, `read_products`, `read_reports`, `read_analytics`),
`SHOPIFY_API_VERSION` (manter `2026-04` ou posterior), `SHOPEE_PARTNER_ID/KEY/SHOP_ID/REDIRECT_URL/PRODUCTION`,
`SYNC_INTERVAL_MINUTES`, `STORE_OFFSET_MINUTES=-180`. Nunca commitar `.env` (já está no `.gitignore`).

**Armadilhas conhecidas do token Shopify:**
- `read_customers` ausente → erro parcial no campo `customer` dos pedidos, mas os dados de receita chegam normalmente.
  A função `gql()` foi ajustada para tolerar erros parciais (só lança se não vier `data` algum).
- `read_analytics` ausente → `shopifyqlQuery` some do schema sem aviso (não é "access denied", é campo inexistente).

## 7. Como rodar / endpoints

- `npm install` → `npm start` (porta 3000). Sync roda ao subir e a cada `SYNC_INTERVAL_MINUTES`.
- `npm run sync` faz uma sincronização única (útil para testar credenciais).
- API: `GET /api/dashboard?channel=&metric=&since=YYYY-MM-DD&until=YYYY-MM-DD`, `POST /api/sync`,
  `GET /shopee/connect`, `GET /shopee/callback`, `GET /health`.
- Testado sem credenciais: servidor sobe, `/health` ok, `/api/dashboard` devolve zeros (não quebra).

## 8. Próximos passos (backlog priorizado)

1. **Deploy** (Railway/Render): variáveis no painel, `npm start`, **disco persistente** para `data/db.json`
   (ou migrar `store.js` para **Postgres**). Depois, ajustar `SHOPEE_REDIRECT_URL` para o domínio https e cadastrá-la no console Shopee.
2. **Autorizar a Shopee** de verdade (`partner_id`/`partner_key` + `/shopee/connect`) e validar `get_order_detail`
   (conferir nomes de campos de valor/itens com dados reais; a Shopee às vezes muda `model_*`).
3. **Google Ads + Meta Ads** para custo/ROAS/ACOS reais (preencher o KPI "Custo Campanhas" e o card de ROAS).
4. Decidir tratamento de **PENDING** (contar só pagos?) — ver 4.1.
5. Amazon e Mercado Livre como canais (mesma lógica da Shopee).
6. Migrar store → Postgres; depois login/usuários se mais gente for acessar.

## 9. Convenções

- Código em ES Modules (`"type": "module"`). Node 18+ (usa `fetch` nativo).
- Sem dependências pesadas (só `express` e `dotenv`). Manter simples.
- Toda a UI e textos em **pt-BR**. Valores em **BRL** (`Intl`/`toLocaleString('pt-BR')`).
- O protótipo Cowork original (single-file) vive em `../sales-dashboard-live.html` — referência de visual,
  mas a fonte de verdade agora é este app.
