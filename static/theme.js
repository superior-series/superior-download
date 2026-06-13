'use strict';

(function () {
  var THEME_KEY = 'superior-download-theme';

  function getTheme() {
    return localStorage.getItem(THEME_KEY) || 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.classList.toggle('light-mode', theme === 'light');
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.textContent = theme === 'light' ? '☀️' : '🌙';
    btn.dataset.tooltip = theme === 'light' ? 'ライトモード' : 'ダークモード';
  }

  applyTheme(getTheme());

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(getTheme());

    var btn = document.getElementById('theme-toggle');
    if (!btn) return;

    btn.addEventListener('click', function () {
      var isLight = document.documentElement.classList.toggle('light-mode');
      var theme = isLight ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, theme);
      btn.textContent = isLight ? '☀️' : '🌙';
      btn.dataset.tooltip = isLight ? 'ライトモード' : 'ダークモード';
    });
  });
})();
