(function () {
  'use strict';

  async function signup() {
    const nameInput = document.getElementById('registerName');
    const emailInput = document.getElementById('registerEmail');
    const passwordInput = document.getElementById('registerPassword');
    const btn = document.getElementById('btnRegister');
    const originalText = btn ? btn.textContent : 'CRIAR CONTA';
  
    const name = nameInput && nameInput.value ? nameInput.value.trim() : 'Usuário';
    const email = emailInput && emailInput.value ? emailInput.value.trim() : '';
    const password = passwordInput && passwordInput.value ? passwordInput.value : '';
  
    if (!email || !password) {
      toast('Preencha email e senha para criar a conta.');
      return;
    }
  
    if (btn) {
      btn.textContent = 'Criando conta...';
      btn.disabled = true;
    }
  
    try {
      if (!hasSupabaseAuth()) {
        throw new Error('Supabase não configurado. Configure a URL e a chave anônima do projeto antes de criar a conta.');
      }
  
      const { data, error } = await window.supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name }
        }
      });
  
      if (error) throw error;
  
      const hasSession = !!data?.session;
      if (hasSession) {
        if (window.UrbanAuth) {
          window.UrbanAuth.completeAuthentication(data.session);
        }
        toast('Conta criada com sucesso!');
        setTimeout(() => {
          const target = window.UrbanAuth ? window.UrbanAuth.getPostLoginRedirect() : 'map/map.html';
          window.location.href = resolveAppRoute(target);
        }, 500);
      } else {
        toast('Conta criada. Confirme seu e-mail para entrar.');
      }
    } catch (error) {
      console.error(error);
      toast(error?.message || 'Não foi possível criar a conta.');
    } finally {
      if (btn) {
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 700);
      }
    }
  }

  Object.assign(window, {signup});

  onAppReady(() => {
    const passwordInput = document.getElementById('registerPassword');
    passwordInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      signup();
    });
  });
})();
