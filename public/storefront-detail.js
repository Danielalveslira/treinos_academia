// Presentation invalidation only; PostgreSQL and the media gateway remain authoritative.
const content = document.getElementById('storefront-content')
function clearExpired() {
 if (!content) return
 content.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Vitrine indisponível. Atualize a página para consultar novamente.' }))
}
if (content?.dataset.expires) {
 // The HTTP Date header is not available to an HTML script; read a fresh HEAD from server.
 fetch(location.href, { method: 'HEAD', cache: 'no-store' }).then(response => {
  if (!response.ok) return clearExpired()
  const server = Date.parse(response.headers.get('date') || '')
  const end = Date.parse(content.dataset.expires)
  if (!Number.isFinite(server) || !Number.isFinite(end)) return clearExpired()
  setTimeout(clearExpired, Math.max(0, Math.min(end-server-1000,2147483647)))
 }).catch(clearExpired)
}
window.addEventListener('pagehide', clearExpired)
document.addEventListener('visibilitychange', () => { if (document.hidden) clearExpired() })
window.addEventListener('pageshow', event => { if (event.persisted) location.reload() })
