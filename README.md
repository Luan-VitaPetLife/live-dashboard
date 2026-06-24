# Coco and Luna — Dashboard de vendas (fora do navegador)

App web próprio que junta os canais de venda numa só dashboard. O **backend** (Node) guarda as chaves com segurança, conversa direto com Shopify e Shopee, renova os tokens sozinho e sincroniza os dados de tempos em tempos. A **interface** é a mesma dashboard, agora servida num endereço fixo, lendo do backend.

```
coco-luna-dashboard/
├── server.js            # servidor web + API + agendador
├── src/
│   ├── store.js         # banco simples (JSON) — trocável por Postgres
│   ├── shopify.js       # pedidos (GraphQL) + sessões (ShopifyQL)
│   ├── shopee.js        # OAuth + assinatura + renovação de token + pedidos
│   ├── metrics.js       # cálculo das métricas (receita exclui cancelados)
│   └── sync.js          # busca tudo e grava no banco
├── public/index.html    # a dashboard (interface)
└── .env.example         # configurações/segredos (copie para .env)
```

## 1. Rodar na sua máquina

Pré-requisito: **Node.js 18+** instalado.

```bash
cd coco-luna-dashboard
npm install
cp .env.example .env        # no Windows: copy .env.example .env
# abra o .env e preencha os valores (veja abaixo)
npm start
```

Acesse **http://localhost:3000**.

## 2. Conectar a Shopify (custom app)

1. No admin da Shopify: **Configurações → Apps e canais de venda → Desenvolver apps → Criar app**.
2. Em **Configuração da API Admin**, dê os escopos: `read_orders`, `read_products`, `read_reports`.
3. Instale o app e copie o **Admin API access token** (começa com `shpat_`).
4. No `.env`, preencha `SHOPIFY_STORE` (ex.: `ebb5cd.myshopify.com`) e `SHOPIFY_ADMIN_TOKEN`.

Pronto: ao iniciar, o backend já puxa pedidos e sessões da Shopify.

## 3. Conectar a Shopee (Open Platform)

1. No console **open.shopee.com**, crie um **App** e pegue o `partner_id` e o `partner_key`.
2. Cadastre a **Redirect URL** exatamente igual à do `.env` (`SHOPEE_REDIRECT_URL`).
   - Local: `http://localhost:3000/shopee/callback`
   - Produção: `https://SEU-DOMINIO/shopee/callback`
3. Preencha `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` e `SHOPEE_REDIRECT_URL` no `.env` e reinicie.
4. Acesse **http://localhost:3000/shopee/connect** → você é levado à Shopee para autorizar a loja.
5. Após autorizar, a Shopee redireciona de volta e o backend salva os tokens. A partir daí a Shopee aparece como canal real (sai do 0) e o token se renova sozinho.

> Enquanto a Shopee não for autorizada, o canal Shopee simplesmente fica em 0 — nada quebra.

## 4. O que cada parte faz

- **Receita correta:** os pedidos vêm da API e o cálculo **exclui cancelados/expirados/anulados** (foi o bug que corrigimos).
- **Sincronização automática:** a cada `SYNC_INTERVAL_MINUTES` (padrão 15) o backend busca dados novos. Dá pra forçar com o botão **↻ Sincronizar** na dashboard ou `POST /api/sync`.
- **Marketing por origem:** receita atribuída (Instagram, Facebook, Google, Direto) vinda do referrer de cada pedido da Shopify.
- **Custo de Ads / ROAS:** continua 0 — exige conectar **Google Ads** e **Meta Ads** (próximo passo; cada um tem sua própria API de custo).

## 5. Publicar online (deploy)

Qualquer serviço que rode Node serve. Sugestões fáceis (passo a passo no painel de cada um):

- **Railway** ou **Render**: conecte o repositório do GitHub, defina as variáveis do `.env` no painel, comando de start `npm start`. Eles dão um domínio https automático.
- Importante: configure um **disco persistente** (ou troque o store por um banco Postgres gerenciado) para o `data/db.json` não se perder a cada deploy. Em produção, o ideal é migrar o `src/store.js` para Postgres — a interface não muda.
- Depois de ter o domínio, atualize `SHOPEE_REDIRECT_URL` para `https://SEU-DOMINIO/shopee/callback` (e cadastre essa mesma URL no console da Shopee).

## 6. Próximos passos sugeridos

1. Conectar Google Ads e Meta Ads para ter custo e **ROAS/ACOS** de verdade.
2. Adicionar Mercado Livre / Amazon como canais (mesma lógica da Shopee).
3. Migrar o store para Postgres quando o volume crescer.
4. Login/usuários se mais pessoas forem acessar.
