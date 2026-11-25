(function () {
  'use strict';

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
    if (selected === 'team') renderAdminTeams();
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
      renderAdminTeams();
      return true;
    } catch (error) {
      console.error('Não foi possível salvar a atribuição local:', error);
      toast('Não foi possível salvar a atribuição neste navegador.');
      return false;
    }
  }

  function removeAdminReportMetadata(reportId) {
    try {
      const assignments = JSON.parse(localStorage.getItem('urbaneye_admin_assignments') || '{}');
      delete assignments[String(reportId)];
      localStorage.setItem('urbaneye_admin_assignments', JSON.stringify(assignments));
    } catch (error) {
      console.warn('Não foi possível remover a atribuição:', error);
    }
    try {
      const notes = JSON.parse(localStorage.getItem('urbaneye_admin_notes') || '{}');
      delete notes[String(reportId)];
      localStorage.setItem('urbaneye_admin_notes', JSON.stringify(notes));
    } catch (error) {
      console.warn('Não foi possível remover as observações:', error);
    }
  }

  function clearAllAdminReportMetadata() {
    localStorage.removeItem('urbaneye_admin_assignments');
    localStorage.removeItem('urbaneye_admin_notes');
  }

  async function clearAllAdminReports() {
    if (!adminReports.length) {
      toast('Não há relatos para limpar.');
      return;
    }
    if (!confirm(`Tem certeza de que deseja apagar todos os ${adminReports.length} relatos? Esta ação não pode ser desfeita.`)) return;

    let deletedCount = 0;
    for (const report of [...adminReports]) {
      try {
        const deleted = await UrbanAPI.deleteProblemAsAdmin(report.id);
        if (deleted) {
          deletedCount += 1;
          removeAdminReportMetadata(report.id);
        }
      } catch (error) {
        console.error(`Erro ao apagar o relato ${report.id}:`, error);
      }
    }

    const guestReports = JSON.parse(localStorage.getItem('urbaneye_guest_reports') || '[]');
    if (Array.isArray(guestReports) && guestReports.length) {
      deletedCount += guestReports.length;
      localStorage.removeItem('urbaneye_guest_reports');
      localStorage.removeItem('urbaneye_current_problem');
    }
    clearAllAdminReportMetadata();
    await loadAdminReports();
    renderAdminTeams();
    toast(deletedCount ? `${deletedCount} relato(s) apagado(s).` : 'Nenhum relato pôde ser apagado.');
  }

  async function clearAdminReport(reportId) {
    const report = adminReports.find((item) => String(item.id) === String(reportId));
    if (!report) return;
    if (!confirm(`Tem certeza de que deseja apagar o relato "${report.cat}"?`)) return;

    try {
      const deleted = await UrbanAPI.deleteProblemAsAdmin(reportId);
      if (!deleted) {
        toast('O relato não foi encontrado ou não pode ser apagado.');
        return;
      }
      removeAdminReportMetadata(reportId);
      await loadAdminReports();
      renderAdminTeams();
      toast('Relato apagado.');
    } catch (error) {
      console.error('Erro ao apagar relato administrativo:', error);
      toast(error?.message || 'Não foi possível apagar o relato.');
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

  function renderAdminTeams() {
    const list = document.getElementById('adminTeamList');
    if (!list) return;
    const teams = ['Equipe de manutenção', 'Equipe de iluminação', 'Equipe de limpeza', 'Defesa civil'];
    list.innerHTML = teams.map((team, index) => {
      const reports = adminReports.filter((report) => getAdminAssignee(report.id) === team);
      return `
        <section class="admin-team-card">
          <button class="admin-team-summary" type="button" data-admin-team="${escapeHTML(team)}" aria-expanded="false">
            <span class="admin-team-icon">${['🔧', '💡', '🧹', '🛡'][index]}</span>
            <span class="admin-team-name"><b>${escapeHTML(team)}</b><small>${reports.length} relato(s) atribuído(s)</small></span>
            <span class="admin-team-arrow">›</span>
          </button>
          <div class="admin-team-reports" data-admin-team-reports="${escapeHTML(team)}" hidden>
            ${reports.length ? reports.map((report) => `
              <button class="admin-team-report" type="button" data-open-admin-report="${escapeHTML(report.id)}">
                <span><b>${escapeHTML(report.cat)}</b><small>${escapeHTML(getAdminReportLocation(report))}</small></span>
                <span class="status ${report.status === 'Resolvido' ? 'resolved' : report.status === 'Em análise' ? 'progress' : 'open'}">${escapeHTML(report.status)}</span>
              </button>
            `).join('') : '<p class="admin-team-empty">Não existem relatos atribuídos.</p>'}
          </div>
        </section>
      `;
    }).join('');

    list.querySelectorAll('[data-admin-team]').forEach((button) => {
      button.addEventListener('click', () => {
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!expanded));
        button.closest('.admin-team-card').querySelector('[data-admin-team-reports]').hidden = expanded;
        button.querySelector('.admin-team-arrow').classList.toggle('open', !expanded);
      });
    });
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
    renderAdminTeams();
  
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
          <button class="btn admin-delete-report" type="button" data-clear-admin-report="${escapeHTML(report.id)}" aria-label="Limpar relato ${escapeHTML(report.cat)}">Excluir</button>
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
    list.querySelectorAll('[data-clear-admin-report]').forEach((button) => {
      button.addEventListener('click', () => clearAdminReport(button.dataset.clearAdminReport));
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

  Object.assign(window, {
    showAdminView,
    scrollAdminNotifications,
    closeAdminReportDialog,
    exportAdminReports,
    loadAdminReports,
    clearAllAdminReports,
    clearAdminReport
  });

  onAppReady(initAdminDashboard);
})();
