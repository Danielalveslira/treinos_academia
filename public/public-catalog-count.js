// Standalone Home enhancement. No Supabase SDK, polling, storage or private data.
(() => {
  if (window.evolutusCatalogCount) return
  window.evolutusCatalogCount = true
  let cleanup = () => {}
  let mounted = null
  const mount = () => {
    const target = document.querySelector('[data-catalog-count]')
    if (mounted === target) return
    cleanup()
    mounted = target
    if (!target) return
    const controller = new AbortController()
    let observer
    let active = true
    let started = false
    const load = async () => {
      if (started) return
      started = true
      observer?.disconnect()
      try {
        const response = await fetch('/api/public-catalog-snapshot', {
          signal: controller.signal, credentials: 'omit',
        })
        if (!response.ok) return
        const value = await response.json()
        if (!active || !target.isConnected || !Number.isSafeInteger(value?.total_active) || value.total_active < 0 ||
          typeof value.revision !== 'string' || !/^\d+$/.test(value.revision) ||
          typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at)) ||
          Date.parse(value.updated_at) > Date.now() + 60000) return
        // updated_at records a visibility change, NOT an expiration time. A snapshot
        // can remain correct for years when no exercises enter/leave publication.
        target.textContent = `${new Intl.NumberFormat('pt-BR').format(value.total_active)} exercícios publicados`
      } catch { /* Keep the honest static fallback, including offline/aborted requests. */ }
    }
    cleanup = () => { active = false; controller.abort(); observer?.disconnect() }
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) load()
      })
      observer.observe(target)
    } else load()
  }
  document.addEventListener('turbo:load', mount)
  document.addEventListener('turbo:before-cache', () => {
    cleanup()
    mounted = null
    const target = document.querySelector('[data-catalog-count]')
    if (target) target.textContent = 'Exercícios para sua rotina'
  })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true})
  else mount()
})()
