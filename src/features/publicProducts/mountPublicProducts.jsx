import { createRoot } from 'react-dom/client'
import { PublicProductsIsland } from './PublicProductsIsland.jsx'

let mounted = false

// Importado só via import() dinâmico (ver src/publicTurbo.js) — nunca um entry point do
// Vite — para não entrar no boot comum nem no precache do service worker: a Vitrine só
// baixa este código (e tudo que ele importa) quando alguém de fato abre /vitrine.
export function mountPublicProducts() {
  const el = document.getElementById('vitrine-root')
  if (!el || mounted) return
  mounted = true
  const root = createRoot(el)
  root.render(<PublicProductsIsland />)
  document.addEventListener(
    'turbo:before-cache',
    () => {
      root.unmount()
      mounted = false
    },
    { once: true }
  )
}
