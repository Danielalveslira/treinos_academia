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
      button.disabled = false
    }
  })
}

const products = document.getElementById('products')
if (products) {
  const status = document.getElementById('catalog-status')
  const category = document.getElementById('category')
  const showEmpty = (title, message) => {
    products.replaceChildren()
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
    const visible = rows.filter((row) => !category.value || row.category === category.value)
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
      if (!href) continue
      const card = document.createElement('article')
      card.className = 'product-card'
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
        card.append(img)
      } else {
        const placeholder = document.createElement('div')
        placeholder.className = 'product-image product-placeholder'
        placeholder.textContent = 'Imagem indisponível'
        card.append(placeholder)
      }
      const brand = document.createElement('p')
      brand.className = 'product-brand'
      brand.textContent = row.brand
      const title = document.createElement('h2')
      title.textContent = row.name
      const description = document.createElement('p')
      description.textContent = row.description
      const tag = document.createElement('p')
      tag.textContent = row.sponsored ? 'Patrocinado · ' + row.category : row.category
      tag.className = 'product-tag'
      const link = document.createElement('a')
      link.href = href
      link.target = '_blank'
      link.rel = row.sponsored ? 'noopener noreferrer sponsored' : 'noopener noreferrer'
      link.className = 'button product-link'
      link.textContent = 'Ver na loja ↗'
      const body = document.createElement('div')
      body.className = 'product-card-body'
      body.append(brand, title, description, tag, link)
      card.append(body)
      products.append(card)
    }
  }
  if (!endpoint || !config.key) {
    status.textContent = 'A vitrine está indisponível no momento.'
    showEmpty(
      'Voltamos em breve.',
      'Não foi possível consultar os produtos agora. Tente novamente mais tarde.'
    )
  } else
    fetch(
      `${endpoint}/rest/v1/partner_products?select=name,brand,description,category,image_url,store_url,sponsored&order=created_at.desc&limit=100`,
      { headers: { apikey: config.key } }
    )
      .then((response) => {
        if (!response.ok) throw new Error('catalog_failed')
        return response.json()
      })
      .then((rows) => {
        const categories = [...new Set(rows.map((row) => row.category))].sort()
        for (const name of categories) {
          const option = document.createElement('option')
          option.value = name
          option.textContent = name
          category.append(option)
        }
        category.addEventListener('change', () => render(rows))
        render(rows)
      })
      .catch(() => {
        status.textContent = 'Não foi possível carregar os produtos. Tente atualizar a página.'
        showEmpty('Não conseguimos carregar a seleção.', 'Atualize a página para tentar novamente.')
      })
}
