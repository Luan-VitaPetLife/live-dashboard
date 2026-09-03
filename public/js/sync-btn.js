// Comportamento do botão "Sincronizar" — o mesmo nas 6 telas que o têm.
//
// Eram seis handlers copiados, com quatro comportamentos diferentes, e três deles (Produtos,
// Estoque e Campanhas) **não davam retorno nenhum**: o clique disparava a sincronização e a tela
// ficava exatamente igual. Como `POST /api/sync` espera a sincronização INTEIRA terminar antes de
// responder, e isso leva minutos, a leitura de quem clicava era a única possível — "não
// funciona". Relatado pelo Luan em 03/09/2026, em Produtos e Estoque.
//
// E os seis engoliam erro (`catch (e) {}`), o que o CLAUDE.md proíbe explicitamente. Pior: como o
// endpoint tem limite de chamadas, clicar duas vezes rende um 429 — e o segundo clique não fazia
// nada, sem nada na tela dizendo por quê. O Unificador era o caso mais enganoso de todos: dizia
// "Sincronizado." mesmo quando a sincronização tinha falhado.
(function () {
  const css = ''
    + '.cs-spin{display:inline-block;animation:csSpin .8s linear infinite}'
    + '@keyframes csSpin{to{transform:rotate(360deg)}}';
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const ERRO_MS = 5000;

  function mensagemDoErro(res, corpo) {
    // 429 é o caso comum e o mais confuso de todos: a pessoa clica de novo achando que não pegou,
    // e o segundo clique é justamente o que o servidor recusa.
    if (res && res.status === 429) return 'Aguarde um pouco antes de sincronizar de novo';
    if (res && res.status === 401) return 'Sessão expirada, entre de novo';
    if (corpo && corpo.error) return corpo.error;
    if (res) return `Erro ${res.status} ao sincronizar`;
    return 'Sem conexão com o servidor';
  }

  // `recarregar` é o que a página faz pra reler os dados depois que a sincronização termina.
  // `aoIniciar` é opcional e serve pras telas que também mexem no indicador "Ao vivo" do topo.
  function ligar(recarregar, opcoes = {}) {
    const botao = document.getElementById(opcoes.botao || 'syncBtn');
    if (!botao) return;
    const original = botao.innerHTML;
    let rodando = false;
    let voltar = null;

    botao.addEventListener('click', async () => {
      // Sem isto, clicar duas vezes dispara duas sincronizações — e a segunda toma 429.
      if (rodando) return;
      rodando = true;
      clearTimeout(voltar);
      botao.disabled = true;
      botao.innerHTML = '<i class="bi bi-arrow-clockwise cs-spin"></i> Sincronizando…';
      if (typeof opcoes.aoIniciar === 'function') opcoes.aoIniciar();

      let erro = null;
      try {
        const r = await fetch('/api/sync', { method: 'POST', credentials: 'same-origin' });
        if (!r.ok) {
          const corpo = await r.json().catch(() => null);
          erro = mensagemDoErro(r, corpo);
        }
      } catch (e) {
        erro = mensagemDoErro(null, null);
        console.error('sync:', e);
      }

      rodando = false;
      botao.disabled = false;
      if (erro) {
        // O recado aparece no próprio botão, que é onde a pessoa está olhando. Nem toda página
        // tem toast, e um erro que só vai pro console é um erro que ninguém vê.
        botao.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${erro}`;
        botao.title = erro;
        console.error('sync: ' + erro);
        voltar = setTimeout(() => { botao.innerHTML = original; botao.title = 'Buscar dados novos agora'; }, ERRO_MS);
        return;
      }
      botao.innerHTML = original;
      // Só recarrega quando deu certo: recarregar depois de falha redesenha os mesmos números e
      // faz parecer que sincronizou.
      if (typeof recarregar === 'function') await recarregar();
    });
  }

  window.CocoSync = { ligar };
})();
