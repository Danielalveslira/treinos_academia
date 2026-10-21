;(() => {
if (window.__evolutusPublicPagesStarted) return
window.__evolutusPublicPagesStarted = true
const config = window.EVOLUTUS_PUBLIC_CONFIG || {}
const endpoint =
  typeof config.url === 'string' && /^https:\/\//.test(config.url)
    ? config.url.replace(/\/+$/, '')
    : ''
const headers = { apikey: config.key, 'Content-Type': 'application/json' }
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

const menuTrigger = document.getElementById('public-menu-trigger')
const menuPanel = document.getElementById('public-menu-panel')
if (menuTrigger && menuPanel) {
  const closeMenu = ({ restoreFocus = false } = {}) => {
    if (menuPanel.hidden) return
    menuPanel.hidden = true
    menuTrigger.setAttribute('aria-expanded', 'false')
    if (restoreFocus) menuTrigger.focus()
  }
  menuTrigger.addEventListener('click', () => {
    const opening = menuPanel.hidden
    menuPanel.hidden = !opening
    menuTrigger.setAttribute('aria-expanded', String(opening))
    if (opening) menuPanel.querySelector('a[href]')?.focus()
  })
  document.addEventListener('pointerdown', (event) => {
    if (!menuTrigger.contains(event.target) && !menuPanel.contains(event.target)) closeMenu()
  })
  document.addEventListener('focusin', (event) => {
    if (!menuTrigger.contains(event.target) && !menuPanel.contains(event.target)) closeMenu()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menuPanel.hidden) {
      event.preventDefault()
      closeMenu({ restoreFocus: true })
    }
  })
  menuPanel.addEventListener('click', (event) => {
    if (event.target.closest('a[href]')) closeMenu()
  })
  window.addEventListener('resize', () => {
    if (innerWidth > 1100) closeMenu()
  })
}

function initCommercialForm(signal) {
const form = document.getElementById('commercial-form')
if (form) {
  const status = document.getElementById('form-status')
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!form.reportValidity()) return
    const button = form.querySelector('button[type="submit"]')
    if (button.disabled) return
    if (!endpoint || !config.key) {
      status.textContent = 'O envio está indisponível no momento. Tente novamente mais tarde.'
      return
    }
    const data = new FormData(form)
    const values = Object.fromEntries(data.entries())
    button.disabled = true
    status.textContent = 'Enviando proposta…'
    try {
      const response = await fetch(`${endpoint}/rest/v1/rpc/submit_commercial_lead`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          p_company: values.company,
          p_contact: values.contact,
          p_email: values.email,
          p_whatsapp: values.whatsapp || null,
          p_segment: values.segment,
          p_website: values.website,
          p_modality: values.modality,
          p_message: values.message,
          p_privacy: values.privacy === 'on',
          p_honeypot: values.website_confirmation || '',
        }),
      })
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}))
        throw new Error(
          failure.code === 'P0001'
            ? 'rate_limited'
            : failure.code === '22023'
              ? 'invalid_submission'
              : 'submission_failed'
        )
      }
      form.reset()
      status.textContent = 'Proposta recebida. A equipe analisará as informações enviadas.'
    } catch (error) {
      status.textContent =
        error.message === 'rate_limited'
          ? 'Limite de envios atingido. Tente novamente amanhã.'
          : error.message === 'invalid_submission'
            ? 'Confira os dados informados e tente novamente.'
            : 'Não foi possível enviar a proposta. Confira sua conexão e tente novamente.'
    } finally {
      if (!signal.aborted) button.disabled = false
    }
  }, { signal })
}
}

let currentBody = null
let pageController = null
let directoryCleanup = null
let productCleanup = null
function teardownPage() {
  pageController?.abort()
  directoryCleanup?.()
  productCleanup?.()
  pageController = null
  directoryCleanup = null
  productCleanup = null
  currentBody = null
  const trigger = document.getElementById('public-menu-trigger')
  const panel = document.getElementById('public-menu-panel')
  if (trigger && panel) {
    panel.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
  }
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
  pageController = new AbortController()
  const signal = pageController.signal
  updateHeader()
  initCommercialForm(signal)
  if (document.getElementById('catalog-filters')) {
    import('/public-products.js').then(({ initProducts }) => {
      if (!signal.aborted) productCleanup = initProducts(signal)
    }).catch(() => {
      const status = document.getElementById('catalog-status')
      if (!signal.aborted && status) status.textContent = 'Não foi possível abrir a vitrine. Atualize a página e tente novamente.'
    })
  }
  if (document.getElementById('professional-filters')) {
    import('/public-professionals.js').then(({ initProfessionalDirectory }) => {
      if (!signal.aborted) directoryCleanup = initProfessionalDirectory(signal)
    }).catch(() => {
      const status = document.getElementById('directory-status')
      if (!signal.aborted && status) status.textContent = 'Não foi possível abrir o diretório. Atualize a página e tente novamente.'
    })
  }
}
document.addEventListener('DOMContentLoaded', initPage, { once: true })
document.addEventListener('turbo:load', initPage)
document.addEventListener('turbo:before-cache', teardownPage)
if (document.readyState === 'complete') initPage()
})()
