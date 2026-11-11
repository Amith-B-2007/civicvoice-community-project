// Runs in <head> before the page is drawn, so dark mode and large text apply without a flash.
(function () {
  var root = document.documentElement;
  var theme = null;
  var text = null;
  try {
    theme = localStorage.getItem('sb_theme');
    text = localStorage.getItem('sb_text');
  } catch (e) { /* storage blocked: fall back to the device setting */ }
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', theme);
  if (text === 'large') root.setAttribute('data-text', 'large');
})();
