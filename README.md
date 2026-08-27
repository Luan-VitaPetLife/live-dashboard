# Dashboard de Vendas

Dashboard de vendas em tempo real da Vita Pet Life, consolidando todos os canais das marcas
Coco and Luna e Yucaloo numa única tela.

## Canais integrados

**Brasil**
- Shopify — Coco and Luna (cocoandluna.com.br)
- Shopify — Yucaloo (yucaloo.com.br)
- Shopee
- Mercado Livre
- Amazon.com.br

**EUA**
- Shopify — Coco and Luna (vita-pet-life.myshopify.com)
- Shopify — Yucaloo
- Amazon.com

**Anúncios**
- Meta Ads (contas separadas de Brasil e EUA)
- Mercado Ads
- Google Ads (só EUA)

## O que mostra

- Receita, pedidos e ticket médio por canal e período
- Tendência diária de vendas, geral ou por canal
- Insights automáticos comparando o período com o anterior
- Custo de anúncios, ROAS e campanha a campanha
- Funil de sessões e conversão (lojas Shopify)
- Distribuição geográfica de pedidos por estado (Brasil e EUA)
- Catálogo completo por canal, com custo e margem por produto
- Estoque e projeção de reposição
- Segmentos de público (gato e cachorro) e tipo de produto

## Stack

Node.js + Express no backend, HTML/CSS/JS puro no frontend, sem empacotador nem etapa de build.
PostgreSQL em produção (Railway); em desenvolvimento, um JSON local. Backup diário para o
Backblaze B2 e alerta no Telegram quando um canal para de sincronizar.

## Rodar

```
npm install
npm start        # sobe na porta 3000 e sincroniza ao subir
npm run sync     # uma sincronização avulsa, sem servidor
```

As credenciais ficam no `.env` (veja `.env.example`) e nunca no repositório, que é público.
