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

function initProducts(signal) {
const products = document.getElementById('products')
if (products) {
  const productTemplate = document.getElementById('product-card-template')
  const status = document.getElementById('catalog-status')
  const category = document.getElementById('category')
  const retry = document.querySelector('.catalog-retry')
  let loadedRows = []
  const showEmpty = (title, message) => {
    products.replaceChildren()
    products.setAttribute('aria-busy', 'false')
    const empty = document.createElement('div')
    empty.className = 'catalog-empty'
    const symbol = document.createElement('span')
    symbol.className = 'catalog-empty-symbol'
    symbol.textContent = '◇'
    symbol.setAttribute('aria-hidden', 'true')
    const heading = document.createElement('h3')
    heading.textContent = title
    const body = document.createElement('p')
    body.textContent = message
    empty.append(symbol, heading, body)
    products.append(empty)
  }
  const safeHttps = (raw) => {
    try {
      const u = new URL(raw)
      return u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        /\.[a-z]{2,}$/i.test(u.hostname) &&
        !/^[\d.]+$/.test(u.hostname)
        ? u.href
        : null
    } catch {
      return null
    }
  }
  const render = (rows) => {
    products.replaceChildren()
    products.setAttribute('aria-busy', 'false')
    const visible = rows.filter((row) => (!category.value || row.category === category.value) && safeHttps(row.store_url))
    status.textContent = visible.length
      ? `${visible.length} produto${visible.length === 1 ? '' : 's'} disponível${visible.length === 1 ? '' : 's'}.`
      : category.value ? 'Ainda não há produtos nesta categoria.' : 'Ainda não há produtos disponíveis.'
    if (!visible.length)
      showEmpty(
        category.value ? 'Nenhum produto nesta categoria.' : 'A vitrine está em preparação.',
        category.value ? 'Escolha outra categoria para continuar.' : 'Produtos aprovados aparecerão aqui.'
      )
    for (const row of visible) {
      const href = safeHttps(row.store_url)
      const card = productTemplate.content.firstElementChild.cloneNode(true)
      const imageSlot = card.querySelector('.product-image')
      if (row.image_url && safeHttps(row.image_url)) {
        const img = document.createElement('img')
        img.src = row.image_url
        img.alt = row.name
        img.width = 480
        img.height = 360
        img.loading = 'lazy'
        img.className = 'product-image'
        img.addEventListener('error', () => {
          img.replaceWith(
            Object.assign(document.createElement('div'), {
              className: 'product-image product-placeholder',
              textContent: 'Imagem indisponível',
            })
          )
        })
        imageSlot.replaceWith(img)
      }
      card.querySelector('.product-brand').textContent = row.brand
      card.querySelector('.product-name').textContent = row.name
      card.querySelector('.product-description').textContent = row.description
      card.querySelector('.product-tag').textContent = row.sponsored ? 'Patrocinado · ' + row.category : row.category
      const link = card.querySelector('.product-link')
      link.href = href
      link.target = '_blank'
      link.rel = row.sponsored ? 'noopener noreferrer sponsored' : 'noopener noreferrer'
      products.append(card)
    }
  }
  const loadProducts = async () => {
    retry.hidden = true
    status.textContent = 'Carregando produtos…'
    products.setAttribute('aria-busy', 'true')
    products.replaceChildren(...Array.from({ length: 3 }, () => {
      const skeleton = document.createElement('div')
      skeleton.className = 'catalog-skeleton'
      skeleton.setAttribute('aria-hidden', 'true')
      return skeleton
    }))
    if (!endpoint || !config.key) {
      status.textContent = 'A vitrine está indisponível no momento.'
      showEmpty('Voltamos em breve.', 'Não foi possível consultar os produtos agora. Tente novamente mais tarde.')
      return
    }
    try {
      const response = await fetch(
        `${endpoint}/rest/v1/partner_products?select=name,brand,description,category,image_url,store_url,sponsored&order=created_at.desc&limit=100`,
        { headers: { apikey: config.key }, signal }
      )
      if (!response.ok) throw new Error('catalog_failed')
      loadedRows = await response.json()
      category.replaceChildren(category.options[0])
      const categories = [...new Set(loadedRows.map((row) => row.category))].sort()
      for (const name of categories) {
        const option = document.createElement('option')
        option.value = name
        option.textContent = name
        category.append(option)
      }
      render(loadedRows)
    } catch {
      if (signal.aborted) return
      status.textContent = 'Não foi possível carregar os produtos.'
      showEmpty('Não conseguimos carregar a seleção.', 'Tente novamente para consultar os produtos.')
      retry.hidden = false
    }
  }
  category.addEventListener('change', () => render(loadedRows), { signal })
  retry.querySelector('button').addEventListener('click', loadProducts, { signal })
  loadProducts()
}

}

let currentBody = null
let pageController = null
let directoryCleanup = null
function teardownPage() {
  pageController?.abort()
  directoryCleanup?.()
  pageController = null
  directoryCleanup = null
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
  initProducts(signal)
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
