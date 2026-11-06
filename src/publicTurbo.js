import { session } from '@hotwired/turbo'

// These pages are HTML documents. Drive only handles links explicitly marked by
// the static page generator; React, account, checkout and profile routes stay native.
session.drive = false
const paths = new Set([
  '/',
  '/como-funciona',
  '/para-empresas',
  '/vitrine',
  '/profissionais',
  '/locais',
  '/demo',
  '/demo-preview',
])
let visitAction = null

const eligible = (raw) => {
  const url = new URL(raw, location.href)
  return url.origin === location.origin && paths.has(url.pathname)
}

document.addEventListener('turbo:click', (event) => {
  if (!eligible(event.detail.url)) event.preventDefault()
})

document.addEventListener('turbo:before-prefetch', (event) => {
  const connection = navigator.connection
  const pathname = new URL(event.target.href).pathname
  if (
    !eligible(event.target.href) ||
    pathname === '/vitrine' ||
    pathname === '/profissionais' ||
    pathname === '/locais' ||
    connection?.saveData ||
    ['slow-2g', '2g'].includes(connection?.effectiveType)
  )
    event.preventDefault()
})

document.addEventListener('turbo:visit', (event) => {
  visitAction = event.detail.action
})

document.addEventListener('turbo:before-render', (event) => {
  if (
    event.detail.newBody?.querySelector('#content .home-hero') &&
    document.querySelector('script[data-auth-ref]')
  ) {
    // Applied before Turbo swaps the body, including history restoration.
    try {
      const ref = document.querySelector('script[data-auth-ref]').dataset.authRef
      if (localStorage.getItem(`sb-${ref}-auth-token`) && navigator.onLine !== false)
        document.documentElement.classList.add('home-auth-pending')
    } catch {
      /* Storage may be unavailable. */
    }
  }
})

document.addEventListener('turbo:load', () => {
  if (visitAction === 'advance' && !location.hash)
    document.getElementById('content')?.focus({ preventScroll: true })
  visitAction = null

  // Chunk só desta tela, carregado sob demanda (ver mountPublicProducts.jsx): nada aqui
  // entra no boot comum das outras páginas públicas.
  if (document.getElementById('vitrine-root'))
    import('./features/publicProducts/mountPublicProducts.jsx').then((module) =>
      module.mountPublicProducts()
    )

  if (document.getElementById('public-listings-root'))
    import('./features/publicListings/mountPublicListings.jsx').then((module) =>
      module.mountPublicListings()
    )

  if (document.getElementById('demo-root'))
    import('./workoutDemoEntry.jsx').then((module) => module.mountWorkoutDemo())

  if (document.getElementById('commercial-lead-form'))
    import('./features/publicCommercial/mountCommercialLeadForm.js').then((module) =>
      module.mountCommercialLeadForm()
    )

  // The head script can survive Turbo navigation. Reuse its session gate on Home.
  if (location.pathname === '/') window.evolutusCheckHomeAuth?.()
  else window.evolutusReleaseHomeAuth?.()
})
