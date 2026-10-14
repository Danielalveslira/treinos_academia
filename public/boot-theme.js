// Synchronous, before the first paint; kept external for script-src 'self'.
try {
  var mode = localStorage.getItem('colorMode') || 'auto'
  document.documentElement.setAttribute('data-color-mode', mode)
  document.documentElement.setAttribute('data-light-theme', 'light')
  document.documentElement.setAttribute('data-dark-theme', 'dark')
} catch { /* Storage can be unavailable in private browsing. */ }
