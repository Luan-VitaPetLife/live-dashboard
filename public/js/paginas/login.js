    (function(){
      const form = document.getElementById('loginForm');
      const btn = document.getElementById('submitBtn');
      const errEl = document.getElementById('err');
      const userEl = document.getElementById('username');
      const passEl = document.getElementById('password');
      const pwToggle = document.getElementById('pwToggle');
      const pwIcon = pwToggle.querySelector('i');

      // Mostrar / ocultar senha
      pwToggle.addEventListener('click', function(){
        const show = passEl.type === 'password';
        passEl.type = show ? 'text' : 'password';
        pwIcon.className = show ? 'bi bi-eye-slash' : 'bi bi-eye';
        pwToggle.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
        passEl.focus();
      });

      function showError(msg){
        errEl.textContent = msg;
        errEl.classList.add('show');
      }
      function clearError(){
        errEl.textContent = '';
        errEl.classList.remove('show');
      }

      form.addEventListener('submit', async function(e){
        e.preventDefault();
        clearError();

        const username = userEl.value.trim();
        const password = passEl.value;

        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = 'Entrando...';

        try{
          const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ username, password })
          });

          if(res.ok){
            window.location.href = '/';
            return;
          }

          let data = {};
          try{ data = await res.json(); }catch(_){}
          showError(data.error || 'Não foi possível entrar.');
          btn.disabled = false;
          btn.textContent = originalText;
        }catch(err){
          showError('Erro de conexão. Tente novamente.');
          btn.disabled = false;
          btn.textContent = originalText;
        }
      });
    })();
