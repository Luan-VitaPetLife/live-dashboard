# CLAUDE.md — Manual da dashboard

> Lido automaticamente pelo Claude Code. Diz **o que está decidido, por quê, e onde já se errou**.
> Histórico de mudança fica no `git log`, não aqui. Quase toda regra tem um teste em `scripts/test/`
> que falha se ela for quebrada — ao mudar uma regra, mude o teste junto.

## 0. Regras de ouro

1. **Repositório PÚBLICO.** Nunca colar token, secret, chave, ARN, ID de conta AWS ou identificador
   de conta externa — aqui, no código ou em commit. Só nome de variável de ambiente. Valores reais
   vivem no `.env` local (ignorado pelo git) e no Railway.
2. **Trabalho no branch `dev`.** Nunca commitar nem dar push em `master`: `master` faz deploy
   automático em produção, e quem mescla é o Luan.
3. **Nenhum teste sobe o `server.js` nem toca no banco.** Subir o servidor dispara o sync, e a cota
   da Amazon é da CONTA, não do processo: teste local disputando com produção já derrubou o BR.
   Pelo mesmo motivo, **não renovar token (Bling, ML, Shopee…) da máquina local com a credencial de
   produção**: a renovação invalida o token que a produção está usando.
4. **Nunca engolir erro de integração** (`.catch(() => [])`, `catch(e){}`). Erro vai pro log e pro
   relatório do sync. Um erro engolido já escondeu a Amazon EUA zerada por semanas.
5. **Allowlist positiva, nunca lista negativa**, pra tudo que decide se algo conta (status de venda,
   de devolução, de nota fiscal, tipo de anúncio). Valor novo que ninguém decidiu NÃO conta e
   aparece contado num relatório — nunca some calado e nunca passa a contar sozinho.
6. **Sondar antes de mapear.** API sem documentação dos campos: primeiro uma sonda de admin que
   devolve o ESQUELETO da resposta real (sem dado pessoal), depois o mapeamento em cima dela.
7. **Número errado é pior que número faltando.** Regra do Luan: "não podemos falar que vendeu 5 se
   vendeu 3". Na dúvida, não conte e avise.
8. Interface e textos em **pt-BR**, com acento certo (a chave interna pode ser ASCII, o rótulo não).
   Dono do produto: Luan, perfil de negócio — explicar em linguagem de negócio.
9. Ao escrever teste novo, **plantar o defeito e ver o teste falhar**. Teste que nunca falhou não
   protege nada.

## 1. O que é

Dashboard de vendas ao vivo das marcas **Coco and Luna** e **Yucaloo** (suplementos para pets),
empresa **Vita Pet Life**. "Vita Pet Life" é nome legal: nunca rótulo de loja/canal na tela (a loja
é sempre "Coco and Luna" ou "Yucaloo"); só aparece no rodapé, como dona da dashboard.

| Mercado | Canais | Moeda |
|---|---|---|
| Brasil (`br`) | Shopify Coco and Luna, Shopify Yucaloo, Shopee, Mercado Livre, Amazon BR, TikTok Shop | BRL, fuso -03 |
| EUA (`us`) | Shopify Coco and Luna, Shopify Yucaloo, Amazon EUA | USD |

- Produção: `https://live-dashboard-vitapetlife.up.railway.app` (Railway, deploy do `master`).
- Yucaloo NÃO é um mercado: usa o mesmo `market` da Coco and Luna (decisão do Luan: ver o país
  inteiro junto). O que a separa é só o `channel` (`yucaloo_br`/`yucaloo_us`).
- Mercado Livre: domínio da API é `api.mercadolibre.com` ("libre"). Já quebrou quando "corrigiram".
- Google Ads só existe nos EUA e só aparece na tela de Campanhas.

## 2. Como funciona

```
sync.js busca os canais → store.js grava → metrics.js calcula → /api/* devolve JSON → public/ desenha
```
As telas nunca falam com Shopify/Shopee/ML/Amazon/Bling direto.

| Arquivo | Papel |
|---|---|
| `server.js` | Express: páginas, API, portão de login, agendador do sync |
| `src/store.js` | Postgres em produção (`DATABASE_URL`), `data/db.json` local. Tudo carregado em memória |
| `src/sync.js` | Orquestra a busca de todos os canais, a cada `SYNC_INTERVAL_MINUTES` (15) |
| `src/metrics.js` | Monta o payload de cada tela. `CANAIS` = catálogo de canais do servidor |
| `src/shopify.js` · `shopifyYucaloo.js` | Pedidos (GraphQL), sessões (ShopifyQL), catálogo; OAuth da Yucaloo |
| `src/shopee.js` · `mercadolivre.js` · `amazon.js` | Cada marketplace (Amazon: LWA + SigV4 + STS, BR e EUA) |
| `src/bling.js` · `src/tiktok.js` | ERP Bling: TikTok Shop, doações, estado da Shopee |
| `src/meta.js` · `googleads.js` | Gasto de anúncio |
| `src/insights.js` · `historico.js` · `retencao.js` · `comparar.js` · `cache.js` · `snapshot.js` · `umaPorVez.js` | Regras PURAS (sem banco/rede), testadas direto |
| `src/auth.js` · `autor.js` | Login, usuários, permissão por página; quem está editando (Histórico) |
| `src/backup.js` · `alerts.js` · `backfill.js` | Backup diário no B2, alerta no Telegram, backfill das lojas Shopify |
| `scripts/restore-backup.mjs` | Restaura o banco a partir do B2 (destrutivo, pede "RESTAURAR") |
| `public/*.html` | 12 páginas; código de cada uma em `js/paginas/<p>.js` e `css/paginas/<p>.css` |
| `public/js/*.js` | Componentes compartilhados (IIFE), ver seção 7 |

### Banco (`store.js`)
- Tabelas: `orders` (id, data JSONB), `sessions_daily`, `kv` (key, value JSONB), `historico`.
- Tudo fica em memória (`initStore()` antes do `listen`); interface síncrona, gravação no Postgres
  em segundo plano. `getOrders` usa índice por mercado ordenado por data (busca binária),
  refeito só quando algo mudou.
- Gravação em LOTES de 500 (`pgUpsertOrders`). Um INSERT por pedido já encheu o disco do Postgres.
- **O sync só grava o pedido que MUDOU** (`mesmoPedido`, `comparar.js`): a comparação ignora ordem de
  chave e `undefined` (o Postgres reordena JSONB), nunca pula o MESMO objeto da memória (alterado no
  lugar) e **repesca gravação que falhou** (`pendentesNoBanco`).
- `kv` guarda blobs inteiros (tokens, configs, séries diárias). Lista que só cresce NÃO vai pro kv
  (cada gravação reescreve o blob): por isso o Histórico tem tabela própria.
- Chave nova no kv precisa entrar em `EMPTY` **e** na leitura do `initStore`, senão some no reinício.
- Pedido sem `market` gravado é tratado como `br`, exceto canal `shopify_us`/`amazon_us` (→ `us`).

### Janela de 90 dias (`retencao.js`) — decisão do Luan, 22/09/2026
- **Todo canal, nos dois mercados, guarda só os últimos 90 dias**; todo dia o mais antigo sai. Motivo:
  97% da conta do Railway é memória, e tudo mora em memória. `PEDIDOS_RETENCAO_DIAS` troca o 90.
- Corte = meia-noite UTC de 91 dias atrás (1 dia de folga pro fuso), igual o dia inteiro.
- Pedido antigo nem entra na memória (filtro no `SELECT` do `initStore`). O banco apaga em lotes de
  2000 (`pgPodarPedidos`). **Memória e banco comparam `createdAt` como TEXTO, pela mesma condição** —
  senão a tela muda sozinha depois de um reinício. Pedido sem data não é apagado.
- Sessões, sessões da Yucaloo e gasto de Meta/Mercado Ads seguem a mesma janela.
- Não existe mais campo de "dias de histórico" em lugar nenhum. Backfill manual (Amazon e Shopify,
  só por API) tem teto de 90 dias: serve pra tapar buraco dentro da janela.
- Consequência aceita: período anterior a 90 dias abre vazio (Insights avisa "anterior ao
  histórico"); o backup do B2 guarda 30 dias, então o que passa de 90 some de vez.

## 3. Regras de negócio

### O que conta como venda
**Só pedido com pagamento recebido.** `cancelled: true` cobre cancelado E não pago, decidido na
origem por canal; `metrics.js` só lê `o.cancelled`.

| Canal | Não conta (`cancelled`) |
|---|---|
| Shopify (todas as lojas) | `EXPIRED`, `VOIDED`, `CANCELLED`, `PENDING`, `AUTHORIZED` (cartão não capturado), ou `cancelledAt` |
| Shopee | `CANCELLED`, `UNPAID`, `INVOICE_PENDING` |
| Mercado Livre | `cancelled`, `invalid`, `confirmed`, `payment_required`, `payment_in_process` |
| Amazon | `Canceled`/`Cancelled`, `Pending`, `PendingAvailability` |
| TikTok (Bling) | situação fora da allowlist de venda (ver "TikTok Shop") |

- `UNPAID_STATUS_BY_CHANNEL` (em `store.js` **e** na Visão geral — as duas cópias precisam ser
  iguais, teste `registro-canais`) só separa o rótulo "Em aberto" de "Cancelado"; não muda cálculo.
- Receita/pedidos/produtos vêm da API de pedidos, nunca do ShopifyQL (que conta cancelado).

### Devolução desconta quantidade E receita
- **Um lugar só desconta**: `pedidoLiquido` dentro do `getOrders` local do `metrics.js` (que importa o
  do store como `lerPedidosBrutos`, e esse nome só pode aparecer 2 vezes no arquivo). Importar o
  `getOrders` do store direto no metrics.js voltaria tudo ao bruto sem erro.
- Campos: `items[].refundedQty` (sabe o produto) → `refundedQty` (sabe só quantas) → `refundedTotal`
  (só dinheiro). Pedido devolvido continua pedido, com receita zerada; sem item conhecido, zera.
- Por canal: **Shopify** já vem líquido (não descontar de novo). **Mercado Livre**: no próprio pedido
  (`payments[].transaction_amount_refunded`; continua `paid`). **Shopee**: API de devolução, a cada
  ciclo. **Amazon**: relatório de devoluções FBA + extrato de repasse. **TikTok**: situação do Bling.
- Reconciliações de devolução são **patch-only** (`patchOrderRefunds`): só marcam pedido existente,
  nunca inserem, nunca tocam `total`/`status`/`items`.
- `upsertOrders` tem guardas que impedem o sync de 15 min de APAGAR o que uma reconciliação
  preencheu: título de item, `state`, `productSales`, marca de devolução (inclusive por linha).

### Rótulo de status ("Pedidos recentes" e busca)
- Autorizado · Em aberto · Cancelado · Reembolsado/Reembolso parcial · Bonificação.
- Escrito em DOIS lugares que precisam concordar: `statusLabelPt` (metrics.js) e `statusTag`
  (js/paginas/index.js). Ordem: bonificação → cancelado → `refunded` → status.
- O filtro "Reembolsado" vive em três lugares (botão no markup, `EXPORT_STATUS_CLS` na tela,
  `EXPORT_STATUS_LABELS` no servidor) e leva o parcial junto.
- Toda lista que o servidor manda com `status` precisa mandar `refunded` junto, senão o devolvido
  aparece "Autorizado" com R$ 0,00.

### Saída em bonificação (doação pra criador de conteúdo)
- Vem de **nota fiscal** do Bling com natureza "Saída em bonificação". Conta UNIDADE, nunca dinheiro
  (`total` e `amount` sempre 0, mesmo quando a nota tem valor).
- **Quem decide é a NATUREZA, pelo nome** (`ehNaturezaDeBonificacao`): exige "saída" (existe
  "Entrada de bonificação", que é o contrário). Nunca pelo valor, nunca pela loja.
- Situação da nota: allowlist 5 (Autorizada) e 6 (Emitida DANFE).
- **A listagem de `/nfe` esconde nota cancelada.** Doação capturada e cancelada depois para de vir:
  o sync confere uma a uma a que sumiu (`situacaoDaNota`) e retira (`removerPedidos`).
- Sai de todo cálculo numa porta só: `getOrders` do metrics.js filtra `bonificacao`; quem precisa
  pede `incluirBonificacao`. Aparece em Top produtos (coluna própria, sem preço), em Pedidos recentes
  (valor "—", fora da contagem e do total) e nunca como canal escolhível.
- `bonificacao` não está no catálogo de canais; o rótulo vem de `NAO_CANAIS` (colors.js). Toda chave
  que pode chegar na tela precisa de rótulo, senão aparece a chave crua ("bonificacao").
- Nenhum dado de quem recebeu (nome, CPF, endereço) é gravado ou devolvido por sonda.
- Janela curta no sync (`BLING_BONIFICACAO_DAYS`, 7); histórico por `POST /api/bling/sync-bonificacao`.

### TikTok Shop (lido pelo Bling, `tiktok.js` + `syncTiktok`)
- A API do TikTok exige gerente de conta, que não temos: os pedidos vêm do canal do TikTok no Bling
  (`TIKTOK_LOJA_ID`), igual ao quadro de pedidos. Um canal só (`tiktok`) pras duas marcas.
- **Situação decide venda, pelo NOME** (de `/situacoes/modulos/98310`): allowlist de venda;
  cancelado e devolvido testados antes; desconhecida não conta ("Em aberto") e vai pro relatório
  `tiktok.situacao`. Traduzido pra `PAID`/`CANCELLED`/`REFUNDED`/`PENDING`, que as telas já entendem.
- **Pedido cuja nota é bonificação não é venda** (a nota já conta a unidade). Por isso o TikTok roda
  DEPOIS da bonificação no sync, e pedido que vira doação depois é retirado.
- Incremental por cursor (`kv.tiktokCursor`) que **só anda com leitura inteira**. Filtro de alteração
  no horário de **São Paulo** (`momentoNoBling`): em UTC o Bling devolve lista vazia sem erro.
- O Bling só dá o DIA do pedido (aparece 00:00). Comissão padrão 0%.
- Sonda: `GET /api/bling/probe-tiktok` (situações encontradas e como foram classificadas, sem cliente).

### Produto
- **Variante da Shopify é produto próprio** (`tituloDoItem`: "Produto - Variante"; "Default Title"
  nunca entra no nome). Catálogo por variante (`productVariants`). Mudar nome de produto desliga
  custo/estoque/grupo salvos sob o nome antigo (tudo é indexado por `canal|||título`).
- **Combo × kit**: "Combo de 3" = 3 unidades do mesmo produto; kit de produtos diferentes = uma
  unidade avulsa de cada (`comboSize(it.bundle)`). O detalhamento de unidades só aparece se fechar
  com o total.
- Shopify: `currentQuantity` (não `quantity`); linha com `currentQuantity` 0 não carrega dinheiro.
- Produto sem unidade nenhuma não entra no Top produtos (receita sem mercadoria é anomalia).
- `itemRevFactor`: a receita dos itens é escalada pro `total` do pedido (pendente → 0).
- **Só produto ATIVO da Shopify vira linha** em Produtos/Estoque; o catálogo guarda todos (as tags
  atuais decidem "Ocultar"), mas só ACRESCENTA produto sem venda, nunca sobrescreve quem vendeu.
- **Unificador** (`kv.productGroups`, por mercado): junta títulos num produto; aplicado no servidor.
  "Tag mãe" do grupo (`kv.productGroupTypes`): `type` (forma física, Segmentos) e `typeGroup`
  (categoria, Top produtos) — eixos independentes. Precedência: manual → catálogo Shopify de
  qualquer membro → palavra-chave de "Tipos de produto" → valor do período.
- **Imagem do produto não depende do período** (`indiceDeImagens` + `completarImagens`): linha sem foto
  procura no histórico inteiro (pedidos, cache da Amazon, catálogo Shopify); linha unificada procura em
  QUALQUER membro cadastrado no grupo. Sem isso, grupo que no período só vendeu pela Amazon (que não
  traz imagem) aparecia sem foto em Segmentos/Produtos/Estoque, com foto no Unificador. Nunca troca uma
  imagem que a linha já tem.
- **Ocultar produto** (por tag, Unificador): vale em toda a dashboard, pela tag ATUAL do catálogo
  (`isHiddenProduct`), não a presa no pedido antigo.
- Tipos de produto: criados na tela de Segmentos (`kv.productTypeGroups`), primeira regra vence.
- Segmentos: "Gato"/"Cachorro" (chaves `cat`/`dog`), cores dos mascotes (`#ff002b`/`#0849e9`).

### Produtos e Estoque (telas)
- Produtos: catálogo completo com vendas do período; custo editável (`kv.productFinance`).
  `Lucro = Receita − COG×Qtd − Frete×Qtd − Receita×Imposto% − Receita×Comissão%`; sem COG, "—".
  Padrões provisórios (o Luan vai preencher os reais): imposto 2,64%; COG 15,21 (lisina) e 17,32
  (daily); comissão Shopee 18%, ML 14%, Amazon 12%, Shopify e TikTok 0%. **Hoje os padrões valem
  também pros EUA** (em dólar) — conhecido e aceito até o preenchimento.
- Linha unificada: campo nasce vazio e grava em todos os membros.
- Estoque: venda real + estoque manual (`kv.productStock` por canal, `kv.productStockAgg` por família).
  Família = grupo do Unificador → Lysine/Daily por palavra-chave → título. Reposição: <3 meses
  urgente, 3–7 atenção. Amazon sem produto nenhum ganha a linha "Produto TESTE" (placeholder).

### Insights e comparação (Visão geral)
- Sem IA, de propósito: número exibido é número calculado, sem custo por acesso, testável.
- `insights.js` é puro e recebe dois retratos (atual e anterior). Pisos anti-ruído: valor absoluto
  (R$200 / US$50), 8% do total e 15% de variação, AO MESMO TEMPO; ordena por impacto em dinheiro.
  Até 10 itens, 2 por dimensão. Cor (`bom`/`medio`/`ruim`) decidida pela regra no servidor.
- Frases e números saem prontos do servidor; a tela nunca reformata.
- Comparação padrão = janela anterior do mesmo tamanho (`janelaDeComparacao`). "Trocar" escolhe
  outra (vale pra faixa de Indicadores também), fica em `sessionStorage` e é desfeita ao mudar o
  período atual. Só barra que compara PERÍODO leva data.

### Histórico de edições (tela Histórico, admin)
- Quem editou o quê, **de quanto pra quanto**. Registrado DENTRO das funções de gravação do store
  (é onde o valor antigo existe); autor via `AsyncLocalStorage` (`autor.js`); autor `null` = "O sistema".
- Só o que mudou vira linha. Senha nunca entra. Tabela própria, retenção `HISTORICO_DIAS` (180).
- Frase montada no servidor em pedaços (`partes`), nome do campo em negrito. Com país "Todos", cada
  linha mostra a bandeira. O filtro de país só descarta linha que TEM país e é de outro (edição de
  usuário não tem país e aparece sempre).
- `INTEGRACOES` (historico.js) é cópia da lista de Integrações; o teste compara as duas.
- Não entra no backup do B2 (limitação conhecida).

## 4. Integrações — o essencial de cada uma

**Shopify** (BR/EUA, Admin API `2026-04`+): sessões por ShopifyQL precisam de `read_analytics` +
`read_reports` (sem `read_analytics` a consulta some do schema, sem erro). `parseErrors` pode ser `[]`
(checar `.length`). Sessões da Yucaloo em balde separado (`kv.yucalooSessionsDaily`). Backfill:
`POST /api/shopify/backfill` (máx. 90 dias, em blocos de 30, grava bloco a bloco).

**Yucaloo** (Dev Dashboard): OAuth de verdade; `/shopify-yucaloo/:mkt/connect` é chamado pela Shopify
com HMAC (`verifyRequest` lê `req.originalUrl`, porque o Express troca `+` por espaço).

**Shopee**: HMAC-SHA256; sem analytics. Mascara endereço (`****`): o estado vem do Bling
(`reconcileGeoFromBling`). Devolução: `item[].amount` é QUANTIDADE (dinheiro é `refund_amount`);
status allowlist `ACCEPTED`; a chamada com janela de tempo falha, lê-se a lista toda com teto de
páginas (bateu no teto = leitura incompleta, declarada).

**Mercado Livre**: `listingType` premium só `gold_pro`/`gold_premium`. Mercado Ads exige header
`Api-Version: 1` e escopo `write:product_ads`; gasto diário dia a dia (`kv.mlAdCostsDaily`).
Reautorizar em `/mercadolivre/connect` depois de deploy. **O Bling devolve o `pack_id` do ML, não o
`order.id`** (resolver pelo pack).

**Amazon** (SP-API, região NA, contas BR e EUA separadas):
- **Nunca o mesmo refresh token nos dois mercados**: ativa `SAME_TOKEN` e um deles para de receber
  pedido calado (já aconteceu). Diagnóstico: `GET /api/amazon/whoami`. IAM: o User precisa de
  `sts:AssumeRole` no Role, e o Role precisa do User na trust policy.
- `/orders` tem cota de 1/min (burst 20): páginas em sequência, espera 61s só no 429 real
  (`RateLimitError`, 3 tentativas), página lida já é gravada. Backoff crescente depois disso
  (`POST /api/amazon/{reset-backoff,force-sync}`).
- Cursor incremental (`LastUpdatedAfter`); `CreatedBefore` ≥ 2 min no passado. O cursor anda até com
  zero resultado: token errado por um tempo deixa buraco, tapado por `POST /api/amazon/backfill`
  (Reports API, janelas de 30 dias, roda no processo do servidor — deploy no meio mata, é só repetir).
- A Orders API não traz nome de produto: vem da Reports API (`reconcileAmazonNames`, `patchOrderItems`
  só mexe em `items` e nunca insere pedido). Linha com `product-name` "-" é frete, descartada.
  `Pending` vem com total 0.
- Relatório pode misturar os dois mercados: validar por `ship-country` (`ordersFromRows`), nunca por
  moeda nem `ship-state` (siglas de UF colidem com estados dos EUA).
- Estado dos EUA vem em grafias variadas: `normalizeUsState` (us-states.js) na leitura e na gravação;
  endereço fora dos EUA vira `INTL`.
- "Receita da Amazon" (Configurações): "Total cobrado" (`total`, padrão) × "Vendas de produto"
  (`productSales`, só de pedido que passou pela Reports API — pode ficar bem abaixo, é limitação).
- **Devolução** nunca aparece no pedido (fica `Shipped` pra sempre). Duas fontes, as duas
  necessárias: relatório de devoluções FBA (mercadoria que voltou, por ASIN) e extrato de repasse V1
  (dinheiro, por SKU; o V2 dá 403). Extrato: contar linha `Principal`, pular repasse repetido pelo
  DOCUMENTO inteiro, download ~1/min (parar no 429 declarando leitura incompleta). Juntar as fontes
  sem somar a mesma unidade (`juntarFontesDeReembolso`). Job a cada 12h, janela 60 dias.
- Imagem de produto EUA: 403 até o app ganhar o role "Product Listing". Nome do comprador: exige
  papel PII (`AMAZON_FETCH_PII=1`). Portal: `solutionproviderportal.amazon.com`.

**Meta Ads**: Graph API (`META_API_VERSION`, padrão `v20.0` — trocar por uma mais nova é mudar a
variável). Conta sem o prefixo `act_`. Gasto diário em `kv.metaInsightsDaily`/`metaUSInsightsDaily`.
ROAS = receita com origem Instagram/Facebook ÷ gasto. Receita "de campanha" = origem Meta OU anúncio
premium do ML; o resto é orgânico. Origem do pedido é atribuição, não custo.

**Google Ads**: só EUA, só na tela de Campanhas.

**Bling** (ERP que recebe pedido de todos os canais):
- Só é FONTE de pedido em dois casos restritos: canal do TikTok e notas de bonificação. Ler qualquer
  outro canal duplicaria venda. `KNOWN_CHANNELS` (estado da Shopee) é fixo no código de propósito.
- Relógio do Bling é o de São Paulo (`momentoNoBling`). Data sem fuso = Brasília (`-03:00`).
- ~3 req/s: `apiGet` espaça as chamadas. Nota não traz itens na listagem (1 chamada por nota).
- **Token JWT** (obrigatório a partir de 15/10/2026): header `enable-jwt: 1` nos dois únicos pontos de
  rede (`tokenRequest` e `apiGet`); nenhum outro arquivo chama o Bling. **Uma renovação por vez**
  (`umaPorVez`): duas simultâneas gastariam o mesmo refresh token e obrigariam a reconectar.
  Conferência: `GET /api/bling/token` (formato e tamanho, nunca o token). Confirmado em 23/09/2026.
- Dois canais novos do Mercado Livre no Bling ainda não estão em `KNOWN_CHANNELS` (decisão pendente).

**Backup** (B2, diário, 30 dias): montado em partes (`snapshot.js`), texto idêntico ao
`JSON.stringify` de antes (o restore faz `JSON.parse`). Sessões de login ficam de fora.

**Alertas** (Telegram): só no sync automático; um alerta por canal depois de `ALERT_STALE_HOURS`
falhando; avisa quando volta.

**Integrações (tela, admin)**: o liga/desliga (`kv.integrationsConfig`, `TOGGLEABLE_KEYS`) tem efeito
real: o sync checa `isIntegrationEnabled()` antes de cada canal. Sem registro salvo = ligada. A Amazon
busca os dois mercados numa chamada só: desligar um filtra o que é gravado, não a chamada.

## 5. Segurança

- Login: scrypt+salt, cookie `coco_session` (HttpOnly, SameSite=Lax), 30 dias. Níveis `admin` e
  `padrao` (páginas em `pages[]`).
- **Portão** (antes do `express.static`): sem login só passam health, login, assets, o fluxo da
  Yucaloo e `/api/sync` com o token de `SYNC_SECRET` (header `x-sync-token`). Páginas de admin
  (Configurações, Integrações, Unificador, Histórico) só abrem pra admin.
- **Toda rota que grava declara quem pode**: `requireAdmin` ou `requirePage('<pagina>.html')`. Exceções
  nomeadas no teste: login, logout, troca da própria senha, `/api/sync`, `/api/senha/{esqueci,redefinir}`. Rota nova sem dono quebra o
  teste `seguranca`.
- Conectar conta (Bling, Shopee, ML, Google Ads) é só de admin — o `state` no cookie não impede um
  estranho de autorizar a PRÓPRIA conta no lugar da nossa. Sondas e rotas de manutenção: só admin.
- Senha do admin semente: `ADMIN_SEED_PASSWORD` ou sorteada e mostrada uma vez no log.
- **"Esqueci minha senha"** (tela de login; `recuperacao.js` + `email.js`): código de 6 dígitos pro
  e-mail cadastrado do usuário, enviado pela Brevo (`BREVO_*`). Vale 10 min, uma vez só, 5
  tentativas; reenvio 1/min e 5/hora; guarda só o HASH do código, em memória. **A tela diz com clareza
  o que aconteceu** (usuário não encontrado, sem e-mail, "enviado para m***@…", código errado com as
  tentativas que restam, vencido) — decisão do Luan, 24/09/2026: "não adianta enganar o usuário". O
  preço aceito é dar pra testar se um usuário existe; quem segura isso é o limite por IP. O e-mail é
  ESPERADO: só diz "enviado" depois que a Brevo aceitou; falha desfaz o pedido e aparece como falha.
  Redefinir derruba todas as sessões; o Histórico registra como feito pelo próprio usuário.
  Rotas `/api/senha/*` ficam ANTES do portão, sem login, com limite próprio (`senhaLimiter`).
  Usuário sem e-mail não consegue usar (Configurações mostra isso na lista). Telefone já é guardado;
  SMS fica pra depois (a Brevo também envia).
- E-mail e telefone do usuário: opcionais, e-mail ÚNICO (dá pra pedir o código pelo e-mail). No
  Histórico entra que mudou, sem o valor.
- Esqueceu a senha e não tem e-mail: outro admin troca em Configurações. Sem outro admin, trocar o `salt`/`hash` do
  usuário direto no `kv.users` (scrypt, 64 bytes, salt hex de 16 bytes — `hashPassword`) e **reiniciar o
  serviço**. Preferir isso a desligar o login: com login desligado, `requireAdmin` libera tudo pra
  qualquer um na internet (inclusive conectar conta e rotas que apagam dado).
- Último recurso: `UPDATE kv SET value='{"enabled":false}' WHERE key='authConfig'` reabre sem login;
  apagar a linha `key='users'` recria o admin (perde os outros usuários). **Qualquer mudança feita
  direto no banco só vale depois de reiniciar o serviço**: usuários e config ficam em memória.
- Cabeçalhos à mão (CSP, HSTS etc.). **Domínio que falta na CSP é bloqueado sem erro visível** (a
  fonte Inter ficou semanas bloqueada). Recurso externo novo → diretiva certa (`script-src`,
  `style-src`, `font-src`, `connect-src`). `'unsafe-inline'` ainda é exigido pelos `onclick=`/`style=`
  no markup.
- Todo recurso de CDN tem `integrity` + `crossorigin` (SRI); trocar a versão = recalcular o hash
  (teste `sri`). Google Fonts fica de fora (o CSS varia por navegador).

## 6. Consumo (conta do Railway)
- 97% da conta é memória (servidor ~470 MB + Postgres ~430 MB antes da janela de 90 dias). CPU, rede e
  disco dão centavos. O que reduz a conta é guardar menos (seção 2).
- Aba escondida não consulta o servidor (`CocoVisivel.agendar`, e o card de processos); ao voltar,
  atualiza se perdeu rodada. Cache de Campanhas vence e tem teto (`cache.js`).

## 7. Frontend — padrões compartilhados

| Componente | Regra |
|---|---|
| `js/colors.js` (`DEFAULT_CH`) | **Catálogo de canais**: nome, cor, logo, mercado, ordem. Tela nenhuma tem lista própria de canal: usa `CocoColors.channelsFor(market)`. O servidor tem a cópia `CANAIS` (metrics.js); as duas precisam bater (teste `registro-canais`). Canal novo = uma linha em cada. Só a cor é personalizável; trocar por `setChannelColor`, nunca `CocoColors.ch[k] = …` |
| `js/sidebar.js` · `confirm-modal.js` · `jobs-widget.js` | Injetados via IIFE em toda página (menos login). Nunca copiar CSS/markup deles. `cocoConfirm` substitui o `confirm()` nativo |
| `js/moeda.js` (`CocoMoeda`) | Dinheiro sempre com centavos, símbolo do `Intl`. Só eixo de gráfico abrevia (`curto`) |
| `js/periodo.js` (`CocoPeriodo`) | Texto da pill de período; ano só aparece fora do ano corrente |
| `js/pill-switch.js` | Todo seletor de opções. Só apresentação (segue a classe `active`); a opção padrão nasce `active` no HTML |
| `js/escape.js` | A única função de escape (texto e atributo), carregada antes do sidebar |
| `js/visivel.js` | Atualização periódica que pausa com a aba escondida |
| `js/sync-btn.js` (`CocoSync`) | Botão Sincronizar: mostra que está trabalhando e o erro; falhou, não recarrega |
| `css/anim.css` | Toda caixa que abre/fecha anima (`allow-discrete` + `@starting-style`, dentro de `@supports`). Caixa nova entra no grupo certo |
| `css/catalogo.css` | CSS comum de Produtos e Estoque; nenhum seletor dele pode ser redeclarado na folha da página |

- Script de página é CLÁSSICO, no fim do `<body>`, sem `defer`: os `onclick="foo()"` dependem disso.
- Caminho relativo dentro de um `.js` resolve pela PÁGINA, não pelo arquivo do script.
- Teste que lê tela usa `fontePagina(nome).tudo` (markup + js + css).
- "Financeiro" na sidebar fica ("em breve", `.nav-soon`), decisão do Luan. Quando virar página, precisa
  de `data-page` (senão escapa da permissão).
- Sidebar colapsada = 64px, e cada página repete `body.sidebar-hidden .main{margin-left:64px}`.
- Reordenar arrastando: sempre por ponteiro (clone `position:fixed`), nunca a API nativa de drag.
  Colunas de "Pedidos recentes" saem de um modelo (`RO_COLUMNS`) e a tabela é remontada a cada troca.
- Gráficos: ECharts; clique em qualquer ponto da área via `getZr().on('click')`. Container de gráfico
  flexível usa `flex:1 1 0` (base zero), nunca `auto` (vira laço infinito de crescimento).
- `public/`: só `.html` e `favicon.png` na raiz (URLs limpas, `SLUG_TO_FILE`); imagens em
  `img/{marca,bandeiras,canais,integracoes,mascotes,ilustracoes}`. Na tela de Integrações o servidor
  manda o NOME do logo e a tela prefixa `LOGO_BASE`; logo começando com `/` é caminho absoluto.

### Particularidades de cada tela
- **Visão geral**: cards da mesma linha esticam e preenchem (conteúdo cresce, não sobra vão). Modo de
  edição reordena/oculta cards e colunas, salvo em `coco_layout_<market>`. Tendência e Tráfego têm
  "Geral × Por canal" e "Expandir". Card de tráfego/funil só pras lojas Shopify (Coco and Luna +
  Yucaloo, via `aggregateSessions`).
- **Campanhas**: resumo e cards de campanha saem da MESMA fonte (`/api/campaigns`, período da tela).
  "Faturamento Geral" é a loja inteira (todos os canais), não a soma dos cards de anúncio.
- **Geografia**: uma página com seletor BR/EUA (`/geografia-us` redireciona). Tudo que ela divide com
  Segmentos vem de `js/geo.js` (`CocoGeo`), fundo Esri sem chave (`addBasemap`). BR: GeoJSON do IBGE
  (`codarea`); EUA: `public/geo/us-states.json` local (`_uf`).
- **Modo Calor (Geografia e Segmentos) = um foco por CIDADE de verdade** (`byCity`), do tamanho do valor
  dela; a pill do estado fica no centróide com o total. Venda sem cidade conhecida NÃO vira foco: fica
  só na pill, e o popup do estado diz quantas (`CocoGeo.semCidade`). Até 25/09/2026 eram 3 a 5 pontos
  fixos inventados por estado (um atrás da pill): uma venda virava vários focos e a cidade nunca aparecia.
- **Cidade do pedido** (`localizacao.js`): cada canal grava `city`/`zip`, e a Shopify e o ML também
  `geo` (arredondado a ~1 km, validado pela caixa do país). Coordenada: tabela de municípios do IBGE
  (`src/geo-dados/municipios-br.json`, MIT) por UF+nome, com socorro por nome único no país; EUA pela
  tabela de CEP do Censo (`cep-us.json`, domínio público). **A chave do foco é a cidade, não a
  coordenada** (senão cada casa vira um foco). Shopee mascara o endereço: a cidade vem do Bling na
  reconciliação de estado, que também completa TikTok antigo; `lugarConsultado` impede perguntar de novo.
  `upsertOrders` não apaga `city`/`zip`/`geo`. Nenhum dado além de cidade/CEP é gravado.
- **Produtos**: exportar CSV só da Shopify EUA. **Estoque**: sem período escolhido, últimos 30 dias;
  `windowDays` é o tamanho real do período.
- **Card de processos** (`jobs-widget.js`, toda página): aparece quando há job rodando e some 3s depois
  de tudo acabar; quem decide é `planoDoCard` (puro), com `autoHidden` pra não reacender. Status
  `running` parado demais vira erro (`destaleJob`, usado por `/api/jobs` E `/api/status` — os dois
  precisam concordar). Cancelar só nos jobs de `CANCELABLE_JOB_IDS` (cooperativo, `checkCancelled`).
  Fechar um job fica em `sessionStorage`. Cabeçalho e alça de redimensionar com `touch-action:none`.
- **`POST /api/sync` é síncrono** (leva minutos): qualquer botão ligado nele precisa mostrar que está
  trabalhando (`CocoSync`).

## 8. Erros conhecidos (e como não repetir)

- **Invisível não é intangível**: `opacity:0` continua recebendo clique. Esconder por opacidade exige
  `pointer-events:none` (o card de processos comia os botões do canto da tela).
- **Imagem dimensionada só por CSS injetado por script** aparece no tamanho do arquivo até o script
  rodar: declarar `width`/`height` no atributo.
- **`min-height:auto` vence `max-height`** num item flex: precisa `min-height:0` (lista que não recolhe).
  `.main{min-width:0}` pelo mesmo motivo (senão a página inteira ganha rolagem lateral).
- **`offsetTop` é relativo ao ancestral posicionado**: medir posição dentro de lista com
  `getBoundingClientRect`. DOM falso de teste precisa seguir a semântica real.
- **`behavior:'smooth'` pode ser ignorado em silêncio**: rolagem programática tenta suave e, se não
  andou em 250 ms, aplica direto.
- **Dois `margin-left:auto` na mesma linha flex** dividem o espaço: só o primeiro do grupo empurra.
- **`touch-action:none`** em todo elemento de arraste por ponteiro, senão o celular rola a página.
- **`document.querySelector` por `data-card-id`** pode achar a cópia no banco de cards: escopar em
  `editGrid`/`kpiStripGrid`.
- **Getter que devolve a referência viva do store** esconde edição do Histórico (o setter recebe o
  objeto já alterado): devolver cópia.
- **Poll que desiste calado** (`if (!j) return`) deixa botão travado: acompanhamento sempre devolve o
  botão e diz o que aconteceu.
- **Lista curta que parece inteira**: toda paginação com teto declara `incompleta`, e cursor/ausência
  só valem com leitura completa.
- **Fuso**: servidor em UTC; Bling e lojas BR em -03. Data sem fuso do Bling leva `-03:00`; filtro de
  data-hora pro Bling vai em horário de São Paulo.
- **Provedor que muda sem erro**: CARTO passou a carimbar "API KEY REQUIRED" no mapa (hoje Esri, sem
  chave); o contorno dos EUA vinha de repositório de terceiro (hoje local, `public/geo/`).
- **Texto interno vazando**: rótulo que falta cai na chave crua (`chLabel`). Toda chave nova precisa de
  rótulo.
- **Tabela não se reordena arrastando só o `<th>`**: cabeçalho e corpo dividem a coluna; remontar a
  tabela inteira. Esconder coluna no celular por identidade (`[data-col="…"]`), nunca `nth-child`, e
  linha de total sem `colspan`.
- **Modal centralizado por `transform`**: a animação precisa compor `translate(-50%,-50%) scale(.97)`;
  só `scale()` joga o modal pro canto.
- **Clone de card com `id`** duplica o id no documento: remover os ids do clone.
- **Dado preso no pedido antigo** (tag, tipo de produto): decidir pelo catálogo ATUAL da Shopify, não
  pelo que ficou gravado no pedido.
- **Remover código "até a próxima função exportada" leva o vizinho junto.** Em 22/09/2026 tirar
  `fixUnpaidOrders` levou `usOffsetForDate` (não exportada, logo abaixo): a sintaxe continuou válida e
  os EUA inteiros passaram a dar "is not defined" em produção. Remover função = apagar só o bloco
  dela e rodar `npm test` (o teste `referencias` confere que toda função chamada no servidor existe).
- **Mercado EUA corta o dia no horário do Pacífico** (`usOffsetForDate`, com horário de verão), não em
  UTC nem no de Brasília: é o fuso do Seller Central da Amazon EUA.

## 9. Rodar e convenções
- `npm install` → `npm start` (porta 3000; o sync roda ao subir — ver regra de ouro 3). `npm run sync`
  faz uma sincronização só.
- ES Modules, Node 18+ (`fetch` nativo). **Dependências mínimas**: `express`, `dotenv`, `pg`,
  `express-rate-limit`. Sem aws-sdk, sem axios: B2, Telegram e a assinatura da Amazon são feitos à mão.
- Dinheiro via `Intl` (BRL no Brasil, USD nos EUA), sempre com centavos.

## 10. Testes (`npm test`, `scripts/test/`)
- Runner próprio (`run.mjs`), um processo por arquivo; saída 0 passou, 1 falhou, 2 pulado (rede).
  `npm test -- <nome>` roda um só.
- Cobrem o que falha em silêncio: CSP, SRI, mapa, assets, imagens, escape, moeda, período, seletores,
  animação, catálogo de canais (`canais`, `registro-canais`), status de pedido, colunas, combo,
  devoluções (Amazon e Shopee), bonificação, TikTok, Bling (sonda e JWT), histórico, comparação,
  insights, retenção, consumo (`economia`), segurança, esqueci a senha (`recuperacao`), toda função
  chamada no servidor existe (`referencias`), imagem que não depende do período (`imagens-produto`), mapa de calor por cidade (`mapa-cidades`),
  backfill, integrações, jobs-widget, sync-btn.
- Testes de `metrics.js`/`store.js` que gravam ainda estão de fora (precisariam de banco temporário).

## 11. Variáveis de ambiente
| Variável | Para quê |
|---|---|
| `PORT`, `DATABASE_URL` | Porta; Postgres (no Railway: `${{Postgres.DATABASE_URL}}`) |
| `SYNC_INTERVAL_MINUTES` (15) · `STORE_OFFSET_MINUTES` (-180) | Frequência do sync; fuso da loja BR |
| `PEDIDOS_RETENCAO_DIAS` (90) | Janela de histórico |
| `SHOPIFY_STORE` / `_ADMIN_TOKEN` / `SHOPIFY_API_VERSION` · `SHOPIFY_US_STORE` / `_ADMIN_TOKEN` | Lojas Coco and Luna |
| `YUCALOO_BR_*` / `YUCALOO_US_*` (`CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URL`) | Apps da Yucaloo |
| `SHOPEE_PARTNER_ID` / `_KEY` / `_SHOP_ID` / `_REDIRECT_URL` | Shopee |
| `ML_CLIENT_ID` / `_CLIENT_SECRET` / `ML_REDIRECT_URL` | Mercado Livre |
| `AMAZON_CLIENT_ID` / `_CLIENT_SECRET` / `AMAZON_REFRESH_TOKEN` · `AMAZON_BR_*` | Apps SP-API EUA e BR (tokens nunca iguais) |
| `AMAZON_ROLE_ARN` / `AMAZON_AWS_ACCESS_KEY` / `_SECRET_KEY` | IAM (compartilhado BR/EUA) |
| `AMAZON_BACKFILL_DAYS` · `AMAZON_FETCH_PII` · `AMAZON_NAMES_*` · `AMAZON_RETURNS_*` · `AMAZON_SETTLEMENT_DOCS` | Ajustes da Amazon |
| `BLING_CLIENT_ID` / `_CLIENT_SECRET` / `BLING_REDIRECT_URL` · `BLING_BONIFICACAO_DAYS` · `TIKTOK_DETALHES_POR_RODADA` | Bling, doações, TikTok |
| `META_APP_ID` / `_APP_SECRET` / `META_ACCESS_TOKEN` / `META_AD_ACCOUNT_ID` / `META_US_AD_ACCOUNT_ID` / `META_API_VERSION` | Meta Ads |
| `GOOGLE_ADS_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URL` / `_DEVELOPER_TOKEN` / `_CUSTOMER_ID` / `_LOGIN_CUSTOMER_ID` | Google Ads |
| `BREVO_API_KEY` · `BREVO_SENDER_EMAIL` · `BREVO_SENDER_NAME` | E-mail do "Esqueci a senha" (remetente confirmado na Brevo; sem as duas primeiras, a opção avisa que não está configurada) |
| `ADMIN_SEED_PASSWORD` · `SYNC_SECRET` | Senha do admin semente; token de agendador externo pro `/api/sync` |
| `B2_KEY_ID` / `B2_APPLICATION_KEY` / `B2_BUCKET_NAME` · `BACKUP_RETENTION_DAYS` · `BACKUP_EVERY_HOURS` | Backup |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` · `ALERT_STALE_HOURS` | Alertas |

## 12. Rotas mais usadas
- Telas: `GET /api/dashboard` (`prevSince`/`prevUntil` trocam a comparação), `/api/campaigns`,
  `/api/products`, `/api/stock`, `/api/orders/search`, `/api/orders/export`.
- Login: `POST /api/login`, `/api/logout`, `GET /api/me`; recuperação `GET /api/senha/canais`,
  `POST /api/senha/{esqueci,redefinir}` (sem login, com limite).
- Operação: `POST /api/sync`, `GET /api/status`, `GET /api/jobs`, `POST /api/jobs/:id/cancel` (admin).
- Diagnóstico (admin): `/api/amazon/whoami`, `/api/amazon/settlement-probe`, `/api/shopee/probe-returns`,
  `/api/bling/probe-bonificacao`, `/api/bling/probe-tiktok`, `/api/bling/probe-channel`,
  `/api/bling/token`.
- Manual (admin): `POST /api/amazon/{backfill,sync-names,sync-returns,force-sync,reset-backoff}`,
  `/api/shopee/sync-returns`, `/api/bling/{sync-bonificacao,sync-geo,token/renovar}`,
  `/api/shopify/backfill`, `/api/backup/run`, `/api/alerts/test`.
- Conectar conta (admin): `/bling/connect`, `/shopee/connect`, `/mercadolivre/connect`, `/googleads/connect`.

## 13. A fazer
- **TikTok**: conferir `/api/bling/probe-tiktok` depois dos primeiros dias; situação "NÃO CONTA" que é
  venda entra na allowlist; doação ligada a canal de venda que não seja o TikTok = unidade contada 2x.
- **Shopee**: conferir `porStatus` das devoluções reais (volume em `CLOSED` pode ser reembolso).
- **Custos de Produtos**: o Luan vai preencher COG/imposto reais (os padrões valem pros EUA hoje).
- **Mercado Livre**: incluir os dois canais novos do Bling em `KNOWN_CHANNELS` (usar `probe-channel`).
- **Amazon**: PII e imagem dos EUA bloqueados por papel no portal (código pronto).
- **Planejado**: Amazon Ads; Microsoft Clarity (API só tem 1–3 dias agregados); tela do programa
  Village (assinatura Shopify EUA: `sellingPlan.name` por item e tag de pedido `VIL-XXXX`, que se
  repete nas renovações; pedidos antigos têm `appstle_subscription_first_order`).
- **Esqueci a senha**: configurar `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` no Railway e cadastrar o e-mail
  de cada usuário. SMS pelo telefone quando o Luan decidir (Brevo, pago por mensagem).
- Conferir a dashboard num celular de verdade.
- **Mapa por cidade**: pedido gravado antes de 25/09/2026 só ganha cidade quando é relido. Shopify e ML
  se completam sozinhos pelo sync; rodar uma vez `POST /api/bling/sync-geo` com `days=90` (Shopee e
  TikTok) e `POST /api/amazon/backfill` com 90 dias (Amazon).
- `cleanup-market-leak` pode sair quando o vazamento de julho passar da janela de 90 dias.
