function onAppReady(callback) {
  document.addEventListener('DOMContentLoaded', async () => {
    if (window.UrbanAuth) {
      await window.UrbanAuth.ready;
      if (window.UrbanAuth.getState().redirecting) return;
    }
    await callback();
  });
}

const municipalityCache = new Map();

const municipalityRequests = new Map();

let municipalityRequestQueue = Promise.resolve();

let lastGeocodeRequestAt = 0;

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

function hasSupabaseAuth() {
  return !!(window.supabaseClient && window.supabaseClient.auth && window.urbaneyeSupabaseEnabled);
}

function isInstitutionalProfile(profile) {
  if (!profile) return false;
  const role = String(profile.role || profile.account_type || profile.organization_role || '').trim().toLowerCase();
  if (!role) return false;
  return ['admin', 'administrador', 'institutional', 'institucional', 'municipal', 'prefeitura', 'ong', 'operator', 'operacional', 'staff'].includes(role);
}

async function logout() {
  if (window.UrbanAuth) {
    await window.UrbanAuth.logout();
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

function openProblem(id) {
  localStorage.setItem('urbaneye_current_problem', id);
  show('detail');
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

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  addInstitutionalAccessLinks();
});