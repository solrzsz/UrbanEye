(function () {
  'use strict';

  const PAGE = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const GUEST_ONLY_PAGES = new Set(['login.html', 'register.html']);
  const KNOWN_PAGES = new Set([
    'index.html', 'map.html', 'detail.html', 'filters.html', 'ranking.html',
    'stats.html', 'integrations.html', 'help.html', 'profile.html',
    'settings.html', 'history.html', 'notifications.html', 'report.html',
    'login.html', 'register.html'
  ]);
  const REDIRECTABLE_PAGES = new Set([...KNOWN_PAGES].filter((page) => !GUEST_ONLY_PAGES.has(page)));

  const AUTH_CACHE_KEY = 'urbaneye_auth_cache';
  const GUEST_KEY = 'urbaneye_guest';
  const AUTH_CHECK_CLASS = 'auth-checking';
  const AUTH_STATE_ATTR = 'data-auth-state';

  const state = {
    status: 'anonymous', // authenticated | guest | anonymous
    user: null,
    email: null,
    ready: false,
    redirecting: false
  };

  let readyResolve;
  const readyPromise = new Promise((resolve) => { readyResolve = resolve; });
  let authListenerBound = false;
  let loggingOut = false;

  function readSessionFlag() {
    try { return sessionStorage.getItem(GUEST_KEY) === 'true'; } catch (error) { return false; }
  }

  function setSessionFlag(value) {
    try {
      if (value) sessionStorage.setItem(GUEST_KEY, 'true');
      else sessionStorage.removeItem(GUEST_KEY);
    } catch (error) {
      console.warn('Não foi possível atualizar o modo visitante:', error);
    }
  }

  function readAuthCache() {
    try {
      const raw = localStorage.getItem(AUTH_CACHE_KEY);
      if (!raw) return null;
      const cache = JSON.parse(raw);
      if (!cache || cache.status !== 'authenticated') return null;
      if (cache.expiresAt && Date.now() > cache.expiresAt) return null;
      return cache;
    } catch (error) {
      return null;
    }
  }

  function writeAuthCache(session) {
    try {
      const payload = {
        status: 'authenticated',
        email: session?.user?.email || null,
        expiresAt: session?.expires_at ? session.expires_at * 1000 : Date.now() + 60 * 60 * 1000
      };
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Não foi possível salvar o cache de autenticação:', error);
    }
  }

  function clearAuthCache() {
    try { localStorage.removeItem(AUTH_CACHE_KEY); } catch (error) { /* ignore */ }
    try { localStorage.removeItem('urbaneye_logged_in'); } catch (error) { /* ignore */ }
    try { localStorage.removeItem('urbaneye_user'); } catch (error) { /* ignore */ }
    try { localStorage.removeItem('urbaneye_session'); } catch (error) { /* ignore */ }
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key && key.startsWith('urbaneye_user_cache_v1_')) sessionStorage.removeItem(key);
      }
    } catch (error) {
      console.warn('Não foi possível limpar o cache do perfil:', error);
    }
  }

  function isAuthenticated() {
    return state.status === 'authenticated';
  }

  function isGuest() {
    return state.status === 'guest';
  }

  function isVisitor() {
    return state.status !== 'authenticated';
  }

  function getDisplayName() {
    if (!isAuthenticated()) return 'Visitante';
    const metadata = state.user?.user_metadata || {};
    const rawName = metadata.full_name || metadata.name;
    if (rawName) return String(rawName).trim();
    if (state.email) return state.email.split('@')[0];
    return 'Usuário';
  }

  function safeRedirect(value) {
    if (!value) return null;
    let target;
    try { target = decodeURIComponent(String(value).trim()); } catch (error) { return null; }
    if (!target) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('\\\\')) return null;
    target = target.replace(/^\.\//, '').replace(/^\//, '');
    const file = target.split(/[?#]/)[0].toLowerCase();
    if (!REDIRECTABLE_PAGES.has(file)) return null;
    return target;
  }

  function currentPageTarget() {
    return PAGE + (window.location.search || '');
  }

  function loginUrl(reason, redirect) {
    const params = new URLSearchParams();
    const target = safeRedirect(redirect) || safeRedirect(currentPageTarget());
    if (target) params.set('redirect', target);
    if (reason) params.set('reason', reason);
    const query = params.toString();
    return 'login.html' + (query ? '?' + query : '');
  }

  function getPostLoginRedirect() {
    const params = new URLSearchParams(window.location.search);
    const target = safeRedirect(params.get('redirect'));
    if (!target) return 'map.html';
    const file = target.split(/[?#]/)[0].toLowerCase();
    if (GUEST_ONLY_PAGES.has(file)) return 'map.html';
    return target;
  }

  function navigate(target) {
    if (!target) return;
    state.redirecting = true;
    window.location.replace(target);
  }

  function applyAuthUI() {
    const authenticated = isAuthenticated();

    document.documentElement.setAttribute(AUTH_STATE_ATTR, state.status);

    document.querySelectorAll('[data-auth-only]').forEach((element) => {
      element.hidden = !authenticated;
    });

    document.querySelectorAll('[data-guest-only]').forEach((element) => {
      element.hidden = !isGuest();
    });

    document.querySelectorAll('[data-account-email]').forEach((element) => {
      element.textContent = authenticated ? (state.email || 'Conta conectada') : '';
    });

    document.querySelectorAll('[data-auth-name]').forEach((element) => {
      element.textContent = getDisplayName();
    });

    document.querySelectorAll('[data-logout-button]').forEach((button) => {
      button.hidden = !authenticated;
      if (!authenticated) {
        button.disabled = false;
        if (button.dataset.authOriginalText) {
          button.textContent = button.dataset.authOriginalText;
          delete button.dataset.authOriginalText;
        }
      }
    });

    renderGuestBanner();
  }

  function renderGuestBanner() {
    const existing = document.getElementById('guestModeBanner');
    const app = document.querySelector('.app');
    const hasInlineNotice = !!document.querySelector('[data-guest-only]');
    const shouldShow = isGuest() && !GUEST_ONLY_PAGES.has(PAGE) && !!app && !hasInlineNotice;

    if (!shouldShow) {
      if (existing) existing.remove();
      return;
    }

    if (existing || !app) return;

    const banner = document.createElement('div');
    banner.id = 'guestModeBanner';
    banner.className = 'guest-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = [
      '<div class="guest-banner-text">',
      '<b>Modo visitante</b>',
      '<div class="small">Explore o mapa e publique relatos locais. Entre para salvar tudo na sua conta.</div>',
      '</div>',
      '<div class="guest-banner-actions">',
      '<button type="button" class="btn secondary guest-banner-action" data-guest-action="login">Entrar</button>',
      '<button type="button" class="btn ghost guest-banner-action" data-guest-action="exit">Sair do modo visitante</button>',
      '</div>'
    ].join('');

    banner.querySelector('[data-guest-action="login"]').addEventListener('click', () => {
      openLogin(currentPageTarget());
    });

    banner.querySelector('[data-guest-action="exit"]').addEventListener('click', () => {
      exitGuestMode();
    });

    app.insertBefore(banner, app.firstChild);
  }

  function setAuthenticated(session) {
    state.status = 'authenticated';
    state.user = session?.user || null;
    state.email = session?.user?.email || null;
    setSessionFlag(false);
    writeAuthCache(session);
    applyAuthUI();
  }

  function setVisitor() {
    state.status = readSessionFlag() ? 'guest' : 'anonymous';
    state.user = null;
    state.email = null;
    applyAuthUI();
  }

  function completeAuthentication(session) {
    setAuthenticated(session);
    bindAuthChanges();
  }

  function enterGuestMode() {
    setSessionFlag(true);
    state.status = 'guest';
    state.user = null;
    state.email = null;
    clearAuthCache();
    applyAuthUI();
    navigate(getPostLoginRedirect());
  }

  function exitGuestMode() {
    setSessionFlag(false);
    state.status = 'anonymous';
    state.user = null;
    state.email = null;
    clearAuthCache();
    try { localStorage.removeItem('urbaneye_current_problem'); } catch (error) { /* ignore */ }
    applyAuthUI();

    if (typeof window.toast === 'function') window.toast('Modo visitante encerrado.');
    setTimeout(() => navigate('login.html'), 300);
  }

  function openLogin(redirect) {
    navigate(loginUrl('auth-required', redirect || currentPageTarget()));
  }

  function requireLogin() {
    if (isAuthenticated() || isGuest()) {
      navigate('report.html');
      return;
    }
    navigate(loginUrl('auth-required', 'report.html'));
  }

  function requireAuthAction() {
    if (isAuthenticated()) return true;
    openLogin(currentPageTarget());
    return false;
  }

  async function logout() {
    loggingOut = true;
    const buttons = document.querySelectorAll('[data-logout-button]');
    buttons.forEach((button) => {
      button.disabled = true;
      if (!button.dataset.authOriginalText) button.dataset.authOriginalText = button.textContent;
      button.textContent = 'Saindo...';
    });

    try {
      if (window.urbaneyeSupabaseEnabled && window.supabaseClient?.auth) {
        const { error } = await window.supabaseClient.auth.signOut();
        if (error) console.warn('Logout do Supabase falhou:', error.message);
      }
    } catch (error) {
      console.warn('Logout do Supabase falhou:', error);
    }

    setSessionFlag(false);
    clearAuthCache();
    state.status = 'anonymous';
    state.user = null;
    state.email = null;
    applyAuthUI();

    if (typeof window.toast === 'function') window.toast('Sessão encerrada.');
    setTimeout(() => navigate('login.html'), 350);
  }

  function bindAuthChanges() {
    const client = window.supabaseClient;
    if (authListenerBound || !client?.auth?.onAuthStateChange) return;
    authListenerBound = true;

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        const wasAuthenticated = isAuthenticated();
        clearAuthCache();
        setVisitor();
        if (!loggingOut) {
          if (wasAuthenticated) navigate(loginUrl('session-expired', currentPageTarget()));
          else applyRouteRules();
        }
        return;
      }

      if (session?.user) {
        setAuthenticated(session);
        if (GUEST_ONLY_PAGES.has(PAGE) && !state.redirecting) {
          navigate(getPostLoginRedirect());
        }
      }
    });
  }

  function applyRouteRules() {
    if (isAuthenticated()) {
      if (GUEST_ONLY_PAGES.has(PAGE)) navigate(getPostLoginRedirect());
      return;
    }

    if (isGuest()) return;

    // Deslogado sem ter escolhido o modo visitante: precisa entrar ou escolher visitante.
    if (!GUEST_ONLY_PAGES.has(PAGE)) {
      navigate(loginUrl('login-required', currentPageTarget()));
    }
  }

  function withTimeout(promise, timeoutMs) {
    return Promise.race([
      promise,
      new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Tempo esgotado ao validar a sessão.')), timeoutMs);
      })
    ]);
  }

  async function resolveState() {
    const hadGuestFlag = readSessionFlag();
    const cachedAuth = readAuthCache();

    if (!window.urbaneyeSupabaseEnabled || !window.supabaseClient?.auth) {
      state.status = hadGuestFlag ? 'guest' : 'anonymous';
      return finish();
    }

    let session = null;
    let sessionError = null;

    try {
      const result = await withTimeout(window.supabaseClient.auth.getSession(), 3000);
      session = result?.data?.session || null;
      sessionError = result?.error || null;
    } catch (error) {
      sessionError = error;
    }

    if (session?.user) {
      setAuthenticated(session);
    } else if (sessionError && cachedAuth) {
      state.status = 'authenticated';
      state.email = cachedAuth.email || null;
      state.user = state.user || { email: cachedAuth.email || null, user_metadata: {} };
    } else if (hadGuestFlag) {
      state.status = 'guest';
      state.user = null;
      state.email = null;
      if (!sessionError) clearAuthCache();
    } else {
      state.status = 'anonymous';
      state.user = null;
      state.email = null;
      if (!sessionError) clearAuthCache();
    }

    return finish();
  }

  function finish() {
    state.ready = true;
    applyAuthUI();
    applyRouteRules();
    bindAuthChanges();

    if (!state.redirecting) {
      document.documentElement.classList.remove(AUTH_CHECK_CLASS);
    }

    readyResolve({ ...state });
    window.dispatchEvent(new CustomEvent('urbaneye:auth-ready', { detail: { ...state } }));
    return state;
  }

  function refresh() {
    return resolveState();
  }

  window.UrbanAuth = {
    ready: readyPromise,
    getState: () => ({ ...state }),
    isAuthenticated,
    isGuest,
    isVisitor,
    getUser: () => state.user,
    getEmail: () => state.email,
    getDisplayName,
    completeAuthentication,
    enterGuestMode,
    exitGuestMode,
    logout,
    requireLogin,
    requireAuthAction,
    openLogin,
    getPostLoginRedirect,
    currentPageTarget,
    loginUrl,
    safeRedirect,
    navigate,
    applyAuthUI,
    refresh
  };

  window.enterGuestMode = enterGuestMode;
  window.exitGuestMode = exitGuestMode;
  window.requireLogin = requireLogin;
  window.requireAuthAction = requireAuthAction;
  window.openLogin = openLogin;

  resolveState();
})();
