// UM ResizeObserver para todos os elementos que precisam reagir a mudança de tamanho (em vez de um
// observador por card): barato mesmo com muitos cards montados. Devolve a função que para de observar.
let observer = null
const callbacks = new WeakMap()

export function observeSize(element, callback) {
  if (!element || typeof ResizeObserver === 'undefined') return () => {}
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) callbacks.get(entry.target)?.()
    })
  }
  callbacks.set(element, callback)
  observer.observe(element)
  return () => {
    callbacks.delete(element)
    observer?.unobserve(element)
  }
}
