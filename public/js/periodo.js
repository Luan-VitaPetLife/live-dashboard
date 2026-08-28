// periodo.js — rótulo do período selecionado, igual em toda tela.
// IIFE incluído via <script src="js/periodo.js">, mesmo padrão de colors.js/geo.js.
// Expõe window.CocoPeriodo.
//
// Existe porque seis telas escreviam esse rótulo cada uma do seu jeito (umas com "–", outras
// com ".", nenhuma com o ano) e todas escondiam o ano. Olhando "01/08 – 28/08" no cabeçalho
// não dava pra saber se o período era deste ano ou de outro, e um período de outro ano abre
// a dashboard inteira zerada sem nenhuma pista do porquê.
//
// O ano só aparece quando o período NÃO é do ano corrente: no uso do dia a dia (que é quase
// sempre este ano) o rótulo continua curto, e nos outros ele se explica.
(function () {
  'use strict';

  const ano = iso => iso.slice(0, 4);

  // since/until em ISO ('AAAA-MM-DD'). Opções: `hoje` (ISO, pra reconhecer "Hoje" e o ano
  // corrente) e `mercado` ('us' inverte pra MM/DD, como a tela de Geografia já fazia).
  function rotulo(since, until, opcoes) {
    if (!since || !until) return '';
    const { hoje = null, mercado = 'br' } = opcoes || {};
    const dm = mercado === 'us'
      ? iso => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`
      : iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    const anoHoje = (hoje || new Date().toISOString().slice(0, 10)).slice(0, 4);

    if (since === until) {
      if (hoje && since === hoje) return 'Hoje';
      return ano(since) === anoHoje ? dm(since) : `${dm(since)}/${ano(since)}`;
    }
    // Anos diferentes entre as pontas: cada ponta precisa do seu ano, senão a virada de ano
    // fica ambígua ("20/12 – 05/01" não diz qual dezembro).
    if (ano(since) !== ano(until)) return `${dm(since)}/${ano(since)} – ${dm(until)}/${ano(until)}`;
    // Mesmo ano, e não é o ano corrente: um ano só no fim já resolve.
    if (ano(since) !== anoHoje) return `${dm(since)} – ${dm(until)}/${ano(until)}`;
    return `${dm(since)} – ${dm(until)}`;
  }

  // Uma data só, SEMPRE com o ano. Serve pra frase que fala de limite de histórico, onde
  // esconder o ano seria justamente esconder a informação que importa.
  function data(iso, opcoes) {
    if (!iso) return '';
    const { mercado = 'br' } = opcoes || {};
    return mercado === 'us'
      ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${ano(iso)}`
      : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${ano(iso)}`;
  }

  window.CocoPeriodo = { rotulo, data };
})();
