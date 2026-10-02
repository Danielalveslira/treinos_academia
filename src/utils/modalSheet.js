// Lógica pura da folha modal (testável sem DOM): teclado (Escape/Tab preso) e altura pela viewport visual.

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Teclado: Escape fecha; Tab/Shift+Tab ficam presos dentro da folha. `container` precisa de querySelectorAll.
export function handleSheetKeyDown(event, container, onClose) {
  if (event.key === 'Escape') {
    event.preventDefault?.()
    onClose?.()
    return 'close'
  }
  if (event.key !== 'Tab') return null
  const items = [...container.querySelectorAll(FOCUSABLE)]
  if (items.length === 0) {
    event.preventDefault?.()
    return 'trap'
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = container.ownerDocument?.activeElement
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault?.()
    last.focus()
    return 'wrap-back'
  }
  if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault?.()
    first.focus()
    return 'wrap'
  }
  return null
}

// Estilo da folha a partir da viewport visual (teclado aberto/barra do navegador). null = deixa o CSS (100dvh).
export function viewportStyle(visualViewport) {
  if (!visualViewport || !Number.isFinite(visualViewport.height) || visualViewport.height <= 0)
    return null
  return {
    '--sheet-height': `${Math.round(visualViewport.height)}px`,
    '--sheet-top': `${Math.round(visualViewport.offsetTop || 0)}px`,
  }
}
