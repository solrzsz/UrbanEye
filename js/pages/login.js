(function () {
  'use strict';

  function getStoredUser() {
    try {
      const raw = localStorage.getItem('urbaneye_user');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  function initLoginPage() {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const savedUser = getStoredUser();
    const savedAccountBadge = document.getElementById('savedAccountBadge');
    const loginNotice = document.getElementById('loginNotice');

    passwordInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      login();
    });

    const reason = getQueryParam('reason');
    const redirect = window.UrbanAuth ? window.UrbanAuth.safeRedirect(getQueryParam('redirect')) : null;
  
    if (loginNotice) {
      let message = '';
      if (reason === 'session-expired') message = 'Sua sessão expirou. Entre novamente para continuar.';
      else if (reason === 'login-required') message = 'Entre na sua conta ou continue como visitante para acessar o UrbanEye.';
      else if (reason === 'auth-required') message = 'Entre na sua conta para publicar e acompanhar seus relatos.';
      else if (reason === 'guest-mode') message = 'Você está no modo visitante. Entre para salvar seus dados na conta.';
  
      if (redirect && redirect !== 'map/map.html') {
        message = (message ? message + ' ' : '') + 'Depois do login você volta para a página que estava acessando.';
      }
  
      if (message) {
        loginNotice.textContent = message;
        loginNotice.style.display = 'block';
      }
    }
  
    if (savedUser && savedUser.email) {
      if (emailInput) emailInput.value = savedUser.email;
      if (savedAccountBadge) {
        savedAccountBadge.textContent = 'Conta salva: ' + savedUser.email;
        savedAccountBadge.style.display = 'block';
      }
      const loginBtn = document.getElementById('btnLogin');
      if (loginBtn) loginBtn.textContent = 'CONTINUAR';
    }
  }

  async function login() {
    const btn = document.getElementById('btnLogin');
    const originalText = btn ? btn.textContent : 'ENTRAR';
    if (btn) {
      btn.textContent = 'Autenticando...';
      btn.disabled = true;
    }
  
    try {
      if (!hasSupabaseAuth()) {
        throw new Error('Supabase não configurado. Configure a URL e a chave anônima do projeto antes de entrar.');
      }
  
      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const userEmail = emailInput && emailInput.value ? emailInput.value.trim() : '';
      const password = passwordInput && passwordInput.value ? passwordInput.value : '';
  
      if (!userEmail || !password) {
        toast('Preencha email e senha para continuar.');
        return;
      }
  
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email: userEmail, password });
      if (error) throw error;
  
      if (window.UrbanAuth && data?.session) {
        window.UrbanAuth.completeAuthentication(data.session);
      } else if (window.UrbanAuth) {
        await window.UrbanAuth.refresh();
      }
  
      toast('Login realizado com sucesso!');
      setTimeout(() => {
        const target = window.UrbanAuth ? window.UrbanAuth.getPostLoginRedirect() : 'map/map.html';
        window.location.href = resolveAppRoute(target);
      }, 500);
    } catch (error) {
      console.error(error);
      toast(error?.message || 'Não foi possível entrar.');
    } finally {
      if (btn) {
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 700);
      }
    }
  }

  Object.assign(window, {login});

  onAppReady(initLoginPage);
})();
