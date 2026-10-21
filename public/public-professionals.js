export function initProfessionalDirectory(signal) {
  const form = document.getElementById('professional-filters')
  if (!form) return () => {}
  const config = window.EVOLUTUS_PUBLIC_CONFIG || {}
  const endpoint = typeof config.url === 'string' && /^https:\/\/[^/]+$/.test(config.url.replace(/\/+$/, ''))
    ? config.url.replace(/\/+$/, '') : ''
  const taxonomy = JSON.parse(document.getElementById('professional-taxonomy').textContent)
  const results = document.getElementById('directory-results')
  const cardTemplate = document.getElementById('directory-card-template')
  const status = document.getElementById('directory-status')
  const more = document.getElementById('directory-more')
  const retry = document.getElementById('directory-retry')
  const controls = {
    tipo: form.elements.namedItem('tipo'),
    modalidade: form.elements.namedItem('modalidade'),
    uf: form.elements.namedItem('uf'),
    cidade: form.elements.namedItem('cidade'),
    atendimento: form.elements.namedItem('atendimento'),
  }
  const params = new URLSearchParams(location.search)
  for (const [name, control] of Object.entries(controls)) {
    const value = params.get(name)
    if (value && (control.tagName === 'INPUT' || [...control.options].some((option) => option.value === value)))
      control.value = value
  }
  const label = (group, value) => taxonomy[group].find((option) => option.value === value)?.label || value || '—'
  let offset = 0
  let controller = null
  let requestId = 0
  let timer = null
  const avatarUrls = new Set()

  function updateUrl() {
    const next = new URLSearchParams()
    for (const [name, control] of Object.entries(controls)) {
      if (control.value && (name !== 'tipo' || control.value !== 'professional')) next.set(name, control.value)
    }
    history.replaceState(history.state, '', `${location.pathname}${next.size ? `?${next}` : ''}`)
  }

  function text(tag, content, className = '') {
    const element = document.createElement(tag)
    element.textContent = content
    if (className) element.className = className
    return element
  }

  function card(row) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id)) return null
    const article = cardTemplate.content.firstElementChild.cloneNode(true)
    const initial = article.querySelector('.directory-avatar')
    initial.textContent = row.displayName?.trim()?.[0]?.toUpperCase() || '•'
    if (typeof row.avatarPath === 'string' && /^[\w./-]{1,240}\.webp$/.test(row.avatarPath) &&
      !row.avatarPath.split('/').some((segment) => segment === '..' || segment === '.')) {
      const objectPath = row.avatarPath.split('/').map(encodeURIComponent).join('/')
      fetch(`${endpoint}/storage/v1/object/profile-avatars/${objectPath}`, { headers: { apikey: config.key }, signal })
        .then((response) => response.ok ? response.blob() : null)
        .then((blob) => {
          if (!blob || !article.isConnected || blob.type !== 'image/webp') return
          const img = document.createElement('img')
          img.src = URL.createObjectURL(blob)
          avatarUrls.add(img.src)
          img.alt = ''
          img.width = 66
          img.height = 66
          img.onload = () => { URL.revokeObjectURL(img.src); avatarUrls.delete(img.src) }
          initial.replaceWith(img)
          img.className = 'directory-avatar'
        }).catch(() => {})
    }
    article.querySelector('.directory-kind').textContent = label('kind', row.kind)
    article.querySelector('.directory-name').textContent = row.displayName || 'Perfil publicado'
    article.querySelector('.directory-category').textContent = label('category', row.categoryKey)
    article.querySelector('.directory-location').textContent = [row.city, row.uf].filter(Boolean).join(', ')
    const modalities = Array.isArray(row.modalityKeys) ? row.modalityKeys.slice(0, 3) : []
    article.querySelector('.directory-modalities').textContent = modalities.map((item) => label('modality', item)).join(' · ')
    article.querySelector('.directory-service').textContent = label('serviceMode', row.serviceMode)
    article.querySelector('.directory-card-link').href = `/profissionais/${row.id}`
    return article
  }

  function empty(message) {
    results.replaceChildren()
    const box = document.createElement('div')
    box.className = 'catalog-empty directory-empty'
    box.append(text('h3', 'Nenhum perfil encontrado'))
    box.append(text('p', message))
    results.append(box)
  }

  async function load(append = false) {
    controller?.abort()
    controller = new AbortController()
    const current = ++requestId
    if (!append) {
      offset = 0
      results.replaceChildren()
    }
    results.setAttribute('aria-busy', 'true')
    status.textContent = append ? 'Carregando mais perfis…' : 'Carregando perfis publicados…'
    more.hidden = true
    retry.hidden = true
    if (!endpoint || !config.key) {
      status.textContent = 'O diretório está indisponível no momento.'
      empty('Tente novamente mais tarde.')
      results.setAttribute('aria-busy', 'false')
      return
    }
    try {
      const response = await fetch(`${endpoint}/rest/v1/rpc/public_list_professionals`, {
        method: 'POST',
        headers: { apikey: config.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_kind: controls.tipo.value,
          p_modality: controls.modalidade.value || null,
          p_uf: controls.uf.value || null,
          p_city: controls.cidade.value.trim() || null,
          p_service_mode: controls.atendimento.value || null,
          p_offset: offset,
          p_limit: 20,
        }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error('directory_failed')
      const page = await response.json()
      if (current !== requestId || signal.aborted) return
      const cards = (Array.isArray(page.items) ? page.items : []).map(card).filter(Boolean)
      if (cards.length) results.append(...cards)
      else if (!append) {
        const narrowed = controls.tipo.value !== 'professional' || controls.modalidade.value ||
          controls.uf.value || controls.cidade.value.trim() || controls.atendimento.value
        empty(narrowed
          ? 'Ajuste os filtros para encontrar outras opções.'
          : 'Perfis publicados aparecerão aqui quando estiverem disponíveis.')
      }
      offset = Number.isInteger(page.nextOffset) ? page.nextOffset : 0
      more.hidden = !offset
      status.textContent = cards.length
        ? `${results.querySelectorAll('.directory-card').length} perfil${results.querySelectorAll('.directory-card').length === 1 ? '' : 's'} exibido${results.querySelectorAll('.directory-card').length === 1 ? '' : 's'}.`
        : append ? 'Não há mais perfis para mostrar.' : 'Ainda não há perfis publicados para esta busca.'
    } catch (error) {
      if (error.name === 'AbortError' || current !== requestId) return
      status.textContent = 'Não foi possível carregar os perfis. Tente novamente.'
      if (!append) empty('A consulta falhou. Nenhum resultado foi exibido.')
      retry.hidden = false
    } finally {
      if (current === requestId) results.setAttribute('aria-busy', 'false')
    }
  }

  form.addEventListener('submit', (event) => event.preventDefault(), { signal })
  form.addEventListener('change', (event) => {
    if (event.target === controls.cidade) return
    updateUrl()
    load()
  }, { signal })
  controls.cidade.addEventListener('input', () => {
    controller?.abort()
    clearTimeout(timer)
    timer = setTimeout(() => { updateUrl(); load() }, 350)
  }, { signal })
  more.addEventListener('click', () => load(true), { signal })
  retry.addEventListener('click', () => load(Boolean(offset && results.querySelector('.directory-card'))), { signal })
  load()
  return () => {
    controller?.abort()
    clearTimeout(timer)
    requestId++
    for (const url of avatarUrls) URL.revokeObjectURL(url)
    avatarUrls.clear()
  }
}
