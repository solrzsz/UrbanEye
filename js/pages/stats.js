(function () {
  'use strict';

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

  onAppReady(renderStats);
})();
