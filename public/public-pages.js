;(() => {
if (window.__evolutusPublicPagesStarted) return
window.__evolutusPublicPagesStarted = true
window.va ||= function (...args) {
  ;(window.vaq ||= []).push(args)
}
if (location.hostname === 'www.evolutus.com.br' || location.hostname.endsWith('.vercel.app')) {
  const analytics = document.createElement('script')
  analytics.src = '/_vercel/insights/script.js'
  analytics.dataset.sdkn = '@vercel/analytics'
  analytics.dataset.sdkv = '2.0.1'
  analytics.defer = true
  document.head.append(analytics)
}
document.addEventListener('click', (event) => {
  const anchor = event.target.closest?.('a[href="/cadastro"]')
  if (anchor) window.va('event', { name: 'Public signup CTA', data: { page: location.pathname } })
})

let currentBody = null
function teardownPage() {
  currentBody = null
}
function updateHeader() {
  const path = location.pathname
  document.querySelectorAll('#public-header a[aria-current]').forEach((anchor) => anchor.removeAttribute('aria-current'))
  document.querySelectorAll('#public-header a[href]').forEach((anchor) => {
    if (new URL(anchor.href).pathname === path) anchor.setAttribute('aria-current', 'page')
  })
}
function initPage() {
  if (currentBody === document.body) return
  teardownPage()
  currentBody = document.body
  updateHeader()
}
document.addEventListener('DOMContentLoaded', initPage, { once: true })
document.addEventListener('turbo:load', initPage)
document.addEventListener('turbo:before-cache', teardownPage)
if (document.readyState === 'complete') initPage()
})()
