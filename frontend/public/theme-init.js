// Apply theme before React mounts to avoid a flash of the wrong theme.
// External file so the page CSP can omit 'unsafe-inline' for scripts.
(function () {
  try {
    var stored = localStorage.getItem('comflex-theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();