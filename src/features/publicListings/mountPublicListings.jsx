import { createRoot } from 'react-dom/client'
import { PublicListingsIsland } from './PublicListingsIsland'
let root, element
export function mountPublicListings() {
  const next = document.getElementById('public-listings-root')
  if (!next || next === element) return
  if (root) root.unmount()
  element = next
  root = createRoot(next)
  root.render(<PublicListingsIsland kind={next.dataset.kind} />)
}
document.addEventListener('turbo:before-cache', () => {
  root?.unmount()
  root = null
  element = null
})
