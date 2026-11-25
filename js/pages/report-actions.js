(function () {
  'use strict';

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

  Object.assign(window, {renderHistory, deleteCurrentProblem});

})();
