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
motivo histórico); não tratar "Vita Pet Life" como nome de loja em textos de UI (ex.: não rotular
um canal Shopify específico como "Vita Pet Life", isso é sempre "Coco and Luna" ou "Yucaloo",
ver `colors.js`). Já o rodapé (`#footerDate`, 6 páginas: Visão geral/Produtos/Estoque/Campanhas/
Segmentos/Geografia) usa "Vita Pet Life" DE PROPÓSITO desde 21/08/2026 — é o resumo de rodapé da
dashboard inteira, que hoje cobre duas marcas (e mais devem vir), então "Coco and Luna" sozinho
ficou impreciso ali; o nome da empresa como identificador de "de quem é essa dashboard" é
exatamente o uso correto do nome legal. As duas regras não se contradizem: uma é sobre não
inventar uma "loja Vita Pet Life" que não existe, a outra é sobre o rótulo correto pra dashboard
como um todo.

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
src/insights.js          Regras do card "Insights" (sem IA) — puro, testável sem banco
src/us-states.js         normalizeUsState(): reduz grafias de estado dos EUA a 2 letras
src/auth.js              Login: hash scrypt+salt, sessão por cookie, CRUD de usuários, permissão por página
src/sync.js              Orquestra a busca de todos os canais e grava no store
src/backfill.js          Recupera pedido antigo das lojas Shopify (o que a janela móvel não pegou)
src/backup.js            Backup diário do banco pra Backblaze B2 (API nativa, sem SDK)
src/alerts.js            Alerta no Telegram quando um canal fica travado sem sincronizar
scripts/restore-backup.mjs  Restaura o banco a partir de um backup do B2 (destrutivo, pede confirmação)
public/index.html        Dashboard principal (Revenue)
public/campanhas.html    Gastos reais por canal + campanhas
public/produtos.html     Catálogo completo por canal
public/estoque.html      Estoque + produção, híbrido real (vendas) + manual
public/segmentos.html    Gato vs Cachorro, tipos de produto, geografia por produto
public/geografia.html    Mapa por estado (Leaflet), seletor BR/EUA embutido
public/unificador.html   Agrupamento manual de produtos entre canais (admin)
public/configuracoes.html Geral, login, gestão de usuários (admin)
public/integracoes.html  Status + liga/desliga por integração (admin)
public/login.html        Tela de login (standalone)
public/404.html          Página de erro 404 (rota desconhecida)
public/js/sidebar.js       Sidebar compartilhada (IIFE, injeta markup + CSS + comportamento)
public/js/colors.js        Sistema de cores compartilhado (IIFE) + color picker
public/js/jobs-widget.js   Card flutuante de processos em segundo plano (IIFE), toda página
public/js/confirm-modal.js Pop-up de confirmação (substitui confirm() nativo, IIFE), toda página
public/js/periodo.js       Rótulo do período selecionado (IIFE), fonte única das 6 telas com seletor
public/css/switch.css      Toggle .ios-switch, padrão único do app
```

### Organização de `public/` (25/08/2026)
Só `.html` e `favicon.png` ficam na raiz — a raiz é o que o `express.static` serve, e as páginas
precisam estar lá pras URLs limpas (`/produtos` etc., ver `SLUG_TO_FILE` em server.js). Antes as
imagens estavam soltas no meio dos HTML e não dava pra ver o que era página e o que era asset.

```
public/
  *.html                 as 11 páginas (raiz obrigatória)
  favicon.png            convenção de raiz, fica onde está
  css/                   switch.css anim.css        (estilo compartilhado)
  css/paginas/           um .css por página, extraído do <style> dela
  js/                    sidebar.js colors.js geo.js periodo.js pill-switch.js confirm-modal.js
                         jobs-widget.js             (componentes compartilhados)
  js/paginas/            um .js por página, extraído do <script> dela
  img/marca/             Logo2.png (ícone "CC" da Coco and Luna)
  img/bandeiras/         bandeira_brasil.webp bandeira_eua.svg
  img/canais/            logo_* usados nos cards de canal (Campanhas/Produtos/Estoque)
  img/integracoes/       antiga logos-integracao/ — logos da tela de Integrações (LOGO_BASE)
  img/mascotes/          coco.svg (cachorro) luna.svg (gata)
  img/ilustracoes/       404.png
  geo/                   us-states.json (contorno dos estados dos EUA, ver Geografia)
```

### O código das telas não mora mais dentro do HTML
- Cada página tem UM `public/js/paginas/<pagina>.js` e UM `public/css/paginas/<pagina>.css`.
  Eram 7.172 linhas de JS e 2.323 de CSS dentro dos `.html`; o markup caiu de 11.231 para 1.757
  linhas. `index.html` sozinho tinha 2.638 linhas e hoje tem 368.
- **A extração foi um movimento puro**: nenhum caractere mudou de lugar dentro do bloco. O script
  que fez isso remontava cada página a partir dos arquivos gerados e comparava byte a byte com o
  original, abortando sem gravar nada se sobrasse qualquer diferença.
- **O script continua clássico, não módulo.** É o que preserva o comportamento: `function foo(){}`
  num `<script src>` clássico continua virando global, então os `onclick="foo()"` do markup
  continuam achando a função. Trocar por `type="module"` quebraria todos eles de uma vez, em
  silêncio. Pela mesma razão não leva `defer` nem `async`: a tag está na mesma posição do bloco
  antigo (fim do `<body>`), e script clássico sem esses atributos executa exatamente na ordem em
  que aparece, igual ao inline.
- **Isso NÃO liberou a CSP.** Tirar `'unsafe-inline'` de `script-src` ainda esbarra em 66
  atributos de evento (`onclick=` e afins, contando o markup que os próprios scripts geram em
  tempo de execução), e de `style-src` em 55 atributos `style=`. Enquanto existir um só deles,
  tirar `'unsafe-inline'` quebra a página sem erro visível. Fechar de verdade é trocar cada
  atributo por `addEventListener` e por classe de CSS, que é outro trabalho.
- **Teste que lê tela precisa usar `fontePagina(nome).tudo`** (`scripts/test/_lib.mjs`), que
  devolve o markup junto com o `.js` e o `.css` daquela página. Um teste que lesse só o `.html`
  continuaria passando e não estaria mais checando nada — foi o que aconteceu com quatro deles no
  instante seguinte à extração, antes de serem religados. Só quem confere estrutura de markup usa
  `.html` puro.

Duas armadilhas ao mexer nisso:
- **Caminho relativo dentro de um `.js` resolve pela PÁGINA, não pelo arquivo do script.**
  `sidebar.js` mora em `public/js/` mas injeta `<img src="favicon.png">`, e isso continua certo
  porque quem resolve é o documento (`/produtos`), que está na raiz. Não "consertar" pra `../`.
- `LOGO_BASE` (integracoes.html) prefixa os nomes de logo que o `server.js` devolve em
  `computeIntegrationsList` — lá os valores são nome pelado (`Amazon_logo.png`), não caminho.
  Logo começando com `/` escapa do `LOGO_BASE` e é caminho absoluto (`/img/marca/Logo2.png`).

Removidos por não serem referenciados em lugar nenhum: `Feno_no_deserto.svg` (substituída pela
`404.png` em 18/08/2026), `Logo1.svg`, `logo_shopify.png`, `logos-integracao/TikTok_logo.png`.

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
  ShopifyQL. `isCancelled` (metrics.js) é só `o.cancelled` — cada canal já decide isso na origem
  (ver abaixo), não recalculado aqui.
- **Só pedido com pagamento de verdade recebido conta como venda** (decisão de negócio,
  28/07/2026 — resolve a antiga "decisão em aberto" sobre `PENDING`). `cancelled: true` em TODOS
  os canais cobre tanto cancelamento de verdade quanto "nunca foi pago" — os dois saem juntos de
  receita/pedidos/ticket/produtos/geografia (mesmo flag, filtrado em todo lugar por
  `isCancelled`). Por canal:
  - Shopify (BR/US/Yucaloo, `shopify.js`, `CANCELLED` set): `EXPIRED`, `VOIDED`, `CANCELLED`,
    `PENDING` (Pix/boleto aguardando, pode falhar), `AUTHORIZED` (cartão autorizado mas NÃO
    capturado, dinheiro ainda não foi cobrado) — `cancelledAt` também conta.
    `PAID`/`PARTIALLY_PAID`/`PARTIALLY_REFUNDED`/`REFUNDED` continuam contando (teve pagamento
    real; devolução já se ajusta sozinha, ver mais abaixo).
  - Shopee (`shopee.js`): `CANCELLED`, `UNPAID`, `INVOICE_PENDING`.
  - Mercado Livre (`mercadolivre.js`): `cancelled`, `invalid`, `confirmed`, `payment_required`,
    `payment_in_process`.
  - Amazon (`amazon.js`, Orders API e Reports API): `Canceled`/`Cancelled`, `Pending`,
    `PendingAvailability`.
  - `UNPAID_STATUS_BY_CHANNEL` (store.js) é só um subconjunto — mesmos status acima, mas
    separados por "não pago" (rótulo "Em aberto" na busca de pedidos) de cancelamento de verdade,
    cosmético (`statusLabelPt`), não afeta nenhum cálculo. `fixUnpaidOrders()`
    (`POST /api/orders/fix-unpaid`) corrigiu o `cancelled` de pedidos já gravados ANTES dessa
    decisão existir (sync incremental não retoca pedido que não mudou de status sozinho) — já
    rodou em produção, `fixed:0` (nenhum pedido pra corrigir), nada pendente aqui.
- Quantidade/receita por produto usa `LineItem.currentQuantity` (não `quantity`, que inclui
  devolvido) e desconta reembolso do `discountedTotalSet` via `order.refunds`.

### Sessões / funil (só lojas Shopify — Coco and Luna + Yucaloo)
- ShopifyQL: `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions,
  sessions_that_reached_checkout, sessions_that_completed_checkout TIMESERIES day`.
- Resposta vem em `shopifyqlQuery.tableData.rows`; `parseErrors` pode ser `[]` (truthy) — checar
  `.length`, não truthiness.
- Precisa dos escopos `read_analytics` + `read_reports`. Sem `read_analytics`, `shopifyqlQuery`
  simplesmente some do schema, sem erro.
- Yucaloo tem loja Shopify própria, então também tem sessão real (o app dela já pede
  `read_analytics`/`read_reports` no SCOPE, ver shopifyYucaloo.js) — gravada num balde **separado**
  (`kv.yucalooSessionsDaily`, `{[market]:{[date]:row}}`, `setYucalooSessionsDaily`/
  `getYucalooSessionsDaily` em store.js), não na tabela `sessions_daily` (que tem `date` como chave
  primária SEM dimensão de canal — gravar ali por cima misturaria/sobrescreveria os dias da Coco
  and Luna). `aggregateSessions()` (metrics.js) soma os dois baldes por canal selecionado: canal
  `shopify`/`shopify_us` → só Coco and Luna; `yucaloo_br`/`yucaloo_us` → só Yucaloo; `todos` → soma
  as duas lojas do mercado. Cards "Tráfego & conversão" e "Funil de conversão" (index.html) ficam
  visíveis pra Yucaloo também (`isYucaloo` em `updateCardVisibility`), com a logo da loja
  (`logos-integracao/cocoandluna.webp`/`Yucaloo1.png`) no subtítulo do card de tráfego pra deixar
  claro de qual loja é o número. Pedido do Luan, 18/08/2026.

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
- **Gasto do Mercado Ads por dia** (`fetchAdCostsForDays(days)`, sync.js `syncMlAdCostsDaily()`):
  resolve o advertiser UMA vez e chama `campaigns/search` com `date_from=date_to=o mesmo dia`, um
  dia por vez — reaproveita o parser já testado (`c.metrics || c`) em vez de arriscar
  `aggregation_type=DAILY` (a API tem esse parâmetro, confirmado por busca, mas sem formato de
  resposta documentado publicamente; adivinhar errado deturparia histórico de gasto sem ninguém
  perceber, então preferimos o caminho mais lento e verificável). Guardado em
  `kv.mlAdCostsDaily` (`{ [data]: {spend,clicks,impressions} }`, mesmo padrão do
  `metaInsightsDaily`). Cada sync sempre reconfirma os últimos `ML_ADS_RECENT_DAYS` (2 — o dia de
  hoje ainda está em andamento) e preenche até `ML_ADS_MAX_BACKFILL` (10) dias que ainda faltam na
  janela de 60 dias, um pouco a cada ciclo em vez de tudo de uma vez (evita estourar chamadas na
  primeira vez que isso roda). `mlBreakdown.adCost`/`.adClicks` (metrics.js) somam esse balde
  dentro do período `since..until` selecionado na tela — antes vinha de um valor único
  (`kv.mlAdCosts`, removido) preso na janela fixa do sync, então o ROAS/ACOS da Visão geral não
  mudava com o período escolhido (bug do backlog "toggle Mercado Ads", corrigido 19/08/2026 — o
  toggle em si já tinha sido removido antes, só a causa raiz ficou pra trás).

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
- Histórico por mercado (BR/EUA separados, `kv.amazonRetentionConfig`) — painel único em
  Integrações → "Amazon — Histórico", **um campo só**: "dias de histórico desejado". Duas telas
  separadas (retenção que apaga + busca que soma) confundiam — "isso soma com aquilo?" (pergunta
  real do Luan, 18/08/2026) — unificado num único número que decide sozinho a ação certa
  (`GET/POST /api/amazon/history`, `planAmazonHistory()` em server.js):
  - pedido mais antigo hoje é MAIS VELHO que o número → sobra dado → **poda** (mostra prévia,
    "isso vai apagar N de M pedidos", só aplica com confirmação explícita — é a única ação que
    apaga pedido de verdade; poda com padrão agressivo já quase apagou 9 meses de dado
    recém-recuperado, 10/07/2026, daí o cuidado);
  - pedido mais antigo é MAIS NOVO que o número (ou não existe nenhum ainda) → falta dado →
    **backfill automático** (reaproveita `POST /api/amazon/backfill?days=N&market=`, que já
    existia só como endpoint sem tela; não precisa de confirmação, só soma). Refaz a janela
    inteira em vez de só o trecho novo — mais simples, upsert por id não duplica.
  Mercado sem config salva ainda cai no legado `AMAZON_RETENTION_DAYS` (produção: 365) — preserva
  o comportamento de antes até o usuário mudar algo pela tela. A config salva também é o que
  `sync.js` usa pra poda incremental automática do dia-a-dia (mesmo mecanismo de sempre,
  `pruneOrders`) — uma fonte de verdade só.
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

### Insights (`src/insights.js`, card da Visão geral)
- Frases curtas explicando O QUE mudou no período contra o período anterior comparável. Nasceu do
  card de Insights do Shopify que o Luan trouxe como referência (24/08/2026).
- **Não usa IA, e é decisão deliberada, não falta de vontade.** O insight do Shopify também não
  usa: é estatística encaixada num molde de frase. Motivos de manter assim: número exibido é o
  número calculado (LLM erra conta e inventa com convicção); `/api/dashboard` nunca chama serviço
  externo na hora de responder e chamar IA a cada carregamento quebraria isso além de custar por
  acesso; dado de faturamento não sai daqui; e o mesmo dado gera sempre a mesma frase, então dá
  pra testar. Se um dia quiser IA, o lugar certo é SÓ um botão "ver o motivo" sob demanda, nunca
  no caminho do carregamento.
- Papel do card, e a razão dele ficar logo abaixo da faixa de Indicadores: a faixa diz "receita
  subiu 53%", o card diz POR CAUSA DE QUÊ (qual canal/produto/estado/etapa puxou).
- `insights.js` é **puro**: recebe dois retratos já calculados (atual e anterior) e devolve a
  lista. Não lê store, não faz I/O e NÃO importa `metrics.js` (evitar import circular — os rótulos
  de canal e nomes de estado chegam por parâmetro). É o que permite testar as regras sem banco.
- Regras hoje: canal parado (prioridade máxima, quase sempre é integração quebrada e não queda de
  vendas), canal que mais subiu/caiu, produto que mais mexeu, concentração num produto só, queda/
  ganho de conversão, maior vazamento do funil, ticket médio, eficiência de anúncio (inclui o caso
  "gastou e não veio nenhuma venda atribuída") e estado que mais mexeu.
- **Anti-ruído é o que faz o card prestar.** Com algumas dezenas de pedidos por dia, percentual
  isolado é ruído: um estado que foi de 1 pra 4 vendas vira "+300%" e não significa nada. Toda
  regra de variação em dinheiro exige TRÊS pisos ao mesmo tempo — valor absoluto (`MIN_ABS`, R$200
  no BR / US$50 nos EUA), peso no total do período (`MIN_SHARE`, 8%) e variação relativa
  (`MIN_PCT`, 15%) — e a ordenação final é por impacto em dinheiro, nunca por percentual.
  Conversão/funil exigem `MIN_SESSIONS`, ticket exige `MIN_ORDERS`. Lista limitada a 6, no máximo
  2 por dimensão (senão um dia em que tudo mexeu no mesmo eixo enche as vagas só com "Canal"), e
  insights com os mesmos dois números são deduplicados (num canal que vende um produto só,
  "Shopify caiu de X pra Y" e "Lisina caiu de X pra Y" são a mesma frase duas vezes).
- Frases e números vêm PRONTOS do servidor; o front (`renderInsights` em `index.html`) só desenha,
  nunca recalcula nem reformata. É o mesmo princípio de "uma fonte de verdade só" já documentado
  em Campanhas — duas pontas formatando o mesmo número acabam discordando.
- **Semáforo de três cores** (pedido do Luan, 24/08/2026): campo `kind` = `'bom'` (verde) /
  `'medio'` (amarelo) / `'ruim'` (vermelho). Quem classifica é a REGRA no servidor, nunca o sinal
  do número no front: ACOS caindo é bom, custo subindo é ruim, e "concentração de 80% num produto"
  não tem sinal nenhum. O ícone acompanha a cor (`bi-check-circle-fill`/`bi-exclamation-circle-fill`/
  `bi-exclamation-triangle-fill`) pra não depender só dela. A regra do funil é `'medio'` de
  propósito mesmo perdendo 90%+ entre sessão e carrinho: isso é o normal de qualquer loja, e um
  vermelho fixo em todo período treinaria o olho a ignorar o vermelho do card inteiro — só vira
  `'ruim'` quando o vazamento é no fim (quem chegou no checkout e desistiu de pagar).
- **Tira horizontal com carrossel finito**, não coluna vertical (pedido do Luan, 24/08/2026: em
  linha "cabe mais insights sem deixar o card gigantesco na vertical"). Por isso cada insight tem
  DOIS textos: `label` (sintagma curto, "Conversão em queda", que é o que cabe na aba de ~200px) e
  `title` (frase inteira, que aparece no detalhe embaixo). Regra nova que esquecer o `label` não
  quebra — o front cai no `title` — mas fica feia na tira.
  - As abas usam `flex:1 1 200px` + `min-width:200px`: com poucas elas crescem e preenchem a linha
    toda; passando do que cabe, param de encolher e a tira rola. É o que faz o carrossel aparecer
    sozinho só "quando tem muito", sem contar itens no JS.
  - Navegação **finita** de propósito (pedido explícito): as setas desabilitam nos extremos em vez
    de dar a volta — carrossel infinito faria o mesmo insight reaparecer e confundir.
  - `MAX_INSIGHTS` subiu de 6 pra 10 junto com essa mudança: o que limitava era altura de card, e
    não limita mais. Os pisos anti-ruído é que decidem quantos aparecem de verdade.
  - Trocar de aba NÃO remonta a tira (só troca a classe ativa e redesenha o detalhe), e o
    `scrollLeft` é salvo/restaurado ao redor de cada remontagem — senão o refresh periódico de
    dados jogava o carrossel de volta pro começo enquanto a pessoa lia um insight do fim.
  - **`behavior:'smooth'` pode ser ignorado SILENCIOSAMENTE** (movimento reduzido no sistema, ou
    rolagem suave desligada no Chrome): a chamada não dá erro e o elemento não sai do lugar.
    Confirmado ao vivo aqui — `scrollTo`/`scrollBy` com `'auto'` funcionam e com `'smooth'` ficam
    em zero, então o clique na seta não fazia NADA. `insScroll()` tenta suave e, se em 250ms não
    andou, aplica direto. Vale como regra pra qualquer rolagem programática nova neste app. Pelo
    mesmo motivo `.ins-list` NÃO leva `scroll-behavior:smooth` no CSS: ele se aplicaria também à
    atribuição direta de `scrollLeft`, que aqui precisa ser instantânea.
- `productRevenueRows()`/`revenueByState()`/`sumDailyRange()` (metrics.js) foram extraídos de dentro
  do `computeDashboard` justamente pra que o período anterior use EXATAMENTE a mesma agregação do
  atual. Se as duas pontas divergirem, a comparação mente.
- `BR_STATE_NAMES`/`US_STATE_NAMES` (br-states.js/us-states.js) existem porque a frase é montada no
  servidor e precisa de "Minas Gerais", não "MG" — as telas de Geografia/Segmentos têm as próprias
  tabelas de nome por motivo histórico, mas texto gerado no backend precisa de fonte no backend.

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
  `segmentos.html` (`CH_BY_MARKET`) e `geografia.html` (`CHAN_BR`/`CHAN_US` +
  `CHAN_COLORS_MAP`/`CHAN_LABELS_MAP`). `campanhas.html` fica de fora de propósito — não
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

### Cabeçalhos de segurança (`server.js`, topo)
- CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` e HSTS
  (só sob HTTPS), tudo à mão, sem helmet. Rate limit geral em `/api` e um específico de login.
- **A CSP é a armadilha: domínio que falta nela é bloqueado SEM erro visível.** A página abre
  normalmente, só falta o recurso, e ninguém percebe. Foi o que aconteceu com a fonte Inter: as 11
  páginas pediam ela ao Google Fonts, a CSP não liberava nem `fonts.googleapis.com` (a folha) nem
  `fonts.gstatic.com` (os `.woff2`), e a dashboard inteira rodou na fonte do sistema até
  27/08/2026 sem ninguém entender por que "estava um pouco diferente". Corrigido.
- Ao adicionar QUALQUER recurso externo novo (script, folha de estilo, fonte, `fetch`), conferir a
  diretiva certa: script → `script-src`, folha → `style-src`, fonte → `font-src`, `fetch` →
  `connect-src`. Uma folha do Google Fonts precisa de DOIS domínios, um em cada diretiva.
  `preconnect` não conta, ele não carrega nada.
- `'unsafe-inline'` em `script-src`/`style-src` continua exigido, mas não mais pelo motivo
  antigo: a lógica e o estilo já saíram do HTML. O que ainda o exige são os ATRIBUTOS —
  `onclick=` e afins (inclusive no markup gerado em tempo de execução pelos scripts) e `style=`
  direto na tag. Fechar isso é trocar cada um por `addEventListener` e por classe de CSS.
- **Todo recurso de CDN carrega com `integrity` + `crossorigin="anonymous"`** (SRI): ECharts,
  Leaflet e Bootstrap Icons. Sem isso, um pacote adulterado na origem roda dentro da dashboard
  já logada. Os dois atributos são indivisíveis — sem `crossorigin` o navegador não consegue
  verificar recurso de outro domínio e bloqueia igual.
  - Ao trocar a VERSÃO de qualquer um deles, recalcular o hash:
    `sha384-` + sha384 do arquivo em base64. `scripts/test/sri.test.mjs` baixa cada recurso e
    compara, então um hash esquecido falha no teste em vez de sumir com o gráfico em produção.
  - A folha do **Google Fonts fica de fora de propósito**: o CSS que ela devolve varia conforme
    o navegador que pede, então o hash nunca bateria e a fonte ficaria bloqueada pra sempre.

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
- **"Tag mãe" do grupo** (`kv.productGroupTypes` = `{ [market]: { [nomeDoGrupo]: {type, typeGroup} } }`,
  campos Tipo/Categoria em cada card do Unificador, 26/08/2026): um grupo unificado é UM produto
  físico, então tem UM tipo. Antes disso o tipo era INFERIDO em tempo de consulta a partir dos
  membros que venderam NO PERÍODO, e como só o membro Shopify carrega o campo `productType`
  (Amazon/Shopee/ML não têm esse conceito), o mesmo produto trocava de tipo conforme a data
  escolhida: numa janela em que só a listagem Amazon do "Daily" vendeu, o grupo inteiro caía em
  "Outros"; numa janela maior voltava a ser "Pó". Reportado pelo Luan com dois prints do MESMO
  produto em períodos diferentes. Três correções anteriores (item sem Type descartado, grupo sem
  herdar Type de um irmão, Type congelado no pedido em vez do catálogo vivo) atacaram camadas reais
  mas continuaram sendo inferência, então o resultado continuava variando com o período. Chave
  SEPARADA de `productGroups` de propósito: aquele blob é `{nome:[títulos]}` e é lido em cinco
  telas, então mudar o formato exigiria migrar produção e tocar em todas elas.
- **Dois eixos independentes, decisão do Luan** (26/08/2026, "vamos ter suplementos de diferentes
  tipos no futuro também, não só o pó"): `type` = forma física, alimenta os pills "Por tipo de
  produto" em Segmentos; `typeGroup` = macro-categoria, alimenta os cabeçalhos do Top produtos. NÃO
  unificar os dois num vocabulário só. Tags por mercado, nada compartilhado entre BR e EUA (também
  pedido explícito) — o formato `{[market]:{...}}` já garante isso.
- **Precedência do tipo** (`resolveGroupTypes` em `metrics.js`, por eixo, primeiro que resolver
  vence): 1) tag mãe manual; 2) Type/tags ATUAIS do catálogo Shopify de qualquer membro do grupo,
  varrendo TODOS os membros cadastrados (tenham vendido ou não — é isso que mata a dependência de
  período); 3) palavra-chave de "Tipos de produto" no título de qualquer membro (só pro eixo
  `typeGroup`, é o que salva membro de canal sem catálogo); 4) null, e aí `applyGroupTypes` preserva
  o valor que veio dos itens do período. `applyGroupTypes` roda DEPOIS de `applyProductGroups` e tem
  a palavra final, mas só sobrescreve o eixo que o grupo conseguiu resolver. Aplicado em Segmentos
  (`computeDashboard`), Produtos (`mergeProductRows`) e Estoque (`computeStock`) — as três telas onde
  uma linha de grupo carrega `type`, pra não discordarem entre si.
- Os campos são `<datalist>`, não `<select>`: sugerem os Types já presentes no catálogo do mercado
  e os nomes de "Tipos de produto" cadastrados, mas continuam aceitando um valor novo digitado.
  Campo vazio = automático (volta pra inferência). Apagar o grupo apaga a tag mãe junto
  (`deleteProductGroup`), senão um grupo novo com nome repetido herdaria o tipo do antigo.

### Segmentos de público — "Gato vs Cachorro" (`public/segmentos.html`)
- Rótulo é **"Cachorro"**, não "Cão" (pedido do Luan, 25/08/2026). As CHAVES internas seguem
  `cat`/`dog` — é o modelo de dado (`computeSegments`, `metrics.js`), não texto de tela, e mudar
  isso não traria nada. As palavras-chave de classificação em `SEG_KW` (`metrics.js`) também
  continuam com `'cão'`/`'cães'`: elas casam com TÍTULO DE PRODUTO real, que segue escrito assim.
- Cores: gato `#ff002b`, cachorro `#0849e9`. Não são escolha estética avulsa — saem direto dos
  mascotes da marca (`img/mascotes/luna.svg` é a gata e usa `#FF002B`; `img/mascotes/coco.svg` é o
  cachorro e usa `#0849E9`). Trocar a cor sem trocar o SVG deixa o card brigando com o mascote que
  está do lado dele.
- **Fonte única**: `DEFAULT_SEG`/`CocoColors.seg` em `js/colors.js`, no mesmo formato de
  `DEFAULT_CH`/`DEFAULT_MKT` (inclui `label` e `text` de contraste, e aceita override salvo em
  `localStorage('coco_colors')` com chave `seg.<k>`). O `colors.js` também injeta as variáveis CSS
  `--cat`/`--dog`/`--other` (`segVarsCss()`, dentro do `injectStyle()` que já existia). Antes o hex
  vivia em DOIS lugares dentro do próprio `segmentos.html` — o `:root` do `<style>` e o objeto JS
  `SEG_COLORS` do gráfico de rosca — e já estavam divergentes na prática (`--other:#9c9790` no CSS
  contra `#c4b49a` no JS); quem mexesse em um não tinha como saber do outro.
- Por isso `segmentos.html` carrega `js/colors.js` no **`<head>`**, e não junto dos outros scripts
  no começo do `<body>` como as demais páginas: o CSS da própria página usa `--cat`/`--dog` e, se o
  script chegasse depois, os acentos e as barras dos cards nasceriam sem cor por um instante.
- O mascote aparece no cabeçalho de cada card de segmento (`.seg-card-mascote`, `SEG_MASCOTE`).
  `height` fixo com `width:auto` de propósito: os dois SVG têm proporções diferentes e travar os
  dois no mesmo quadrado achataria um deles.

### Tipos de produto
- Categorias criadas pela própria UI (Segmentos → botão de gerenciar tipos), não hardcoded.
  `kv.productTypeGroups` = `{ [market]: { [nomeDoTipo]: [palavraChave,...] } }`. Testa a palavra-
  chave contra título + productType + tags do item; primeira regra que bater vence; sem regra
  cadastrada cai em `'Outros'`. Usado no "Top produtos" por segmento em Segmentos.

### Ocultar produtos
- Palavras-chave testadas só contra TAG do item (`kv.productHiddenTags`, por mercado), geridas no
  Unificador. Item que bate vira segmento `'hidden'` em vez de cat/dog/other, some de
  `productGeo`/Segmentos normais e aparece só no card "Ocultos" (Unificador e Segmentos).
- Filtro vale em toda a dashboard, não só em Segmentos: `computeDashboard` (Top Produtos),
  `computeProducts` (Produtos) e `computeStock` (Estoque) também excluem o produto (antes só
  Segmentos respeitava a tag oculta e o produto continuava aparecendo normalmente em
  Produtos/Estoque/Top Produtos, corrigido 17/08/2026).
- `isHiddenProduct` (não `isHiddenItem` direto) decide isso nesses três lugares, priorizando a tag
  ATUAL do catálogo Shopify (`kv.shopifyProductCatalog`, re-sincronizado a cada ciclo) sobre a tag
  presa no pedido. `it.tags` de um pedido vem do produto na hora em que o pedido foi buscado (ver
  shopify.js) e nunca é re-sincronizado depois — se uma tag como "Combo"/"Teste" foi removida da
  Shopify depois, pedidos antigos continuam com ela presa pra sempre, e a união de tags em
  `aggregateProductsByChannel` carregava esse resíduo pra sempre junto. Sem a prioridade do
  catálogo, um produto com tags limpas HOJE continuava oculto por causa de uma tag que nem existe
  mais (reportado pelo Luan, 17/08/2026 — "Lisina para gatos 120g", tags atuais limpas, sumia de
  Produtos/Estoque mesmo assim). Canal sem catálogo (Shopee/ML/Amazon) cai no fallback de sempre: só
  a tag do pedido mesmo.

### Geografia (`geografia.html`)
- Página única com seletor BR/EUA no topo (mesmo padrão `mkt-toggle-wrap`/`setMarket()` de
  `campanhas.html`) — antes eram duas páginas/rotas separadas (`geografia.html` +
  `geografia-us.html`, um item de sidebar cada). Unificado 20/08/2026 a pedido do Luan: "temos
  tudo pronto, é só fazer essa lógica de mudar o país dentro de uma só página". `/geografia-us` e
  `/geografia-us.html` continuam existindo só como redirect 301 pra `/geografia?market=us`
  (bookmark antigo), lidos por `geografia.html` via `?market=` na URL na carga inicial.
- Leaflet 1.9.4, tile CartoDB Voyager. Dois modos: coroplético (polígono colorido por intensidade)
  e calor (também preenche o polígono, com gradiente — não usa círculos, evita sobreposição).
- **`public/js/geo.js` (`window.CocoGeo`) é a fonte única de tudo que Geografia e Segmentos
  compartilham**: as oito tabelas (nome de estado, centróide, sub-região do mapa de calor,
  códigos do IBGE e FIPS, nome→sigla dos EUA), o carregador de contorno com cache por mercado,
  o fundo do mapa e a interpolação de cor. Eram ~150 linhas IDÊNTICAS dentro de cada um dos dois
  HTML (conferido chave a chave antes de extrair, 27/08/2026), e corrigir um lado nunca chegava
  no outro. Uma tela nova que desenhe mapa carrega esse script em vez de copiar tabela.
- **Fundo do mapa: Esri "Light Gray Canvas"** (`CocoGeo.addBasemap(map)`), DUAS camadas
  (`World_Light_Gray_Base` + `World_Light_Gray_Reference`) — a base do Esri não traz nome de
  cidade nenhum, os rótulos vêm separados. Sem chave de API. Era CartoDB Voyager até 27/08/2026,
  quando a CARTO passou a exigir chave e começou a devolver o tile com **"API KEY REQUIRED"
  carimbado por cima do mapa**: HTTP 200, imagem válida, nada falhando no código, só a marca
  d'água na tela do usuário. Cinza claro também é melhor aqui do que o Voyager colorido — o mapa
  é fundo pro coroplético e não pode disputar cor com o dado desenhado em cima.
  `scripts/test/mapa.test.mjs` falha se alguém voltar pra um provedor que exige chave ou se uma
  página montar o próprio `L.tileLayer` em vez de chamar `addBasemap`.
- BR: GeoJSON do IBGE em runtime, casa por `codarea`. US: `public/geo/us-states.json`, servido do
  próprio domínio, casa por `_uf`. Esse arquivo vinha de um repositório de TERCEIROS via jsDelivr
  (`PublicaMundi/MappingAPI`) até 27/08/2026 — o mapa dos EUA parava de desenhar se aquele
  repositório fosse apagado ou renomeado, e nada avisava. Mesmo arquivo, mesma estrutura
  (`properties.name` → `_uf`), só a origem mudou. Não voltar a apontar pra CDN externa.
  Os dois ficam cacheados em memória (`geojsonDataBR`/`geojsonDataUS`) depois da 1ª carga — trocar
  de mercado não rebusca o GeoJSON se já visitado nesta sessão. Bounds/centro/zoom do Leaflet
  (`MAP_VIEW`) e as tabelas de nomes/centróides/sub-regiões (`STATE_NAMES`/`CENTROIDS`/
  `SUB_REGIONS`) trocam de ponteiro em `setMarket()`, não são reconstruídas.
- `byState` no mercado US passa por `normalizeUsState`. Endereço fora dos EUA no mercado US vira
  bucket `'INTL'` (não perde receita, só não vira linha própria por país). Território/militar
  contam como EUA.
- Lista de canais por mercado (`CHAN_BR`/`CHAN_US`) ainda é hardcoded no JS — ao adicionar canal
  novo em qualquer lugar do app, checar também aqui. O dropdown de canal em si já não é mais HTML
  estático: `renderChannelOptions()` monta as `.csel-opt` a partir de `CHAN_BR`/`CHAN_US` toda vez
  que o mercado troca, então só as duas constantes precisam de manutenção (antes eram 2 arquivos
  com `<div class="csel-opt">` duplicado cada).
- Formatação (`fmtMoney`/`fmtInt`/`pctStr`/`fmtDM`) lê a variável `market` em cada chamada — BRL/
  pt-BR no Brasil, USD/en-US nos EUA (mesmo padrão de moeda por mercado do resto do app; texto em
  pt-BR nos dois — a antiga `geografia-us.html` tinha "order"/"orders" em inglês vazado em dois
  lugares, corrigido na unificação).
- Cores do coroplético são as mesmas nos dois mercados; só a cor padrão da pill do mapa de calor
  difere (laranja `#f97316` no BR, azul `#3b82f6` no EUA) — configuração salva por mercado
  (`coco_choro_cfg`/`coco_choro_us_cfg`, `coco_heat_cfg`/`coco_heat_us_cfg`), recarregada a cada
  troca de país.

### Campanhas (`public/campanhas.html`)
- Os cards de RESUMO por canal (topo) e os cards de CAMPANHA individual (embaixo) precisam vir da
  MESMA fonte (`/api/campaigns`, ao vivo) — já existiu um bug em que o resumo lia
  `/api/dashboard` (janela fixa de 60 dias do sync periódico) enquanto os cards de baixo liam
  `/api/campaigns` (período escolhido na tela), e os dois discordavam. Não reintroduzir essa
  divergência.
- KPI do topo ("Vendas Atribuídas Geral") soma Meta + Mercado Livre (Destaque/premium) + Google Ads.
- Mercado Livre e Meta BR só aparecem no mercado BR; Meta US e Google Ads só no mercado US.
- KPI "Faturamento Geral" é `kpis.revenue` de `/api/dashboard` (canal `'todos'`) — receita da loja
  INTEIRA no período (todo canal, orgânico incluso), não soma dos cards de Ads abaixo. Não bate com
  a soma de Mercado Livre + Meta + Amazon BR por design; confundiu o Luan (18/08/2026, "de onde vem
  esse R$10k") por ficar ao lado de "Vendas Atribuídas Geral"/"ROAS Geral" (que são soma dos
  canais de Ads) — sub-label deixado explícito ("todos os canais, não só Ads") pra não repetir.
- Toggle de tipo de gráfico dos cards de canal (barra × linha, `.chart-type-btn`) fica acima da
  lista de canais (`.camp-grid-tools`, logo antes de `#campGrid`), não no header — o header é só
  filtro/config da página inteira, esse toggle controla só os mini-gráficos dos cards abaixo dele.
  Pedido do Luan, 19/08/2026.

### Produtos (`public/produtos.html`)
- Catálogo completo por canal, sem limite de top-N. Mescla pedidos do período com catálogo de
  todo o histórico — produto sem venda no período continua listado (qty/receita zeradas), porque é
  tela de catálogo, não de vendas.
- Isso vale por canal só se o canal já teve ALGUM pedido no histórico inteiro — um canal Shopify
  sem nenhum pedido ainda (ex.: Yucaloo recém-conectada) nem aparecia, porque a chave do canal só
  nascia a partir de pedido real. Corrigido: `computeProducts`/`computeStock` (`metrics.js`) também
  mesclam `kv.shopifyProductCatalog` (`mergeShopifyCatalog()`, mesma fonte que já alimentava o
  Unificador) — canal Shopify (`SHOPIFY_CATALOG_CHANNELS`) sem pedido nenhum ainda mostra seu
  catálogo real, com vendas zeradas, em vez de card vazio.
- Colunas financeiras editáveis por produto: COG, Frete, Impostos %, Comissão % → Lucro/Lucro %.
  `Lucro = Receita − COG×Qtd − Frete×Qtd − Receita×Impostos% − Receita×Comissão%`. Sem COG
  preenchido (nem override nem padrão), lucro fica `null` ("—"), nunca assume custo zero.
  Persistido em `kv.productFinance`, chave `canal|||título`.
  - Impostos padrão: 2,64% fixo (Simples Nacional).
  - COG padrão: R$ 15,21 (produto com "lisina"/"lysine" no título), R$ 17,32 ("daily"/"taurina"/"espirulina").
  - Comissão padrão por canal: Shopee 18%, Mercado Livre 14%, Amazon 12%, Shopify 0%.
  - Linha unificada pelo Unificador (`_grouped`, ver `applyProductGroups`): o campo nasce vazio (não
    dá pra mostrar UM valor de membros com overrides possivelmente diferentes), mas continua
    editável — grava o valor digitado em TODOS os membros do grupo dentro daquele canal
    (`data-grouped`/`data-members` no input, `onFinanceEdit` faz um POST por membro). Antes o campo
    ficava travado com "—" e a dica dizia pra editar "no produto individual", mas isso não tinha
    como ser feito (o título individual não aparece mais em lugar nenhum uma vez agrupado) —
    corrigido 17/08/2026.
- Combo/bundle (tag `combo` ou Shopify Bundles) mescla no produto-base, não vira linha própria.
- Exportar CSV: só Shopify US por enquanto (`GET /api/products/export`).

### Estoque (`public/estoque.html`)
- Híbrido: venda real (calculada) + estoque/produção manual. Seletor de período igual ao de
  Produtos (mesmo componente `.period-pop`); sem `since`/`until` na URL, `computeStock()` cai nos
  últimos 30 dias corridos (mesmo default de sempre). `windowDays` no retorno da API é o tamanho
  real do período (`daySpan`), não mais fixo em 30 — usado pra converter vendas do período em
  vendas/dia. Produto sem venda no período continua listado (mesclado do catálogo bruto Shopify,
  igual a Produtos, ver 4.13) — pedido do Luan (17/08/2026) ao adicionar o seletor: não pode sumir
  produto só por não ter vendido no período escolhido.
- Dois níveis: por canal (`kv.productStock`: só `stock`/`incoming`, editável) e agregado por
  família de produto somando todos os canais (`kv.productStockAgg`: `orderInProgress`/`orderNew`/
  `projected`, editável só aqui). Família = grupo manual do Unificador (prioridade) ou
  `classifyFamily()` por palavra-chave (Lysine/Daily) ou o próprio título.
  `totalMonthsOfStock = (stock+incoming+projected+orderNew+orderInProgress) / salesMonth`.
- O card POR CANAL também respeita grupo manual do Unificador (`applyProductGroups`), igual ao
  Panorama geral — faltava antes: o card por canal listava um título por SKU/listagem mesmo com um
  grupo já juntando duplicatas do mesmo produto físico (comum em Amazon/Shopee, onde o mesmo
  produto aparece com título ligeiramente diferente por listagem); corrigido 17/08/2026.
- Sugestão de reposição: `<3` meses = urgente, `3–7` = atenção, `≥7` = aguardar.
- Amazon BR sem nenhum item no catálogo recebe uma linha sintética "Produto TESTE" pra permitir
  cadastro manual de estoque mesmo sem nome de produto real.

### Devoluções
- Quantidade/receita por produto usa `LineItem.currentQuantity` (Shopify) e desconta refund do
  valor do item — ver "Receita" acima. Sem isso, produto devolvido continuava contando venda.

### Catálogo de canais (`public/js/colors.js`, `DEFAULT_CH`)
- **Fonte única de nome, cor, logo e mercado de cada canal.** Canal novo é UMA linha ali e ele
  aparece em todas as telas. Antes disso a mesma informação vivia em cinco tabelas
  (`CH_META` em Produtos e Estoque, `CHAN`/`MARKET_CHANNELS` na Visão geral,
  `CHAN_COLORS_MAP`/`CHAN_LABELS_MAP` na Geografia, `CH_BY_MARKET` em Segmentos) e as cópias já
  discordavam: Shopify verde numa tela e vermelha na outra, Amazon BR preta em quase tudo e
  laranja na Geografia e nos mini-gráficos de Campanhas. Pior: só quem lia daqui enxergava a cor
  que o usuário salva no seletor de cores, então mudar a cor de um canal não mexia em Produtos,
  Estoque nem Geografia (27/08/2026).
- Cores confirmadas pelo Luan na mesma data, a partir do que a Visão geral BR já mostrava:
  Shopify Coco and Luna verde (`#95BF47` BR / `#7EAD3C` EUA), Yucaloo azul `#4466FF`,
  Amazon BR preto `#111111`, Amazon EUA laranja `#FF9900`, Shopee `#EE4D2D`, Mercado Livre
  `#FFE600`. A ORDEM das chaves no objeto é a ordem em que os canais aparecem em toda tela.
- API: `CocoColors.channelsFor(market, {comTodos})` monta seletor de canal;
  `CocoColors.chLabel(chave)` dá o nome (trata `'todos'` e chave desconhecida sem quebrar);
  `CocoColors.setChannelColor(k, hex)` troca a cor E persiste. **Nunca escrever
  `CocoColors.ch[k] = {...}` na mão** — era o que as quatro telas com seletor de cor faziam, e
  isso agora apagaria `logo`/`logoFill`/`market` do canal: a logo sumiria do card e o canal
  deixaria de aparecer no seletor do próprio mercado, logo depois de alguém escolher uma cor.
- Só a COR é personalizável. Nome, logo e mercado vêm sempre do catálogo, nunca do que está
  salvo no navegador — senão uma cópia antiga no `localStorage` de alguém mostraria o nome velho.
- `'todos'` não está no catálogo de propósito: não é um canal, é a ausência de filtro.
- `scripts/test/canais.test.mjs` guarda tudo isso: falha se uma tela redeclarar qualquer das
  tabelas antigas, se um hex de canal aparecer solto numa página, se um logo apontar pra arquivo
  inexistente, se dois canais tiverem o mesmo nome — e executa o `colors.js` de verdade (com
  dublês de window/localStorage/document) pra testar o comportamento, não só o texto do arquivo.

### Animação de abrir e fechar (`public/css/anim.css`)
- **Tudo que abre e fecha na dashboard entra e sai suave** (pedido do Luan, 27/08/2026: "tudo que
  acontecesse na dashboard tivesse uma animação suave"). Cobre as 20 caixas do app: menus
  (`.csel-pop`, `.period-pop`, `.fp-pop`, `.chan-pop`, `.bulk-pop`, `.ccp-pop`), os fundos
  escurecidos, os modais centralizados (`.sp-panel`, `.smd-modal`, `.geo-modal`, `.exp-modal`,
  `.tr-modal`) e os blocos que surgem na própria página (`.card-bank`, `.select-bar`,
  `.pop-chan-detail`).
- Nenhuma linha de JavaScript de tela foi tocada: o padrão de todas elas é `display:none` na base
  e `display:flex` com a classe `open`, e os handlers continuam só pondo e tirando essa classe.
  Quem anima é `transition-behavior: allow-discrete` (segura o display até a saída terminar) mais
  `@starting-style` (dá o estado de onde a entrada parte).
- **O `@supports` em volta de tudo é o que impede um estrago.** Sem ele, num navegador sem
  suporte o `opacity:0` da regra base valeria e TODO menu do app abriria invisível. Não remover.
- **Modal centralizado usa `transform` pra se centralizar.** A escala precisa vir composta
  (`translate(-50%,-50%) scale(.97)`); escrever só `scale()` joga o modal pro canto inferior
  direito da tela. `scripts/test/animacao.test.mjs` falha se isso acontecer.
- **Card que expande** (Tendência e Tráfego, `index.html`): muda altura E largura, e a largura vem
  de `grid-column`, que não é animável. Quem cobre é uma **View Transition**
  (`comAnimacao()`), disparada só no CLIQUE — no carregamento não existe estado anterior pra
  interpolar. Se uma segunda página precisar do mesmo, `comAnimacao` sai do `index.html` pra um
  arquivo compartilhado.
- Ao criar uma caixa nova que abre e fecha, acrescentar o seletor ao grupo certo em `anim.css`:
  o teste varre todas as regras `.x.open{display:` do app e falha se alguma ficou de fora, e
  falha de novo se ela não tiver estado de entrada declarado (sairia suave e entraria seca).

### Rótulo de período (`public/js/periodo.js`, `CocoPeriodo`)
- **Fonte única do texto que aparece na pill de período**, nas 6 telas que têm seletor (Visão
  geral, Geografia, Segmentos, Produtos, Campanhas, Estoque). Eram sete implementações
  independentes, com formatos diferentes entre si (umas com `–`, outras com `.`) e **nenhuma
  mostrava o ano**.
- **O ano só aparece quando o período NÃO é do ano corrente.** No uso normal a pill continua
  curta ("01/08 – 28/08"); num período de outro ano ela vira "01/08 – 28/08/2025". Numa virada
  de ano cada ponta leva o seu ("20/12/2025 – 05/01/2026"), senão "20/12 – 05/01" não diz qual
  dezembro. Esconder o ano sempre é o que fez um período de agosto/2025 abrir a dashboard
  inteira zerada com o cabeçalho parecendo o mês corrente (28/08/2026).
- `rotulo(since, until, { hoje, mercado })` monta a pill; `data(iso, { mercado })` formata UMA
  data **sempre com o ano**, pra frase que fala de limite de histórico (onde esconder o ano
  seria esconder justamente o que importa). `mercado:'us'` inverte pra MM/DD, comportamento que
  a Geografia já tinha e foi preservado.
- `scripts/test/periodo.test.mjs` executa o módulo de verdade (em `node:vm`) e falha se uma
  tela voltar a montar o rótulo na mão ou deixar de carregar o script. Foi ele que achou uma
  sétima cópia escondida no seletor de período do Estoque, que a busca manual tinha deixado passar.

### Período sem dado nenhum (card de Insights)
- `computeDashboard` devolve `historyStart`: a data do pedido mais antigo daquele mercado
  (`getOldestOrderDate` em store.js, O(1) em cima do índice por mercado que já existia).
- O card de Insights tinha UMA frase pra duas ausências bem diferentes: período estável e
  período sem pedido nenhum. Dizer "Nada fora do normal neste período" quando não existe pedido
  é enganoso, porque não é que nada mudou, é que não há o que comparar. Agora são três textos:
  período anterior ao histórico (diz qual é a data do primeiro pedido registrado), período sem
  pedido, e período de fato estável.
- **O histórico começa quando o sync começou, não na primeira venda da empresa.** Cada ciclo
  busca uma janela móvel de 60 dias (`defaultWindow()` em sync.js) e faz upsert, então nada
  anterior à primeira sincronização jamais entrou no banco. Em 28/08/2026 o mercado BR começa
  em 17/04/2026 (Amazon BR, que é a única com backfill via Reports API), e as lojas Shopify/ML/
  Shopee só a partir do fim de abril.
- Recuperar o que ficou pra trás depende de um backfill POR CANAL, porque cada API tem o seu
  jeito. Amazon (Reports API) e as lojas Shopify (Admin API, ver abaixo) já têm. Mercado Livre e
  Shopee ainda não.

### Backfill histórico das lojas Shopify (`src/backfill.js`)
- Recupera pedido anterior à primeira sincronização, nas quatro lojas Shopify (Coco and Luna
  BR/EUA + Yucaloo BR/EUA). A Admin API serve o histórico inteiro; o que faltava era alguém pedir
  fora da janela móvel de 60 dias.
- **Só soma, nunca apaga.** É a diferença central pro painel "Amazon — Histórico", que é um campo
  de retenção e por isso poda quando o número diminui. Aqui não existe poda, então também não
  existe confirmação: um aviso de "isso não tem volta" seria mentira. Painel próprio em
  Integrações → "Shopify — Buscar histórico antigo", com um campo de dias por mercado.
- Percorre a janela em blocos de 30 dias (`CHUNK_DAYS`), do mais antigo pro mais novo, e grava
  bloco a bloco (`onChunk` → `upsertOrders`) em vez de tudo no fim — uma interrupção no meio
  preserva o que já veio, e como o upsert é por id, repetir um bloco não duplica. Mesmo princípio
  do backfill da Amazon.
- Uma janela que falha NÃO derruba o backfill inteiro: as outras continuam, e as falhas voltam em
  `falhas[]` e vão pro log. Elas precisam aparecer — um buraco silencioso no histórico passa por
  "não teve venda nesse período", que é exatamente a confusão que este backfill existe pra
  desfazer.
- `lojasDoMercado(market)` respeita `isIntegrationEnabled`, e a Yucaloo devolve `[]` sozinha
  quando a loja ainda não foi conectada (mesmo comportamento do sync normal).
- Endpoints: `POST /api/shopify/backfill?market=br|us&days=N` (admin, máx. 1825 dias) e
  `GET /api/shopify/history` (admin) — este último é só leitura: diz onde o histórico de cada
  mercado começa hoje e quais lojas o backfill alcançaria, pra tela não pedir um número sem dizer
  contra o que ele está sendo comparado.
- Job `shopify-backfill` no widget de processos, cancelável, com estado em `kv.shopifyBackfill`
  (chave separada do `amazonBackfill` de propósito: os dois podem rodar ao mesmo tempo, APIs e
  cotas diferentes, e um não pode sobrescrever o progresso do outro).

### Imagem precisa declarar o próprio tamanho
- **`<img>` dimensionado só por CSS que um script injeta aparece no tamanho do ARQUIVO até o
  script rodar.** A bandeira dos EUA do seletor Brasil/EUA piscava ocupando a tela inteira a cada
  troca de página: `.mkt-flag-img` é dimensionada dentro do `pill-switch.js`, e
  `bandeira_eua.svg` declara 1235x650. A do Brasil tem o mesmo defeito e nunca apareceu, porque
  é um `.webp` pequeno — o que faz a diferença é o tamanho natural do arquivo, não a página.
- Corrigido com `width`/`height` como ATRIBUTO nas 14 tags: atributo vale já na análise do HTML,
  antes de qualquer CSS ou JS. A regra do `pill-switch.js` continua valendo depois e diz o mesmo,
  então nada muda visualmente. Vale como regra pra qualquer imagem nova cujo tamanho venha de um
  componente IIFE.
- Folha de estilo de verdade no `<head>` não tem esse problema (ela bloqueia o desenho); só o
  CSS injetado por script tem. `scripts/test/imagens.test.mjs` cruza as duas listas e falha se
  uma imagem cair nesse caso sem declarar o próprio tamanho.

### Seletor de opção (`public/js/pill-switch.js`, `.pill-switch`)
- **Padrão único de todo seletor de duas ou mais opções mutuamente exclusivas**: moldura discreta
  e um pill claro que DESLIZA até a opção ativa. Pedido do Luan (27/08/2026) a partir do
  Colunas/Linhas de Integrações, que era o único com esse visual. Antes eram quatro aparências
  pra mesma decisão de interface — `.mkt-btn` (Brasil/EUA, 7 telas), `.chart-type-btn` (tipo de
  gráfico, 2 telas), `.mode-btn` (Coropleto/Calor) e `.vs-btn` — e três delas marcavam o ativo
  com fundo escuro em vez do pill.
- **O componente é PURA APRESENTAÇÃO.** Ele não trata clique, não muda estado, não decide nada:
  observa (`MutationObserver`) qual botão tem a classe `active` e leva o pill até lá. É o que
  permitiu converter 9 telas mexendo só em CSS e markup, sem tocar em um handler sequer — cada
  página continua sendo a única fonte da verdade sobre o que está selecionado. Se um clique for
  recusado pela lógica da tela, o pill não anda, em vez de mentir e se corrigir depois.
- Markup: `<div class="pill-switch">` + `<span class="ps-pill">` como PRIMEIRO filho (ele fica
  atrás e, vindo depois, cobriria o texto) + um `<button class="ps-opt">` por opção. As classes
  antigas (`mkt-btn`, `vs-btn`, `chart-type-btn`, `mode-btn`) seguem nos botões de propósito:
  são o gancho dos handlers de cada página, não têm mais CSS de aparência.
- Variantes: `pill-switch--sm` (só ícone, pro cabeçalho de card) e `pill-switch--full` (ocupa a
  linha toda, usado no celular em Integrações).
- **A opção padrão precisa nascer com `active` no HTML.** Quatro seletores marcavam o ativo só
  via JS, e antes do script rodar o controle aparecia sem nada selecionado.
- Nome NÃO é `seg`: nesse projeto `seg` já quer dizer segmento de público (gato/cachorro), em
  `segmentos.html`, em vinte classes `.seg-*` e em `DEFAULT_SEG`/`CocoColors.seg`.
- `scripts/test/seletores.test.mjs` guarda a estrutura (pill presente e em primeiro, pelo menos
  duas opções, exatamente uma ativa, script carregado, aparência antiga não ressuscitada) e
  confere que toda classe citada no CSS do componente existe mesmo no markup — regra apontando
  pra classe inexistente não dá erro, só deixa de se aplicar, e foi assim que um rename quase
  devolveu o pill deslizando da borda a cada carga de página.
- O `.ios-switch` (liga/desliga, `public/css/switch.css`) é outro controle e continua como está:
  ele não escolhe entre opções, ele liga ou desliga uma coisa.

### Padrões de UI compartilhados
- Sidebar (`sidebar.js`), sistema de cores (`colors.js`) e o widget de processos em segundo plano
  (`jobs-widget.js`) e o pop-up de confirmação (`confirm-modal.js`) são componentes injetados via
  IIFE — nunca duplicar CSS/markup deles numa página nova, sempre incluir o script
  (`confirm-modal.js` logo depois de `sidebar.js`, `jobs-widget.js` logo depois desse, em toda
  página exceto `login.html`).
- **"Financeiro" na sidebar é um item de página que ainda não existe, e FICA** (decisão explícita
  do Luan, 27/08/2026, ao revisar o código: "não tire a seção de financeiro da sidebar"). Ele
  sinaliza o que vem por aí. Só não pode fingir que é clicável: leva `.nav-soon` (sem hover,
  cursor normal, opacidade menor) e o selo "em breve". Quando a página existir, tirar a classe e o
  selo e dar a ele `href` + `data-page` como os outros — **sem `data-page` o item escapa do
  controle de permissão** e aparece pra usuário `padrao` que não teria acesso a ele.
- **Cabeçalho da sidebar** (logo + texto no topo, `.brand`): layout/tamanho igual ao da sidebar de
  `dashboard-social-media` (projeto irmão) — ícone pequeno (34px) à esquerda + nome/subtítulo à
  direita, em vez do logo grande empilhado em cima do texto. Pedido do Luan, 21/08/2026. Só o
  TAMANHO/LAYOUT veio de lá — a paleta (`--side-bg`/`--side-text`/`--side-muted`/`--side-hover`/
  `--side-active`) continua a mesma de sempre (fundo escuro sólido). Uma primeira tentativa (PR
  #159, `da753ee`) mudou também a cor de fundo pra um gradiente pastel claro nos 9 `:root` de cada
  página, sem que isso tivesse sido pedido — e foi mesclada **direto em `master`, sem passar por
  `dev`** (bypass do fluxo normal, produção ficou com a cor errada). Revertido: a paleta nunca
  chegou a existir em `dev`, então o conserto foi implementar o layout certo direto aqui; falta só
  a mesclagem chegar em `master` pra sobrescrever o commit `da753ee` que está lá. `favicon.png`
  (ícone quadrado) no lugar de `Logo2.png` (faixa larga, não cabe em 34px) — mesma imagem que já
  era usada no estado colapsado, então não precisa mais trocar de logo ao colapsar a sidebar, só
  esconder o bloco de texto (`.brand-text`).
- **Sidebar colapsada = faixa de ícones (64px), não mais some da tela** (pedido do Luan,
  19/08/2026, a partir de uma referência visual). Antes "esconder" fazia `transform:translateX(
  -100%)` — a sidebar sumia por completo e um botão flutuante fora dela (`.sidebar-open-btn`)
  reaparecia sobre o conteúdo da página pra reabrir; no `campanhas.html` ele ficava literalmente
  em cima dos botões Brasil/EUA (bug relatado pelo Luan, mesmo dia). Agora colapsa via
  `width:180px→64px` (`body.sidebar-hidden .sidebar`), sempre visível — o botão de
  abrir/fechar (`#sidebarToggle`) mora DENTRO da sidebar nos dois estados, nunca mais um elemento
  solto por cima da página; `.sidebar-open-btn` só existe pro caso mobile (sidebar de verdade some
  via `transform`, overlay). Colapsada: texto de cada item (`.nav-text`) some, ícone fica
  centralizado, hover mostra um balão com o rótulo (`content:attr(data-label)`, sem JS pra montar
  tooltip — cada `.nav-item`/`#sideUser` carrega `data-label` já pronto). Logo vira só o ícone
  (`favicon.png`, quadrado, no lugar do `Logo2.png` que é uma faixa larga). **Os 64px do rail
  precisam bater com `body.sidebar-hidden .main{margin-left:64px}` em CADA página** (12 arquivos,
  não centralizado) — as duas medidas são independentes e nada as amarra automaticamente; um canal
  novo de layout ou uma página nova precisa lembrar de repetir esse valor, senão o conteúdo desliza
  por baixo do rail (ou sobra um vão vazio de 64px quando expandida).
  - **Mobile**: `.sidebar-open-btn` (o botão que abre a sidebar no celular, já que lá ela some de
    verdade via overlay) é `position:fixed`, fora do fluxo de qualquer página — sem reservar
    espaço pra ele, ficava sobreposto aos primeiros pills do topbar (seletor de país, por
    exemplo). Em vez de mexer nas 12 páginas, a regra mora centralizada no próprio `sidebar.js`:
    `@media(max-width:768px){.topbar{padding-left:56px!important}}` — o `!important` é porque o
    `.topbar{padding:...}` de cada página tem a mesma especificidade; sem ele dependeria da ordem
    de carregamento dos `<style>` no `<head>`, frágil. Bug relatado pelo Luan, 19/08/2026.
- **`.main{min-width:0}` evita rolagem horizontal da página inteira** — regra idêntica em `.main`
  (sidebar fixa + `margin-left:180px`) repetida nas 10 páginas com sidebar, nenhuma tinha
  `min-width:0`. `.main` é item flex de `body{display:flex}`; sem `min-width:0`, o navegador usa o
  `min-content` do descendente mais largo como largura mínima automática do item, em vez de
  encolher pra caber no espaço disponível — se QUALQUER conteúdo lá dentro (tabela com muitas
  colunas, nome de produto comprido) for mais largo que o espaço, a página inteira alarga e o
  scroll horizontal aparece no rodapé do navegador. Bug real: Estoque (card "Panorama geral" de 11
  colunas) alargava a página, mas Produtos "funcionava" só porque o card mais largo de lá cabia —
  não porque tivesse alguma proteção que faltava em Estoque (reportado pelo Luan, 21/08/2026, "deve
  ser igual a produtos, que fixa corretamente" — a causa real não era a página em si, era a mesma
  falha latente em todas, só que sem conteúdo largo o bastante pra aparecer). Confirmado ao vivo via
  DevTools antes de mexer no código: injetar `min-width:0` no `.main` de produção zerava o
  `scrollWidth` extra na hora. Corrigido nas 10 páginas de uma vez (mesma regra, mesmo bug latente
  em todas). `.prod-table-wrap{overflow-x:auto}` (Produtos/Estoque) continua como segunda camada de
  proteção pra quando uma tabela específica for mesmo mais larga que o card — as duas coisas
  resolvem problemas diferentes, uma não substitui a outra.
- **Pop-up de confirmação** (`confirm-modal.js`, pedido do Luan 19/08/2026: o `confirm()` nativo
  do navegador — a barra cinza "site diz" — "não poderia acontecer"). `window.cocoConfirm(msg,
  {title, confirmText, cancelText, danger}) → Promise<boolean>` substitui todo `confirm()` nativo
  usado pra ações destrutivas/importantes (desativar integração, apagar histórico Amazon, excluir
  usuário/tipo/grupo, cancelar um job). `danger:true` deixa o botão de confirmar vermelho (ações
  que realmente apagam dado). Sempre `await` — a função que chama precisa ser `async` (todos os
  callers já eram).
- **Widget de processos** (`jobs-widget.js`, pedido do Luan 18/08/2026): card flutuante,
  arrastável e redimensionável pelas bordas/cantos (posição e tamanho em `localStorage`) que
  aparece sozinho quando algo está rodando em segundo plano (backfill/imagens/itens da Amazon,
  geografia via Bling, backup) e some sozinho ~8s depois de terminar. Consome `GET /api/jobs`
  (server.js, agrega os status já existentes de cada job — não duplica lógica) a cada 3s. Mostra
  quem disparou cada processo (`startedBy`, capturado no handler do POST que iniciou via
  `req.authUser`; jobs automáticos/agendados ficam `null` → aparece como "automático"). Continua
  visível ao trocar de página porque toda página recarrega o mesmo script — a posição/tamanho
  arrastados e se está minimizado ficam salvos, não o estado do job em si (isso vem sempre fresco
  do servidor).
  - Barra de progresso: cheia e sólida em concluído/erro/cancelado; só fica "correndo" (indeterminada)
    enquanto o processo está rodando sem uma % conhecida ainda (iniciando) — bug relatado pelo Luan
    19/08/2026, job já concluído aparecia com a barra animada e parcialmente cheia, parecendo travado.
  - `destaleJob(jobId, raw)` (server.js): um status `running` sem atualização há mais de
    `STALE_AFTER_MS[jobId]` (10–45min por tipo) vira `error` com mensagem de "interrompido" em vez
    de aparecer preso em "iniciando" pra sempre — sintoma real de um deploy/reinício no meio do
    processo (a flag `*Running` em memória zera sozinha ao reiniciar, mas o status persistido em
    `kv` não é tocado por ninguém). Usado tanto por `GET /api/jobs` (`normalizeJob`) quanto por
    `GET /api/status` — os dois PRECISAM concordar, mesmo princípio já documentado em "Campanhas"
    (nunca ter duas fontes pro mesmo dado). Bug real já causado por isso (19/08/2026): só
    `/api/jobs` tinha a checagem, então o botão "Aplicar" do histórico Amazon EUA em Integrações
    (que lê `/api/status`) ficava travado pra sempre olhando pro mesmo job fantasma que o widget já
    mostrava como erro. `GET /api/jobs` também esquece job concluído/erro/cancelado sozinho 15min
    depois de terminar, pra uma execução de teste antiga não continuar aparecendo em toda página pra
    sempre (o Luan relatou isso como "fica criando tarefa nova sem eu pedir", 19/08/2026 — na real
    eram jobs fantasmas/antigos nunca limpos, não jobs novos de verdade).
  - Botão × por job: em job rodando, cancela (com `confirm()`) — só nos três com ponto seguro pra
    checar a flag no meio do loop: `amazon-backfill`, `amazon-images`, `amazon-items`
    (`CANCELABLE_JOB_IDS`, server.js). Cancelamento cooperativo via
    `JobCancelledError`/`checkCancelled(jobId)`: a callback de progresso de cada um checa a flag e
    lança, o que sobe até o catch do job e vira status `cancelled` — o que já foi processado até
    ali fica salvo (upsert incremental, mesmo princípio de sempre). `bling-geo` e `backup` não
    entram (terminam em segundos, não vale o risco de interromper no meio de um upload/gravação).
    Em job já concluído/erro/cancelado, o mesmo × vira "fechar" (sem `confirm()` — só some da lista
    no navegador, `dismissedJobKeys` client-side por `id+finishedAt`, uma execução nova do mesmo
    job volta a aparecer). O cabeçalho do widget também ganhou um × pra fechar o card inteiro
    (`dismissed`/`dismissedKnownIds`, jobs-widget.js) — diferente de minimizar, só volta a aparecer
    sozinho quando surge um job rodando que não existia no momento do fechamento. Pedido do Luan,
    19/08/2026: "não consigo simplesmente fechar ela ou a tarefa que eu deu erro". Os dois estados
    de fechado (`dismissedJobKeys` e `dismissed`/`dismissedKnownIds`) ficam em `sessionStorage`
    (`coco_jobs_widget_dismissed_jobs`/`_all`), não em variável de memória — senão sumia de volta
    sozinho ao trocar de página, porque cada página reexecuta o script do zero (bug real relatado
    pelo Luan, 19/08/2026, no dia seguinte ao ship). `sessionStorage` e não `localStorage` de
    propósito: precisa sobreviver à navegação dentro da mesma aba, mas não pode durar pra sempre —
    um fechamento permanente esconderia silenciosamente uma execução nova e genuína do mesmo tipo
    de job dias depois (mesmo `id`, execução diferente); fechar a aba/navegador já limpa sozinho.
  - Painel "Amazon — Histórico" (Integrações): logo da Amazon (`Amazon_logo.png`) ao lado do rótulo
    BR/EUA em cada linha, mesmo padrão de logo já usado no card de Tráfego & conversão.
  - `.jw-head`/`.jw-resize` precisam de `touch-action:none` — sem isso, no celular o navegador
    interpreta o toque como início de scroll da página em vez de entregar os eventos de pointer
    pro nosso drag (arrastar/redimensionar funcionava só no desktop com mouse, não no touch). Vale
    como regra geral pra qualquer drag customizado via Pointer Events nesse app, não só aqui — se
    um novo componente precisar de arraste, lembrar do `touch-action`. Bug relatado pelo Luan,
    19/08/2026.
- **Clique num gráfico ECharts pra abrir um drilldown** (ex.: clicar na Tendência mostra o
  detalhamento por canal daquele dia): usar `chart.getZr().on('click', ...)` +
  `chart.convertFromPixel({seriesIndex}, [offsetX, offsetY])`, NÃO `chart.on('click', ...)` — o
  `click` de série do ECharts só dispara em cima do traço/ponto exatos (o Chart.js antigo reagia a
  clique em qualquer lugar da coluna, `getElementsAtEventForMode(...,'index',...)`); num gráfico de
  linha com área preenchida, um dia de valor baixo deixa bastante espaço em branco por cima da
  curva que não conta como "em cima da série" — parecia quebrado (clique não fazia nada na maior
  parte do card), só funcionava acertando o pixel exato do traço. Bug relatado pelo Luan,
  19/08/2026, depois da migração Chart.js → ECharts (index.html, toggle "Mostrar canais ao clicar
  no gráfico de tendência"). `showTrendDrilldown()` termina com `el.scrollIntoView({behavior:
  'smooth', block:'nearest'})` — no mobile os cards empilham em largura total, e o card de
  Tendência é alto o bastante pra clicar no gráfico (lá em cima) e o resultado do drilldown
  aparecer fora da tela (embaixo, depois da legenda), parecendo que nada aconteceu. `block:
  'nearest'` não mexe em nada se já estiver visível (desktop já vê sem rolar). Bug relatado pelo
  Luan, 19/08/2026: "eu clico no gráfico lá em cima, e o card aparece lá embaixo".
- **Selo de variação (`.delta-val`, ex.: "↑ 106%") no mobile**: `.kc-delta` é `display:flex` numa
  linha só (selo + "vs. período anterior"); no mobile a faixa de Indicadores vira 2 colunas
  (`.kpi-strip-grid` em 768px) e a frase não cabia mais ao lado do selo — quebrava no meio, com o
  selo boiando sozinho ao lado de um parágrafo de 2 linhas ("pills verdes estranhos", relatado
  pelo Luan 19/08/2026). Fix: `@media(max-width:768px){.kc-delta{flex-direction:column;
  align-items:flex-start}}` — empilha em vez de quebrar no meio da frase.
- **Card Tendência (index.html) — "Geral" × "Por canal"**: toggle (`trendView`,
  `localStorage('coco_trend_view')`) que troca a linha única (com área preenchida + "Custo ads")
  por uma linha por canal, sem área nem "Custo ads" (com vários canais ao mesmo tempo a área
  sobreposta fica ilegível — decisão combinada com o Luan antes de implementar, 19/08/2026). Usa o
  mesmo `t.byChannel` que já alimentava só o drilldown de clique — nenhuma mudança no backend. Só
  aparece com canal="todos" selecionado (`#trendViewToggle` some sozinho pra um canal específico,
  que não tem o que quebrar em mais linhas); o drilldown de clique (ver item acima) também só roda
  na visão "Geral" — na "Por canal" seria redundante, cada linha já é o próprio canal.
  - Botão "Expandir" (`trendExpanded`, `localStorage('coco_trend_expanded')`): dobra a altura do
    gráfico (`.ch220`→`.ch380`) e o card passa a ocupar a largura toda (`grid-column:span 12`). O
    resize do ECharts acontece sozinho (o `ResizeObserver` compartilhado, `echartsRO`, já observa
    `#trendChart`). Importante: `updateCardVisibility()` já mexia no `grid-column` do card de
    Tendência por outro motivo (ocupar a linha toda quando o card de Canais ao lado está escondido
    pelo canal selecionado) — as duas fontes de verdade precisam concordar, senão um refresh de
    dado desfazia o expandido no ciclo seguinte; a condição virou `trendExpanded ||
    !channelSplitVisible`.
- **Card Tráfego & conversão (index.html) — mesmo padrão "Geral" × "Por canal" + expandir do
  card Tendência** (pedido do Luan, 19/08/2026), mas aqui "por canal" é sempre Coco and Luna ×
  Yucaloo (as duas únicas marcas com dado de sessão — Shopee/ML/Amazon não têm nenhum) em vez da
  lista de canais de venda. `aggregateSessions()` (metrics.js) já calculava `rCoco`/`rYuc` por dia
  separadamente só pra somar; passou a devolver também `seriesCoco`/`seriesYucaloo` (mesmo formato
  de `series`) no objeto de retorno, sempre calculado (não só quando channel="todos" — custa quase
  nada por cima do que já era somado). `computeDashboard` repassa os dois em `traffic.seriesCoco`/
  `traffic.seriesYucaloo`. No "Por canal" o eixo secundário de Conversão some (fica só sessões, uma
  linha por marca) — mesma decisão de simplificar tomada pro Tendência (vários eixos/séries ao
  mesmo tempo vira poluição). Cores reaproveitadas do mapeamento por canal já usado no card
  "Canais" (`CocoColors.ch.shopify`/`shopify_us` pra Coco and Luna, `.yucaloo_br`/`yucaloo_us` pra
  Yucaloo — market-dependent), nada novo. Toggle some sozinho fora de canal="todos", igual ao da
  Tendência (um canal específico já filtrado zeraria a outra marca o tempo todo).
- Seletores de Métrica/Canal/Período/Atualizar são dropdowns customizados (`.csel`), não `<select>`
  nativo. Frequência de atualização (`localStorage('coco_refresh')`) é compartilhada entre todas
  as páginas. Estado ativo do item é fundo escuro (`background:var(--ink)`), não checkmark — era
  inconsistente (segmentos.html usava um `.chan-pop` próprio com esse visual, as outras 6 páginas
  com `.csel-opt` usavam `✓`); padronizado no visual do segmentos.html (preferência do Luan,
  18/08/2026) mantendo o nome de classe `.csel-opt` nas 6 páginas pra não mexer em handler de
  clique. `segmentos.html` continua com sua própria implementação (`.chan-pop`) por baixo — só
  igualado visualmente, não o código; um canal novo em `.csel-opt` não precisa de checkmark.
- **Texto de última sincronização no header** (`#lastUpdate`, ao lado da bolinha `.ldot`): padrão é
  `"Ao vivo · HH:MM"` (`Atualizando…`/`Erro` enquanto carrega/falha, `Carregando…` como texto
  inicial antes do primeiro load) — já era assim em index.html/geografia.html/segmentos.html.
  `campanhas.html`/`estoque.html`/`produtos.html` ainda mostravam
  `"sync: DD/MM/AAAA, HH:MM:SS"` (cru, sem estado de loading/erro) — igualado ao padrão dos outros
  4 (só o texto/formato; não ganharam a máquina de estado completa da bolinha, que era um trabalho
  maior). Pedido do Luan, 19/08/2026: "deve ser um padrão entre todos os headers". O rodapé
  (`#footerDate`) continua com data/hora completa — só o header precisa ser curto.
- Arrastar para reordenar cards (Produtos/Estoque/Visão geral): a API nativa de Drag and Drop do
  HTML5 causou vários bugs (arraste não iniciava, duas cópias visuais do card) — foi trocada por
  um arraste customizado por ponteiro (`mousedown`/`mousemove`/`mouseup` + clone `position:fixed`
  seguindo o cursor). Se for implementar reordenação em alguma tela nova, seguir esse padrão em
  vez da API nativa de drag and drop. O modo de edição da Visão geral (`index.html`,
  `makeDragController`) ainda usava a API nativa apesar do próprio comentário do código dizer
  "mesmo mecanismo já validado em produtos.html/estoque.html" — nunca tinha sido migrado de
  verdade, só o comentário mentia; o espaço vago dinâmico esperado ao arrastar não acontecia
  (reportado pelo Luan, 21/08/2026). Migrado pro mesmo padrão de ponteiro dos outros dois, tanto
  pro grid principal (`#editGrid`) quanto pra faixa interna de KPIs (`#kpiStripGrid`).
- **Banco de cards** (Visão geral, modo de edição): cada card oculto mostra uma prévia real do seu
  conteúdo, não só o nome (pedido do Luan, 21/08/2026 — antes era uma pill sem nenhuma pista
  visual). `capturePreview()` clona o elemento no instante em que ele é ocultado — `cloneNode` não
  copia o bitmap desenhado num `<canvas>`, então todo `<canvas>` do clone (gráficos ECharts) é
  trocado por um `<img>` com `toDataURL()` do canvas original antes de descartar a referência.
  Encolhido no banco via `transform:scale`. Card que já veio oculto de uma sessão anterior (nunca
  esteve visível nesta carga de página) não tem captura disponível — cai num ícone genérico
  (`CB_ICON_BY_ID`/`CB_ICON_KPI`) até ser mostrado e ocultado de novo uma vez; não vale a pena
  forçar uma captura de um card que nunca renderizou dado real. O clone tem todo `id` removido
  antes de entrar no DOM (`clone.removeAttribute('id')` + `querySelectorAll('[id]')`) — sem isso,
  a prévia de "Tendência" ficaria com um segundo elemento `id="trendChart"` no documento, e como
  `#cardBank` aparece ANTES de `#editGrid` no HTML, um `document.querySelector` desprotegido pegaria
  a cópia inerte em vez do card de verdade. Por isso `updateCardVisibility()` (que já tinha esse
  padrão pra `trendWrap`/`topProdWrap`/`ALWAYS_VISIBLE_CARD_IDS`) foi escopado em `editGrid` em vez
  de `document` — vale como regra geral: nunca usar `document.querySelector` pra achar um
  `.edit-card`/`.kpi-mini` por `data-card-id`/`data-kpi-id`, sempre escopar em `editGrid`/
  `kpiStripGrid`.
- **Cards da Visão geral esticam pra preencher a linha do grid** (`.edit-grid`, `align-items:
  stretch` em vez do antigo `start`): dois cards na mesma linha (Tendência×Canais, Tráfego×Funil,
  Top produtos×Marketing por origem) quase nunca têm o mesmo tanto de conteúdo — o mais curto
  ficava boiando no topo, com o fundo da página aparecendo como uma faixa em branco antes da
  próxima linha começar (reportado pelo Luan, 24/08/2026, com print). Só esticar o card (borda/
  fundo) não bastava — pedido explícito de preencher com conteúdo de verdade em vez de deixar vão:
  `.card-pad` virou coluna flex ocupando 100% da altura esticada, e cada elemento "de crescer"
  dentro dela usa `flex:1` com um `min-height` como piso (mesmo tamanho de sempre quando não sobra
  espaço nenhum):
  - `.ch220`/`.ch180` (Tendência/Tráfego): o gráfico ECharts cresce de verdade, não só a moldura —
    o `ResizeObserver` único (`echartsRO`) já observava o container e redesenha sozinho, nenhum
    código de gráfico precisou mudar;
  - `.donut-center-wrap` (Canais/Marketing por origem): o anel fica maior, mesma lógica;
  - **Container de gráfico usa `flex:1 1 0` (base ZERO), NUNCA `flex:1 1 auto`.** Com base `auto` o
    tamanho base do item vira a altura do próprio conteúdo — e o conteúdo é um canvas que o ECharts
    desenha no tamanho do container, então fecha um laço infinito: canvas cresce → conteúdo cresce
    → item cresce → `echartsRO` dispara → ECharts redesenha maior → repete. Foi exatamente o que
    aconteceu na 1ª versão dessa mudança (PR #172): o gráfico da Tendência chegou a 1651px e
    continuava subindo, com o anel de Canais junto (o laço se realimenta pelos dois cards da linha,
    via altura da linha do grid). Pego pelo Luan no mesmo dia, corrigido no PR seguinte. Com base 0
    a altura sai só da divisão do espaço livre, o conteúdo não realimenta nada, e o `min-height`
    segura o piso. Vale pra qualquer container de gráfico flexível daqui pra frente;
  - `.funnel-list` (Funil de conversão, já era flex-column): ganhou `flex:1` +
    `justify-content:space-between` — os passos se espalham em vez de empilhar no topo;
  - `#topProducts`: virou coluna flex própria, e quem absorve a sobra são as próprias linhas
    (`.tp-row{flex:1 1 auto}`) — ficam mais espaçadas, preenchendo o card. Deixar só o
    `.tp-summary{margin-top:auto}` absorver (1ª tentativa, PR #172) apenas MUDOU o vão de lugar:
    as 4 linhas amontoadas em cima, um bloco em branco no meio e o total lá embaixo (Luan, mesmo
    dia: "não podemos deixar esse espaço em branco desse jeito"). O `margin-top:auto` continua no
    total, mas só serve pro modo "Ver todos", onde as linhas ficam presas dentro do
    `.tp-list-scroll` (altura travada em 420px, não cresce). `.tp-row` NÃO leva `max-height` pra
    limitar o crescimento: ela não tem `overflow:hidden`, então um nome comprido que quebre em duas
    linhas vazaria por cima da borda seguinte — linha espaçosa demais é bem menos ruim que texto
    vazando.
  Cards sozinhos numa linha (span 12: Mercado Livre · Detalhe, Orgânico x Campanha, Pedidos
  recentes, Indicadores) não têm vizinho pra comparar altura, então não mudam visualmente. Mobile
  também não é afetado — `.edit-grid>.edit-card{grid-column:1/-1!important}` já força um card por
  linha ali, sem par pra esticar contra.
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
| `B2_KEY_ID` / `B2_APPLICATION_KEY` / `B2_BUCKET_NAME` | Backup diário do banco (Backblaze B2) — ver `src/backup.js` |
| `BACKUP_RETENTION_DAYS` | Quantos backups diários manter no B2 (padrão 30) |
| `BACKUP_EVERY_HOURS` | Intervalo mínimo entre backups automáticos (padrão 24) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Alerta quando um canal fica travado sem sincronizar — ver `src/alerts.js` |
| `ALERT_STALE_HOURS` | Horas de falha seguida antes do primeiro alerta (padrão 6) |

Armadilhas conhecidas: `read_analytics` ausente faz `shopifyqlQuery` sumir do schema sem erro.
Amazon `CreatedBefore` precisa ficar ≥2min no passado. IAM User precisa de `sts:AssumeRole` no
Role E o Role precisa ter o User no trust policy. Mercado Ads exige escopo `write:product_ads`
no OAuth do ML, reautorizar via `/mercadolivre/connect` se faltar.

## 7. Rodar / endpoints principais

`npm install` → `npm start` (porta 3000, sync roda ao subir e a cada `SYNC_INTERVAL_MINUTES`).
`npm run sync` faz uma sincronização única.

### Testes (`npm test`, `scripts/test/`)
- Runner próprio (`run.mjs`), sem framework: o projeto não tem etapa de build nem dependência de
  desenvolvimento, e 40 linhas cobrem o que precisamos. Cada `*.test.mjs` roda no seu processo,
  código de saída 0 passou / 1 falhou / **2 pulado** (teste que precisa de rede não vira falha
  numa máquina offline, mas também não se declara aprovado). `npm test -- mapa` roda só um.
- Cobre hoje o que **falha em silêncio**, que é onde este projeto machuca: `csp` (todo host
  externo de `public/` autorizado na CSP), `mapa` (nenhuma página volta pra provedor de tile com
  chave, e as duas telas usam o mesmo), `geojson` (o arquivo dos EUA é local, servido e no formato
  certo), `paginas` (sintaxe de cada `js/paginas/*.js`, mais os blocos inline que sobrem ou voltem, e se
  todo `js|css/paginas/` apontado pelo HTML existe em disco), `assets` (caminho de arquivo local
  existe),
  `imagens` (nenhuma imagem depende de CSS injetado por script pra ter tamanho),
  `insights` (as regras do card, incluindo os pisos anti-ruído), `backfill` (a divisão da janela
  em blocos, sem buraco nem dia repetido, mais a ligação com servidor e tela) e `periodo` (o ano aparece no
  rótulo quando o período é de outro ano, e nenhuma tela remonta esse texto por conta própria).
- **Nenhum teste sobe o `server.js` nem toca no banco.** `geojson.test.mjs` levanta só um
  `express.static` sobre `public/`. Isso é regra, não detalhe: subir o servidor de verdade dispara
  o sync, e a cota da Amazon é por CONTA, não por processo — teste local competindo com o sync de
  produção já quebrou o BR uma vez.
- Testes de `metrics.js`/`store.js` (tag mãe, tipo de produto, catálogo) ainda estão de fora: eles
  gravam no store e precisam de um banco temporário próprio antes de entrar aqui, senão `npm test`
  suja o `data/db.json` de quem estiver desenvolvendo.
- Ao escrever um teste novo, conferir que ele FALHA com o defeito reintroduzido. Teste que nunca
  falha não protege nada — os seis atuais foram validados assim, um bug real de cada vez.

- `GET /api/dashboard?channel=&metric=&since=&until=&market=br|us` — payload principal
- `GET /api/campaigns?market=&since=&until=` — campanha a campanha, ao vivo, cache 5min
- `GET /api/products?market=&since=&until=` / `GET /api/stock?market=&since=&until=`
- `GET /api/orders/search?market=&q=` / `GET /api/orders/export?...`
- `POST /api/sync` / `GET /api/status` / `GET /api/jobs` — status agregado dos jobs em segundo
  plano, alimenta o widget flutuante (`jobs-widget.js`)
- `POST /api/jobs/:id/cancel` — cancela um job em segundo plano (só os cancelable, ver acima)
- `POST /api/amazon/{reset-backoff,force-sync,backfill,images,sync-names,cleanup-market-leak}`
- `POST /api/shopify/backfill?market=&days=` (admin) · `GET /api/shopify/history` (admin) —
  recupera histórico antigo das lojas Shopify, ver tela Integrações
- `GET/POST /api/amazon/history` (admin) · `GET /api/amazon/history/preview` — histórico por
  mercado (poda OU busca, decide sozinho), ver tela Integrações
- `GET /api/backup/status` (admin) · `POST /api/backup/run` (admin) — backup manual/status do B2
- `POST /api/alerts/test` (admin) — manda uma mensagem de teste no Telegram, ver `src/alerts.js`
- `GET /shopee/connect` · `GET /mercadolivre/connect` · `GET /googleads/connect`
- `GET /shopify-yucaloo/:mkt(br|us)/{connect,callback}` — chamadas pela própria Shopify
- `POST /api/login` / `POST /api/logout` / `GET /api/me`
- `GET/POST /api/product-groups*` (Unificador, admin; `POST /api/product-groups/type` grava a
  "tag mãe" Tipo/Categoria de um grupo) · `GET/POST /api/product-types*` ·
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
- ~~Toggle "Incluir Mercado Ads" no dashboard principal não respeita o período selecionado~~ —
  feito (19/08/2026). O toggle em si já não existia mais (virou obrigatório a pedido do Luan, ver
  Marketing abaixo); o que sobrava era a causa raiz: `mlBreakdown.adCost` lia um valor único preso
  na janela fixa de 60 dias do sync periódico. Resolvido com série diária (`kv.mlAdCostsDaily`,
  mesmo padrão do `metaInsightsDaily`) em vez de quebrar o princípio de `/api/dashboard` nunca
  chamar API externa na hora — ver seção "Mercado Livre" (`fetchAdCostsForDays`) mais abaixo.
- **Yucaloo sem conta de Ads própria:** não tem card em Campanhas nem ROAS calculado. Revisitar
  quando a marca tiver conta de anúncios própria.
- **Microsoft Clarity:** o Luan tem Clarity conectado nos 4 sites (Coco BR/EUA, Yucaloo BR/EUA) e
  quer avaliar trazer os dados pra uma página própria da dashboard. Ainda não iniciado — falta
  decidir os project ID/token de cada site. Limitação já identificada: a API pública do Clarity só
  devolve métricas agregadas dos últimos 1–3 dias (sem histórico longo) e não expõe heatmaps nem
  gravações de sessão — isso continua só no painel deles.
- **Village (programa de assinatura, Shopify EUA) — página/gestão dedicada:** o Luan quer uma
  tela própria pra gerenciar as inscrições do programa "Village". Ainda não iniciado — falta
  pesquisar o que a API do app **Seal Subscriptions** (o app que eles usam hoje no Shopify EUA
  pra gerenciar assinatura) expõe de útil pra essa tela (provavelmente dá pra ler contrato,
  status, próxima cobrança etc. direto da API deles, em vez de só inferir pelos pedidos). Domínio
  já investigado e confirmado contra pedidos reais (21/08/2026):
  - Cada item de pedido com assinatura vem com `lineItem.sellingPlan.name` (Shopify Admin
    GraphQL) — hoje NÃO pedido em `fetchOrders` (`src/shopify.js`), precisa ser adicionado à
    query.
  - `VIL-XXXX` (tag do PEDIDO, não do produto — também precisa ser adicionada à query, hoje só
    pedimos `product.tags` por item) é o número do contrato do programa Village. Confirmado que
    a tag se REPETE em todo pedido de renovação do mesmo contrato (não é "só aparece na primeira
    vez") — ex.: mesmo cliente com 3 pedidos em datas diferentes, os 3 com a mesma tag
    `VIL-1562`. Pedido com mais de um produto em assinatura pode ter mais de uma tag VIL (uma por
    contrato) no mesmo pedido.
  - Nem todo pedido de assinatura tem tag VIL: uma parte tem `appstle_subscription_first_order`
    no lugar — indício de contratos mais antigos de um app diferente (Appstle Subscriptions),
    provavelmente de antes da troca pro Seal Subscriptions. Vale confirmar com o Luan se isso é
    esperado antes de tratar como "sem contrato".

### Confiabilidade operacional (não é checklist de site público — SEO/CTA/meta description não se
### aplicam aqui, a dashboard é interna e atrás de login; pedido do Luan em 17/08/2026)
- ~~Página de erro 404~~ — feito (`public/404.html`, ilustração `404.png`, trocada de
  `Feno_no_deserto.svg` a pedido do Luan em 18/08/2026).
- ~~Alerta quando um sync falha silenciosamente~~ — feito (19/08/2026). `src/alerts.js`: Telegram
  via `fetch` direto (sem SDK, mesma regra do B2/SigV4 da Amazon). Só entra no sync AUTOMÁTICO
  (`setInterval` em server.js) — um "Sincronizar agora" manual já mostra o erro na hora pra quem
  clicou. Não alerta na primeira falha isolada (rate limit passageiro, blip de rede): agrupa os
  erros de `report.errors` (sync.js) pelo prefixo antes do primeiro `.` — um canal com 3
  sub-operações falhando (orders/sessions/catalog) vira UM alerta, não três — e só dispara depois
  de `ALERT_STALE_HOURS` (padrão 6h) falhando sem parar (`kv.channelHealth`, `failingSince`/
  `alerted` por canal). Manda um segundo aviso quando o canal volta a sincronizar (só se o
  primeiro alerta de problema já tinha saído, senão fica calado). Canal desligado pela tela
  Integrações não conta como falha. Painel em Integrações (mesmo padrão do card de Backup): status
  configurado/não + botão "Enviar teste" (`POST /api/alerts/test`), pra confirmar
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` sem esperar um canal ficar horas travado de verdade.
- **Log de auditoria de edição:** login/permissão por página já existem (`src/auth.js`), mas não há
  registro de QUEM mudou um valor (COG, estoque manual, grupo do Unificador, config de
  integração) nem QUANDO. Hoje só o valor final fica salvo.
- ~~Rotina de backup do Postgres~~ — feito (18/08/2026). Confirmado com o Luan: sem plano Pro no
  Railway não existe backup/PITR automático (só um manual antigo, 1 mês). `src/backup.js`: snapshot
  diário do store inteiro (mesmo formato JSON do `data/db.json` local, gzip) pra **Backblaze B2**
  (10GB grátis, ~$0,005/GB/mês depois disso — com retenção de 30 dias o uso fica bem abaixo do
  grátis). API nativa do B2 direto via `fetch` (sem SDK, mesma regra do resto do projeto — igual o
  SigV4 feito à mão da Amazon). Roda sozinho 1x/dia (`runBackupIfDue()`, mesmo padrão de
  auto-throttle do `reconcileAmazonNames`) + botão manual em Integrações → "Backup do banco".
  Restauração testada de ponta a ponta (`scripts/restore-backup.mjs`, baixa do B2 + `TRUNCATE`
  + reinsere tudo — pede confirmação digitada "RESTAURAR", é destrutivo por design). `authSessions`
  fica de fora do snapshot de propósito (token efêmero, restaurar só exige login de novo).
- **Teste em tela de celular:** a dashboard já tem CSS responsivo em várias telas, mas nunca foi
  formalmente conferida ponta a ponta num celular de verdade.

## 10. Convenções

- ES Modules (`"type": "module"`), Node 18+ (usa `fetch` nativo).
- Dependências mínimas: `express`, `dotenv`, `pg`, `express-rate-limit`. Sem aws-sdk, sem axios —
  B2, Telegram e o SigV4 da Amazon são feitos à mão com `fetch`.
- UI e textos em pt-BR. Valores em BRL/USD via `Intl`/`toLocaleString`.
- `.gitignore`: `node_modules/`, `.env`, `data/db.json`, `*.log`, `.claude/`.
- Repositório é público — nunca commitar `.env`, token, secret ou qualquer credencial real. Revisar
  o diff antes de commitar se algo parecer um valor sensível, mesmo em arquivo aparentemente inócuo.
