let map, userMarker, reportMap, reportMarker;
const municipalityCache = new Map();
const municipalityRequests = new Map();
let municipalityRequestQueue = Promise.resolve();
let lastGeocodeRequestAt = 0;
let reportGeocodeSequence = 0;
let reportGeocodeTimer = null;

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

// Integrações externas: abrem os aplicativos/sites parceiros; não fazem login OAuth nem sincronizam dados privados.
function openPartner(app) {
  const lat = window.urbaneyeLat;
  const lng = window.urbaneyeLng;
  const coords = lat != null && lng != null ? `${lat},${lng}` : '-22.7858,-43.3116';
  const urls = {
    waze: `https://www.waze.com/pt-BR/live-map/`,
    maps: `https://www.google.com/maps`,
    moovit: `https://moovitapp.com/`,
    uber: `https://auth.uber.com/login/?next=https%3A%2F%2Fm.uber.com%2F`
  };
  if (urls[app]) window.open(urls[app], '_blank', 'noopener');
}
function useMyLocationForApps() {
  if (!navigator.geolocation) { toast('Seu navegador não oferece localização.'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    window.urbaneyeLat = pos.coords.latitude; window.urbaneyeLng = pos.coords.longitude;
    const el = document.getElementById('integrationLocation');
    if (el) el.textContent = 'Localização pronta para compartilhar com os apps.';
    toast('Localização obtida!');
  }, () => toast('Não foi possível obter a localização. Verifique a permissão.'), { enableHighAccuracy: true, timeout: 10000 });
}
async function shareUrbanEye() {
  const data = { title: 'UrbanEye', text: 'Confira o UrbanEye: relatos e informações sobre mobilidade urbana.', url: location.href };
  try { if (navigator.share) await navigator.share(data); else if (navigator.clipboard) { await navigator.clipboard.writeText(data.text + ' ' + data.url); toast('Link copiado!'); } else toast('Compartilhamento não disponível neste navegador.'); }
  catch (e) { if (e.name !== 'AbortError') toast('Não foi possível compartilhar agora.'); }
}


function show(id) {
  const target = id === 'home' ? 'index.html' : id + '.html';
  window.location.href = target;
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

    if (redirect && redirect !== 'map.html') {
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
      const target = window.UrbanAuth ? window.UrbanAuth.getPostLoginRedirect() : 'map.html';
      window.location.href = target;
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
        const target = window.UrbanAuth ? window.UrbanAuth.getPostLoginRedirect() : 'map.html';
        window.location.href = target;
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

async function logout() {
  if (window.UrbanAuth) {
    await window.UrbanAuth.logout();
  }
}

async function renderProfileHeader() {
  const data = await UrbanAPI.getProfileData();

  const name = document.getElementById('profileName');
  if (name) name.textContent = data.name;

  const memberSince = document.getElementById('profileMemberSince');
  if (memberSince) memberSince.textContent = data.memberSince;

  const avatar = document.querySelector('.profile-avatar') || document.querySelector('.avatar');
  if (avatar) avatar.textContent = (data.name || 'V').trim().charAt(0).toUpperCase();

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

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();

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
  if (document.getElementById('btnLogin')) initLoginPage();
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

  problems.forEach(p => {
    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="width:24px;height:24px;border-radius:50%;background:${p.color || '#1769e0'};border:3px solid white;box-shadow:0 3px 8px rgba(0,0,0,0.5)"></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    L.marker([p.lat, p.lng], { icon }).addTo(map).bindPopup(
      `<b>${p.cat}</b><br>${p.desc}<br><span style="font-size:12px;color:gray">${p.status}</span><br>
       <button onclick="openProblem(${JSON.stringify(p.id)})" style="margin-top:8px;width:100%;padding:8px;border-radius:8px;background:var(--primary);color:white;border:0;cursor:pointer">Ver detalhes</button>`
    );
  });
  document.getElementById('mapCount').textContent = problems.length + ' problemas recuperados';
}

function openProblem(id) {
  localStorage.setItem('urbaneye_current_problem', id);
  show('detail');
}

async function identifyMunicipality(lat, lng) {
  const cacheKey = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  if (municipalityCache.has(cacheKey)) return municipalityCache.get(cacheKey);
  if (municipalityRequests.has(cacheKey)) return municipalityRequests.get(cacheKey);

  const request = municipalityRequestQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastGeocodeRequestAt = Date.now();

    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lng),
        zoom: '10',
        addressdetails: '1',
        'accept-language': 'pt-BR'
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
      if (!response.ok) throw new Error(`Geocodificação retornou HTTP ${response.status}`);

      const result = await response.json();
      const address = result.address || {};
      const city = address.city || address.town || address.village || address.municipality || address.county;
      const state = address.state;
      const municipality = city
        ? [city, state].filter(Boolean).join(', ')
        : null;
      municipalityCache.set(cacheKey, municipality);
      return municipality;
    } catch (error) {
      console.warn('Não foi possível identificar o município pelas coordenadas:', error);
      return null;
    } finally {
      municipalityRequests.delete(cacheKey);
    }
  });

  municipalityRequestQueue = request.then(() => undefined, () => undefined);
  municipalityRequests.set(cacheKey, request);
  return request;
}

function updateReportMunicipality(lat, lng) {
  const sequence = ++reportGeocodeSequence;
  const label = document.getElementById('reportLocationName');
  if (!label) return;

  if (reportGeocodeTimer) clearTimeout(reportGeocodeTimer);
  label.textContent = 'Identificando município...';
  reportGeocodeTimer = setTimeout(async () => {
    const municipality = await identifyMunicipality(lat, lng);
    if (sequence !== reportGeocodeSequence) return;
    label.textContent = municipality
      ? `${municipality} · Dados © OpenStreetMap`
      : 'Município não identificado · Dados © OpenStreetMap';
  }, 500);
}

async function populateDetail() {
  const id = localStorage.getItem('urbaneye_current_problem');
  const p = await UrbanAPI.getProblemById(id);
  if (!p) return;
  document.getElementById('detailCat').textContent = p.cat;
  document.getElementById('detailStatus').textContent = p.status;
  document.getElementById('detailDesc').textContent = p.desc;
  const municipality = p.municipality || await identifyMunicipality(p.lat, p.lng);
  const detailLocation = document.getElementById('detailLoc');
  if (detailLocation) {
    detailLocation.textContent = municipality
      ? `📍 ${municipality} · Dados © OpenStreetMap`
      : `📍 ${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)} · Dados © OpenStreetMap`;
  }
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

function previewPhoto(input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  if (!file.type.startsWith('image/')) {
    toast('Selecione um arquivo de imagem.');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById('photoCanvas');
      const scale = Math.min(1, 1280 / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
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
    const municipality = await identifyMunicipality(lat, lng);
    await UrbanAPI.addProblem({
      lat, lng, municipality, cat, status: 'Aberto', desc, photo: capturedPhoto, color: colors[cat] || '#1769e0'
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

  const rows = problems.map(p => `
    <div class="listitem">
      <i class="dot" style="background:${p.color || '#1769e0'}"></i>
      <div style="flex:1">
        <div class="between"><b>${p.cat}</b><span class="status ${p.status === 'Resolvido' ? 'resolved' : p.status === 'Em análise' ? 'progress' : 'open'}">${p.status}</span></div>
        <div class="small muted">${p.desc}</div>
        ${p.is_guest ? '<div class="small guest-tag">Salvo apenas neste navegador</div>' : ''}
      </div>
    </div>`).join('');
  box.innerHTML = rows;
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
  const settings = JSON.parse(localStorage.getItem('urbaneye_filters') || '{}');
  return {
    category: settings.category || 'Todas',
    status: settings.status || 'Todos',
    bairro: settings.bairro || 'Todos os bairros'
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
