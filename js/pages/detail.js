(function () {
  'use strict';

  let currentDetailProblem = null;

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

  Object.assign(window, {openProblemInWaze, openProblemEditor, cancelProblemEditor, saveProblemDetails, saveProblemStatus, confirmProblemDetail});

  onAppReady(populateDetail);
})();
