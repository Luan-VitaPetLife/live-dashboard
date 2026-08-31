// escape.js — a única função que transforma texto de fora em texto seguro pra HTML.
//
// Por que existe: a mesma função estava escrita em OITO lugares, e não eram todas iguais.
// Cinco eram idênticas (sidebar, Configurações, Integrações, Unificador e Segmentos, essa com
// outro nome), uma tratava só atributo (Visão geral) e DUAS escapavam pela metade — o `escAttr`
// de Produtos e Estoque cuidava só de `&` e `"`, deixando `<` passar. Aquilo não era bug ainda,
// porque só era usado dentro de atributo entre aspas, mas quem reaproveitasse a função pra
// montar texto de elemento abriria um buraco sem perceber. Escapar é o tipo de coisa em que
// nenhuma cópia pode ser "quase igual".
//
// Trata os cinco caracteres que importam. `<` e `>` fecham/abrem tag; `"` e `'` fecham atributo;
// `&` precisa vir junto, senão um texto que já contenha `&lt;` seria decodificado de volta pra
// `<` pelo navegador (dupla decodificação).
//
// Serve tanto pra texto de elemento quanto pra valor de atributo entre aspas: o navegador
// decodifica a entidade ao ler de volta, então `dataset.x` e `JSON.parse` continuam recebendo o
// valor original.
(function () {
  'use strict';

  const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => MAPA[c]);
  }

  window.escapeHtml = escapeHtml;
})();
