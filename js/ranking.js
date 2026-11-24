/**
 * Ranking de bairros da comunidade UrbanEye.
 *
 * Regras:
 *  - Universo: todos os bairros do município do Rio de Janeiro + bairros que
 *    apareçam em relatos (para não perder contribuições de outras localidades).
 *  - Cada relato conta como uma contribuição.
 *  - Ordenação: maior número de contribuições primeiro; empate resolvido em
 *    ordem alfabética (pt-BR).
 *  - Exibe as 10 primeiras posições. Bairros ainda sem contribuições completam
 *    o ranking com zero, deixando claro o que falta para entrar no topo.
 *  - Atualiza sozinho (Supabase Realtime + polling) e permite atualização manual.
 */
(function () {
  'use strict';

  const TOP_SIZE = 10;
  const PODIUM_SIZE = 3;
  const REFRESH_INTERVAL_MS = 45000;
  const VISIBILITY_STALE_MS = 20000;
  const INFERENCE_LIMIT = 40;
  const INFERENCE_ATTEMPT_TTL = 1000 * 60 * 60 * 6;
  const ATTEMPT_STORAGE_KEY = 'urbaneye_ranking_geocode_attempts_v1';
  const GEOCODE_STORAGE_KEY = 'urbaneye_geocode_cache_v1';

  const state = {
    initialized: false,
    loading: false,
    hasLoaded: false,
    lastLoadedAt: 0,
    reports: [],
    inferred: new Map(),
    attempted: new Set(),
    inference: {
      running: false,
      total: 0,
      done: 0,
      failed: 0
    },
    refreshTimer: null,
    realtimeChannel: null,
    realtimeTimer: null,
    renderTimer: null,
    requestId: 0
  };

  const els = {};

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHTML(value) {
    if (typeof window.escapeHTML === 'function') return window.escapeHTML(value);
    return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function normalizeName(value) {
    if (window.UrbanNeighborhoods?.normalize) return window.UrbanNeighborhoods.normalize(value);
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function titleCase(value) {
    if (window.UrbanNeighborhoods?.titleCase) return window.UrbanNeighborhoods.titleCase(value);
    return String(value || '').trim();
  }

  function clean(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function shortMunicipality(value) {
    const text = clean(value);
    if (!text) return '';
    return text.split(',')[0].trim();
  }

  function isRioMunicipality(value) {
    return normalizeName(value) === 'rio de janeiro';
  }

  function pluralContribution(count) {
    return count === 1 ? 'contribuição' : 'contribuições';
  }

  function formatTime(date) {
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } catch (error) {
      return '';
    }
  }

  function readAttempts() {
    try {
      const raw = JSON.parse(localStorage.getItem(ATTEMPT_STORAGE_KEY) || '{}');
      const now = Date.now();
      const result = new Set();
      Object.keys(raw).forEach((key) => {
        const expiresAt = Number(raw[key] || 0);
        if (expiresAt > now) result.add(key);
      });
      return result;
    } catch (error) {
      return new Set();
    }
  }

  function persistAttempts() {
    try {
      const now = Date.now();
      const payload = {};
      state.attempted.forEach((key) => {
        payload[key] = now + INFERENCE_ATTEMPT_TTL;
      });
      localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      /* localStorage indisponível: sem problema, tenta novamente na sessão. */
    }
  }

  function reportKey(report) {
    if (report?.id != null) return `id:${report.id}`;
    return `geo:${Number(report?.lat).toFixed(4)},${Number(report?.lng).toFixed(4)}`;
  }

  function readGeocodeCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(GEOCODE_STORAGE_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (error) {
      return {};
    }
  }

  /**
   * Relatos antigos sem bairro já podem ter sido geocodificados em uma visita
   * anterior (o app guarda esse resultado no localStorage). Reaproveita o cache
   * para o ranking já aparecer completo, sem repetir chamadas ao Nominatim.
   */
  function hydrateInferredFromCache() {
    const cache = readGeocodeCache();
    const keys = Object.keys(cache);
    if (!keys.length) return;

    state.reports.forEach((report) => {
      if (clean(report?.bairro || report?.neighborhood)) return;
      if (!hasValidCoordinates(report)) return;

      const key = reportKey(report);
      if (state.inferred.has(key)) return;

      const coordKey = `${Number(report.lat).toFixed(4)},${Number(report.lng).toFixed(4)}`;
      const entry = cache[coordKey];
      const location = entry?.location;
      if (!location?.bairro) return;

      state.inferred.set(key, {
        bairro: location.bairro,
        municipality: location.municipality || ''
      });
    });
  }

  function hasValidCoordinates(report) {
    const lat = Number(report?.lat);
    const lng = Number(report?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  }

  /* ------------------------------------------------------------------ */
  /* Modelo                                                              */
  /* ------------------------------------------------------------------ */

  function buildModel(reports) {
    const canonicalList = Array.isArray(window.UrbanNeighborhoods?.list)
      ? window.UrbanNeighborhoods.list
      : [];

    const groups = new Map();
    let unresolved = 0;
    let total = 0;

    (reports || []).forEach((report) => {
      const key = reportKey(report);
      const directName = clean(report?.bairro || report?.neighborhood);
      const inferred = state.inferred.get(key) || null;
      const name = directName || clean(inferred?.bairro);
      const municipality = directName
        ? shortMunicipality(report?.municipality)
        : shortMunicipality(inferred?.municipality || report?.municipality);

      if (!name) {
        unresolved += 1;
        return;
      }

      const canonical = window.UrbanNeighborhoods?.find?.(name) || null;
      const displayName = canonical?.nome || titleCase(name);
      const groupKey = normalizeName(displayName) || normalizeName(name);

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          name: displayName,
          zona: canonical?.zona || null,
          count: 0,
          municipalities: new Map()
        });
      }

      const group = groups.get(groupKey);
      group.count += 1;
      total += 1;

      if (municipality) {
        group.municipalities.set(
          municipality,
          (group.municipalities.get(municipality) || 0) + 1
        );
      }
    });

    const universe = new Map();

    canonicalList.forEach((bairro) => {
      const key = normalizeName(bairro.nome);
      if (!key) return;
      universe.set(key, {
        key,
        name: bairro.nome,
        zona: bairro.zona || null,
        count: 0,
        municipalities: new Map()
      });
    });

    groups.forEach((group, key) => {
      universe.set(key, group);
    });

    const ranked = [...universe.values()]
      .map((entry) => {
        const municipalities = [...entry.municipalities.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
        const topMunicipality = municipalities[0]?.[0] || '';
        let region = entry.zona || '';
        if (topMunicipality && !isRioMunicipality(topMunicipality)) {
          region = topMunicipality;
        } else if (!region) {
          region = topMunicipality || 'Rio de Janeiro';
        }
        return { ...entry, region, municipalities };
      })
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
      });

    const active = ranked.filter((entry) => entry.count > 0);
    const top = ranked.slice(0, TOP_SIZE);
    const leaderCount = top[0]?.count || 0;
    const displayMax = Math.max(1, leaderCount);

    return {
      ranked,
      top,
      active,
      total,
      unresolved,
      leaderCount,
      displayMax,
      hasData: total > 0,
      monitored: universe.size,
      canonicalCount: canonicalList.length || universe.size,
      generatedAt: new Date(),
      inference: { ...state.inference }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Markup                                                              */
  /* ------------------------------------------------------------------ */

  const ICONS = {
    contributions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8l4 4v14H4V3h4z"/><path d="M8 11h8M8 15h8M8 7h2"/></svg>',
    neighborhoods: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V8l5-4 5 4v13"/><path d="M15 21V11l4-2v12"/><path d="M8 10h.01M8 14h.01M8 18h.01M12 10h.01M12 14h.01M12 18h.01"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    complaint: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 16H3L12 3z"/><path d="M12 9v4M12 16h.01"/></svg>'
  };

  function progressWidth(count, max) {
    if (!count || !max) return 0;
    return Math.max(2, Math.round((count / max) * 100));
  }

  function renderStats(model) {
    if (!els.stats) return;
    const time = formatTime(model.generatedAt);
    els.stats.innerHTML = `
      <div class="ranking-stat">
        <span class="ranking-stat-icon">${ICONS.contributions}</span>
        <div class="ranking-stat-text">
          <strong>${model.total.toLocaleString('pt-BR')}</strong>
          <span>${pluralContribution(model.total)}</span>
        </div>
      </div>
      <div class="ranking-stat">
        <span class="ranking-stat-icon">${ICONS.neighborhoods}</span>
        <div class="ranking-stat-text">
          <strong>${model.active.length.toLocaleString('pt-BR')}</strong>
          <span>${model.active.length === 1 ? 'bairro ativo' : 'bairros ativos'}</span>
        </div>
      </div>
      <div class="ranking-stat">
        <span class="ranking-stat-icon">${ICONS.clock}</span>
        <div class="ranking-stat-text">
          <strong>${escapeHTML(time)}</strong>
          <span>última atualização</span>
        </div>
      </div>`;
  }

  function renderPodium(model) {
    if (!els.podium) return;
    const top = model.top.slice(0, PODIUM_SIZE);

    if (!top.length) {
      els.podium.innerHTML = '';
      return;
    }

    // Ordem visual: 2º, 1º, 3º (no mobile o CSS reordena para 1, 2, 3).
    const positions = [1, 0, 2].filter((index) => top[index]);
    els.podium.innerHTML = `<div class="ranking-podium-grid" role="list" aria-label="Pódio do ranking de bairros">${positions.map((index) => {
      const entry = top[index];
      const place = index + 1;
      const width = progressWidth(entry.count, model.displayMax);
      const idle = entry.count === 0 ? ' is-idle' : '';
      return `<article class="podium-card podium-${place}${idle}" role="listitem" aria-label="${place}º lugar: ${escapeHTML(entry.name)}, ${entry.count} ${pluralContribution(entry.count)}">
        <div class="podium-top">
          <span class="podium-place">${place}º</span>
          ${entry.region ? `<span class="ranking-region">${escapeHTML(entry.region)}</span>` : ''}
        </div>
        <h3 class="podium-name">${escapeHTML(entry.name)}</h3>
        <div class="podium-count">
          <strong>${entry.count.toLocaleString('pt-BR')}</strong>
          <span>${pluralContribution(entry.count)}</span>
        </div>
        <div class="podium-track" aria-hidden="true"><span style="width:${width}%"></span></div>
      </article>`;
    }).join('')}</div>`;
  }

  function renderRows(model) {
    if (!els.list) return;
    const rows = model.top.slice(PODIUM_SIZE);

    if (!rows.length) {
      els.list.innerHTML = '';
      if (els.listTitle) els.listTitle.hidden = true;
      return;
    }

    if (els.listTitle) els.listTitle.hidden = false;
    els.list.innerHTML = rows.map((entry, index) => {
      const place = index + PODIUM_SIZE + 1;
      const width = progressWidth(entry.count, model.displayMax);
      const idle = entry.count === 0 ? ' is-idle' : '';
      return `<div class="ranking-row${idle}" role="listitem" aria-label="${place}º lugar: ${escapeHTML(entry.name)}, ${entry.count} ${pluralContribution(entry.count)}">
        <span class="ranking-position" aria-hidden="true">${place}</span>
        <div class="ranking-neighborhood">
          <div class="ranking-name-row">
            <span class="ranking-name">${escapeHTML(entry.name)}</span>
            ${entry.region ? `<span class="ranking-region">${escapeHTML(entry.region)}</span>` : ''}
          </div>
          <div class="ranking-track" aria-hidden="true"><span style="width:${width}%"></span></div>
        </div>
        <span class="ranking-count">
          <strong>${entry.count.toLocaleString('pt-BR')}</strong>
          <span>${pluralContribution(entry.count)}</span>
        </span>
      </div>`;
    }).join('');
  }

  function renderNotice(model) {
    if (!els.notice) return;
    const messages = [];

    if (model.inference.running) {
      const total = Math.max(model.inference.total, 1);
      messages.push(`Identificando o bairro de contribuições antigas… <strong>${Math.min(model.inference.done, total)}/${total}</strong>`);
    } else if (model.unresolved > 0) {
      messages.push(`<strong>${model.unresolved}</strong> ${model.unresolved === 1 ? 'contribuição ainda não tem' : 'contribuições ainda não têm'} bairro identificado e ${model.unresolved === 1 ? 'ficou' : 'ficaram'} fora do ranking.`);
    }

    if (model.hasData && model.active.length < TOP_SIZE) {
      messages.push(`Apenas <strong>${model.active.length}</strong> ${model.active.length === 1 ? 'bairro tem' : 'bairros têm'} contribuições até agora. Os demais aparecem com zero.`);
    }

    if (!messages.length) {
      els.notice.hidden = true;
      els.notice.innerHTML = '';
      return;
    }

    els.notice.hidden = false;
    els.notice.innerHTML = `${ICONS.info}<div class="ranking-notice-text">${messages.join(' ')}</div>`;
  }

  function renderFooter(model) {
    if (!els.footer) return;
    els.footer.hidden = false;
    if (els.updatedAt) {
      els.updatedAt.textContent = model.hasLoaded === false
        ? 'Atualizando automaticamente…'
        : `Atualizado às ${formatTime(model.generatedAt)} · atualização automática a cada ${Math.round(REFRESH_INTERVAL_MS / 1000)}s`;
    }
  }

  function renderEmpty() {
    if (els.podium) els.podium.innerHTML = '';
    if (els.listTitle) els.listTitle.hidden = true;
    if (els.notice) {
      els.notice.hidden = true;
      els.notice.innerHTML = '';
    }
    if (els.list) {
      els.list.innerHTML = `<div class="ranking-empty-state">
        <span class="ranking-empty-icon">${ICONS.complaint}</span>
        <h2>Ainda não há contribuições com bairro</h2>
        <p class="muted">O ranking é montado a partir dos relatos da comunidade. Publique um problema no seu bairro para colocar a primeira posição no mapa.</p>
        <button class="btn" type="button" onclick="requireLogin()">Fazer o primeiro relato</button>
      </div>`;
    }
    if (els.stats) {
      els.stats.innerHTML = `
        <div class="ranking-stat"><span class="ranking-stat-icon">${ICONS.contributions}</span><div class="ranking-stat-text"><strong>0</strong><span>contribuições</span></div></div>
        <div class="ranking-stat"><span class="ranking-stat-icon">${ICONS.neighborhoods}</span><div class="ranking-stat-text"><strong>0</strong><span>bairros ativos</span></div></div>
        <div class="ranking-stat"><span class="ranking-stat-icon">${ICONS.clock}</span><div class="ranking-stat-text"><strong>—</strong><span>aguardando relatos</span></div></div>`;
    }
  }

  function renderError(message) {
    if (els.stats) {
      els.stats.innerHTML = `
        <div class="ranking-stat"><span class="ranking-stat-icon">${ICONS.contributions}</span><div class="ranking-stat-text"><strong>—</strong><span>contribuições</span></div></div>
        <div class="ranking-stat"><span class="ranking-stat-icon">${ICONS.neighborhoods}</span><div class="ranking-stat-text"><strong>—</strong><span>bairros ativos</span></div></div>
        <div class="ranking-stat"><span class="ranking-stat-icon">${ICONS.clock}</span><div class="ranking-stat-text"><strong>—</strong><span>sem conexão</span></div></div>`;
    }
    if (els.podium) els.podium.innerHTML = '';
    if (els.listTitle) els.listTitle.hidden = true;
    if (els.notice) {
      els.notice.hidden = true;
      els.notice.innerHTML = '';
    }
    if (els.list) {
      els.list.innerHTML = `<div class="ranking-empty-state ranking-error-state">
        <span class="ranking-empty-icon">${ICONS.info}</span>
        <h2>Não foi possível carregar o ranking</h2>
        <p class="muted">${escapeHTML(message || 'Verifique sua conexão e tente novamente.')}</p>
        <button class="btn secondary" type="button" onclick="refreshNeighborhoodRanking()">Tentar novamente</button>
      </div>`;
    }
    if (els.updatedAt) els.updatedAt.textContent = 'Falha ao atualizar · tentaremos novamente em instantes';
  }

  function skeletonRow() {
    return `<div class="ranking-row ranking-skeleton-row" aria-hidden="true">
      <span class="ranking-skeleton ranking-skeleton-badge"></span>
      <div class="ranking-neighborhood">
        <span class="ranking-skeleton ranking-skeleton-name"></span>
        <span class="ranking-skeleton ranking-skeleton-track"></span>
      </div>
      <span class="ranking-skeleton ranking-skeleton-count"></span>
    </div>`;
  }

  function renderSkeleton() {
    if (els.stats) {
      els.stats.innerHTML = Array.from({ length: 3 }).map(() => `
        <div class="ranking-stat ranking-skeleton-stat" aria-hidden="true">
          <span class="ranking-skeleton ranking-skeleton-icon"></span>
          <div class="ranking-stat-text">
            <span class="ranking-skeleton ranking-skeleton-value"></span>
            <span class="ranking-skeleton ranking-skeleton-label"></span>
          </div>
        </div>`).join('');
    }
    if (els.podium) {
      els.podium.innerHTML = `<div class="ranking-podium-grid" aria-hidden="true">${Array.from({ length: 3 }).map(() => `
        <div class="podium-card ranking-skeleton-podium">
          <span class="ranking-skeleton ranking-skeleton-badge"></span>
          <span class="ranking-skeleton ranking-skeleton-name"></span>
          <span class="ranking-skeleton ranking-skeleton-value"></span>
          <span class="ranking-skeleton ranking-skeleton-track"></span>
        </div>`).join('')}</div>`;
    }
    if (els.listTitle) els.listTitle.hidden = true;
    if (els.notice) {
      els.notice.hidden = true;
      els.notice.innerHTML = '';
    }
    if (els.list) {
      els.list.setAttribute('aria-busy', 'true');
      els.list.innerHTML = Array.from({ length: 4 }).map(skeletonRow).join('');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  function render() {
    const model = buildModel(state.reports);
    state.lastModel = model;

    if (els.list) els.list.setAttribute('aria-busy', 'false');

    if (!model.hasData) {
      renderEmpty();
      renderFooter({ ...model, hasLoaded: true });
      els.footer?.setAttribute('data-state', 'empty');
      return;
    }

    els.footer?.setAttribute('data-state', 'data');
    renderStats(model);
    renderPodium(model);
    renderRows(model);
    renderNotice(model);
    renderFooter({ ...model, hasLoaded: true });
  }

  function scheduleRender() {
    if (state.renderTimer) clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(() => {
      state.renderTimer = null;
      render();
    }, 450);
  }

  /* ------------------------------------------------------------------ */
  /* Inferência de bairro para relatos antigos                           */
  /* ------------------------------------------------------------------ */

  async function enrichLegacyReports() {
    if (state.inference.running) return;
    if (typeof window.identifyLocation !== 'function') return;
    if (navigator.onLine === false) return;

    const pending = state.reports.filter((report) => {
      if (clean(report?.bairro || report?.neighborhood)) return false;
      if (!hasValidCoordinates(report)) return false;
      return !state.attempted.has(reportKey(report));
    }).slice(0, INFERENCE_LIMIT);

    if (!pending.length) return;

    state.inference = {
      running: true,
      total: pending.length,
      done: 0,
      failed: 0
    };
    renderNotice(buildModel(state.reports));

    for (const report of pending) {
      if (navigator.onLine === false) break;
      const key = reportKey(report);
      if (state.attempted.has(key)) continue;
      state.attempted.add(key);

      try {
        const location = await window.identifyLocation(Number(report.lat), Number(report.lng));
        if (location?.bairro) {
          state.inferred.set(key, {
            bairro: location.bairro,
            municipality: location.municipality || ''
          });
        } else {
          state.inference.failed += 1;
        }
      } catch (error) {
        state.inference.failed += 1;
        console.warn('Não foi possível identificar o bairro de um relato antigo:', error);
      } finally {
        state.inference.done += 1;
        persistAttempts();
        // Atualiza o contador sem redesenhar o ranking inteiro a cada consulta.
        const model = buildModel(state.reports);
        renderNotice(model);
        if (state.inference.done % 2 === 0 || state.inference.done === state.inference.total) {
          scheduleRender();
        }
      }
    }

    state.inference.running = false;
    persistAttempts();
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Carregamento e atualização                                          */
  /* ------------------------------------------------------------------ */

  async function load({ manual = false } = {}) {
    if (state.loading) return;
    if (typeof window.UrbanAPI?.getNeighborhoodReports !== 'function') {
      renderError('A fonte de dados da comunidade não está disponível.');
      return;
    }

    state.loading = true;
    const requestId = ++state.requestId;

    if (manual) setRefreshLoading(true);
    if (!state.hasLoaded) renderSkeleton();

    try {
      const reports = await window.UrbanAPI.getNeighborhoodReports();
      if (requestId !== state.requestId) return;

      state.reports = Array.isArray(reports) ? reports : [];
      hydrateInferredFromCache();
      state.lastLoadedAt = Date.now();
      state.hasLoaded = true;
      render();

      // Depois da primeira pintura, tenta identificar o bairro de relatos antigos.
      enrichLegacyReports();
    } catch (error) {
      console.error('Erro ao carregar o ranking de bairros:', error);
      if (requestId === state.requestId) {
        renderError(error?.message || 'Não foi possível carregar as contribuições.');
      }
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        if (manual) setRefreshLoading(false);
      }
    }
  }

  function setRefreshLoading(isLoading) {
    if (!els.refreshButton) return;
    els.refreshButton.disabled = isLoading;
    els.refreshButton.classList.toggle('is-loading', isLoading);
    const label = els.refreshButton.querySelector('.ranking-refresh-label');
    if (label) label.textContent = isLoading ? 'Atualizando…' : 'Atualizar';
  }

  function refresh(manual = false) {
    return load({ manual: manual === true });
  }

  /* ------------------------------------------------------------------ */
  /* Tempo real                                                          */
  /* ------------------------------------------------------------------ */

  function scheduleRealtimeRefresh() {
    if (state.realtimeTimer) clearTimeout(state.realtimeTimer);
    state.realtimeTimer = setTimeout(() => {
      state.realtimeTimer = null;
      load();
    }, 1200);
  }

  function subscribeRealtime() {
    if (state.realtimeChannel) return;
    const client = window.supabaseClient;
    if (!client?.channel) return;

    try {
      state.realtimeChannel = client
        .channel('urbaneye-ranking-reports')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'reports'
        }, scheduleRealtimeRefresh)
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('Realtime do ranking indisponível; usando atualização por intervalo.');
          }
        });
    } catch (error) {
      console.warn('Não foi possível assinar atualizações em tempo real:', error);
      state.realtimeChannel = null;
    }
  }

  function unsubscribeRealtime() {
    if (!state.realtimeChannel) return;
    try {
      (window.supabaseClient?.removeChannel || window.supabaseClient?.removeSubscription)
        ?.call(window.supabaseClient, state.realtimeChannel);
    } catch (error) {
      /* ignore */
    }
    state.realtimeChannel = null;
  }

  function startTimers() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_INTERVAL_MS);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('storage', onStorageChange);
    window.addEventListener('pagehide', teardown);
    window.addEventListener('pageshow', onPageShow);
  }

  function onVisibilityChange() {
    if (document.hidden) return;
    if (Date.now() - state.lastLoadedAt > VISIBILITY_STALE_MS) load();
  }

  function onStorageChange(event) {
    if (!event.key || !event.key.startsWith('urbaneye_')) return;
    if (event.key === 'urbaneye_guest_reports') load();
  }

  function onPageShow(event) {
    if (event.persisted) load();
  }

  function teardown() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    if (state.realtimeTimer) {
      clearTimeout(state.realtimeTimer);
      state.realtimeTimer = null;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('storage', onStorageChange);
    window.removeEventListener('pageshow', onPageShow);
    unsubscribeRealtime();
  }

  /* ------------------------------------------------------------------ */
  /* Inicialização                                                       */
  /* ------------------------------------------------------------------ */

  function init() {
    if (state.initialized) return;
    state.initialized = true;

    els.list = $('neighborhoodRanking');
    els.podium = $('rankingPodium');
    els.stats = $('rankingStats');
    els.notice = $('rankingNotice');
    els.footer = $('rankingFooter');
    els.updatedAt = $('rankingUpdatedAt');
    els.refreshButton = $('refreshNeighborhoodRanking');
    els.listTitle = $('rankingListTitle');

    if (!els.list) return;

    state.attempted = readAttempts();
    renderSkeleton();
    load();
    startTimers();
    subscribeRealtime();
  }

  window.UrbanRanking = {
    init,
    refresh,
    getModel: () => state.lastModel || null
  };

  // Mantém o onclick existente na página funcionando.
  window.refreshNeighborhoodRanking = function refreshNeighborhoodRanking() {
    refresh(true);
  };
})();
