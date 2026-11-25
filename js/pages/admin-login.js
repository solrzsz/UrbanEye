(function () {
  'use strict';

  async function adminLogin() {
    const emailInput = document.getElementById('adminEmail');
    const passwordInput = document.getElementById('adminPassword');
    const button = document.getElementById('btnAdminLogin');
    const email = emailInput?.value.trim() || '';
    const password = passwordInput?.value || '';
  
    if (!email || !password) {
      toast('Preencha o e-mail e a senha institucionais.');
      return;
    }
    if (!hasSupabaseAuth()) {
      toast('Supabase não configurado. Configure o projeto antes do acesso institucional.');
      return;
    }
  
    if (button) {
      button.disabled = true;
      button.textContent = 'Autenticando...';
    }
  
    try {
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data?.session) throw new Error('Não foi possível iniciar a sessão institucional.');
  
      if (window.UrbanAuth) window.UrbanAuth.completeAuthentication(data.session);
      window.location.href = resolveAppRoute(APP_ROUTES['admin-dashboard']);
    } catch (error) {
      console.error('Erro no login institucional:', error);
      toast(error?.message || 'Não foi possível entrar no painel.');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'ENTRAR NO PAINEL';
      }
    }
  }

  async function redirectActiveInstitutionalSession() {
    const notice = document.getElementById('adminSessionNotice');
    if (!window.UrbanAuth || !window.UrbanAuth.isAuthenticated()) return;
  
    try {
      if (!hasSupabaseAuth()) throw new Error('Supabase não está configurado.');
      const user = window.UrbanAuth.getUser();
      if (!user?.id) throw new Error('A sessão não contém um usuário válido.');
  
      const { data: profile, error } = await window.supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
  
      if (isInstitutionalProfile(profile)) {
        window.location.replace(resolveAppRoute(APP_ROUTES['admin-dashboard']));
        return;
      }
  
      if (notice) {
        notice.textContent = 'Você já está conectado, mas esta conta não tem acesso institucional. Entre com a conta da prefeitura ou ONG.';
        notice.hidden = false;
      }
    } catch (error) {
      console.error('Não foi possível verificar a sessão institucional existente:', error);
      if (notice) {
        notice.textContent = 'Não foi possível verificar sua sessão. Tente novamente ou entre com a conta institucional.';
        notice.hidden = false;
      }
    }
  }

  Object.assign(window, {adminLogin});

  onAppReady(() => {
    document.getElementById('adminLoginForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      adminLogin();
    });
    redirectActiveInstitutionalSession();
  });
})();
