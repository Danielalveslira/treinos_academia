// Presentation invalidation only; PostgreSQL and the media gateway remain authoritative.
const content =
  document.querySelector('[data-public-lease]') || document.getElementById('storefront-content')
function clearExpired() {
  if (!content) return
  document.title = 'Publicação indisponível | Evolutus'
  document.querySelectorAll('script[type="application/ld+json"]').forEach((node) => node.remove())
  document
    .querySelectorAll(
      'meta[name="description"], meta[property="og:title"], meta[property="og:description"], meta[name="twitter:title"], meta[name="twitter:description"]'
    )
    .forEach((node) => node.setAttribute('content', 'Publicação indisponível'))
  document.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex,follow')
  content.replaceChildren(
    Object.assign(document.createElement('p'), {
      textContent: 'Publicação indisponível. Atualize a página para consultar novamente.',
    })
  )
}
if (content?.dataset.expires) {
  const duration = Date.parse(content.dataset.expires) - Date.parse(content.dataset.serverTime)
  const remaining = duration - performance.now()
  if (!Number.isFinite(remaining) || remaining <= 0) clearExpired()
  else setTimeout(clearExpired, Math.min(remaining, 2147483647))
}
window.addEventListener('pagehide', clearExpired)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearExpired()
})
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload()
})
