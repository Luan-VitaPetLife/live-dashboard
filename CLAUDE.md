# CLAUDE.md — Contexto do projeto

> Lido automaticamente pelo Claude Code ao abrir o projeto. Resume o que já foi decidido,
> para não repetir investigação. Histórico de mudanças fica no `git log`, não aqui.
>
> Este repositório é PÚBLICO no GitHub. Nunca colar aqui token, secret, chave, ARN completo,
> ID de conta AWS, ou qualquer identificador exato de conta externa — só nomes de variável
> de ambiente. Os valores reais vivem só no `.env` local (git-ignored) e no Railway.

## 1. O que é

Dashboard de vendas multi-mercado e multicanal da marca **Coco and Luna** (suplementos para
pets) e da sua 2ª marca **Yucaloo**. A empresa por trás das duas é a **Vita Pet Life** — isso é
só o nome legal/administrativo (aparece no domínio da loja Shopify US e na conta Meta EUA por
motivo histórico); não tratar "Vita Pet Life" como nome de loja em textos de UI.

- **Brasil:** Shopify BR (`cocoandluna.com.br`) + Shopify Yucaloo BR + Shopee + Mercado Livre + Amazon BR
- **EUA:** Shopify US (`vita-pet-life.myshopify.com`) + Shopify Yucaloo EUA + Amazon US

Dono do produto: Luan, perfil de negócio (não-dev) — quer uma tela única, ao vivo, com todos os
canais. Interface em pt-BR. Valores BR em BRL, valores US em USD.

Produção: `https://live-dashboard-vitapetlife.up.railway.app` (Railway, auto-deploy do branch
`master` de `https://github.com/Luan-VitaPetLife/live-dashboard.git`). Trabalho normal acontece
no branch `dev`; nunca commitar/pushar direto em `master`.

## 2. Contas e domínios

**Shopify BR:** `cocoandluna.com.br`, admin `ebb5cd.myshopify.com`. BRL, fuso -03
(`STORE_OFFSET_MINUTES=-180`). Admin API `2026-04` (não usar versão anterior a 2025-10).

**Shopify US:** `vita-pet-life.myshopify.com`.

**Shopify Yucaloo BR:** `pii90z-nz.myshopify.com` (nome de exibição `yucaloo.com.br`). App
criado via Dev Dashboard da Shopify (fluxo diferente do app clássico — ver seção Yucaloo).

**Amazon BR:** marketplace `A2Q3Y263D00KWC` (ID público da Amazon, igual pra qualquer vendedor
no Brasil), conta de vendedor CocoandLuna, app SP-API próprio
(`AMAZON_BR_CLIENT_ID/SECRET/REFRESH_TOKEN`).

**Amazon US:** marketplace `ATVPDKIKX0DER` (idem, público), conta de vendedor VITA PET LIFE.
Autenticação via IAM User + IAM Role (SigV4 + STS AssumeRole) — nomes/ARNs exatos só no
Railway, nunca aqui. Role/chaves AWS compartilhados entre BR e US; client_id/secret/refresh_token
são separados por conta.

**Meta Ads:** BR = conta Coco and Luna (`META_AD_ACCOUNT_ID`). US = conta Vita Pet Life
(`META_US_AD_ACCOUNT_ID`). Mesmo `META_ACCESS_TOKEN` (System User) pros dois.

**Mercado Livre:** domínio da API é `api.mercadolibre.com` — "libre" em espanhol, NÃO "livre".
Nunca reverter isso, já causou bug.

**Google Ads:** conta "Coco and Luna", só roda campanhas dos EUA (`GOOGLE_ADS_CUSTOMER_ID`).

## 3. Arquitetura

```
server.js               Express: serve public/ + API + agendador de sync
src/store.js             Postgres em produção (DATABASE_URL), JSON local (data/db.json) no dev
src/shopify.js           Pedidos via GraphQL Admin API + sessões via ShopifyQL (multi-loja via cfg)
src/shopifyYucaloo.js    OAuth da Yucaloo (Dev Dashboard) + fetchOrders/fetchProductCatalog
src/shopee.js            Shopee Open API v2: HMAC, OAuth, refresh de token
src/mercadolivre.js      Mercado Livre OAuth + pedidos + Mercado Ads (fetchAdCosts/fetchCampaigns)
src/amazon.js            Amazon SP-API (BR+US): LWA + SigV4 + STS AssumeRole
src/meta.js              Meta Marketing API: gasto diário + fetchCampaigns
src/googleads.js         Google Ads API: OAuth + fetchCampaigns (só EUA)
src/metrics.js           Calcula o payload da dashboard por mercado
src/us-states.js         normalizeUsState(): reduz grafias de estado dos EUA a 2 letras
src/auth.js              Login: hash scrypt+salt, sessão por cookie, CRUD de usuários, permissão por página
src/sync.js              Orquestra a busca de todos os canais e grava no store
public/index.html        Dashboard principal (Revenue)
public/campanhas.html    Gastos reais por canal + campanhas
public/produtos.html     Catálogo completo por canal
public/estoque.html      Estoque + produção, híbrido real (vendas) + manual
public/segmentos.html    Gato vs Cão, tipos de produto, geografia por produto
public/geografia.html    Mapa por estado BR (Leaflet)
public/geografia-us.html Mapa por estado US (Leaflet)
public/unificador.html   Agrupamento manual de produtos entre canais (admin)
public/configuracoes.html Geral, login, gestão de usuários (admin)
public/integracoes.html  Status + liga/desliga por integração (admin)
public/login.html        Tela de login (standalone)
public/sidebar.js        Sidebar compartilhada (IIFE, injeta markup + CSS + comportamento)
public/colors.js         Sistema de cores compartilhado (IIFE) + color picker
```

Fluxo: `sync.js` busca pedidos/sessões → grava no `store` → `metrics.js` calcula → `/api/*`
devolve JSON → `public/*.html` desenham. As telas nunca falam com Shopify/Shopee/ML/Amazon direto.

### Store
- `DATABASE_URL` presente → Postgres. Ausente → JSON em `data/db.json`.
- `initStore()` é async, precisa de `await` antes de `app.listen()`.
- Tabelas: `orders` (id, data JSONB), `sessions_daily` (date, data JSONB), `kv` (key, value JSONB).
- `getOrders({ channel, since, until, market })`: pedido legado sem `market` é inferido `'br'`
  (exceto canal `shopify_us`/`amazon_us` → `'us'`). Mantém índice em memória por mercado
  (array ordenado por timestamp + busca binária) em vez de `Object.values().filter()` a cada
  chamada — necessário pra aguentar centenas de milhares de pedidos. Índice reconstrói
  preguiçosamente (`indexDirty`, só na próxima leitura). Interface pública é síncrona.
- Escrita em lote: `pgUpsertOrders` faz INSERT multi-linha (lotes de 500) em vez de um INSERT por
  pedido — um backfill grande gerando um INSERT por linha já encheu o disco do Postgres uma vez
  (WAL bloat). Não reverter para insert-por-linha.

## 4. Domínio — decisões que não devem ser reinventadas

### Receita
- ShopifyQL (`FROM sales`) conta pedidos cancelados/expirados e não tem como filtrar por status —
  por isso receita/pedidos/ticket/tendência/top-produtos vêm da API GraphQL de pedidos, não do
  ShopifyQL. `isCancelled`: `cancelledAt != null` OU `displayFinancialStatus ∈ {EXPIRED,VOIDED,CANCELLED}`.
  Valor do pedido = `currentTotalPriceSet.shopMoney.amount` (já vem líquido de devolução).
- Pedidos `PENDING` (Pix/boleto aguardando) hoje contam como receita — decisão em aberto, ver seção 9.
- Quantidade/receita por produto usa `LineItem.currentQuantity` (não `quantity`, que inclui
  devolvido) e desconta reembolso do `discountedTotalSet` via `order.refunds`.

### Sessões / funil (só Shopify)
- ShopifyQL: `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions,
  sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day`.
- Resposta vem em `shopifyqlQuery.tableData.rows`; `parseErrors` pode ser `[]` (truthy) — checar
  `.length`, não truthiness.
- Precisa dos escopos `read_analytics` + `read_reports`. Sem `read_analytics`, `shopifyqlQuery`
  simplesmente some do schema, sem erro.

### Marketing
- Atribuição por origem (`order.customerJourneySummary.lastVisit.source`) é atribuição, não custo.

### Meta Ads (`src/meta.js`)
- Graph API v20.0. `fetchInsights`/`fetchCampaigns` aceitam `accountId` (padrão BR) — mesma função
  serve qualquer conta nova, só passar outro ID.
- Store: `metaInsightsDaily` (BR), `metaUSInsightsDaily` (US).
- ROAS = receita de pedidos com source Instagram/Facebook ÷ gasto Meta.
- `salesSplit`: separa receita de campanha (source Meta OU `listingType==='premium'`) de orgânica.

### Shopee (`src/shopee.js`)
- Open Platform API v2 direto. Assinatura HMAC-SHA256(partner_key, partner_id+path+timestamp[+token+shop_id]).
- Sem analytics via API (só no Seller Center).
- A Shopee mascara todos os campos de endereço do pedido como `"****"` — não tem correção via
  código, é política da plataforma. O Bling ERP (recebe pedidos de todos os canais) traz o
  endereço sem máscara; `reconcileGeoFromBling` (`sync.js`) preenche `state` a partir de lá,
  contornando a limitação sem depender da Shopee. `POST /api/bling/sync-geo?market=br` recupera histórico.

### Mercado Livre (`src/mercadolivre.js`)
- Cancelado = status `cancelled`/`invalid`. Sem tokens → `[]`, canal fica 0, nada quebra.
- Estado do pedido via `/shipments/{id}` → `receiver_address.state.id`.
- `listingType`: só `gold_pro`/`gold_premium` = `'premium'` (Destaque/Diamante, exposição paga de
  verdade). Qualquer outro (`gold_special` "Clássico", `free`, tipo legado desconhecido) =
  `'organic'`. Allowlist positiva, não negativa — inflar atribuição por engano é pior que
  subestimar. Resolvido via `/items?ids=...` multiget (o campo não existe em `/orders/search`).
- Mercado Ads exige header `Api-Version: 1`. Fluxo: `GET /advertising/advertisers?product_id=PADS`
  → advertiser_id/site_id → `GET /marketplace/advertising/{site}/advertisers/{adv}/product_ads/campaigns/search`.
  Precisa da permissão "Mercado Ads" no app + token re-autorizado; sem isso, 403 → zeros graciosos.
- `mlBreakdown`: `{ organic, premium, adCost, adClicks, roas }`.
- Re-autorizar via `/mercadolivre/connect` depois de cada novo deploy (token não sobrevive sozinho).

### Amazon SP-API (`src/amazon.js`)
- Endpoint único `sellingpartnerapi-na.amazon.com` (região NA) serve BR e US. Auth: LWA token →
  STS AssumeRole (IAM user compartilhado) → SigV4 + `x-amz-access-token`.
- **Duas contas de vendedor, dois apps separados.** CocoandLuna (BR) e VITA PET LIFE (US) são
  contas vinculadas mas distintas — cada uma com seu próprio app SP-API
  (`AMAZON_CLIENT_ID/SECRET/REFRESH_TOKEN` para US, `AMAZON_BR_*` para BR). Role/chaves AWS
  continuam compartilhados. **Nunca usar o mesmo refresh token nos dois** — ativa `SAME_TOKEN`
  (chamada combinada) e um dos dois para de receber pedidos silenciosamente. Já aconteceu uma vez
  com o token BR apontando pra conta errada — sintoma foi "Amazon BR sem pedidos" mesmo com vendas
  reais; diagnosticar com `GET /api/amazon/whoami` (compara os marketplaces que cada token enxerga).
- `/orders/v0/orders` tem cota de 1 req/min (burst 20). A conta US passa de 100 pedidos por janela
  e sempre pagina — por isso a paginação dispara páginas em sequência aproveitando o burst e só
  espera 61s quando toma 429 de verdade (`RateLimitError`, até 3 tentativas/página); página já
  lida vira upsert parcial, cursor não avança em caso de erro (o sync seguinte completa o resto).
  A cota é da CONTA, não do processo — não rodar teste local e sync de produção ao mesmo tempo.
- Sync incremental por cursor (`kv.amazonCursors`, por mercado): com cursor usa
  `LastUpdatedAfter/Before` (pega mudança de status que `CreatedAfter` não pegaria); sem cursor
  (1ª carga) usa `CreatedAfter/Before`, janela de `AMAZON_BACKFILL_DAYS` (padrão 2).
  `CreatedBefore` precisa ficar ≥2min no passado — código aplica 3min de margem. O cursor avança
  mesmo com 0 resultados — se um token ficar errado por um tempo, o cursor "anda no vazio" e o
  gap não se recupera sozinho quando o token é corrigido; precisa de um backfill manual pra
  recuperar o período perdido.
- Pedido `Pending` vem com `total: 0` (SP-API omite o valor até a captura) — entra sozinho num
  sync incremental seguinte.
- RDT (nome do comprador) desativado por padrão — app sem papel PII aprovado, 403. Ligar com
  `AMAZON_FETCH_PII=1` só se aprovado.
- Backoff só em 429 que esgotou tentativas: degraus crescentes, zera no sucesso. Reset/force:
  `POST /api/amazon/{reset-backoff,force-sync}`.
- `byState` da Amazon vem com grafia de estado inconsistente ("California"/"CA"/"CA.") —
  `src/us-states.js` (`normalizeUsState`) resolve, aplicado na leitura e na gravação.
- **Backfill histórico** via Reports API (`GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL`),
  balde de cota próprio (não disputa com `/orders`). Janelas de 30 dias, `POST /api/amazon/backfill
  ?days=N&market=us|br`, progresso em `GET /api/status`. É a única fonte de título de produto
  (a Orders API nunca devolve). Linha com `product-name === '-'` é frete/ajuste, descartada.
  Roda no processo do servidor (não é worker separado) — um deploy no meio mata a execução; é
  idempotente (upsert por id), só re-disparar.
- **Reconciliação de nome de produto**: job próprio (`reconcileAmazonNames`, roda periodicamente)
  busca um relatório curto e faz PATCH só em `items[]` via `patchOrderItems()` — nunca mexe em
  `total/status/state`. `patchOrderItems` não insere pedido novo (só corrige título de pedido que
  a Orders API já gravou — evita contaminar um mercado com pedido do outro, já aconteceu). `upsertOrders()`
  tem uma guarda: se o pedido que chega vier com todos os itens sem título mas o existente já
  tinha título, preserva os títulos antigos — sem isso, o sync normal de pedidos (que não traz
  título) apagava os nomes preenchidos pelo backfill. Manual: `POST /api/amazon/sync-names?market=us|br`.
- `itemRevFactor` (`metrics.js`): os itens da Amazon vêm com preço bruto do relatório mesmo que o
  pedido ainda esteja `Pending` (total 0) — a receita por item é escalada pro `total` real do
  pedido (capturado → soma o total; pendente → 0), sem afetar a contagem de unidades. Regra
  generalizada pra qualquer canal: se `total === 0` mas algum item tem preço de catálogo (ex.
  pedido de atacado/fulfillment onde quem cobra é o parceiro, não a loja), o fator também é 0 —
  zera a receita fantasma, preserva a unidade vendida.
- Retenção: `AMAZON_RETENTION_DAYS` (padrão 0 = desligada, opt-in) poda só pedidos Amazon mais
  antigos que N dias a cada sync — janela móvel pra não estourar o disco de novo. Em produção: 365.
- Mistura de mercado: o relatório de backfill/reconciliação pode trazer linhas dos dois mercados
  juntas (as contas são vinculadas) — `ordersFromRows()` valida o mercado real por linha via
  `ship-country` (não moeda, não `ship-state` — siglas de UF BR colidem com estados US). Limpeza
  de dado já vazado: `POST /api/amazon/cleanup-market-leak` (idempotente).
- Toggle "Receita da Amazon" (Configurações): "Total cobrado" (`order.total`, padrão, igual aos
  outros canais) × "Vendas de produto" (`order.productSales`, métrica "Ordered Product Sales" da
  Amazon, só populada em pedido que passou pela Reports API). Limitação conhecida, não é bug:
  "Vendas de produto" pode ficar bem abaixo do real porque o relatório frequentemente vem sem
  imposto/frete detalhado por pedido — aviso já fica na própria tela.
- Diagnóstico: `GET /api/amazon/{whoami,probe-order,report-columns,probe-image}`.
- Portal atual: `solutionproviderportal.amazon.com`. Criar app novo exige verificação de
  identidade + revisão de "Solution Provider Account Profile" antes de liberar app de produção
  (sem revisão, só Sandbox — não vê pedido real). Roles renomeados: usar "Inventory and Order
  Tracking" (equivalente ao antigo "Orders") + "Product Listing" (exigido pela Catalog Items API —
  imagem de produto; o app US não tem esse role hoje, o app BR já nasceu com ele).

### Multi-mercado
- Campo `market: 'br'|'us'` em todo pedido. `computeDashboard({market})` separa tudo:
  byChannel, sessões, pedidos recentes. Canal `shopify_us`/`amazon_us` sempre implica `market: 'us'`.

### Yucaloo (2ª marca)
- Loja Shopify própria por mercado, mas **o `market` é o mesmo da Coco and Luna** (`'br'`/`'us'`)
  — decisão deliberada do Luan: no Brasil a Yucaloo vende junto com os mesmos marketplaces da Coco
  and Luna, e ele quer ver tudo junto ao escolher só "Brasil"/"EUA", sem uma dimensão de marca
  separada. O que distingue a Yucaloo é só o `channel` (`yucaloo_br`/`yucaloo_us`). Uma dimensão de
  marca de verdade só faria sentido com mais marcas — não é um problema a resolver agora.
- App Shopify criado via **Dev Dashboard** (`dev.shopify.com`), não o app clássico da Coco and
  Luna — exige handshake OAuth de verdade (o app clássico dá token estático direto). Fluxo:
  Shopify chama a "URL do app" com parâmetros assinados (HMAC) → nosso servidor valida e redireciona
  pro `/admin/oauth/authorize` da loja → Shopify chama o `redirect_uri` com `code` → trocamos por
  token permanente. `src/shopifyYucaloo.js`: `verifyRequest` reconstrói a query a partir de
  `req.originalUrl` (não `req.query`, porque o parser do Express trata `+` do base64 do parâmetro
  `host` como espaço). Rotas: `GET /shopify-yucaloo/:mkt(br|us)/{connect,callback}`.
- Tokens em `kv.yucalooTokens[mkt]`. Catálogo de produto sincronizado à parte
  (`fetchProductCatalog`, `kv.shopifyProductCatalog`) — permite um produto cadastrado mas nunca
  vendido aparecer no Unificador mesmo sem pedido nenhum.
- Como o `market` é compartilhado, os pedidos da Yucaloo entram automaticamente em todos os
  agregados por mercado (KPI, channelSplit, catálogo, Segmentos, Produtos) sem mudança de código
  nesses lugares — só telas com lista FIXA de canais (em vez de descobrir dinamicamente pelos
  dados) precisam de uma entrada própria pra Yucaloo aparecer: já adicionada em `index.html`
  (`MARKET_CHANNELS`), `produtos.html`/`estoque.html` (`CHANNELS_BR`/`CHANNELS_US` + `CH_META`),
  `segmentos.html` (`CH_BY_MARKET`) e `geografia.html`/`geografia-us.html` (dropdown hardcoded +
  `CHAN`/`CHAN_COLORS_MAP`/`CHAN_LABELS_MAP`). `campanhas.html` fica de fora de propósito — não
  tem lista genérica de canais Shopify, só cards fixos por conta de Ads, e a Yucaloo ainda não tem
  conta de Ads própria. Se um canal novo for adicionado no futuro, checar essas mesmas telas.
- Cor padrão da marca: `#4466FF`. Badge de canal: "Shopify - Yucaloo BR"/"EUA" (e os da Coco and
  Luna viraram "Shopify - Coco and Luna BR"/"EUA" pra desambiguar, já que as duas rodam no Shopify).

### Google Ads (`src/googleads.js`)
- Só EUA — apesar do nome da conta ser "Coco and Luna". GAQL via REST
  (`POST /customers/{id}/googleAds:search`), agregado no período, sem granularidade diária.
- Não entra no payload de `/api/dashboard` nem no ROAS do dashboard principal — só na tela de
  Campanhas, decisão deliberada de escopo.

### Autenticação (`src/auth.js`)
- Senha: scrypt+salt, comparação em tempo constante. Sessão: cookie `coco_session` (HttpOnly,
  SameSite=Lax, Secure sob HTTPS), 30 dias, em `kv.authSessions`.
- Dois níveis: `admin` (tudo) e `padrao` (só páginas liberadas em `pages[]`).
- Portão de acesso em `server.js`, antes do `express.static`: libera sempre `/health`,
  `/login.html`, rotas de API de auth, assets estáticos e callbacks OAuth; sem sessão → 401/redirect;
  com sessão mas sem permissão na página → redirect pra primeira página permitida.
- `initAuth()` no boot semeia um usuário admin se `kv.users` estiver vazio (senha padrão trocada
  em produção) e liga o login por padrão (`authConfig.enabled = true`).
- Recuperação se travar: editar `kv` direto no Postgres (`UPDATE kv SET value='{"enabled":false}'
  WHERE key='authConfig'` reabre sem login; apagar a linha `key='users'` re-semeia o admin).

### Integrações (`public/integracoes.html`)
- Admin only. `GET /api/integrations` monta status ao vivo por canal; `POST
  /api/integrations/:key/toggle` liga/desliga, persistido em `kv.integrationsConfig`
  (`TOGGLEABLE_KEYS` define o que pode ser alternado). Opt-out por padrão — sem registro salvo,
  a integração conta como ligada.
- O switch tem efeito real: `sync.js`/`/api/campaigns` checam `isIntegrationEnabled()` antes de
  buscar/gravar cada canal. Exceção: `fetchOrders()` da Amazon busca os dois mercados numa
  chamada só — desligar um mercado filtra o que é GRAVADO, não reduz a chamada de rede em si.

### Unificador (`public/unificador.html`)
- Agrupamento manual global de produtos entre canais/nomes — substitui versões antigas que
  existiam separadas em Segmentos/Estoque. Admin only.
- Modelo: `kv.productGroups` = `{ [market]: { [nomeDoGrupo]: [tituloBruto,...] } }`. Um título
  pertence a no máximo um grupo por mercado. Liga/desliga global em `kv.productGroupsConfig`
  (padrão ligado).
- Aplicado no backend (`metrics.js`, `applyProductGroups()`), não client-side: em
  `topProducts`/`topProductsAll` (merge entre canais), `productGeo` (Segmentos), `computeProducts`
  (merge dentro do mesmo canal — campos financeiros editáveis ficam "—" na linha agrupada) e
  `computeStock.agg` (grupo manual tem prioridade sobre a família automática Lysine/Daily).
- Também mostra produto do catálogo Shopify mesmo sem venda nenhuma (`listProductCatalog` mescla
  pedidos reais com `kv.shopifyProductCatalog`).

### Tipos de produto
- Categorias criadas pela própria UI (Segmentos → botão de gerenciar tipos), não hardcoded.
  `kv.productTypeGroups` = `{ [market]: { [nomeDoTipo]: [palavraChave,...] } }`. Testa a palavra-
  chave contra título + productType + tags do item; primeira regra que bater vence; sem regra
  cadastrada cai em `'Outros'`. Usado no "Top produtos" por segmento em Segmentos.

### Ocultar produtos
- Palavras-chave testadas só contra TAG do item (`kv.productHiddenTags`, por mercado), geridas no
  Unificador. Item que bate vira segmento `'hidden'` em vez de cat/dog/other, some de
  `productGeo`/Segmentos normais e aparece só no card "Ocultos".

### Geografia (`geografia.html`/`geografia-us.html`)
- Leaflet 1.9.4, tile CartoDB Voyager. Dois modos: coroplético (polígono colorido por intensidade)
  e calor (também preenche o polígono, com gradiente — não usa círculos, evita sobreposição).
- BR: GeoJSON do IBGE em runtime, casa por `codarea`. US: `us-states.json`, casa por `_uf`.
- `byState` no mercado US passa por `normalizeUsState`. Endereço fora dos EUA no mercado US vira
  bucket `'INTL'` (não perde receita, só não vira linha própria por país). Território/militar
  contam como EUA.
- Canal é dropdown hardcoded no HTML (não gerado dinamicamente) — ao adicionar canal novo em
  qualquer lugar do app, checar também aqui (`CHAN`/`CHAN_COLORS_MAP`/`CHAN_LABELS_MAP` + o `<div
  class="csel-opt">` do dropdown), é o ponto mais fácil de esquecer.

### Campanhas (`public/campanhas.html`)
- Os cards de RESUMO por canal (topo) e os cards de CAMPANHA individual (embaixo) precisam vir da
  MESMA fonte (`/api/campaigns`, ao vivo) — já existiu um bug em que o resumo lia
  `/api/dashboard` (janela fixa de 60 dias do sync periódico) enquanto os cards de baixo liam
  `/api/campaigns` (período escolhido na tela), e os dois discordavam. Não reintroduzir essa
  divergência.
- KPI do topo ("Vendas Atribuídas Geral") soma Meta + Mercado Livre (Destaque/premium) + Google Ads.
- Mercado Livre e Meta BR só aparecem no mercado BR; Meta US e Google Ads só no mercado US.

### Produtos (`public/produtos.html`)
- Catálogo completo por canal, sem limite de top-N. Mescla pedidos do período com catálogo de
  todo o histórico — produto sem venda no período continua listado (qty/receita zeradas), porque é
  tela de catálogo, não de vendas.
- Colunas financeiras editáveis por produto: COG, Frete, Impostos %, Comissão % → Lucro/Lucro %.
  `Lucro = Receita − COG×Qtd − Frete×Qtd − Receita×Impostos% − Receita×Comissão%`. Sem COG
  preenchido (nem override nem padrão), lucro fica `null` ("—"), nunca assume custo zero.
  Persistido em `kv.productFinance`, chave `canal|||título`.
  - Impostos padrão: 2,64% fixo (Simples Nacional).
  - COG padrão: R$ 15,21 (produto com "lisina"/"lysine" no título), R$ 17,32 ("daily"/"taurina"/"espirulina").
  - Comissão padrão por canal: Shopee 18%, Mercado Livre 14%, Amazon 12%, Shopify 0%.
- Combo/bundle (tag `combo` ou Shopify Bundles) mescla no produto-base, não vira linha própria.
- Exportar CSV: só Shopify US por enquanto (`GET /api/products/export`).

### Estoque (`public/estoque.html`)
- Híbrido: venda real (calculada) + estoque/produção manual. Janela fixa de 30 dias pra
  velocidade de venda (sem seletor de período).
- Dois níveis: por canal (`kv.productStock`: só `stock`/`incoming`, editável) e agregado por
  família de produto somando todos os canais (`kv.productStockAgg`: `orderInProgress`/`orderNew`/
  `projected`, editável só aqui). Família = grupo manual do Unificador (prioridade) ou
  `classifyFamily()` por palavra-chave (Lysine/Daily) ou o próprio título.
  `totalMonthsOfStock = (stock+incoming+projected+orderNew+orderInProgress) / salesMonth`.
- Sugestão de reposição: `<3` meses = urgente, `3–7` = atenção, `≥7` = aguardar.
- Amazon BR sem nenhum item no catálogo recebe uma linha sintética "Produto TESTE" pra permitir
  cadastro manual de estoque mesmo sem nome de produto real.

### Devoluções
- Quantidade/receita por produto usa `LineItem.currentQuantity` (Shopify) e desconta refund do
  valor do item — ver "Receita" acima. Sem isso, produto devolvido continuava contando venda.

### Padrões de UI compartilhados
- Sidebar (`sidebar.js`) e sistema de cores (`colors.js`) são componentes injetados via IIFE —
  nunca duplicar CSS/markup deles numa página nova, sempre incluir o script.
- Seletores de Métrica/Canal/Período/Atualizar são dropdowns customizados (`.csel`), não `<select>`
  nativo. Frequência de atualização (`localStorage('coco_refresh')`) é compartilhada entre todas
  as páginas.
- Arrastar para reordenar cards (Produtos/Estoque): a API nativa de Drag and Drop do HTML5 causou
  vários bugs (arraste não iniciava, duas cópias visuais do card) — foi trocada por um arraste
  customizado por ponteiro (`mousedown`/`mousemove`/`mouseup` + clone `position:fixed` seguindo o
  cursor). Se for implementar reordenação em alguma tela nova, seguir esse padrão em vez da API
  nativa de drag and drop.
- Nunca engolir erro de integração silenciosamente (`.catch(() => [])` sem log/propagação) — já
  escondeu um bug real (Amazon US com pedidos zerados) por semanas.

## 5. Modelo de dados (pedido normalizado)

```js
{
  id, channel,             // 'shopify' | 'shopify_us' | 'yucaloo_br' | 'yucaloo_us' |
                            // 'shopee' | 'mercadolivre' | 'amazon' | 'amazon_us'
  market,                  // 'br' | 'us'
  name, createdAt,         // ISO (UTC)
  status, cancelled,
  total,                   // BRL (BR) ou USD (US)
  source,                  // origem de marketing ('Instagram' | 'Facebook' | 'Google' | ...)
  customer,
  state,                   // UF/estado de entrega
  listingType,             // ML: 'organic' | 'premium' | null
  items: [{ title, qty, amount, asin?, tags? }],
}
```

## 6. Configuração (.env)

Todos os valores reais ficam só no `.env` local (git-ignored) e nas variáveis de ambiente do
Railway — nunca colar valor aqui, só o nome da variável e pra que serve.

| Variável | Descrição |
|---|---|
| `PORT` | Porta (Railway injeta) |
| `SYNC_INTERVAL_MINUTES` | Frequência do sync automático (padrão 15) |
| `STORE_OFFSET_MINUTES` | Fuso da loja BR em minutos (Brasil = -180) |
| `SHOPIFY_STORE` / `SHOPIFY_ADMIN_TOKEN` | Loja e token BR (escopos: read_orders, read_products, read_reports, read_analytics, read_customers) |
| `SHOPIFY_API_VERSION` | `2026-04` ou posterior |
| `SHOPIFY_US_STORE` / `SHOPIFY_US_ADMIN_TOKEN` | Loja e token US |
| `YUCALOO_BR_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URL` | App Yucaloo BR (Dev Dashboard) |
| `YUCALOO_US_*` | Idem, Yucaloo EUA |
| `SHOPEE_PARTNER_ID` / `_KEY` / `_SHOP_ID` | Credenciais Shopee de produção |
| `SHOPEE_REDIRECT_URL` | Callback OAuth Shopee |
| `ML_CLIENT_ID` / `_CLIENT_SECRET` / `ML_REDIRECT_URL` | App Mercado Livre |
| `META_APP_ID` / `_APP_SECRET` / `META_ACCESS_TOKEN` | App Meta + token de sistema (único p/ BR e US) |
| `META_AD_ACCOUNT_ID` | Conta BR (sem prefixo `act_`) |
| `META_US_AD_ACCOUNT_ID` | Conta US |
| `AMAZON_CLIENT_ID` / `_CLIENT_SECRET` / `AMAZON_REFRESH_TOKEN` | App SP-API EUA (conta VITA PET LIFE) |
| `AMAZON_BR_CLIENT_ID` / `_CLIENT_SECRET` / `AMAZON_BR_REFRESH_TOKEN` | App SP-API BR (conta CocoandLuna) — nunca reusar o token do EUA |
| `AMAZON_BACKFILL_DAYS` | Janela da 1ª carga antes de existir cursor (padrão 2) |
| `AMAZON_FETCH_PII` | `1` liga busca de nome do comprador (exige papel PII aprovado) |
| `AMAZON_NAMES_EVERY_HOURS` / `AMAZON_NAMES_DAYS` | Reconciliação de nome de produto (padrão 12h / 2 dias) |
| `AMAZON_RETENTION_DAYS` | Poda de pedidos Amazon antigos, opt-in (padrão 0 = desligado; produção usa 365) |
| `AMAZON_ROLE_ARN` / `AMAZON_AWS_ACCESS_KEY` / `_SECRET_KEY` | IAM Role + credenciais do IAM User (compartilhados BR/US) |
| `GOOGLE_ADS_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URL` | OAuth do projeto Google Cloud |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Precisa de aprovação "Basic access" |
| `GOOGLE_ADS_CUSTOMER_ID` | Só EUA |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Só se o developer token foi gerado sob uma MCC |
| `DATABASE_URL` | Postgres — Railway NÃO injeta sozinho, setar `${{Postgres.DATABASE_URL}}` |

Armadilhas conhecidas: `read_analytics` ausente faz `shopifyqlQuery` sumir do schema sem erro.
Amazon `CreatedBefore` precisa ficar ≥2min no passado. IAM User precisa de `sts:AssumeRole` no
Role E o Role precisa ter o User no trust policy. Mercado Ads exige escopo `write:product_ads`
no OAuth do ML, reautorizar via `/mercadolivre/connect` se faltar.

## 7. Rodar / endpoints principais

`npm install` → `npm start` (porta 3000, sync roda ao subir e a cada `SYNC_INTERVAL_MINUTES`).
`npm run sync` faz uma sincronização única.

- `GET /api/dashboard?channel=&metric=&since=&until=&market=br|us` — payload principal
- `GET /api/campaigns?market=&since=&until=` — campanha a campanha, ao vivo, cache 5min
- `GET /api/products?market=&since=&until=` / `GET /api/stock?market=`
- `GET /api/orders/search?market=&q=` / `GET /api/orders/export?...`
- `POST /api/sync` / `GET /api/status`
- `POST /api/amazon/{reset-backoff,force-sync,backfill,images,sync-names,cleanup-market-leak}`
- `GET /shopee/connect` · `GET /mercadolivre/connect` · `GET /googleads/connect`
- `GET /shopify-yucaloo/:mkt(br|us)/{connect,callback}` — chamadas pela própria Shopify
- `POST /api/login` / `POST /api/logout` / `GET /api/me`
- `GET/POST /api/product-groups*` (Unificador, admin) · `GET/POST /api/product-types*` ·
  `GET/POST /api/product-hidden-tags*` (admin)
- `GET /api/integrations` / `POST /api/integrations/:key/toggle` (admin)
- `GET /health`

## 8. Status das integrações

| Canal | Estado |
|---|---|
| Shopify BR/US | Ativo |
| Shopify Yucaloo BR/EUA | Ativo, mesclado no market da Coco and Luna |
| Shopee | Ativo — sem analytics, endereço via Bling |
| Mercado Livre | Ativo — pedidos + Mercado Ads |
| Amazon BR | Ativo — app próprio, corrigido de um token de conta errada |
| Amazon US | Ativo — cursor incremental + backfill via Reports API |
| Meta Ads BR/US | Ativo |
| Google Ads | Ativo, só EUA |
| Amazon Ads, TikTok Shop | Planejado, sem código ainda |

## 9. A fazer

- **Amazon — nome do comprador (PII):** bloqueado até a Amazon aprovar o papel PII no Solution
  Provider Portal. Código já pronto, só precisa de `AMAZON_FETCH_PII=1`.
- **Amazon US — imagem de produto (403):** Catalog Items API bloqueada porque o app dos EUA não
  tem o role "Product Listing". Habilitar no portal + re-autorizar (novo refresh token). O app do
  BR já nasceu com esse role, então BR já não tem esse problema.
  Código pronto (`POST /api/amazon/images`).
- **Amazon Ads e TikTok Shop:** integrações ainda não construídas, aparecem só como "Planejadas"
  na tela de Integrações.
- **Toggle "Incluir Mercado Ads" no dashboard principal não respeita o período selecionado:**
  lê `mlBreakdown.adCost`, um valor preso na janela fixa de 60 dias do sync periódico (mesma causa
  já corrigida em Campanhas, que usa `/api/campaigns` ao vivo). Não corrigido aqui porque
  `/api/dashboard` é, por design, o único endpoint que nunca depende de chamada externa em tempo
  de request — corrigir exige ou quebrar esse princípio ou sincronizar o gasto do ML como série
  diária (não confirmado se a API de Mercado Ads suporta isso).
- **Yucaloo sem conta de Ads própria:** não tem card em Campanhas nem ROAS calculado. Revisitar
  quando a marca tiver conta de anúncios própria.
- **Decisão pendente:** pedidos `PENDING` (Pix/boleto aguardando) contam como receita hoje — Luan
  decide se quer só pagos.
- **Microsoft Clarity:** o Luan tem Clarity conectado nos 4 sites (Coco BR/EUA, Yucaloo BR/EUA) e
  quer avaliar trazer os dados pra uma página própria da dashboard. Ainda não iniciado — falta
  decidir os project ID/token de cada site. Limitação já identificada: a API pública do Clarity só
  devolve métricas agregadas dos últimos 1–3 dias (sem histórico longo) e não expõe heatmaps nem
  gravações de sessão — isso continua só no painel deles.

## 10. Convenções

- ES Modules (`"type": "module"`), Node 18+ (usa `fetch` nativo).
- Dependências mínimas: `express`, `dotenv`, `pg`. Sem aws-sdk, sem axios.
- UI e textos em pt-BR. Valores em BRL/USD via `Intl`/`toLocaleString`.
- `.gitignore`: `node_modules/`, `.env`, `data/db.json`, `*.log`, `.claude/`.
- Repositório é público — nunca commitar `.env`, token, secret ou qualquer credencial real. Revisar
  o diff antes de commitar se algo parecer um valor sensível, mesmo em arquivo aparentemente inócuo.
