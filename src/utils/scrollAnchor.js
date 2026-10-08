// "Âncora" de rolagem: o primeiro card visível e a distância dele ao topo. Serve para manter a leitura no
// mesmo lugar quando o conteúdo acima muda (publicações novas inseridas ao atualizar) e para restaurar a
// posição ao voltar de outra tela. Não usa scrollY absoluto: com `content-visibility` a altura dos cards ainda
// não desenhados é estimada, então um número absoluto derivaria; o card âncora, uma vez desenhado, devolve a
// posição exata. (Safari não tem scroll anchoring nativo, por isso a compensação é feita aqui.)
const HEADER_OFFSET = 80
const MIN_SCROLL = 60

export function captureScrollAnchor() {
  if (typeof document === 'undefined' || window.scrollY < MIN_SCROLL) return null
  for (const card of document.querySelectorAll('.status-card')) {
    const rect = card.getBoundingClientRect()
    if (rect.bottom > HEADER_OFFSET && card.offsetParent !== null)
      return { id: card.id, top: rect.top }
  }
  return null
}

export function restoreScrollAnchor(anchor) {
  if (!anchor) return
  const element = document.getElementById(anchor.id)
  if (!element) return
  const delta = element.getBoundingClientRect().top - anchor.top
  if (Math.abs(delta) >= 1) window.scrollBy(0, delta)
}
