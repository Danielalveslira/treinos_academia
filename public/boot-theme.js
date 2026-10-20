// Synchronous, before the first paint; kept external for script-src 'self'.
try {
  var mode = localStorage.getItem('colorMode') || 'auto'
  document.documentElement.setAttribute('data-color-mode', mode)
  document.documentElement.setAttribute('data-light-theme', 'light')
  document.documentElement.setAttribute('data-dark-theme', 'dark')
  // Public product pages use a dark default. An explicit light choice still applies.
  document.documentElement.setAttribute('data-public-theme', mode === 'light' ? 'light' : 'dark')
} catch { /* Storage can be unavailable in private browsing. */ }
