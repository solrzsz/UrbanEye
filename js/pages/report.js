(function () {
  'use strict';

  let reportMap = null;

  let reportMarker = null;

  let reportGeocodeSequence = 0;

  let reportGeocodeTimer = null;

  let cameraStream = null;

  let cameraFacing = 'environment';

  let capturedPhoto = null;

  function isPointOnSegment(lng, lat, x1, y1, x2, y2) {
    const cross = (lng - x1) * (y2 - y1) - (lat - y1) * (x2 - x1);
    const withinSegment = (lng - x1) * (lng - x2) + (lat - y1) * (lat - y2) <= 1e-10;
    return Math.abs(cross) <= 1e-8 && withinSegment;
  }

  function isPointInRing(lng, lat, ring) {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const [x1, y1] = ring[index];
      const [x2, y2] = ring[previous];
      if (isPointOnSegment(lng, lat, x1, y1, x2, y2)) return true;
      const crossesLatitude = (y1 > lat) !== (y2 > lat);
      const intersectionLng = ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1;
      if (crossesLatitude && lng < intersectionLng) inside = !inside;
    }
    return inside;
  }

  function isLocationWithinRio(lat, lng) {
    const polygons = window.UrbanEyeRioBoundary?.coordinates;
    if (!Array.isArray(polygons)) {
      console.error('O limite geográfico do estado do Rio de Janeiro não foi carregado.');
      return false;
    }

    return polygons.some((polygon) => {
      if (!polygon.length || !isPointInRing(lng, lat, polygon[0])) return false;
      return !polygon.slice(1).some((hole) => isPointInRing(lng, lat, hole));
    });
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

  function setReportLocation(lat, lng, shouldCenter = false) {
    if (!isLocationWithinRio(lat, lng)) {
      toast('Selecione um ponto dentro do estado do Rio de Janeiro.');
      return false;
    }

    const locInput = document.getElementById('reportLocation');
    if (locInput) locInput.value = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
    updateReportMunicipality(lat, lng);
  
    if (reportMap) {
      if (!reportMarker) {
        reportMarker = L.marker([lat, lng], { draggable: true }).addTo(reportMap);
        reportMarker.bindPopup('Ponto do problema');
        reportMarker.on('dragend', () => {
          const pos = reportMarker.getLatLng();
          if (!isLocationWithinRio(pos.lat, pos.lng)) {
            const previousPosition = locInput.value.split(',').map(Number);
            reportMarker.setLatLng(previousPosition);
            toast('O ponto precisa ficar dentro do estado do Rio de Janeiro.');
            return;
          }
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

    L.geoJSON(window.UrbanEyeRioBoundary, {
      interactive: false,
      style: {
        color: '#1769e0',
        weight: 2,
        fillColor: '#1769e0',
        fillOpacity: 0.08
      }
    }).addTo(reportMap);

    reportMap.setMaxBounds(rioBounds);
  
    reportMap.on('click', event => {
      const { lat, lng } = event.latlng;
      if (!isLocationWithinRio(lat, lng)) {
        toast('Selecione um ponto dentro do estado do Rio de Janeiro.');
        return;
      }
      setReportLocation(lat, lng, true);
    });

    const descriptionInput = document.getElementById('reportDescription');
    descriptionInput?.addEventListener('input', () => {
      if (!window.validateProblemDescription || !descriptionInput.value.trim()) {
        descriptionInput.removeAttribute('aria-invalid');
        return;
      }
      const validation = validateProblemDescription(descriptionInput.value);
      descriptionInput.setAttribute('aria-invalid', String(!validation.valid));
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
      if (!isLocationWithinRio(latitude, longitude)) {
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
    if (!capturedPhoto) {
      toast('Adicione uma foto do problema antes de publicar.');
      document.getElementById('cameraPlaceholder')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (window.validateProblemDescription) {
      const descriptionValidation = validateProblemDescription(desc);
      if (!descriptionValidation.valid) {
        toast(descriptionValidation.message);
        document.getElementById('reportDescription')?.focus();
        return;
      }
    }
  
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

  Object.assign(window, {locateUserForReport, startCamera, stopCamera, switchCamera, capturePhoto, retakePhoto, previewPhoto, sendReport});

  onAppReady(initReportPage);
})();
