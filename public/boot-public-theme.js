// Resolve the theme before the first paint on static public pages.
try {
  var preference = matchMedia('(prefers-color-scheme: dark)')
  var manualMode
  function applyTheme() {
    var savedMode = manualMode || 'auto'
    if (!manualMode) {
      try { savedMode = localStorage.getItem('colorMode') || 'auto' } catch { /* Private browsing. */ }
    }
    var mode = savedMode === 'light' ? 'day' : savedMode === 'dark' ? 'night' : savedMode
    if (!['auto', 'day', 'night'].includes(mode)) mode = 'auto'
    var dark = mode === 'night' || (mode === 'auto' && preference.matches)
    document.documentElement.setAttribute('data-color-mode', dark ? 'dark' : 'light')
    document.documentElement.setAttribute('data-public-theme', dark ? 'dark' : 'light')
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    dispatchEvent(new Event('public-theme-change'))
  }
  window.setPublicTheme = function (mode) {
    manualMode = mode === 'dark' ? 'dark' : 'light'
    try { localStorage.setItem('colorMode', manualMode) } catch { /* Private browsing. */ }
    applyTheme()
  }
  document.documentElement.setAttribute('data-light-theme', 'light')
  document.documentElement.setAttribute('data-dark-theme', 'dark')
  applyTheme()
  preference.addEventListener('change', applyTheme)
  addEventListener('storage', function (event) {
    if (event.key === 'colorMode') { manualMode = undefined; applyTheme() }
  })
} catch { /* Storage can be unavailable in private browsing. */ }
