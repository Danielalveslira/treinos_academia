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
  if (location.pathname === '/como-funciona') {
    const howLink = event.target.closest?.('.how-page a[href="/demo"], .how-page a[href="/cadastro"]')
    if (howLink)
      window.va('event', { name: howLink.getAttribute('href') === '/demo' ? 'How it works demo clicked' : 'How it works signup clicked' })
  }
})

let currentBody = null
let currentPath = location.pathname
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
  if (currentBody === document.body && currentPath === location.pathname) return
  const previousPath = currentPath
  teardownPage()
  currentBody = document.body
  currentPath = location.pathname
  if (currentPath === '/como-funciona') window.va('event', { name: 'How it works viewed' })
  if (previousPath === '/como-funciona' && currentPath === '/demo')
    window.va('event', { name: 'How it works demo opened' })
  updateHeader()
}
document.addEventListener('DOMContentLoaded', initPage, { once: true })
document.addEventListener('turbo:load', initPage)
document.addEventListener('turbo:before-cache', teardownPage)
if (document.readyState === 'complete') initPage()
})()
