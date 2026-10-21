const PAGE_SIZE = 20
const GROUP_SIZE = 5

function safeHttps(raw) {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password &&
      /\.[a-z]{2,}$/i.test(url.hostname) && !/^[\d.]+$/.test(url.hostname) ? url.href : null
  } catch { return null }
}

function element(tag, className, value) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (value != null) node.textContent = value
  return node
}

export function initProducts(signal) {
  const config = window.EVOLUTUS_PUBLIC_CONFIG || {}
  const endpoint = typeof config.url === 'string' && /^https:\/\/[^/]+$/.test(config.url.replace(/\/+$/, ''))
    ? config.url.replace(/\/+$/, '') : ''
  const form = document.getElementById('catalog-filters')
  const search = document.getElementById('catalog-search')
  const category = document.getElementById('category')
  const categoryTrigger = document.getElementById('category-trigger')
  const categoryMenu = document.getElementById('category-options')
  const categoryValue = document.getElementById('category-value')
  const clear = document.getElementById('catalog-clear')
  const status = document.getElementById('catalog-status')
  const products = document.getElementById('products')
  const more = document.getElementById('catalog-more')
  const retry = document.querySelector('.catalog-retry')
  const dialog = document.getElementById('product-dialog')
  const template = document.getElementById('product-card-template')
  const rows = new Map()
  let brand = ''
  let offset = 0
  let total = 0
  let controller
  let requestId = 0
  let timer
  let opener

  // Keep the native select as a usable fallback until this module initializes.
  category.hidden = true
  categoryTrigger.hidden = false
  categoryTrigger.disabled = true
  categoryTrigger.setAttribute('aria-busy', 'true')
  document.getElementById('category-label').htmlFor = categoryTrigger.id

  function categoryOptions() {
    return [...categoryMenu.querySelectorAll('[role="option"]')]
  }

  function syncCategory() {
    const selected = [...category.options].find((option) => option.value === category.value)
    categoryValue.textContent = selected?.textContent || 'Todas as categorias'
    for (const option of categoryOptions()) {
      const active = option.dataset.value === category.value
      option.setAttribute('aria-selected', String(active))
      option.querySelector('.category-check').hidden = !active
    }
  }

  function buildCategoryMenu() {
    const fragment = document.createDocumentFragment()
    for (const [index, source] of [...category.options].entries()) {
      const option = element('button', 'category-option')
      option.type = 'button'
      option.id = `category-option-${index}`
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', 'false')
      option.tabIndex = -1
      option.dataset.value = source.value
      option.append(element('span', '', source.textContent))
      const check = element('span', 'category-check', '✓')
      check.setAttribute('aria-hidden', 'true')
      option.append(check)
      fragment.append(option)
    }
    categoryMenu.replaceChildren(fragment)
    syncCategory()
  }

  function closeCategory(restoreFocus = false) {
    if (categoryMenu.hidden) return
    categoryMenu.hidden = true
    categoryTrigger.setAttribute('aria-expanded', 'false')
    if (restoreFocus) categoryTrigger.focus()
  }

  function openCategory() {
    if (categoryTrigger.disabled) return
    categoryMenu.hidden = false
    categoryTrigger.setAttribute('aria-expanded', 'true')
    categoryMenu.dataset.placement = 'bottom'
    const bounds = categoryTrigger.getBoundingClientRect()
    const below = innerHeight - bounds.bottom
    const above = bounds.top
    const height = Math.min(categoryMenu.scrollHeight, 320)
    const placeTop = below < height + 12 && above > below
    categoryMenu.dataset.placement = placeTop ? 'top' : 'bottom'
    categoryMenu.style.maxHeight = `${Math.max(80, (placeTop ? above : below) - 16)}px`
    ;(categoryMenu.querySelector('[aria-selected="true"]') || categoryOptions()[0])?.focus()
  }

  function chooseCategory(value) {
    closeCategory(true)
    if (category.value === value) return
    category.value = value
    syncCategory()
    category.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function readUrl() {
    const params = new URLSearchParams(location.search)
    search.value = (params.get('busca') || '').slice(0, 80)
    const selectedCategory = (params.get('categoria') || '').slice(0, 80)
    if (selectedCategory && ![...category.options].some((option) => option.value === selectedCategory)) {
      const option = document.createElement('option')
      option.value = selectedCategory
      option.textContent = selectedCategory
      category.append(option)
    }
    category.value = selectedCategory
    syncCategory()
    brand = (params.get('marca') || '').slice(0, 120)
    clear.hidden = !(search.value || category.value || brand)
  }

  function writeUrl() {
    const params = new URLSearchParams()
    if (search.value.trim()) params.set('busca', search.value.trim())
    if (category.value) params.set('categoria', category.value)
    if (brand) params.set('marca', brand)
    const next = `${location.pathname}${params.size ? `?${params}` : ''}`
    if (next !== location.pathname + location.search) history.pushState(history.state, '', next)
    clear.hidden = !params.size
  }

  function closeDialog(restore = true) {
    if (dialog.open) dialog.close()
    dialog.querySelector('.product-dialog-image').replaceChildren(element('span', '', 'Carregando imagem…'))
    if (restore && opener?.isConnected) opener.focus()
    opener = null
  }

  function card(row, grouped = false, priority = false) {
    const href = safeHttps(row.store_url)
    if (!href || !row.id) return null
    rows.set(row.id, row)
    const card = template.content.firstElementChild.cloneNode(true)
    card.dataset.productId = row.id
    const button = card.querySelector('.product-image-button')
    const imageUrl = safeHttps(row.image_url)
    if (imageUrl) {
      const img = element('img', 'product-image')
      img.src = imageUrl
      img.alt = ''
      img.width = 240
      img.height = 180
      img.loading = priority ? 'eager' : 'lazy'
      img.decoding = 'async'
      if (priority) img.fetchPriority = 'high'
      button.replaceChildren(img)
    }
    button.setAttribute('aria-label', `Ampliar imagem de ${row.name}`)
    const brandNode = card.querySelector('.product-brand')
    brandNode.textContent = row.brand || ''
    brandNode.hidden = grouped
    card.querySelector('.product-name').textContent = row.name || 'Produto'
    card.querySelector('.product-description').textContent = row.description || ''
    card.querySelector('.product-category').textContent = row.category || ''
    card.querySelector('.product-sponsored').hidden = !row.sponsored
    const link = card.querySelector('.product-link')
    link.href = href
    link.target = '_blank'
    link.rel = row.sponsored ? 'noopener noreferrer sponsored' : 'noopener noreferrer'
    return card
  }

  function empty(message) {
    products.replaceChildren(element('p', 'catalog-empty', message))
  }

  function request(mode, values, activeSignal) {
    return fetch(`${endpoint}/rest/v1/rpc/public_product_catalog`, {
      method: 'POST',
      headers: { apikey: config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_mode: mode, ...values }),
      signal: activeSignal,
      cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}))
        throw Object.assign(new Error('catalog_failed'), { code: failure.code, status: response.status })
      }
      return response.json()
    })
  }

  function addGroup(group, fragment) {
    const section = element('section', 'product-group')
    const heading = element('div', 'product-group-heading')
    const title = element('h2', '', group.brand)
    const count = element('span', '', `${group.count} produto${group.count === 1 ? '' : 's'}`)
    heading.append(title, count)
    const grid = element('div', 'products-grid')
    const items = Array.isArray(group.items) ? group.items : []
    for (const [index, row] of items.entries()) {
      const node = card(row, true, offset === 0 && fragment.childElementCount === 0 && index === 0)
      if (node) grid.append(node)
    }
    section.append(heading, grid)
    if (group.count > items.length) {
      const all = element('button', 'product-group-all', `Ver todos os ${group.count} produtos ↗`)
      all.type = 'button'
      all.dataset.brand = group.key
      section.append(all)
    }
    fragment.append(section)
  }

  function render(page, append, grouped) {
    const fragment = document.createDocumentFragment()
    const list = grouped ? page.groups : page.items
    if (grouped) {
      for (const group of Array.isArray(list) ? list : []) addGroup(group, fragment)
      total = Number(page.totalBrands) || 0
    } else {
      const grid = products.querySelector('.products-grid') || element('div', 'products-grid')
      for (const [index, row] of (Array.isArray(list) ? list : []).entries()) {
        const node = card(row, false, offset === 0 && index === 0)
        if (node) grid.append(node)
      }
      if (!append) fragment.append(grid)
      total = Number(page.totalProducts) || 0
    }
    if (!append) products.replaceChildren(fragment)
    else if (grouped) products.append(fragment)
    offset += (Array.isArray(list) ? list.length : 0)
    more.hidden = offset >= total || !list?.length
    status.dataset.state = 'ready'
    const productCount = Number(page.totalProducts) || 0
    const brandCount = Number(page.totalBrands) || 0
    status.textContent = `${productCount} produto${productCount === 1 ? '' : 's'} encontrado${productCount === 1 ? '' : 's'} · ${brandCount} marca${brandCount === 1 ? '' : 's'} representada${brandCount === 1 ? '' : 's'}.`
    if (!productCount) empty('Nenhum produto encontrado. Ajuste a busca ou a categoria.')
  }

  async function load(append = false) {
    controller?.abort()
    controller = new AbortController()
    const current = ++requestId
    const grouped = !search.value.trim() && !category.value && !brand
    if (!append) {
      offset = 0
      rows.clear()
      products.replaceChildren()
    }
    more.hidden = true
    more.disabled = true
    retry.hidden = true
    products.setAttribute('aria-busy', 'true')
    status.dataset.state = 'loading'
    status.textContent = append ? 'Carregando mais produtos…' : 'Carregando produtos…'
    if (!endpoint || !config.key) {
      status.textContent = 'A vitrine está indisponível no momento.'
      status.dataset.state = 'error'
      empty('Não foi possível consultar os produtos agora.')
      products.setAttribute('aria-busy', 'false')
      return
    }
    try {
      const page = await request(grouped ? 'groups' : 'items', {
        p_search: search.value.trim(), p_category: category.value, p_brand: brand,
        p_offset: offset, p_limit: grouped ? GROUP_SIZE : PAGE_SIZE,
      }, controller.signal)
      if (current !== requestId || signal.aborted) return
      render(page, append, grouped)
    } catch (error) {
      if (error.name === 'AbortError' || current !== requestId || signal.aborted) return
      status.textContent = error.code === 'PGRST202'
        ? 'A vitrine está temporariamente indisponível.'
        : 'Não foi possível carregar os produtos.'
      status.dataset.state = 'error'
      if (!append) empty(error.code === 'PGRST202'
        ? 'Não foi possível consultar os produtos agora. Tente novamente mais tarde.'
        : 'Confira a conexão e tente novamente.')
      retry.hidden = false
    } finally {
      if (current === requestId) {
        products.setAttribute('aria-busy', 'false')
        more.disabled = false
      }
    }
  }

  async function categories() {
    if (!endpoint || !config.key) return
    try {
      const values = await request('categories', {}, signal)
      if (signal.aborted || !Array.isArray(values)) return
      const selected = new URLSearchParams(location.search).get('categoria') || ''
      const options = [category.options[0]]
      for (const value of values) {
        if (typeof value !== 'string') continue
        const option = document.createElement('option')
        option.value = value
        option.textContent = value
        options.push(option)
      }
      if (selected && !values.includes(selected)) {
        const option = document.createElement('option')
        option.value = selected
        option.textContent = selected
        options.push(option)
      }
      category.replaceChildren(...options)
      category.value = selected
    } catch { /* The catalog still shows its own error and retry state. */ }
    finally {
      if (!signal.aborted) {
        buildCategoryMenu()
        categoryTrigger.disabled = false
        categoryTrigger.removeAttribute('aria-busy')
      }
    }
  }

  function openDialog(button) {
    const row = rows.get(button.closest('.product-card')?.dataset.productId)
    if (!row) return
    opener = button
    dialog.querySelector('.product-dialog-brand').textContent = row.brand || ''
    dialog.querySelector('#product-dialog-name').textContent = row.name || 'Produto'
    const link = dialog.querySelector('.product-dialog-link')
    link.href = safeHttps(row.store_url) || '#'
    link.rel = row.sponsored ? 'noopener noreferrer sponsored' : 'noopener noreferrer'
    const imageSlot = dialog.querySelector('.product-dialog-image')
    const imageUrl = safeHttps(row.image_url)
    if (imageUrl) {
      const image = element('img', '')
      image.alt = row.name || 'Produto'
      image.decoding = 'async'
      image.addEventListener('error', () => image.replaceWith(element('span', '', 'Imagem indisponível')), { once: true })
      image.src = imageUrl
      imageSlot.replaceChildren(image)
    } else imageSlot.replaceChildren(element('span', '', 'Imagem indisponível'))
    dialog.showModal()
    dialog.querySelector('.product-dialog-close').focus()
  }

  readUrl()
  buildCategoryMenu()
  categories()
  load()
  form.addEventListener('submit', (event) => event.preventDefault(), { signal })
  search.addEventListener('input', () => {
    controller?.abort()
    clearTimeout(timer)
    timer = setTimeout(() => { writeUrl(); load() }, 250)
  }, { signal })
  category.addEventListener('change', () => { clearTimeout(timer); syncCategory(); writeUrl(); load() }, { signal })
  categoryTrigger.addEventListener('click', () => {
    if (categoryMenu.hidden) openCategory()
    else closeCategory(true)
  }, { signal })
  categoryTrigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openCategory()
      if (event.key === 'ArrowUp') categoryOptions().at(-1)?.focus()
    }
  }, { signal })
  categoryMenu.addEventListener('click', (event) => {
    const option = event.target.closest('.category-option')
    if (option) chooseCategory(option.dataset.value)
  }, { signal })
  categoryMenu.addEventListener('keydown', (event) => {
    const options = categoryOptions()
    const current = options.indexOf(document.activeElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      closeCategory(true)
    } else if (event.key === 'Tab') closeCategory()
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      options[next]?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (options[current]) chooseCategory(options[current].dataset.value)
    }
  }, { signal })
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.catalog-category')) closeCategory()
  }, { signal })
  window.addEventListener('resize', () => closeCategory(), { signal })
  clear.addEventListener('click', () => {
    search.value = ''
    category.value = ''
    brand = ''
    syncCategory()
    closeCategory()
    writeUrl()
    load()
    search.focus()
  }, { signal })
  more.addEventListener('click', () => load(true), { signal })
  retry.querySelector('button').addEventListener('click', () => load(offset > 0), { signal })
  products.addEventListener('click', (event) => {
    const all = event.target.closest('.product-group-all')
    if (all) {
      brand = all.dataset.brand
      writeUrl()
      load()
      return
    }
    const image = event.target.closest('.product-image-button')
    if (image) openDialog(image)
  }, { signal })
  products.addEventListener('error', (event) => {
    if (event.target.matches?.('img.product-image'))
      event.target.replaceWith(element('span', 'product-image product-placeholder', 'Imagem indisponível'))
  }, { capture: true, signal })
  dialog.querySelector('.product-dialog-close').addEventListener('click', () => closeDialog(), { signal })
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog() }, { signal })
  dialog.addEventListener('close', () => closeDialog(), { signal })
  window.addEventListener('popstate', () => { clearTimeout(timer); closeCategory(); readUrl(); load() }, { signal })
  return () => {
    controller?.abort()
    clearTimeout(timer)
    requestId++
    closeCategory()
    closeDialog(false)
  }
}
