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
  const isLoginPage = /(?:\/|^)auth\/login\.html(?:$|\?)/.test(window.location.pathname);
  if (top && !isLoginPage && !document.querySelector('.top-institutional-link')) {
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
      const bairro = address.suburb || address.neighbourhood || address.quarter || address.residential || address.city_district || null;
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
  if (!value || value === 'Todas' ) return 'Todas';
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

const ACCESSIBILITY_STORAGE_KEY = 'urbaneye_accessibility_v1';

function getAccessibilitySettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(ACCESSIBILITY_STORAGE_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch (error) {
    return {};
  }
}

function saveAccessibilitySettings(settings) {
  try {
    localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Não foi possível salvar as preferências de acessibilidade:', error);
  }
}

function accessibilityIcon(name) {
  const icons = {
    person: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="7" r="2"/><path d="M8 22v-7l-2-5m10 12v-7l2-5M8 10l4 2 4-2"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M12 5v14M8 19h8"/></svg>',
    spacing: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14M5 20h14M8 8h8M8 12h8M8 16h8"/></svg>',
    align: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h11M4 14h16M4 18h11"/></svg>',
    legible: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V5h7a4 4 0 0 1 0 8H5m7 0 6 6"/></svg>',
    saturation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3S5 11 5 16a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/><path d="M12 7v13"/></svg>',
    contrast: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/></svg>',
    structure: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg>',
    reading: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>',
    images: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="10" r="1.5"/><path d="m5 17 5-5 4 4 2-2 3 3"/></svg>',
    animations: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 3 18 18"/></svg>',
    focus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    links: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></svg>',
    audio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11"/></svg>'
  };
  return icons[name] || '';
}

function applyAccessibilitySettings(settings) {
  const root = document.documentElement;
  root.classList.toggle('ua-text-large', !!settings.textLarge);
  root.classList.toggle('ua-readable-font', !!settings.readableFont);
  root.classList.toggle('ua-grayscale', !!settings.grayscale);
  root.classList.toggle('ua-high-contrast', !!settings.highContrast);
  root.classList.toggle('ua-page-structure', !!settings.structure);
  root.classList.toggle('ua-reading-mask', !!settings.readingMask);
  root.classList.toggle('ua-focus-visible', !!settings.focusVisible);
  root.classList.toggle('ua-highlight-links', !!settings.highlightLinks);

  const existingGuide = document.querySelector('.ua-reading-guide');
  if (settings.readingMask && !existingGuide) {
    const guide = document.createElement('div');
    guide.className = 'ua-reading-guide';
    guide.setAttribute('aria-hidden', 'true');
    document.body.appendChild(guide);
  } else if (!settings.readingMask && existingGuide) {
    existingGuide.remove();
  }
}

function initAccessibilityPanel() {
  if (document.getElementById('accessibilityWidget')) return;

  let settings = getAccessibilitySettings();
  applyAccessibilitySettings(settings);

  const widget = document.createElement('div');
  widget.id = 'accessibilityWidget';
  widget.className = 'accessibility-widget';

  widget.innerHTML = `
    <button type="button" id="accessibilityToggle" class="accessibility-toggle" aria-label="Abrir menu de acessibilidade" aria-controls="accessibilityPanel" aria-expanded="false">
      ${accessibilityIcon('person')}
    </button>
    <section id="accessibilityPanel" class="accessibility-panel" aria-label="Recursos de acessibilidade" hidden>
      <header class="accessibility-panel-header">
        <h2>Acessibilidade</h2>
        <div class="accessibility-header-actions">
          <button type="button" id="accessibilityReset" class="accessibility-header-button" aria-label="Redefinir acessibilidade" title="Redefinir">${accessibilityIcon('reset')}</button>
          <button type="button" id="accessibilityClose" class="accessibility-header-button" aria-label="Fechar painel" title="Fechar">${accessibilityIcon('close')}</button>
        </div>
      </header>
      <div class="accessibility-options">
        <button type="button" class="accessibility-option" data-a11y="textLarge"><span>${accessibilityIcon('text')}</span><b>Texto maior</b></button>
        <button type="button" class="accessibility-option" data-a11y="readableFont"><span>${accessibilityIcon('legible')}</span><b>Fonte legível</b></button>
        <button type="button" class="accessibility-option" data-a11y="grayscale"><span>${accessibilityIcon('saturation')}</span><b>Escala de cinza</b></button>
        <button type="button" class="accessibility-option" data-a11y="highContrast"><span>${accessibilityIcon('contrast')}</span><b>Alto contraste</b></button>
        <button type="button" class="accessibility-option" data-a11y="structure"><span>${accessibilityIcon('structure')}</span><b>Estrutura da página</b></button>
        <button type="button" class="accessibility-option" data-a11y="readingMask"><span>${accessibilityIcon('reading')}</span><b>Máscara de leitura</b></button>
        <button type="button" class="accessibility-option" data-a11y="focusVisible"><span>${accessibilityIcon('focus')}</span><b>Contorno de foco</b></button>
        <button type="button" class="accessibility-option" data-a11y="highlightLinks"><span>${accessibilityIcon('links')}</span><b>Destacar links</b></button>
        <button type="button" id="accessibilityRead" class="accessibility-option accessibility-speech-option" aria-pressed="false"><span>${accessibilityIcon('audio')}</span><b>Ouvir página</b></button>
        <button type="button" id="accessibilityStopSpeech" class="accessibility-option accessibility-speech-stop" disabled><span>${accessibilityIcon('close')}</span><b>Parar áudio</b></button>
      </div>
      <footer class="accessibility-panel-footer">
        <button type="button" id="accessibilityResetFooter">Redefinir tudo</button>
      </footer>
    </section>
  `;

  document.body.appendChild(widget);

  const toggle = widget.querySelector('#accessibilityToggle');
  const panel = widget.querySelector('#accessibilityPanel');
  const close = widget.querySelector('#accessibilityClose');

  function setPanelOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu de acessibilidade' : 'Abrir menu de acessibilidade');
    if (open) {
      optionSpeechEnabled = true;
      window.setTimeout(() => accessibilityOptions[0]?.focus(), 50);
    }
  }

  toggle.addEventListener('click', () => setPanelOpen(panel.hidden));
  close.addEventListener('click', () => {
    setPanelOpen(false);
    toggle.focus();
  });

  widget.querySelectorAll('[data-a11y]').forEach((button) => {
    const key = button.dataset.a11y;
    const active = !!settings[key];
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => {
      settings[key] = !settings[key];
      button.classList.toggle('is-active', !!settings[key]);
      button.setAttribute('aria-pressed', String(!!settings[key]));
      applyAccessibilitySettings(settings);
      saveAccessibilitySettings(settings);
    });
  });

  const accessibilityOptions = Array.from(widget.querySelectorAll('.accessibility-option'));
  let optionSpeechTimer = null;
  let optionSpeechEnabled = true;

  function cancelOptionSpeech() {
    clearTimeout(optionSpeechTimer);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function speakOption(option) {
    if (!optionSpeechEnabled || !option || !('speechSynthesis' in window)) return;
    const label = (option.getAttribute('aria-label') || option.querySelector('b')?.textContent || option.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label) return;

    clearTimeout(optionSpeechTimer);
    optionSpeechTimer = setTimeout(() => {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(label);
      utterance.lang = 'pt-BR';
      utterance.rate = 1;
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find((item) => /^pt[-_]BR/i.test(item.lang))
        || voices.find((item) => /^pt/i.test(item.lang));
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    }, 180);
  }

  accessibilityOptions.forEach((option, index) => {
    option.dataset.a11yIndex = String(index);
    option.addEventListener('mouseenter', () => speakOption(option));
    option.addEventListener('mouseleave', () => {
      clearTimeout(optionSpeechTimer);
    });
    option.addEventListener('focus', () => speakOption(option));
  });

  panel.addEventListener('keydown', (event) => {
    const isArrow = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key);
    if (!isArrow) return;

    event.preventDefault();

    const current = document.activeElement;
    const currentIndex = accessibilityOptions.indexOf(current);
    if (currentIndex < 0) {
      accessibilityOptions[0]?.focus();
      return;
    }

    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const nextIndex = forward
      ? (currentIndex + 1) % accessibilityOptions.length
      : (currentIndex - 1 + accessibilityOptions.length) % accessibilityOptions.length;
    const nextOption = accessibilityOptions[nextIndex];
    if (nextOption) {
      nextOption.focus();
      nextOption.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    if (escapeStage === 0) {
      escapeStage = 1;
      optionSpeechEnabled = false;
      cancelOptionSpeech();
      toast('Narração das opções desativada. Pressione Esc novamente para fechar.');
    } else {
      escapeStage = 0;
      setPanelOpen(false);
      toggle.focus();
    }

    event.preventDefault();
    event.stopPropagation();
  });

  function resetAccessibility() {
    stopSpeech();
    optionSpeechEnabled = true;
    settings = {};
    saveAccessibilitySettings(settings);
    applyAccessibilitySettings(settings);
    widget.querySelectorAll('[data-a11y]').forEach((button) => {
      button.classList.remove('is-active');
      button.setAttribute('aria-pressed', 'false');
    });
  }

  widget.querySelector('#accessibilityReset').addEventListener('click', resetAccessibility);
  widget.querySelector('#accessibilityResetFooter').addEventListener('click', resetAccessibility);

  // Speech synthesis controls
  const readButton = widget.querySelector('#accessibilityRead');
  const stopButton = widget.querySelector('#accessibilityStopSpeech');

  function getSpeechText() {
    const title = (document.querySelector('h1')?.textContent
      || document.querySelector('.top b')?.textContent
      || document.querySelector('.admin-auth-heading h2')?.textContent
      || document.querySelector('title')?.textContent
      || 'UrbanEye').replace(/\s+/g, ' ').trim();

    const main = document.querySelector('main') || document.querySelector('.app') || document.querySelector('.admin-dashboard') || document.querySelector('.screen') || document.body;
    const seen = new Set();

    const actions = Array.from(main.querySelectorAll('button,a,[role="button"]'))
      .filter((element) => {
        if (element.closest('#accessibilityWidget,[hidden]')) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;

        const label = (element.getAttribute('aria-label') || element.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

        if (!label || seen.has(label)) return false;
        if (/^(início|mapa|parcerias|comunidade|perfil|área institucional|voltar|fechar|redefinir|tentar novamente)$/.test(label)) return false;

        seen.add(label);
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .sort((a, b) => {
        const priority = (element) => {
          const className = element.className || '';
          if (/primary|submit|btn$|admin-login-button|btn-report/.test(className)) return 0;
          if (/secondary|plus/.test(className)) return 1;
          return 2;
        };
        return priority(a) - priority(b);
      })
      .slice(0, 5)
      .map((element) => {
        const label = (element.getAttribute('aria-label') || element.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        const top = element.getBoundingClientRect().top;
        const position = top < 180 ? 'no topo' : top > window.innerHeight * 0.65 ? 'mais abaixo' : 'no centro';
        return `${label}, ${position}`;
      });

    if (!actions.length) return `Página ${title}. Nenhum botão principal disponível.`;
    return `Página ${title}. ${actions.join('. ')}.`;
  }

  function stopSpeech(preserveSession = false) {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (!preserveSession) setSpeechSessionActive(false);
    if (readButton) {
      readButton.classList.remove('is-active');
      readButton.setAttribute('aria-pressed', 'false');
      readButton.querySelector('b').textContent = 'Ouvir página';
    }
    if (stopButton) stopButton.disabled = true;
  }

  function readPageAloud(autoNarrate = false) {
    if (!('speechSynthesis' in window)) {
      if (!autoNarrate) toast('Seu navegador não oferece leitura em voz alta.');
      setSpeechSessionActive(false);
      return;
    }

    const text = getSpeechText();
    if (!text) {
      if (!autoNarrate) toast('Não há texto disponível para leitura.');
      setSpeechSessionActive(false);
      return;
    }

    setSpeechSessionActive(true);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.95;
    utterance.pitch = 1;

    const voices = window.speechSynthesis.getVoices();
    const portugueseVoice = voices.find((voice) => /^pt[-_]BR/i.test(voice.lang))
      || voices.find((voice) => /^pt/i.test(voice.lang));
    if (portugueseVoice) utterance.voice = portugueseVoice;

    utterance.onend = () => {
      if (readButton) {
        readButton.classList.remove('is-active');
        readButton.setAttribute('aria-pressed', 'false');
        readButton.querySelector('b').textContent = 'Ouvir página';
      }
      if (stopButton) stopButton.disabled = true;
    };

    readButton.classList.add('is-active');
    readButton.setAttribute('aria-pressed', 'true');
    readButton.querySelector('b').textContent = 'Lendo…';
    stopButton.disabled = false;
    window.speechSynthesis.speak(utterance);
  }

  readButton.addEventListener('click', () => {
    if (isSpeechSessionActive()) stopSpeech(false);
    else readPageAloud(false);
  });
  stopButton.addEventListener('click', () => stopSpeech(false));

  if (isSpeechSessionActive()) {
    window.setTimeout(() => readPageAloud(true), 700);
  }
}

const SPEECH_SESSION_KEY = 'urbaneye_read_aloud_active';

function isSpeechSessionActive() {
  try { return sessionStorage.getItem(SPEECH_SESSION_KEY) === 'true'; } catch (error) { return false; }
}

function setSpeechSessionActive(active) {
  try {
    if (active) sessionStorage.setItem(SPEECH_SESSION_KEY, 'true');
    else sessionStorage.removeItem(SPEECH_SESSION_KEY);
  } catch (error) {
    // Sessão pode permanecer ativa enquanto a memória estiver disponível.
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  addInstitutionalAccessLinks();
  initAccessibilityPanel();
});

let escapeStage = 0;