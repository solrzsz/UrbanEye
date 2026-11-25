(function () {
  'use strict';

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

  Object.assign(window, {openPartner, useMyLocationForApps, shareUrbanEye});

})();
