(function () {
  'use strict';

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
  
    if (typeof window.applyMapFilters === 'function') {
    window.applyMapFilters(state);
    toast('Filtros aplicados.');
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
  
    if (typeof window.applyMapFilters === 'function') {
    window.applyMapFilters(getFilterState());
  }
  
    toast(`Filtro "${el.textContent.trim()}" aplicado na view.`);
  }

  Object.assign(window, {applyFilters, filterChip});

})();
