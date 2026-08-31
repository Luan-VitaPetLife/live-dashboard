// pill-switch.js — seletor de opção com pill deslizante (Coco and Luna)
// IIFE incluído via <script src="js/pill-switch.js">, mesmo padrão de sidebar.js/colors.js.
//
// Padrão visual único de TODO seletor de duas ou mais opções mutuamente exclusivas do app:
// moldura discreta, opção ativa marcada por um pill claro que DESLIZA até ela. Antes cada
// tela tinha o seu: .view-switch (Colunas/Linhas), .mkt-btn (Brasil/EUA), .chart-type-btn
// (barra/linha), .mode-btn (Coropleto/Calor) — quatro aparências diferentes pra mesma
// decisão de interface, três delas marcando o ativo com fundo escuro.
//
// Este arquivo é PURA APRESENTAÇÃO: não trata clique, não muda estado, não decide nada.
// Ele observa qual botão tem a classe `active` e leva o pill até lá. É de propósito — assim
// as telas mantiveram os próprios handlers, que continuam sendo a única fonte da verdade
// sobre o que está selecionado. Se um clique for recusado pela lógica da página, o pill
// simplesmente não anda, em vez de mentir e se corrigir depois.
//
// Markup:
//   <div class="pill-switch" id="algumId">
//     <span class="ps-pill" aria-hidden="true"></span>
//     <button class="ps-opt active" ...>Colunas</button>
//     <button class="ps-opt" ...>Linhas</button>
//   </div>
// A variante `pill-switch--sm` é pro seletor só de ícone que vive no cabeçalho de um card, onde não
// cabe a altura do padrão.
(function () {
  const CSS = `
  .pill-switch{position:relative;display:inline-flex;align-items:center;gap:3px;background:var(--surface2);border:1px solid var(--border2);border-radius:10px;padding:3px;flex-shrink:0}
  /* O pill fica ATRÁS das opções (z-index) e não recebe clique, senão ele roubaria o clique
     do botão que está cobrindo. A transição é só de transform/width: animar left/top custaria
     um recálculo de layout a cada quadro. */
  .ps-pill{position:absolute;top:3px;left:0;height:calc(100% - 6px);width:0;border-radius:7px;background:var(--surface);box-shadow:0 1px 3px rgba(30,28,24,.13);pointer-events:none;z-index:0;transition:transform .3s cubic-bezier(.32,.72,0,1),width .3s cubic-bezier(.32,.72,0,1)}
  /* Enquanto a medida inicial não aconteceu, o pill não pode animar: ele entraria deslizando
     da borda esquerda toda vez que a página carrega. */
  .pill-switch.ps-medindo .ps-pill{transition:none}
  .ps-opt{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 12px;border:none;background:none;border-radius:7px;font-size:11px;font-weight:600;color:var(--sub);cursor:pointer;font-family:inherit;white-space:nowrap;transition:color .18s;line-height:1}
  .ps-opt:hover{color:var(--text)}
  .ps-opt.active{color:var(--text)}
  .ps-opt:focus-visible{outline:2px solid var(--ink);outline-offset:1px}
  .ps-opt img{flex-shrink:0}
  .ps-opt i{font-size:12px;line-height:1}
  /* Bandeirinha do seletor Brasil/EUA. Vive aqui, e não em cada página, porque só aparece
     dentro deste componente e a regra estava copiada igual em sete arquivos. */
  .mkt-flag-img{width:18px;height:13px;object-fit:cover;border-radius:2px;flex-shrink:0}

  /* Variante compacta: só ícone, pro cabeçalho de card, onde a altura do padrão não cabe. */
  .pill-switch--sm{border-radius:8px;padding:2px;gap:2px}
  .pill-switch--sm .ps-pill{top:2px;height:calc(100% - 4px);border-radius:6px}
  .pill-switch--sm .ps-opt{width:24px;height:22px;padding:0;border-radius:6px}
  .pill-switch--sm .ps-opt i{font-size:11px}

  /* Ocupa a linha toda no celular (a tela de Integrações já fazia isso com o seletor antigo). */
  .pill-switch--full{display:flex;width:100%}
  .pill-switch--full .ps-opt{flex:1}

  @media (prefers-reduced-motion: reduce){
    .ps-pill{transition:none}
  }`;

  function injetarCss() {
    if (document.getElementById('coco-pill-switch-style')) return;
    const s = document.createElement('style');
    s.id = 'coco-pill-switch-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // Leva o pill até a opção ativa. Sem opção ativa, ele some em vez de ficar preso na anterior.
  function posicionar(sw) {
    const pill = sw.querySelector(':scope > .ps-pill');
    const ativo = sw.querySelector(':scope > .ps-opt.active');
    if (!pill) return;
    if (!ativo) { pill.style.width = '0'; return; }
    // offsetLeft é relativo ao container posicionado, que é o próprio .pill-switch.
    pill.style.width = ativo.offsetWidth + 'px';
    pill.style.transform = `translateX(${ativo.offsetLeft}px)`;
  }

  // Primeira medida sem animação: o pill nasce já no lugar certo.
  function medirSemAnimar(sw) {
    sw.classList.add('ps-medindo');
    posicionar(sw);
    // Dois quadros: o primeiro aplica a posição, o segundo devolve a transição. Num só, o
    // navegador ainda não tinha desenhado e a transição pegaria a mudança inicial.
    requestAnimationFrame(() => requestAnimationFrame(() => sw.classList.remove('ps-medindo')));
  }

  const observados = new WeakSet();
  function ligar(sw) {
    if (observados.has(sw)) return;
    observados.add(sw);

    if (!sw.querySelector(':scope > .ps-pill')) {
      const pill = document.createElement('span');
      pill.className = 'ps-pill';
      pill.setAttribute('aria-hidden', 'true');
      sw.prepend(pill);
    }
    // Um grupo de opções mutuamente exclusivas: o leitor de tela precisa saber que os botões
    // são um conjunto e qual está escolhido.
    if (!sw.hasAttribute('role')) sw.setAttribute('role', 'group');

    // Quem manda é a classe `active`, posta pela própria página. Observar em vez de tratar o
    // clique é o que permite este arquivo não conhecer nada da lógica de nenhuma tela.
    new MutationObserver(() => {
      posicionar(sw);
      sw.querySelectorAll(':scope > .ps-opt').forEach(b =>
        b.setAttribute('aria-pressed', String(b.classList.contains('active'))));
    }).observe(sw, { attributes: true, attributeFilter: ['class'], subtree: true });

    // Largura do container e das opções muda com a janela, com o recolher da sidebar e quando
    // um seletor escondido aparece — aí a medida anterior valia zero.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => posicionar(sw));
      ro.observe(sw);
      sw.querySelectorAll(':scope > .ps-opt').forEach(b => ro.observe(b));
    }

    sw.querySelectorAll(':scope > .ps-opt').forEach(b =>
      b.setAttribute('aria-pressed', String(b.classList.contains('active'))));
    medirSemAnimar(sw);
  }

  function ligarTodos() {
    injetarCss();
    document.querySelectorAll('.pill-switch').forEach(ligar);
  }

  // O estilo entra AGORA, e não no DOMContentLoaded: o seletor aparece bem no topo da página, e
  // esperar o documento inteiro carregar deixa uma janela em que ele já está desenhado e ainda
  // sem regra nenhuma. Era o que fazia a bandeira do seletor Brasil/EUA piscar no tamanho do
  // arquivo. É seguro chamar aqui porque a tag deste script vem depois do </head>, então o
  // document.head já existe, e injetarCss se protege contra rodar duas vezes.
  injetarCss();

  // Ligar os controles continua esperando o documento: aí sim os elementos precisam existir.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligarTodos);
  else ligarTodos();

  // A fonte pode chegar depois do primeiro desenho e mudar a largura do texto das opções, o
  // que deslocaria o pill. Reposiciona quando ela terminar de carregar.
  if (document.fonts?.ready) document.fonts.ready.then(() => document.querySelectorAll('.pill-switch').forEach(posicionar));

  // `refresh` é pra tela que cria um seletor depois do carregamento (ou reescreve o innerHTML
  // de um que já existia) — ligarTodos ignora o que já está ligado.
  window.CocoPillSwitch = { refresh: ligarTodos, posicionar };
})();
