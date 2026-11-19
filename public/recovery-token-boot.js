// Remove recovery credentials before the app, analytics, theme or other scripts run.
// Keep the value only in this page's memory until the recovery hook consumes it.
if (window.location.pathname === '/redefinir-senha') {
  const query = new URLSearchParams(window.location.search)
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const source = fragment.has('token_hash') ? fragment : query
  window.__EVOLUTUS_RECOVERY_TOKEN = {
    tokenHash: source.get('token_hash'),
    type: source.get('type'),
  }
  if (window.location.search || window.location.hash) {
    window.history.replaceState(window.history.state, '', window.location.pathname)
  }
}
