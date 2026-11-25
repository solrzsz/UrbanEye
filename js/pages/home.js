(function () {
  'use strict';

  async function loadHome() {
    const problems = await UrbanAPI.getProblems();
    document.getElementById('homeCount').textContent = problems.length;
  }

  onAppReady(loadHome);
})();
