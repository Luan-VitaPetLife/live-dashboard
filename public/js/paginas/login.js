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

      // ── Esqueci a senha ──────────────────────────────────────────────────────
      // Passo 1 pede o código (a resposta é sempre a mesma, exista o usuário ou não). Passo 2 manda
      // código + senha nova. Deu certo, volta pro login com o usuário preenchido.
      const loginOk = document.getElementById('loginOk');
      const forgotForm = document.getElementById('forgotForm');
      const forgotBtn = document.getElementById('forgotBtn');
      const forgotOk = document.getElementById('forgotOk');
      const forgotErr = document.getElementById('forgotErr');
      const fLogin = document.getElementById('fLogin');
      const stepCode = document.getElementById('stepCode');
      const resendLink = document.getElementById('resendLink');
      let etapa = 'pedir';

      function mostrar(el, msg){ el.textContent = msg; el.classList.toggle('show', Boolean(msg)); }

      async function postar(url, corpo){
        const r = await fetch(url, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        });
        const d = await r.json().catch(() => ({}));
        if(!r.ok) throw new Error(d.error || 'Não deu certo. Tente de novo.');
        return d;
      }

      function irPara(qual){
        const esqueci = qual === 'esqueci';
        form.hidden = esqueci;
        forgotForm.hidden = !esqueci;
        mostrar(forgotOk, ''); mostrar(forgotErr, ''); mostrar(loginOk, ''); clearError();
        if(esqueci){
          etapa = 'pedir';
          stepCode.hidden = true; resendLink.hidden = true;
          forgotBtn.textContent = 'Enviar código';
          fLogin.value = userEl.value.trim();
          fLogin.focus();
        }
      }

      document.getElementById('forgotLink').addEventListener('click', async function(){
        irPara('esqueci');
        // Sem envio de e-mail configurado no servidor, a tela diz isso de cara, em vez de deixar a
        // pessoa digitar e só então descobrir.
        try{
          const r = await fetch('/api/senha/canais', { credentials: 'same-origin' });
          const d = await r.json();
          if(!d.email){
            mostrar(forgotErr, 'A recuperação por e-mail ainda não está configurada. Fale com um administrador.');
            forgotBtn.disabled = true;
          } else {
            forgotBtn.disabled = false;
          }
        }catch(e){
          console.error('canais de recuperação:', e);
        }
      });
      document.getElementById('backLink').addEventListener('click', function(){ irPara('login'); });

      async function pedirCodigo(){
        const login = fLogin.value.trim();
        if(!login){ mostrar(forgotErr, 'Digite seu usuário ou e-mail.'); return; }
        const d = await postar('/api/senha/esqueci', { login });
        mostrar(forgotOk, d.message || 'Se o usuário existir, o código chega em instantes.');
        etapa = 'redefinir';
        stepCode.hidden = false; resendLink.hidden = false;
        forgotBtn.textContent = 'Redefinir senha';
        document.getElementById('fCode').focus();
      }

      async function redefinir(){
        const codigo = document.getElementById('fCode').value.trim();
        const senha = document.getElementById('fNew').value;
        const senha2 = document.getElementById('fNew2').value;
        if(!/^\d{6}$/.test(codigo)){ mostrar(forgotErr, 'O código tem 6 números.'); return; }
        if(senha.length < 8){ mostrar(forgotErr, 'A senha precisa ter pelo menos 8 caracteres.'); return; }
        if(senha !== senha2){ mostrar(forgotErr, 'As duas senhas não são iguais.'); return; }
        const d = await postar('/api/senha/redefinir', { login: fLogin.value.trim(), codigo, senha });
        const login = fLogin.value.trim();
        irPara('login');
        if(!login.includes('@')) userEl.value = login;
        passEl.value = '';
        passEl.focus();
        mostrar(loginOk, d.message || 'Senha redefinida. Entre com a senha nova.');
      }

      forgotForm.addEventListener('submit', async function(e){
        e.preventDefault();
        mostrar(forgotErr, '');
        forgotBtn.disabled = true;
        try{
          if(etapa === 'pedir') await pedirCodigo(); else await redefinir();
        }catch(err){
          mostrar(forgotErr, err.message || 'Erro de conexão. Tente novamente.');
        }finally{
          forgotBtn.disabled = false;
        }
      });

      resendLink.addEventListener('click', async function(){
        mostrar(forgotErr, '');
        try{ await pedirCodigo(); }
        catch(err){ mostrar(forgotErr, err.message || 'Erro de conexão. Tente novamente.'); }
      });
    })();
