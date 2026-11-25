(function () {
  'use strict';

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

  function clearLocalData() {
    if (confirm('Apagar os dados salvos localmente neste navegador?')) {
      localStorage.removeItem('urbaneye_data');
      localStorage.removeItem('urbaneye_guest_reports');
      localStorage.removeItem('urbaneye_current_problem');
      location.reload();
    }
  }

  Object.assign(window, {clearLocalData});

  onAppReady(initSettings);
})();
