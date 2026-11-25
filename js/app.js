let map, userMarker, reportMap, reportMarker;
let currentDetailProblem = null;
let profileAvatarPreviewUrl = null;
const municipalityCache = new Map();
const municipalityRequests = new Map();
let municipalityRequestQueue = Promise.resolve();
let lastGeocodeRequestAt = 0;
let reportGeocodeSequence = 0;
let reportGeocodeTimer = null;
const GEOCODE_STORAGE_KEY = 'urbaneye_geocode_cache_v1';
const GEOCODE_SUCCESS_TTL = 30 * 24 * 60 * 60 * 1000;
const GEOCODE_FAILURE_TTL = 24 * 60 * 60 * 1000;

function readGeocodeStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(GEOCODE_STORAGE_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (error) {
    return {};
  }
}

let geocodeStorage = readGeocodeStorage();

function persistGeocodeStorage() {
  try {
    localStorage.setItem(GEOCODE_STORAGE_KEY, JSON.stringify(geocodeStorage));
  } catch (error) {
    // Cache é opcional; se a cota estourar, a geocodificação continua na memória.
  }
}

function readStoredLocation(cacheKey) {
  const entry = geocodeStorage[cacheKey];
  if (!entry || !entry.location) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    delete geocodeStorage[cacheKey];
    return null;
  }
  return entry.location;
}

function storeLocation(cacheKey, location) {
  const ttl = location && (location.bairro || location.municipality)
    ? GEOCODE_SUCCESS_TTL
    : GEOCODE_FAILURE_TTL;
  geocodeStorage[cacheKey] = {
    location,
    expiresAt: Date.now() + ttl
  };
  persistGeocodeStorage();
}

// Theme Logic
function setTheme(theme) {
  const selected = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', selected);
  localStorage.setItem('urbaneye_theme', selected);
  const toggle = document.getElementById('darkModeToggle');
  if (toggle) toggle.checked = selected === 'dark';
  document.querySelectorAll('[data-theme-choice]').forEach(btn => {
    const active = btn.dataset.themeChoice === selected;
    btn.classList.toggle('theme-choice-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}
function toggleDarkMode(isDark) { setTheme(isDark ? 'dark' : 'light'); }
function initTheme() {
  const saved = localStorage.getItem('urbaneye_theme') || document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(saved);
}

function isLocationEnabled() {
  try {
    return localStorage.getItem('urbaneye_location_enabled') !== 'false';
  } catch (error) {
    console.warn('Não foi possível ler a preferência de localização:', error);
    return true;
  }
}

async function initSettings() {
  const locationPreference = document.getElementById('locationPreference');
  const notificationPreference = document.getElementById('notificationPreference');
  const notificationHelp = document.getElementById('notificationPreferenceHelp');

  if (locationPreference) {
    locationPreference.checked = isLocationEnabled();
    locationPreference.addEventListener('change', () => {
      try {
        localStorage.setItem('urbaneye_location_enabled', String(locationPreference.checked));
        if (!locationPreference.checked) {
          window.urbaneyeLat = null;
          window.urbaneyeLng = null;
        }
        toast(locationPreference.checked ? 'Uso da localização ativado.' : 'Uso da localização desativado.');
      } catch (error) {
        locationPreference.checked = isLocationEnabled();
        console.error('Não foi possível salvar a preferência de localização:', error);
        toast('Não foi possível salvar essa preferência neste navegador.');
      }
    });
  }

  if (!notificationPreference) return;
  if (!window.UrbanAuth?.isAuthenticated?.()) {
    notificationPreference.checked = false;
    notificationPreference.disabled = true;
    if (notificationHelp) notificationHelp.textContent = 'Entre na sua conta para configurar alertas de atualização dos seus relatos.';
    return;
  }

  notificationPreference.disabled = true;
  if (notificationHelp) notificationHelp.textContent = 'Carregando preferência da conta...';
  let preferenceLoaded = false;
  try {
    notificationPreference.checked = await UrbanAPI.getNotificationPreference();
    preferenceLoaded = true;
    if (notificationHelp) notificationHelp.textContent = 'Alertas quando a situação dos seus relatos mudar.';
  } catch (error) {
    console.error('Não foi possível carregar a preferência de notificações:', error);
    if (notificationHelp) notificationHelp.textContent = 'Não foi possível carregar a preferência. Confira a migração de notificações do Supabase.';
  } finally {
    notificationPreference.disabled = !preferenceLoaded;
  }
  if (!preferenceLoaded) return;

  notificationPreference.addEventListener('change', async () => {
    const nextValue = notificationPreference.checked;
    notificationPreference.disabled = true;
    try {
      await UrbanAPI.setNotificationPreference(nextValue);
      toast(nextValue ? 'Alertas de atualização ativados.' : 'Alertas de atualização desativados.');
    } catch (error) {
      notificationPreference.checked = !nextValue;
      console.error('Não foi possível salvar a preferência de notificações:', error);
      toast(error?.message || 'Não foi possível salvar essa preferência.');
    } finally {
      notificationPreference.disabled = false;
    }
  });
}

async function renderNotifications() {
  const list = document.getElementById('notificationsList');
  const markReadButton = document.getElementById('markNotificationsRead');
  if (!list) return;

  if (!window.UrbanAuth?.isAuthenticated?.()) {
    list.textContent = 'Entre na sua conta para ver atualizações dos seus relatos.';
    if (markReadButton) markReadButton.hidden = true;
    return;
  }

  list.textContent = 'Carregando notificações...';
  if (markReadButton) {
    markReadButton.hidden = true;
    markReadButton.disabled = false;
  }

  try {
    const notifications = await UrbanAPI.getNotifications();
    const unreadCount = notifications.filter(notification => !notification.read_at).length;
    if (markReadButton) markReadButton.hidden = unreadCount === 0;
    if (!notifications.length) {
      list.textContent = 'Nenhum alerta de atualização ainda. Você receberá um quando a situação de um dos seus relatos mudar.';
      return;
    }

    list.replaceChildren();
    notifications.forEach(notification => {
      const item = document.createElement('article');
      item.className = 'listitem';
      item.setAttribute('aria-label', notification.read_at ? 'Notificação lida' : 'Notificação não lida');

      const content = document.createElement('div');
      content.style.flex = '1';
      const title = document.createElement('b');
      title.textContent = notification.title;
      const message = document.createElement('p');
      message.className = 'small muted';
      message.textContent = notification.message;
      content.append(title, message);

      if (notification.created_at) {
        const date = new Date(notification.created_at);
        if (Number.isFinite(date.getTime())) {
          const time = document.createElement('time');
          time.className = 'small muted';
          time.dateTime = date.toISOString();
          time.textContent = date.toLocaleString('pt-BR');
          content.appendChild(time);
        }
      }

      item.appendChild(content);
      list.appendChild(item);
    });
  } catch (error) {
    console.error('Não foi possível carregar as notificações:', error);
    list.textContent = 'Não foi possível carregar notificações. Confira se a migração database/supabase_notifications.sql foi executada no projeto Supabase.';
  }
}

async function markNotificationsRead() {
  const button = document.getElementById('markNotificationsRead');
  if (button) button.disabled = true;
  try {
    const count = await UrbanAPI.markNotificationsRead();
    await renderNotifications();
    toast(count ? 'Notificações marcadas como lidas.' : 'Não há notificações novas.');
  } catch (error) {
    console.error('Não foi possível marcar as notificações como lidas:', error);
    toast(error?.message || 'Não foi possível atualizar as notificações.');
    if (button) button.disabled = false;
  }
}

// Integrações externas: abrem os aplicativos/sites parceiros; não fazem login OAuth nem sincronizam dados privados.
function openPartner(app) {
  const lat = window.urbaneyeLat;
  const lng = window.urbaneyeLng;
  const hasLocation = isLocationEnabled() && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const coords = encodeURIComponent(hasLocation ? `${lat},${lng}` : '-22.7858,-43.3116');
  const urls = {
    waze: `https://www.waze.com/ul?ll=${coords}`,
    maps: `https://www.google.com/maps/search/?api=1&query=${coords}`,
    moovit: 'https://moovitapp.com/',
    uber: 'https://m.uber.com/'
  };
  if (urls[app]) window.open(urls[app], '_blank', 'noopener');
}
function useMyLocationForApps() {
  if (!isLocationEnabled()) { toast('Ative o uso da localização nas configurações primeiro.'); return; }
  if (!navigator.geolocation) { toast('Seu navegador não oferece localização.'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    window.urbaneyeLat = pos.coords.latitude; window.urbaneyeLng = pos.coords.longitude;
    const el = document.getElementById('integrationLocation');
    if (el) el.textContent = 'Localização pronta para abrir no Waze e Google Maps.';
    toast('Localização obtida!');
  }, () => toast('Não foi possível obter a localização. Verifique a permissão.'), { enableHighAccuracy: true, timeout: 10000 });
}
async function shareUrbanEye() {
  const data = { title: 'UrbanEye', text: 'Confira o UrbanEye: relatos e informações sobre mobilidade urbana.', url: location.href };
  try {
    if (navigator.share) await navigator.share(data);
    else if (navigator.clipboard) {
      await navigator.clipboard.writeText(data.text + ' ' + data.url);
      toast('Link copiado!');
    } else toast('Compartilhamento não disponível neste navegador.');
  } catch (error) {
    if (error.name !== 'AbortError') toast('Não foi possível compartilhar agora.');
  }
}


const APP_ROUTES = Object.freeze({
  home: 'index.html',
  map: 'map/map.html',
  detail: 'reports/detail.html',
  filters: 'map/filters.html',
  ranking: 'community/ranking.html',
  stats: 'community/stats.html',
  integrations: 'integrations/integrations.html',
  help: 'support/help.html',
  profile: 'account/profile.html',
  settings: 'account/settings.html',
  history: 'reports/history.html',
  notifications: 'account/notifications.html',
  report: 'reports/report.html',
  login: 'auth/login.html',
  register: 'auth/register.html',
  'admin-login': 'admin/admin-login.html',
  'admin-dashboard': 'admin/admin-dashboard.html'
});

function resolveAppRoute(target) {
  const pathname = window.location.pathname.toLowerCase();
  const isRootDocument = pathname.endsWith('/index.html') || !pathname.endsWith('.html');
  const appRoot = new URL(isRootDocument ? './' : '../', window.location.href);
  return new URL(target, appRoot).href;
}

function show(id) {
  const target = APP_ROUTES[id];
  if (!target) {
    console.error(`Rota UrbanEye desconhecida: ${id}`);
    return;
  }
  window.location.href = resolveAppRoute(target);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function toast(t) {
  let x = document.getElementById('toast');
  x.textContent = t;
  x.style.display = 'block';
  x.style.animation = 'fadeIn 0.2s';
  setTimeout(() => x.style.display = 'none', 2500);
}

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
  const savedUser = getStoredUser();
  const savedAccountBadge = document.getElementById('savedAccountBadge');
  const loginNotice = document.getElementById('loginNotice');

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

function hasSupabaseAuth() {
  return !!(window.supabaseClient && window.supabaseClient.auth && window.urbaneyeSupabaseEnabled);
}

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

function isInstitutionalProfile(profile) {
  if (!profile) return false;
  const role = String(profile.role || profile.account_type || profile.organization_role || '').trim().toLowerCase();
  if (!role) return false;
  return ['admin', 'administrador', 'institutional', 'institucional', 'municipal', 'prefeitura', 'ong', 'operator', 'operacional', 'staff'].includes(role);
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

let adminReports = [];

function showAdminView(view) {
  const views = ['dashboard', 'reports', 'map', 'team'];
  const selected = views.includes(view) ? view : 'dashboard';
  document.querySelectorAll('[data-admin-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.adminPanel !== selected;
  });
  document.querySelectorAll('[data-admin-view]').forEach((button) => {
    const active = button.dataset.adminView === selected;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const titles = { dashboard: 'Visão geral', reports: 'Gestão de relatos', map: 'Mapa operacional', team: 'Equipe' };
  const title = document.getElementById('adminPageTitle');
  if (title) title.textContent = titles[selected];
}

function scrollAdminNotifications() {
  showAdminView('dashboard');
  document.getElementById('adminNotifications')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeAdminReportDialog() {
  const dialog = document.getElementById('adminReportDialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function getAdminAssignee(reportId) {
  try {
    const assignments = JSON.parse(localStorage.getItem('urbaneye_admin_assignments') || '{}');
    return assignments[String(reportId)] || 'Não atribuído';
  } catch (error) {
    console.warn('Não foi possível ler as atribuições locais:', error);
    return 'Não atribuído';
  }
}

function setAdminAssignee(reportId, assignee) {
  try {
    const assignments = JSON.parse(localStorage.getItem('urbaneye_admin_assignments') || '{}');
    assignments[String(reportId)] = assignee;
    localStorage.setItem('urbaneye_admin_assignments', JSON.stringify(assignments));
    return true;
  } catch (error) {
    console.error('Não foi possível salvar a atribuição local:', error);
    toast('Não foi possível salvar a atribuição neste navegador.');
    return false;
  }
}

function exportAdminReports() {
  if (!adminReports.length) {
    toast('Não há relatos para exportar.');
    return;
  }
  const header = ['ID', 'Categoria', 'Descricao', 'Bairro', 'Municipio', 'Situacao', 'Responsavel'];
  const rows = adminReports.map((report) => [
    report.id, report.cat, report.desc, report.bairro, report.municipality || '',
    report.status, getAdminAssignee(report.id)
  ]);
  const csv = [header, ...rows].map((row) => row.map((value) => {
    const text = String(value ?? '');
    const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  }).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'urbaneye-relatos.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Relatório CSV exportado.');
}

function renderAdminCategories() {
  const select = document.getElementById('adminCategoryFilter');
  if (!select) return;
  const selected = select.value || 'Todos';
  const categories = [...new Set(adminReports.map((report) => report.cat).filter(Boolean))].sort();
  select.innerHTML = '<option value="Todos">Todas as categorias</option>' + categories.map((category) =>
    `<option value="${escapeHTML(category)}"${category === selected ? ' selected' : ''}>${escapeHTML(category)}</option>`
  ).join('');
}

function renderAdminOverview(openCount, analysisCount, resolvedCount) {
  const chart = document.getElementById('adminStatusChart');
  if (chart) {
    const values = [
      { label: 'Em aberto', value: openCount },
      { label: 'Em análise', value: analysisCount },
      { label: 'Resolvidos', value: resolvedCount }
    ];
    const max = Math.max(...values.map((item) => item.value), 1);
    chart.innerHTML = values.map((item) =>
      `<div class="admin-chart-column"><b>${item.value}</b><div class="admin-chart-bar" style="height:${Math.max(8, item.value / max * 125)}px"></div><span>${item.label}</span></div>`
    ).join('');
  }

  const recent = document.getElementById('adminRecentList');
  if (!recent) return;
  recent.innerHTML = adminReports.slice(0, 5).map((report) => `
    <button class="admin-recent-item" type="button" data-open-admin-report="${escapeHTML(report.id)}">
      <i class="admin-recent-dot"></i>
      <div><strong>${escapeHTML(report.cat)}</strong><span>${escapeHTML(getAdminReportLocation(report))}</span></div>
      <time>${escapeHTML(report.status)}</time>
    </button>
  `).join('') || '<p class="muted small">Nenhuma atividade recente.</p>';
  recent.querySelectorAll('[data-open-admin-report]').forEach((button) => {
    button.addEventListener('click', () => openAdminReportDialog(button.dataset.openAdminReport));
  });
}

function renderAdminPriority() {
  const list = document.getElementById('adminPriorityList');
  if (!list) return;
  const priority = adminReports.filter((report) => report.status !== 'Resolvido').slice(0, 4);
  list.innerHTML = priority.map((report) => `
    <article class="admin-report">
      <div class="admin-report-main">
        <div class="admin-report-head"><h2>${escapeHTML(report.cat)}</h2><span class="status ${report.status === 'Em análise' ? 'progress' : 'open'}">${escapeHTML(report.status)}</span></div>
        <div class="admin-report-meta">📍 ${escapeHTML(getAdminReportLocation(report))} · Responsável: ${escapeHTML(getAdminAssignee(report.id))}</div>
      </div>
      <button class="btn secondary" type="button" data-open-admin-report="${escapeHTML(report.id)}">Atender</button>
    </article>
  `).join('') || '<p class="admin-empty">Nenhum relato aguardando atendimento.</p>';
  list.querySelectorAll('[data-open-admin-report]').forEach((button) => {
    button.addEventListener('click', () => openAdminReportDialog(button.dataset.openAdminReport));
  });
}

function openAdminReportDialog(reportId) {
  const report = adminReports.find((item) => String(item.id) === String(reportId));
  const dialog = document.getElementById('adminReportDialog');
  const content = document.getElementById('adminDialogContent');
  if (!report || !dialog || !content) return;
  const assignees = ['Não atribuído', 'Equipe de manutenção', 'Equipe de iluminação', 'Equipe de limpeza', 'Defesa civil'];
  const currentAssignee = getAdminAssignee(report.id);
  const savedNotes = getAdminReportNotes(report.id);
  content.className = 'admin-dialog-content';
  content.innerHTML = `
    <span class="admin-kicker">RELATO #${escapeHTML(report.id)}</span>
    <h2>${escapeHTML(report.cat)}</h2>
    <p>${escapeHTML(report.desc)}</p>
    <div class="admin-dialog-meta">
      <span>📍 ${escapeHTML(getAdminReportLocation(report))}</span>
      <span>Status: ${escapeHTML(report.status)}</span>
      <span>Confirmações: ${Number(report.confirmation_count || 0)}</span>
    </div>
    ${report.photo ? `<img class="admin-report-photo" src="${escapeHTML(report.photo)}" alt="Foto enviada no relato">` : ''}
    ${savedNotes.length ? `
      <section class="admin-note-history" aria-label="Observações anteriores">
        <h3>Histórico de observações</h3>
        <ul>${savedNotes.slice().reverse().map((entry) => {
          const date = new Date(entry.createdAt);
          const formattedDate = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR');
          return `<li><time>${escapeHTML(formattedDate)}</time><p>${escapeHTML(entry.text)}</p></li>`;
        }).join('')}</ul>
      </section>
    ` : ''}
    <div class="admin-dialog-form">
      <select id="adminDialogStatus" aria-label="Atualizar situação">
        ${['Aberto', 'Em análise', 'Resolvido'].map((status) => `<option${report.status === status ? ' selected' : ''}>${status}</option>`).join('')}
      </select>
      <select id="adminDialogAssignee" aria-label="Atribuir equipe">
        ${assignees.map((name) => `<option${currentAssignee === name ? ' selected' : ''}>${name}</option>`).join('')}
      </select>
      <textarea id="adminDialogNote" maxlength="500" placeholder="Observação (opcional, até 500 caracteres)"></textarea>
      <button class="btn" id="adminDialogSave" type="button">Salvar atendimento</button>
    </div>
  `;
  document.getElementById('adminDialogSave')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const status = document.getElementById('adminDialogStatus').value;
    const assignee = document.getElementById('adminDialogAssignee').value;
    const note = document.getElementById('adminDialogNote').value.trim();
    const statusSaved = await saveAdminReportStatus(report.id, button, status);
    if (!statusSaved) return;
    if (!setAdminAssignee(report.id, assignee)) return;
    if (note && !saveAdminReportNote(report.id, note)) return;
    closeAdminReportDialog();
  });
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function getAdminReportNotes(reportId) {
  try {
    const notes = JSON.parse(localStorage.getItem('urbaneye_admin_notes') || '{}');
    return Array.isArray(notes[String(reportId)])
      ? notes[String(reportId)].filter((entry) => entry && typeof entry.text === 'string')
      : [];
  } catch (error) {
    console.warn('Não foi possível ler o histórico de observações:', error);
    return [];
  }
}

function saveAdminReportNote(reportId, note) {
  try {
    const notes = JSON.parse(localStorage.getItem('urbaneye_admin_notes') || '{}');
    const entries = Array.isArray(notes[String(reportId)]) ? notes[String(reportId)] : [];
    entries.push({ text: note, createdAt: new Date().toISOString() });
    notes[String(reportId)] = entries;
    localStorage.setItem('urbaneye_admin_notes', JSON.stringify(notes));
    return true;
  } catch (error) {
    console.error('Não foi possível salvar a observação local:', error);
    toast('Não foi possível salvar a observação neste navegador.');
    return false;
  }
}

async function initAdminDashboard() {
  if (!window.UrbanAuth?.isAuthenticated()) {
    window.location.replace(resolveAppRoute(APP_ROUTES['admin-login']));
    return;
  }

  const nameElement = document.querySelector('[data-admin-name]');
  const displayName = window.UrbanAuth.getDisplayName();
  if (nameElement) nameElement.textContent = displayName;

  const denied = document.getElementById('adminAccessDenied');
  const content = document.getElementById('adminDashboardContent');
  const retryAccess = document.getElementById('adminRetryAccess');
  if (retryAccess) retryAccess.hidden = true;

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
    const roleDecision = isInstitutionalProfile(profile);
    if (roleDecision === false) {
      if (denied) denied.hidden = false;
      if (content) content.hidden = true;
      return;
    }
  } catch (error) {
    console.error('Não foi possível validar o perfil institucional:', error);
    if (denied) {
      denied.hidden = false;
      const message = denied.querySelector('p');
      if (message) message.textContent = 'Não foi possível validar o acesso institucional. Confira a configuração do Supabase e tente novamente.';
    }
    if (retryAccess) retryAccess.hidden = false;
    if (content) content.hidden = true;
    return;
  }

  if (denied) denied.hidden = true;
  if (content) content.hidden = false;
  await loadAdminReports();

  document.getElementById('adminSearch')?.addEventListener('input', renderAdminReports);
  document.getElementById('adminStatusFilter')?.addEventListener('change', renderAdminReports);
  document.getElementById('adminCategoryFilter')?.addEventListener('change', renderAdminReports);
  document.querySelectorAll('[data-admin-view]').forEach((button) => {
    button.addEventListener('click', () => showAdminView(button.dataset.adminView));
  });
  showAdminView('dashboard');
}

async function loadAdminReports() {
  const list = document.getElementById('adminReportsList');
  const notice = document.getElementById('adminLoadNotice');
  const refreshButton = document.querySelector('.admin-refresh');
  if (list) list.innerHTML = '<p class="admin-empty">Carregando relatos e localizações...</p>';
  if (notice) {
    notice.hidden = false;
    notice.textContent = 'Atualizando relatos...';
  }
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.classList.add('is-loading');
  }

  try {
    const reports = await UrbanAPI.getProblems();
    adminReports = await Promise.all((reports || []).map(async (report) => {
      const mapped = {
        ...report,
        cat: report.cat || report.category || 'Outro',
        desc: report.desc || report.description || 'Sem descrição',
        status: window.normalizeProblemStatus ? normalizeProblemStatus(report.status) : report.status,
        bairro: report.bairro || report.neighborhood || null,
        municipality: report.municipality || null
      };

      const lat = Number(mapped.lat);
      const lng = Number(mapped.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const location = await identifyLocation(lat, lng);
        mapped.bairro = mapped.bairro || location.bairro;
        mapped.municipality = mapped.municipality || location.municipality;
      }

      if (!mapped.bairro) mapped.bairro = 'Local não informado';
      return mapped;
    }));
    renderAdminReports();
    if (notice) notice.hidden = true;
  } catch (error) {
    console.error('Erro ao carregar painel administrativo:', error);
    if (list) list.innerHTML = '<p class="admin-empty">Não foi possível carregar os relatos.</p>';
    if (notice) {
      notice.hidden = false;
      notice.textContent = 'Não foi possível carregar os relatos. Verifique a conexão e tente atualizar novamente.';
    }
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.classList.remove('is-loading');
    }
  }
}

function getAdminReportLocation(report) {
  const bairro = report.bairro && report.bairro !== 'Local não informado' ? report.bairro : null;
  const municipio = report.municipality || null;
  return [bairro, municipio].filter(Boolean).join(' · ') || 'Local não informado';
}

function renderAdminReports() {
  const list = document.getElementById('adminReportsList');
  if (!list) return;

  renderAdminCategories();
  const search = String(document.getElementById('adminSearch')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('adminStatusFilter')?.value || 'Todos';
  const categoryFilter = document.getElementById('adminCategoryFilter')?.value || 'Todos';
  const filtered = adminReports.filter((report) => {
    const location = getAdminReportLocation(report);
    const haystack = `${report.cat} ${location} ${report.bairro || ''} ${report.desc}`.toLowerCase();
    return (!search || haystack.includes(search))
      && (statusFilter === 'Todos' || report.status === statusFilter)
      && (categoryFilter === 'Todos' || report.cat === categoryFilter);
  });

  const counts = (status) => adminReports.filter((report) => report.status === status).length;
  const openCount = counts('Aberto');
  const analysisCount = counts('Em análise');
  const resolvedCount = counts('Resolvido');
  document.getElementById('adminTotal').textContent = String(adminReports.length);
  document.getElementById('adminOpen').textContent = String(openCount);
  document.getElementById('adminAnalysis').textContent = String(analysisCount);
  document.getElementById('adminResolved').textContent = String(resolvedCount);
  document.getElementById('adminNavCount').textContent = String(adminReports.length);
  const alertCount = document.getElementById('adminAlertCount');
  alertCount.textContent = String(openCount);
  alertCount.hidden = openCount === 0;
  document.getElementById('adminResolutionRate').textContent = `${adminReports.length ? Math.round(resolvedCount / adminReports.length * 100) : 0}% concluído`;
  renderAdminOverview(openCount, analysisCount, resolvedCount);
  renderAdminPriority();

  if (!filtered.length) {
    list.innerHTML = '<p class="admin-empty">Nenhum relato encontrado para os filtros selecionados.</p>';
    return;
  }

  list.innerHTML = filtered.map((report) => `
    <article class="admin-report">
      <div class="admin-report-main">
        <div class="admin-report-head">
          <button class="admin-report-open" type="button" data-open-admin-report="${escapeHTML(report.id)}"><h2>${escapeHTML(report.cat)}</h2></button>
          <span class="status ${report.status === 'Resolvido' ? 'resolved' : report.status === 'Em análise' ? 'progress' : 'open'}">${escapeHTML(report.status)}</span>
        </div>
        <p class="admin-report-description">${escapeHTML(report.desc)}</p>
        <div class="admin-report-meta">📍 ${escapeHTML(getAdminReportLocation(report))} · #${escapeHTML(report.id)}</div>
      </div>
      <div class="admin-report-actions">
        <select class="admin-assignee" aria-label="Equipe responsável" data-admin-assignee="${escapeHTML(report.id)}">
          ${['Não atribuído', 'Equipe de manutenção', 'Equipe de iluminação', 'Equipe de limpeza', 'Defesa civil'].map((name) =>
            `<option${getAdminAssignee(report.id) === name ? ' selected' : ''}>${name}</option>`
          ).join('')}
        </select>
        <select class="admin-report-status ${report.status === 'Resolvido' ? 'admin-status-resolved' : report.status === 'Em análise' ? 'admin-status-progress' : 'admin-status-open'}" aria-label="Situação de ${escapeHTML(report.cat)}" data-admin-status="${escapeHTML(report.id)}">
          <option value="Aberto"${report.status === 'Aberto' ? ' selected' : ''}>Aberto</option>
          <option value="Em análise"${report.status === 'Em análise' ? ' selected' : ''}>Em análise</option>
          <option value="Resolvido"${report.status === 'Resolvido' ? ' selected' : ''}>Resolvido</option>
        </select>
        <button class="btn secondary" type="button" data-save-admin-status="${escapeHTML(report.id)}">Salvar</button>
      </div>
    </article>
  `).join('');

  list.querySelectorAll('[data-open-admin-report]').forEach((button) => {
    button.addEventListener('click', () => openAdminReportDialog(button.dataset.openAdminReport));
  });
  list.querySelectorAll('[data-save-admin-status]').forEach((button) => {
    button.addEventListener('click', () => {
      const assignee = button.parentElement.querySelector('[data-admin-assignee]');
      if (assignee && !setAdminAssignee(button.dataset.saveAdminStatus, assignee.value)) return;
      saveAdminReportStatus(button.dataset.saveAdminStatus, button);
    });
  });
  list.querySelectorAll('[data-admin-status]').forEach((select) => {
    select.addEventListener('change', () => {
      select.classList.remove('admin-status-open', 'admin-status-progress', 'admin-status-resolved');
      if (select.value === 'Resolvido') select.classList.add('admin-status-resolved');
      else if (select.value === 'Em análise') select.classList.add('admin-status-progress');
      else select.classList.add('admin-status-open');
    });
  });
}

async function logout() {
  if (window.UrbanAuth) {
    await window.UrbanAuth.logout();
  }
}

async function renderProfileHeader() {
  const data = await UrbanAPI.getProfileData();

  const name = document.getElementById('profileName');
  if (name) name.textContent = data.name;
  const nameInput = document.getElementById('profileNameInput');
  if (nameInput) nameInput.value = data.name === 'Visitante' ? '' : data.name;

  const memberSince = document.getElementById('profileMemberSince');
  if (memberSince) memberSince.textContent = data.memberSince;

  const avatar = document.querySelector('.profile-avatar') || document.querySelector('.avatar');
  if (avatar) {
    avatar.replaceChildren();
    if (data.avatarUrl) {
      const image = document.createElement('img');
      image.src = data.avatarUrl;
      image.alt = `Foto de perfil de ${data.name}`;
      avatar.appendChild(image);
    } else {
      avatar.textContent = (data.name || 'V').trim().charAt(0).toUpperCase();
    }
  }

  const fields = [
    ['profileReports', data.reports],
    ['profileResolved', data.resolved],
    ['profileConfirmations', data.confirmations],
    ['profilePoints', data.points]
  ];

  fields.forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });
}

function previewProfileAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    input.value = '';
    toast('Escolha uma imagem JPG, PNG ou WebP de até 5 MB.');
    return;
  }

  const avatar = document.getElementById('profileAvatar');
  if (!avatar) return;
  if (profileAvatarPreviewUrl) URL.revokeObjectURL(profileAvatarPreviewUrl);
  profileAvatarPreviewUrl = URL.createObjectURL(file);
  const image = document.createElement('img');
  image.src = profileAvatarPreviewUrl;
  image.alt = 'Prévia da foto de perfil';
  avatar.replaceChildren(image);
}

async function saveProfile() {
  const nameInput = document.getElementById('profileNameInput');
  const photoInput = document.getElementById('profileAvatarInput');
  const button = document.getElementById('saveProfileButton');
  const fullName = nameInput ? nameInput.value.trim() : '';
  const avatarFile = photoInput?.files?.[0] || null;

  if (!fullName) {
    toast('Informe seu nome.');
    nameInput?.focus();
    return;
  }

  if (fullName.length > 80) {
    toast('O nome deve ter no máximo 80 caracteres.');
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Salvando...';
  }

  try {
    await UrbanAPI.updateProfile({ fullName, avatarFile });
    if (profileAvatarPreviewUrl) {
      URL.revokeObjectURL(profileAvatarPreviewUrl);
      profileAvatarPreviewUrl = null;
    }
    if (photoInput) photoInput.value = '';
    await renderProfileHeader();
    const editor = document.getElementById('profileEditor');
    const editButton = document.getElementById('editProfileButton');
    if (editor) editor.hidden = true;
    if (editButton) editButton.hidden = false;
    toast('Perfil atualizado com sucesso!');
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    toast(error?.message || 'Não foi possível atualizar o perfil.');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Salvar perfil';
    }
  }
}

function addInstitutionalAccessLinks() {
  const desktopLinks = document.querySelector('.desktop-links');
  if (desktopLinks && !desktopLinks.querySelector('.institutional-link')) {
    const link = document.createElement('a');
    link.className = 'institutional-link';
    link.href = resolveAppRoute(APP_ROUTES['admin-login']);
    link.textContent = 'Área institucional';
    desktopLinks.insertBefore(link, desktopLinks.querySelector('.btn-report'));
  }

  const top = document.querySelector('.top');
  if (top && !document.querySelector('.top-institutional-link')) {
    const accessRow = document.createElement('div');
    accessRow.className = 'institutional-access-mobile';
    const link = document.createElement('a');
    link.className = 'institutional-link top-institutional-link';
    link.href = resolveAppRoute(APP_ROUTES['admin-login']);
    link.textContent = 'Área institucional';
    accessRow.appendChild(link);
    top.insertAdjacentElement('afterend', accessRow);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  addInstitutionalAccessLinks();

  if (window.UrbanAuth) {
    await window.UrbanAuth.ready;
    if (window.UrbanAuth.getState().redirecting) return;
  }

  // Route Controllers
  if (document.getElementById('homeCount')) loadHome();
  if (document.getElementById('reportMap')) initReportPage();
  if (document.getElementById('realMap')) initMapPage();
  if (document.getElementById('historyBox')) renderHistory('historyBox');
  if (document.getElementById('profileHistoryBox')) renderHistory('profileHistoryBox', 3);
  if (document.getElementById('profileName')) renderProfileHeader();
  if (document.getElementById('statsGrid')) renderStats();
  if (document.getElementById('detailCat')) populateDetail();
  if (document.getElementById('locationPreference')) initSettings();
  if (document.getElementById('notificationsList')) renderNotifications();
  if (document.getElementById('btnLogin')) initLoginPage();
  if (document.getElementById('adminEmail')) redirectActiveInstitutionalSession();
  if (document.getElementById('neighborhoodRanking')) {
    window.UrbanRanking?.init();
  }
  if (document.getElementById('adminDashboardContent')) initAdminDashboard();
});


async function loadHome() {
  const problems = await UrbanAPI.getProblems();
  document.getElementById('homeCount').textContent = problems.length;
}

async function initMapPage() {

  // Limites aproximados do estado do Rio de Janeiro
  const rioBounds = L.latLngBounds(
    [-23.40, -44.90], // Sudoeste
    [-20.75, -40.95]  // Nordeste
  );

  // Inicialização do mapa
  map = L.map('realMap', {
    center: [-22.7858, -43.3116],
    zoom: 9,
    minZoom: 8,
    maxZoom: 18,
    maxBounds: rioBounds,
    maxBoundsViscosity: 1.0,
    noWrap: true,
    worldCopyJump: false,
    zoomSnap: 0.25,
    inertia: false
  });

  map.setMaxBounds(rioBounds);
  map.setView([-22.7858, -43.3116], 9);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  applyFilterStateToInputs(getFilterState());

  const problems = await UrbanAPI.getProblems();

  document.getElementById('loadingMap').style.display = 'none';

  renderMapData(filterProblems(problems, getFilterState()));
}

function renderMapData(problems) {
  if (!map) return;

  map.eachLayer(layer => {
    const isProblemMarker = layer && layer.options && layer.options.icon && layer.options.icon.options && layer.options.icon.options.className === 'custom-marker';
    if (isProblemMarker) map.removeLayer(layer);
  });

  const groups = new Map();
  problems.forEach(problem => {
    const lat = Number(problem.lat);
    const lng = Number(problem.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (!groups.has(key)) groups.set(key, { lat, lng, problems: [] });
    groups.get(key).problems.push(problem);
  });

  groups.forEach(group => {
    const groupProblems = group.problems;
    const count = groupProblems.length;
    const first = groupProblems[0];
    const markerColor = window.normalizeProblemColor
      ? window.normalizeProblemColor(first.color)
      : '#1769e0';
    const badge = count > 1
      ? `<div style="position:absolute;right:-7px;top:-7px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#202638;color:white;border:2px solid white;font-size:11px;font-weight:800;line-height:14px;text-align:center">${count}</div>`
      : '';

    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="position:relative;width:24px;height:24px;border-radius:50%;background:${markerColor};border:3px solid white;box-shadow:0 3px 8px rgba(0,0,0,0.5)">${badge}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const popupContent = count === 1
      ? `<b>${escapeHTML(first.cat)}</b><br>${escapeHTML(first.desc)}<br><span style="font-size:12px;color:gray">${escapeHTML(first.status)}</span><br>
         <button onclick="openProblem(this.dataset.problemId)" data-problem-id="${escapeHTML(String(first.id))}" style="margin-top:8px;width:100%;padding:8px;border-radius:8px;background:var(--primary);color:white;border:0;cursor:pointer">Ver detalhes</button>`
      : `<b>${count} problemas nesta localização</b>
         <div style="max-height:260px;overflow-y:auto;margin-top:8px">
           ${groupProblems.map((problem, index) => `
             <div style="border-top:${index ? '1px solid #ddd' : 'none'};padding:8px 0">
               <b>${escapeHTML(problem.cat)}</b><br>
               <span style="display:block;font-size:12px;margin:3px 0">${escapeHTML(problem.desc)}</span>
               <span style="font-size:12px;color:gray">${escapeHTML(problem.status)}</span><br>
               <button onclick="openProblem(this.dataset.problemId)" data-problem-id="${escapeHTML(String(problem.id))}" style="margin-top:6px;width:100%;padding:7px;border-radius:8px;background:var(--primary);color:white;border:0;cursor:pointer">Ver detalhes</button>
             </div>`).join('')}
         </div>`;

    L.marker([group.lat, group.lng], { icon })
      .addTo(map)
      .bindPopup(popupContent, { maxWidth: 320 });
  });
  document.getElementById('mapCount').textContent = problems.length + ' problemas recuperados';
}

function openProblem(id) {
  localStorage.setItem('urbaneye_current_problem', id);
  show('detail');
}

async function identifyLocation(lat, lng) {
  const cacheKey = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  if (municipalityCache.has(cacheKey)) {
    const cached = municipalityCache.get(cacheKey);
    return typeof cached === 'object'
      ? cached
      : { bairro: null, municipality: cached || null, label: cached || null };
  }
  if (municipalityRequests.has(cacheKey)) return municipalityRequests.get(cacheKey);

  const stored = readStoredLocation(cacheKey);
  if (stored) {
    municipalityCache.set(cacheKey, stored);
    return stored;
  }

  const request = municipalityRequestQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastGeocodeRequestAt = Date.now();

    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lng),
        zoom: '18',
        addressdetails: '1',
        'accept-language': 'pt-BR'
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
      if (!response.ok) throw new Error(`Geocodificação retornou HTTP ${response.status}`);

      const result = await response.json();
      const address = result.address || {};
      const city = address.city || address.town || address.village || address.municipality || address.county;
      const state = address.state;
      const bairro = address.neighbourhood || address.suburb || address.quarter || address.residential || address.city_district || null;
      const municipality = city ? [city, state].filter(Boolean).join(', ') : null;
      const location = {
        bairro,
        municipality,
        label: [bairro, municipality].filter(Boolean).join(' · ') || null
      };

      municipalityCache.set(cacheKey, location);
      storeLocation(cacheKey, location);
      return location;
    } catch (error) {
      console.warn('Não foi possível identificar bairro e município pelas coordenadas:', error);
      const fallback = { bairro: null, municipality: null, label: null };
      municipalityCache.set(cacheKey, fallback);
      storeLocation(cacheKey, fallback);
      return fallback;
    } finally {
      municipalityRequests.delete(cacheKey);
    }
  });

  municipalityRequestQueue = request.then(() => undefined, () => undefined);
  municipalityRequests.set(cacheKey, request);
  return request;
}

async function identifyMunicipality(lat, lng) {
  const location = await identifyLocation(lat, lng);
  return location.municipality;
}

function updateReportMunicipality(lat, lng) {
  const sequence = ++reportGeocodeSequence;
  const label = document.getElementById('reportLocationName');
  if (!label) return;

  if (reportGeocodeTimer) clearTimeout(reportGeocodeTimer);
  label.textContent = 'Identificando bairro e município...';
  reportGeocodeTimer = setTimeout(async () => {
    const location = await identifyLocation(lat, lng);
    if (sequence !== reportGeocodeSequence) return;
    label.textContent = location.label
      ? `${location.label} · Dados © OpenStreetMap`
      : 'Bairro e município não identificados · Dados © OpenStreetMap';
  }, 500);
}

function updateProblemStatusDisplay(status) {
  const stages = ['Aberto', 'Em análise', 'Resolvido'];
  const currentStage = Math.max(0, stages.indexOf(status));
  const badge = document.getElementById('detailStatus');
  if (badge) {
    badge.textContent = status;
    badge.className = `status ${status === 'Resolvido' ? 'resolved' : status === 'Em análise' ? 'progress' : 'open'}`;
  }

  const progress = document.getElementById('detailProgress');
  const progressBar = document.getElementById('detailProgressBar');
  if (progress) {
    progress.setAttribute('aria-valuenow', String(currentStage + 1));
    progress.setAttribute('aria-valuetext', `${status}, etapa ${currentStage + 1} de 3`);
  }
  if (progressBar) progressBar.style.width = `${((currentStage + 1) / stages.length) * 100}%`;

  document.querySelectorAll('[data-status-step]').forEach((step, index) => {
    step.classList.toggle('is-complete', index < currentStage);
    step.classList.toggle('is-current', index === currentStage);
  });
}

async function populateDetail() {
  const id = localStorage.getItem('urbaneye_current_problem');
  const shouldOpenEditor = localStorage.getItem('urbaneye_edit_problem_on_open') === 'true';
  localStorage.removeItem('urbaneye_edit_problem_on_open');
  const p = id ? await UrbanAPI.getProblemById(id) : null;
  if (!p) {
    const category = document.getElementById('detailCat');
    const locationLabel = document.getElementById('detailLoc');
    const description = document.getElementById('detailDesc');
    const photo = document.getElementById('detailPhoto');
    if (category) category.textContent = 'Relato não encontrado';
    if (locationLabel) locationLabel.textContent = '';
    if (description) description.textContent = 'Este relato não está mais disponível. Volte ao mapa para ver os relatos atuais.';
    if (photo) photo.textContent = 'Relato indisponível';
    ['detailEditCard', 'detailEditor', 'detailStatusEditor', 'detailDeleteCard'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.hidden = true;
    });
    const progressCard = document.getElementById('detailProgress')?.closest('.card');
    const confirmationCard = document.getElementById('detailConfirmButton')?.closest('.card');
    if (progressCard) progressCard.hidden = true;
    if (confirmationCard) confirmationCard.hidden = true;
    return;
  }
  currentDetailProblem = p;
  document.getElementById('detailCat').textContent = p.cat;
  updateProblemStatusDisplay(p.status);
  const statusEditor = document.getElementById('detailStatusEditor');
  const currentUser = window.UrbanAuth?.getUser?.();
  const isReportOwner = !!(currentUser?.id && p.user_id && String(currentUser.id) === String(p.user_id));
  const editCard = document.getElementById('detailEditCard');
  const canEdit = p.is_guest || isReportOwner;
  if (editCard) editCard.hidden = !canEdit;
  const editCategory = document.getElementById('editProblemCategory');
  if (editCategory) editCategory.value = p.cat;
  const editDescription = document.getElementById('editProblemDescription');
  if (editDescription) editDescription.value = p.desc;
  const editor = document.getElementById('detailEditor');
  if (editor) editor.hidden = true;
  if (shouldOpenEditor && canEdit) openProblemEditor();
  if (statusEditor) statusEditor.hidden = !isReportOwner;
  const deleteCard = document.getElementById('detailDeleteCard');
  if (deleteCard) deleteCard.hidden = !(p.is_guest || isReportOwner);
  const statusSelect = document.getElementById('detailStatusSelect');
  if (statusSelect) statusSelect.value = p.status;
  document.getElementById('detailDesc').textContent = p.desc;
  const locationInfo = await identifyLocation(p.lat, p.lng);
  const municipality = p.municipality || locationInfo.municipality;
  const bairro = p.bairro || locationInfo.bairro;
  const detailLocation = document.getElementById('detailLoc');
  if (detailLocation) {
    const locationLabel = [bairro, municipality].filter(Boolean).join(' · ');
    detailLocation.textContent = locationLabel
      ? `📍 ${locationLabel} · Dados © OpenStreetMap`
      : `📍 ${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)} · Dados © OpenStreetMap`;
  }
  const coordinates = document.getElementById('detailCoordinates');
  const hasCoordinates = p.lat !== null && p.lat !== undefined && p.lng !== null && p.lng !== undefined
    && String(p.lat).trim() !== '' && String(p.lng).trim() !== ''
    && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
  if (coordinates) {
    coordinates.textContent = hasCoordinates
      ? `Coordenadas: ${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}`
      : '';
  }
  const wazeButton = document.getElementById('detailWazeButton');
  if (wazeButton) wazeButton.hidden = !hasCoordinates;
  const photoBox = document.getElementById('detailPhoto');
  if (photoBox) {
    if (p.photo) {
      photoBox.innerHTML = '';
      const img = document.createElement('img');
      img.src = p.photo;
      img.alt = 'Foto do problema relatado';
      img.style.cssText = 'width:100%;height:100%;max-height:320px;object-fit:contain;border-radius:14px';
      photoBox.appendChild(img);
    } else {
      photoBox.textContent = 'Foto do problema';
    }
  }
  const count = await UrbanAPI.getProblemConfirmationCount(id);
  document.getElementById('detailConfirmCount').textContent = String(count);

  const alreadyConfirmed = await UrbanAPI.hasConfirmedProblem(id);
  const confirmButton = document.getElementById('detailConfirmButton');
  if (confirmButton) {
    confirmButton.disabled = alreadyConfirmed;
    confirmButton.textContent = alreadyConfirmed ? '✓ Problema confirmado' : '✓ Confirmar problema';
  }
}

function openProblemInWaze() {
  const rawLat = currentDetailProblem?.lat;
  const rawLng = currentDetailProblem?.lng;
  if (rawLat === null || rawLat === undefined || rawLng === null || rawLng === undefined
      || String(rawLat).trim() === '' || String(rawLng).trim() === '') {
    toast('As coordenadas deste relato não estão disponíveis.');
    return;
  }
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    toast('As coordenadas deste relato não estão disponíveis.');
    return;
  }

  const url = new URL('https://waze.com/ul');
  url.searchParams.set('ll', `${lat},${lng}`);
  url.searchParams.set('navigate', 'yes');
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

function openProblemEditor() {
  const editCard = document.getElementById('detailEditCard');
  const editor = document.getElementById('detailEditor');
  if (editCard) editCard.hidden = true;
  if (editor) editor.hidden = false;
}

function cancelProblemEditor() {
  const editCard = document.getElementById('detailEditCard');
  const editor = document.getElementById('detailEditor');
  if (editor) editor.hidden = true;
  if (editCard) editCard.hidden = false;
}

async function saveProblemDetails() {
  const reportId = localStorage.getItem('urbaneye_current_problem');
  const categoryInput = document.getElementById('editProblemCategory');
  const descriptionInput = document.getElementById('editProblemDescription');
  const button = document.getElementById('saveProblemDetailsButton');
  const description = descriptionInput?.value.trim() || '';
  if (!reportId || !categoryInput || !description) {
    toast('Informe a descrição do relato.');
    descriptionInput?.focus();
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Salvando...';
  }

  try {
    const updated = await UrbanAPI.updateProblemDetails(reportId, {
      category: categoryInput.value,
      description
    });
    document.getElementById('detailCat').textContent = updated.cat;
    document.getElementById('detailDesc').textContent = updated.desc;
    cancelProblemEditor();
    toast('Detalhes do relato atualizados.');
  } catch (error) {
    console.error('Erro ao editar relato:', error);
    toast(error?.message || 'Não foi possível salvar as alterações.');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Salvar alterações';
    }
  }
}

async function saveProblemStatus() {
  const id = localStorage.getItem('urbaneye_current_problem');
  const select = document.getElementById('detailStatusSelect');
  const button = document.getElementById('saveDetailStatusButton');
  if (!id || !select) return;

  if (button) {
    button.disabled = true;
    button.textContent = 'Salvando...';
  }

  try {
    const status = await UrbanAPI.updateProblemStatus(id, select.value);
    updateProblemStatusDisplay(status);
    toast('Situação atualizada e salva.');
  } catch (error) {
    console.error('Erro ao atualizar situação do relato:', error);
    toast(error?.message || 'Não foi possível atualizar a situação.');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Salvar situação';
    }
  }
}

async function confirmProblemDetail() {
  const id = localStorage.getItem('urbaneye_current_problem');
  if (!id) return;

  const result = await UrbanAPI.confirmProblem(id);
  if (!result) return;

  document.getElementById('detailConfirmCount').textContent = String(result.count);
  const confirmButton = document.getElementById('detailConfirmButton');
  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = '✓ Problema confirmado';
  }
  toast(result.alreadyConfirmed ? 'Você já confirmou este problema.' : 'Problema confirmado!');
}


function setReportLocation(lat, lng, shouldCenter = false) {
  const locInput = document.getElementById('reportLocation');
  if (locInput) locInput.value = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  updateReportMunicipality(lat, lng);

  if (reportMap) {
    if (!reportMarker) {
      reportMarker = L.marker([lat, lng], { draggable: true }).addTo(reportMap);
      reportMarker.bindPopup('Ponto do problema');
      reportMarker.on('dragend', () => {
        const pos = reportMarker.getLatLng();
        setReportLocation(pos.lat, pos.lng);
      });
    } else {
      reportMarker.setLatLng([lat, lng]);
    }

    reportMarker.openPopup();
    if (shouldCenter) reportMap.setView([lat, lng], Math.max(reportMap.getZoom(), 14));
  }
}

function initReportPage() {
  const rioBounds = L.latLngBounds(
    [-23.40, -44.90],
    [-20.75, -40.95]
  );

  reportMap = L.map('reportMap', {
    center: [-22.7858, -43.3116],
    zoom: 10,
    minZoom: 8,
    maxZoom: 18,
    maxBounds: rioBounds,
    maxBoundsViscosity: 1.0,
    noWrap: true,
    zoomSnap: 0.25,
    inertia: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(reportMap);

  reportMap.setMaxBounds(rioBounds);

  reportMap.on('click', event => {
    const { lat, lng } = event.latlng;
    setReportLocation(lat, lng, true);
  });

  setReportLocation(-22.7858, -43.3116);
}

function locateUserForReport() {
  if (!isLocationEnabled()) {
    toast('Ative o uso da localização nas configurações ou marque o ponto manualmente no mapa.');
    return;
  }
  if (!navigator.geolocation) {
    toast('Seu navegador não oferece localização.');
    return;
  }

  toast('Obtendo sua localização...');

  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude, longitude } = pos.coords;
    const rioBounds = L.latLngBounds(
      [-23.40, -44.90],
      [-20.75, -40.95]
    );

    if (!rioBounds.contains([latitude, longitude])) {
      toast('Sua localização está fora do Rio de Janeiro.');
      return;
    }

    if (reportMap) {
      reportMap.setView([latitude, longitude], 15);
    }

    setReportLocation(latitude, longitude, false);
    toast('Ponto do problema definido com sua localização!');
  }, () => {
    toast('Não foi possível obter sua localização. Clique no mapa para marcar o ponto.');
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function locateUser() {
  if (!isLocationEnabled()) {
    toast('Ative o uso da localização nas configurações primeiro.');
    return;
  }
  if (!navigator.geolocation) {
    toast('Seu navegador não oferece localização.');
    return;
  }

  toast('Obtendo coordenada no GPS...');

  navigator.geolocation.getCurrentPosition(pos => {

    const { latitude, longitude } = pos.coords;

    // Limites aproximados do estado do Rio de Janeiro
    const rioBounds = L.latLngBounds(
      [-23.40, -44.90],
      [-20.75, -40.95]
    );

    // Verifica se o usuário está dentro do RJ
    if (!rioBounds.contains([latitude, longitude])) {
      toast('Sua localização está fora do estado do Rio de Janeiro.');
      return;
    }

    // Centraliza o mapa na localização do usuário
    map.setView([latitude, longitude], 16);

    // Remove marcador anterior
    if (userMarker) userMarker.remove();

    // Adiciona novo marcador
    userMarker = L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup('📍 Você está aqui')
      .openPopup();

    // Preenche localização no formulário de denúncia
    const locInput = document.getElementById('reportLocation');

    if (locInput) {
      locInput.value = `📍 ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }

    toast('Localização encontrada com sucesso!');

  }, () => {
    toast('Não foi possível obter sua localização.');
  });
}


let cameraStream = null;
let cameraFacing = 'environment';
let capturedPhoto = null;

async function startCamera() {
  const video = document.getElementById('cameraPreview');
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Câmera indisponível. Use HTTPS ou escolha um arquivo.');
    document.getElementById('reportPhoto')?.click();
    return;
  }
  stopCamera();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: cameraFacing }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = cameraStream;
    video.style.display = 'block';
    document.getElementById('cameraPlaceholder').style.display = 'none';
    document.getElementById('photoPreview').style.display = 'none';
    document.getElementById('captureButton').disabled = false;
    document.getElementById('switchCameraButton').disabled = false;
    toast('Câmera ativada!');
  } catch (error) {
    console.error('Erro ao abrir câmera:', error);
    toast('Não foi possível abrir a câmera. Confira a permissão ou escolha um arquivo.');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  const video = document.getElementById('cameraPreview');
  if (video) {
    video.pause();
    video.srcObject = null;
    video.style.display = 'none';
  }
  const captureButton = document.getElementById('captureButton');
  const switchButton = document.getElementById('switchCameraButton');
  if (captureButton) captureButton.disabled = true;
  if (switchButton) switchButton.disabled = true;
}

async function switchCamera() {
  cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
  await startCamera();
}

function capturePhoto() {
  const video = document.getElementById('cameraPreview');
  if (!cameraStream || !video.videoWidth) {
    toast('Aguarde a imagem da câmera carregar.');
    return;
  }
  const canvas = document.getElementById('photoCanvas');
  const scale = Math.min(1, 1280 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  capturedPhoto = canvas.toDataURL('image/jpeg', 0.78);
  showPhotoPreview(capturedPhoto);
  stopCamera();
}

function showPhotoPreview(dataUrl) {
  const img = document.getElementById('photoPreview');
  img.src = dataUrl;
  img.style.display = 'block';
  document.getElementById('cameraPlaceholder').style.display = 'none';
  document.getElementById('retakeButton').style.display = 'inline-flex';
}

function retakePhoto() {
  capturedPhoto = null;
  document.getElementById('reportPhoto').value = '';
  document.getElementById('photoPreview').style.display = 'none';
  document.getElementById('retakeButton').style.display = 'none';
  document.getElementById('cameraPlaceholder').style.display = 'flex';
  startCamera();
}

function getExifOrientation(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = event => {
      const view = new DataView(event.target.result);
      if (view.byteLength < 2 || view.getUint16(0, false) !== 0xFFD8) return resolve(1);

      let offset = 2;
      while (offset + 4 <= view.byteLength) {
        const marker = view.getUint16(offset, false);
        offset += 2;

        if (marker === 0xFFE1) {
          const segmentLength = view.getUint16(offset, false);
          const exifHeader = offset + 2;
          if (view.getUint32(exifHeader, false) !== 0x45786966) return resolve(1);

          const tiffOffset = exifHeader + 6;
          if (tiffOffset + 8 > view.byteLength) return resolve(1);
          const littleEndian = view.getUint16(tiffOffset, false) === 0x4949;
          const ifdOffset = view.getUint32(tiffOffset + 4, littleEndian);
          const entriesOffset = tiffOffset + ifdOffset;
          if (entriesOffset + 2 > view.byteLength) return resolve(1);

          const entries = view.getUint16(entriesOffset, littleEndian);
          for (let index = 0; index < entries; index++) {
            const entryOffset = entriesOffset + 2 + index * 12;
            if (entryOffset + 12 > view.byteLength) break;
            if (view.getUint16(entryOffset, littleEndian) === 0x0112) {
              return resolve(view.getUint16(entryOffset + 8, littleEndian));
            }
          }
          return resolve(1);
        }

        if (marker === 0xDA || marker === 0xD9) break;
        const segmentLength = view.getUint16(offset, false);
        if (segmentLength < 2) break;
        offset += segmentLength;
      }
      resolve(1);
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file);
  });
}

function drawImageWithOrientation(img, canvas, orientation) {
  const swapsDimensions = orientation >= 5 && orientation <= 8;
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  const scale = Math.min(1, 1280 / (swapsDimensions ? sourceHeight : sourceWidth));
  const scaledWidth = Math.round(sourceWidth * scale);
  const scaledHeight = Math.round(sourceHeight * scale);

  canvas.width = swapsDimensions ? scaledHeight : scaledWidth;
  canvas.height = swapsDimensions ? scaledWidth : scaledHeight;

  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);

  switch (orientation) {
    case 2:
      context.transform(-1, 0, 0, 1, canvas.width, 0);
      break;
    case 3:
      context.transform(-1, 0, 0, -1, canvas.width, canvas.height);
      break;
    case 4:
      context.transform(1, 0, 0, -1, 0, canvas.height);
      break;
    case 5:
      context.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.transform(0, 1, -1, 0, canvas.height, 0);
      break;
    case 7:
      context.transform(0, -1, -1, 0, canvas.width, canvas.height);
      break;
    case 8:
      context.transform(0, -1, 1, 0, 0, canvas.width);
      break;
  }

  context.drawImage(img, 0, 0, scaledWidth, scaledHeight);
}

function previewPhoto(input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  if (!file.type.startsWith('image/')) {
    toast('Selecione um arquivo de imagem.');
    return;
  }

  const reader = new FileReader();
  reader.onload = async e => {
    const img = new Image();
    img.onload = async () => {
      const orientation = await getExifOrientation(file);
      const canvas = document.getElementById('photoCanvas');
      drawImageWithOrientation(img, canvas, orientation);
      capturedPhoto = canvas.toDataURL('image/jpeg', 0.78);
      showPhotoPreview(capturedPhoto);
      stopCamera();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

window.addEventListener('pagehide', stopCamera);

async function sendReport() {
  const cat = document.getElementById('reportCategory').value;
  const desc = document.getElementById('reportDescription').value.trim();
  if (!desc) { toast('Descreva o problema antes de publicar.'); return }

  const isAuthenticated = !!(window.UrbanAuth && window.UrbanAuth.isAuthenticated());
  const btn = document.getElementById('btnSubmitReport');
  btn.textContent = isAuthenticated ? 'Enviando para API...' : 'Salvando localmente...';
  btn.disabled = true;

  try {
    if (isAuthenticated && hasSupabaseAuth()) {
      const { data: userData, error: userError } = await window.supabaseClient.auth.getUser();
      if (userError || !userData?.user) {
        throw new Error('Sessão do Supabase inválida. Faça login novamente.');
      }
    }

    let lat = -22.7858, lng = -43.3116;

    if (reportMarker) {
      const ll = reportMarker.getLatLng();
      lat = ll.lat;
      lng = ll.lng;
    } else if (userMarker) {
      const ll = userMarker.getLatLng();
      lat = ll.lat;
      lng = ll.lng;
    }

    const colors = { 'Buraco na rua': '#e53935', 'Falta de iluminação': '#f5a623', 'Enchente': '#1769e0', 'Falta de segurança': '#22a06b', 'Outro': '#7a5af8' };

    if (reportGeocodeTimer) clearTimeout(reportGeocodeTimer);
    reportGeocodeTimer = null;
    const locationInfo = await identifyLocation(lat, lng);
    await UrbanAPI.addProblem({
      lat,
      lng,
      municipality: locationInfo.municipality,
      bairro: locationInfo.bairro,
      cat,
      status: 'Aberto',
      desc,
      photo: capturedPhoto,
      color: colors[cat] || '#1769e0'
    });

    const message = isAuthenticated
      ? 'Relato publicado com sucesso!'
      : 'Relato salvo no modo visitante. Ele aparece apenas neste navegador.';
    toast(message);
    setTimeout(() => show('map'), 800);
  } catch (error) {
    console.error('Erro ao enviar relato:', error);
    toast(error?.message || 'Não foi possível publicar o relato.');
  } finally {
    btn.textContent = 'PUBLICAR RELATO';
    btn.disabled = false;
  }
}

async function renderHistory(elementId, limit = null) {
  const box = document.getElementById(elementId);
  if (!box) return;

  let problems = await UrbanAPI.getMyReports();
  if (limit) problems = problems.slice(0, limit);

  if (!problems.length) {
    const guestMessage = window.UrbanAuth && !window.UrbanAuth.isAuthenticated()
      ? 'Você ainda não publicou relatos neste navegador. Entre na conta para ver seu histórico completo.'
      : 'Você ainda não publicou nenhum relato.';
    box.innerHTML = `<div class="empty-state"><div class="small muted">${guestMessage}</div></div>`;
    return;
  }

  box.innerHTML = problems.map(p => {
    const color = window.normalizeProblemColor
      ? window.normalizeProblemColor(p.color)
      : '#1769e0';
    return `
      <div class="listitem">
        <i class="dot" style="background:${color}"></i>
        <div style="flex:1">
          <div class="between"><b>${escapeHTML(p.cat)}</b><span class="status ${p.status === 'Resolvido' ? 'resolved' : p.status === 'Em análise' ? 'progress' : 'open'}">${escapeHTML(p.status)}</span></div>
          <div class="small muted">${escapeHTML(p.desc)}</div>
          ${p.is_guest ? '<div class="small guest-tag">Salvo apenas neste navegador</div>' : ''}
        </div>
        <div class="report-actions">
          <button type="button" class="edit-report-button" data-report-id="${escapeHTML(p.id)}"
            aria-label="Editar relato: ${escapeHTML(p.cat)}">Editar</button>
          <button type="button" class="delete-report-button" data-report-id="${escapeHTML(p.id)}"
            aria-label="Apagar relato: ${escapeHTML(p.cat)}">Apagar</button>
        </div>
      </div>`;
  }).join('');

  box.querySelectorAll('.edit-report-button').forEach(button => {
    button.addEventListener('click', () => editProblemFromHistory(button.dataset.reportId));
  });
  box.querySelectorAll('.delete-report-button').forEach(button => {
    button.addEventListener('click', () => deleteProblem(button.dataset.reportId, elementId));
  });
}

function editProblemFromHistory(reportId) {
  localStorage.setItem('urbaneye_edit_problem_on_open', 'true');
  openProblem(reportId);
}

async function deleteProblem(reportId, elementId, returnToMap = false) {
  if (!confirm('Tem certeza de que deseja apagar este relato?')) return;

  try {
    const deleted = await UrbanAPI.deleteProblem(reportId);
    if (!deleted) {
      toast('Relato não encontrado ou você não pode apagá-lo.');
      return;
    }

    toast('Relato apagado.');
    if (returnToMap) {
      localStorage.removeItem('urbaneye_current_problem');
      setTimeout(() => show('map'), 500);
      return;
    }
    await renderHistory(elementId, elementId === 'profileHistoryBox' ? 3 : null);
  } catch (error) {
    console.error('Erro ao apagar relato:', error);
    toast(error?.message || 'Não foi possível apagar o relato.');
  }
}

function deleteCurrentProblem() {
  const id = localStorage.getItem('urbaneye_current_problem');
  if (!id) {
    toast('Relato não localizado.');
    return;
  }
  deleteProblem(id, null, true);
}

async function renderStats() {
  const stats = await UrbanAPI.getStats();
  const statGrid = document.getElementById('statsGrid');
  if (statGrid) {
    statGrid.innerHTML = `
      <div class="stat"><div class="muted small">Total via API</div><b>${stats.total}</b></div>
      <div class="stat"><div class="muted small">Resolvidos</div><b>${stats.resolved}</b></div>
      <div class="stat"><div class="muted small">Em análise</div><b>${stats.analysis}</b></div>
      <div class="stat"><div class="muted small">Abertos</div><b>${stats.open}</b></div>`;
  }
}

async function exportData() {
  const problems = await UrbanAPI.getProblems();
  const blob = new Blob([JSON.stringify(problems, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'urbaneye_export_api.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Dados JSON exportados da API!');
}

function clearLocalData() {
  if (confirm('Apagar os dados salvos localmente neste navegador?')) {
    localStorage.removeItem('urbaneye_data');
    localStorage.removeItem('urbaneye_guest_reports');
    localStorage.removeItem('urbaneye_current_problem');
    location.reload();
  }
}

function getFilterState() {
  let settings = {};
  try {
    const saved = JSON.parse(localStorage.getItem('urbaneye_filters') || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) settings = saved;
  } catch (error) {
    console.warn('Filtros salvos inválidos; usando os filtros padrão:', error);
    try {
      localStorage.removeItem('urbaneye_filters');
    } catch (storageError) {
      console.warn('Não foi possível remover os filtros inválidos:', storageError);
    }
  }
  return {
    category: typeof settings.category === 'string' && settings.category ? settings.category : 'Todas',
    status: typeof settings.status === 'string' && settings.status ? settings.status : 'Todos',
    bairro: typeof settings.bairro === 'string' && settings.bairro ? settings.bairro : 'Todos os bairros'
  };
}

function saveFilterState(next) {
  const current = getFilterState();
  const state = { ...current, ...next };
  localStorage.setItem('urbaneye_filters', JSON.stringify(state));
  return state;
}

function normalizeCategoryFilter(value) {
  if (!value || value === 'Todas') return 'Todas';
  if (value.includes('Buraco')) return 'Buracos';
  if (value.includes('Iluminação')) return 'Iluminação';
  if (value.includes('Enchente')) return 'Enchentes';
  if (value.includes('Segurança')) return 'Segurança';
  return value;
}

function applyFilterStateToInputs(state) {
  const categoryEl = document.getElementById('mapCategoryFilter') || document.getElementById('filterCategory');
  const statusEl = document.getElementById('mapStatusFilter') || document.getElementById('filterStatus');
  const bairroEl = document.getElementById('mapBairroFilter') || document.getElementById('filterBairro');

  if (categoryEl) categoryEl.value = state.category === 'Todas' ? 'Todas' : state.category;
  if (statusEl) statusEl.value = state.status;
  if (bairroEl) bairroEl.value = state.bairro;

  document.querySelectorAll('.chip').forEach(chip => {
    const chipLabel = chip.textContent.replace(/^[^\wÀ-ÿ]+|[^\wÀ-ÿ]+$/g, '').trim();
    const selected = chipLabel === 'Todos' && state.category === 'Todas';
    chip.classList.toggle('on', selected || chipLabel === state.category);
  });
}

function filterProblems(problems, state = getFilterState()) {
  return problems.filter(problem => {
    const categoryMatch = state.category === 'Todas' || (
      (state.category === 'Buracos' && problem.cat && problem.cat.toLowerCase().includes('buraco')) ||
      (state.category === 'Iluminação' && problem.cat && problem.cat.toLowerCase().includes('iluminação')) ||
      (state.category === 'Enchentes' && problem.cat && problem.cat.toLowerCase().includes('enchente')) ||
      (state.category === 'Segurança' && problem.cat && problem.cat.toLowerCase().includes('segurança'))
    );

    const statusMatch = state.status === 'Todos' || problem.status === state.status;
    const bairroMatch = state.bairro === 'Todos os bairros' || problem.bairro === state.bairro;

    return categoryMatch && statusMatch && bairroMatch;
  });
}

function applyFilters() {
  const categoryEl = document.getElementById('mapCategoryFilter') || document.getElementById('filterCategory');
  const statusEl = document.getElementById('mapStatusFilter') || document.getElementById('filterStatus');
  const bairroEl = document.getElementById('mapBairroFilter') || document.getElementById('filterBairro');

  const state = saveFilterState({
    category: normalizeCategoryFilter(categoryEl ? categoryEl.value : 'Todas'),
    status: statusEl ? statusEl.value : 'Todos',
    bairro: bairroEl ? bairroEl.value : 'Todos os bairros'
  });

  applyFilterStateToInputs(state);

  if (typeof map !== 'undefined' && map && typeof renderMapData === 'function') {
    UrbanAPI.getProblems().then(problems => {
      const filtered = filterProblems(problems, state);
      renderMapData(filtered, true);
      toast('Filtros aplicados.');
    });
    return;
  }

  if (document.getElementById('realMap')) {
    show('map');
  }

  toast('Filtros aplicados.');
}

function filterChip(el) {
  const filterName = el.textContent.replace(/^[^\wÀ-ÿ]+|[^\wÀ-ÿ]+$/g, '').trim();
  const category = filterName === 'Todos' ? 'Todas' : filterName;

  document.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
  el.classList.add('on');

  saveFilterState({ category });
  const select = document.getElementById('mapCategoryFilter');
  if (select) select.value = category === 'Todas' ? 'Todas' : category;

  if (typeof map !== 'undefined' && map && typeof renderMapData === 'function') {
    UrbanAPI.getProblems().then(problems => renderMapData(filterProblems(problems, getFilterState()), true));
  }

  toast(`Filtro "${el.textContent.trim()}" aplicado na view.`);
}

function openProfileEditor() {
  const editor = document.getElementById('profileEditor');
  const button = document.getElementById('editProfileButton');
  if (editor) editor.hidden = false;
  if (button) button.hidden = true;
  document.getElementById('profileNameInput')?.focus();
}

async function closeProfileEditor() {
  const editor = document.getElementById('profileEditor');
  const button = document.getElementById('editProfileButton');
  const photoInput = document.getElementById('profileAvatarInput');
  if (editor) editor.hidden = true;
  if (button) button.hidden = false;
  if (photoInput) photoInput.value = '';
  if (profileAvatarPreviewUrl) {
    URL.revokeObjectURL(profileAvatarPreviewUrl);
    profileAvatarPreviewUrl = null;
  }
  await renderProfileHeader();
}

async function saveAdminReportStatus(reportId, button, statusOverride) {
  const article = button?.closest('.admin-report');
  const select = article?.querySelector(`[data-admin-status="${CSS.escape(String(reportId))}"]`);
  const statusToSave = statusOverride || select?.value;
  if (!statusToSave) return false;

  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Salvando...';
  }

  try {
    const status = await UrbanAPI.updateProblemStatus(reportId, statusToSave);
    const report = adminReports.find((item) => String(item.id) === String(reportId));
    if (report) report.status = status;

    const badge = article?.querySelector('.status');
    if (badge) {
      badge.textContent = status;
      badge.className = `status ${status === 'Resolvido' ? 'resolved' : status === 'Em análise' ? 'progress' : 'open'}`;
    }

    if (select) {
      select.classList.remove('admin-status-open', 'admin-status-progress', 'admin-status-resolved');
      if (status === 'Resolvido') select.classList.add('admin-status-resolved');
      else if (status === 'Em análise') select.classList.add('admin-status-progress');
      else select.classList.add('admin-status-open');
    }

    renderAdminReports();
    toast('Situação atualizada com sucesso!');
    return true;
  } catch (error) {
    console.error('Erro ao salvar situação administrativa:', error);
    toast(error?.message || 'Não foi possível alterar o status do problema.');
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}
