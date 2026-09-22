// Atualização periódica que PAUSA com a aba escondida (window.CocoVisivel).
//
// Toda tela com seletor de "Atualizar a cada N min" recarregava os dados mesmo com a aba em
// segundo plano, e cada recarga faz o servidor recalcular o período inteiro. Uma aba esquecida
// aberta passava o dia pedindo número que ninguém ia ler (análise de custo do Railway, 22/09/2026).
//
// Com a aba escondida a rodada é PULADA e anotada. Quando a aba volta, a tela atualiza na hora se
// perdeu alguma rodada: sem isso, quem voltasse depois de uma hora veria número de uma hora atrás
// até o próximo intervalo, sem nada indicando que estava velho.
//
// agendar(chave, fn, ms): substitui o agendamento anterior da mesma chave. ms <= 0 só cancela
// (é o "Atualizar: nunca" do seletor).
(function () {
  const agendados = new Map(); // chave → { id, fn, perdeu }

  function agendar(chave, fn, ms) {
    const antigo = agendados.get(chave);
    if (antigo) clearInterval(antigo.id);
    agendados.delete(chave);
    if (!(ms > 0)) return;
    const item = { fn, perdeu: false, id: 0 };
    item.id = setInterval(() => {
      if (document.hidden) { item.perdeu = true; return; }
      fn();
    }, ms);
    agendados.set(chave, item);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    for (const item of agendados.values()) {
      if (!item.perdeu) continue;
      item.perdeu = false;
      item.fn();
    }
  });

  window.CocoVisivel = { agendar };
})();
