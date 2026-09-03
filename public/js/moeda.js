// Formatação de dinheiro — fonte única das telas que mostram valor.
//
// Eram SEIS implementações independentes, uma por página, e elas tinham divergido em duas coisas
// ao mesmo tempo:
//   - casas decimais: Visão geral, Geografia, Campanhas e Produtos mostravam o valor SEM centavos,
//     enquanto Segmentos, Unificador e a exportação em CSV mostravam com. Um pedido de R$ 119,90
//     aparecia como "R$ 120" em quatro telas e como "R$ 119,90" nas outras três, para o mesmo
//     pedido — e quem fosse conferir com a Shopify ou com o Bling parava pra entender a diferença;
//   - símbolo do dólar: "U$", "US$" e "$", dependendo da página.
//
// Decisão do Luan (03/09/2026): **tudo com centavos, sem arredondar**. O arredondamento nunca
// esteve no cálculo (o servidor só arredonda pra CENTAVO, o que existe pra conter erro de ponto
// flutuante) — era só exibição. Mas exibição arredondada tem um efeito ruim próprio: três produtos
// de R$ 0,40 apareciam como "R$ 0" cada, com o total dizendo "R$ 1", e a coluna não fechava.
//
// O símbolo saiu do `Intl` em vez de ser escrito à mão, então é o do próprio idioma/moeda: BRL em
// pt-BR dá "R$ 119,90" (idêntico ao que quatro páginas já montavam à mão) e USD em en-US dá
// "$119.90" (que é o que Campanhas, Produtos e Segmentos já mostravam — as outras três convergem
// pro mesmo).
(function () {
  const CONFIG = {
    br: { locale: 'pt-BR', currency: 'BRL' },
    us: { locale: 'en-US', currency: 'USD' },
  };
  function cfg(market) { return CONFIG[market] || CONFIG.br; }

  // Valor por extenso, sempre com centavos. É o formato de tudo que alguém pode conferir com
  // outra fonte: pedido, produto, receita por estado, total de tabela.
  function fmt(v, market) {
    const { locale, currency } = cfg(market);
    return (Number(v) || 0).toLocaleString(locale, {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }

  // Forma curta, para RÓTULO DE EIXO de gráfico e mais nada. Um eixo com cinco marcas de
  // "R$ 651.487,32" empilhadas fica ilegível e empurra o gráfico pra fora do card — ali o número
  // é uma régua, não um valor a conferir. Abaixo de mil devolve o valor cheio, com centavos.
  function curto(v, market) {
    const n = Number(v) || 0;
    if (Math.abs(n) < 1000) return fmt(n, market);
    const { locale, currency } = cfg(market);
    const mil = (n / 1000).toLocaleString(locale, {
      style: 'currency', currency, minimumFractionDigits: 1, maximumFractionDigits: 1,
    });
    return mil + 'K';
  }

  window.CocoMoeda = { fmt, curto };
})();
