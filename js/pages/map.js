(function () {
  'use strict';

  let map = null;

  let userMarker = null;

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

  window.applyMapFilters = (state) => UrbanAPI.getProblems().then((problems) => {
    renderMapData(filterProblems(problems, state), true);
  });

  Object.assign(window, {locateUser});

  onAppReady(initMapPage);
})();
