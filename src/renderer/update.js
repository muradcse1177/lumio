'use strict';
/* Shared auto-update banner — loaded by both the activation and studio pages.
   The main process downloads updates silently; this only shows progress and
   the final "restart to install" prompt. */
(function () {
  var nx = window.lumio;
  var banner = document.getElementById('updBanner');
  if (!nx || !nx.onUpdateEvent || !banner) return;

  var ico = document.getElementById('updIco');
  var title = document.getElementById('updTitle');
  var sub = document.getElementById('updSub');
  var btn = document.getElementById('updBtn');
  var close = document.getElementById('updClose');

  nx.onUpdateEvent(function (m) {
    if (m.state === 'downloading') {
      banner.className = 'upd-banner show';
      ico.textContent = '⬇';
      title.textContent = 'Downloading update…';
      sub.textContent = (m.percent || 0) + '% complete';
      btn.style.display = 'none';
    } else if (m.state === 'ready') {
      banner.className = 'upd-banner show ready';
      ico.textContent = '✓';
      title.textContent = 'Update ready — v' + m.version;
      sub.textContent = 'Restart Lumio to install the new version.';
      btn.style.display = '';
    }
    /* 'available' / 'none' / 'error' stay silent */
  });

  btn.onclick = function () {
    btn.textContent = 'Restarting…';
    btn.disabled = true;
    nx.installUpdate();
  };
  close.onclick = function () { banner.classList.remove('show'); };
})();
