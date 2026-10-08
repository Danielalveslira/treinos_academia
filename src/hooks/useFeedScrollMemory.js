import { useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigationType } from 'react-router-dom'
import { captureScrollAnchor, restoreScrollAnchor } from '../utils/scrollAnchor'
import { onPageCacheClear } from '../utils/pageCache'

// Posição de rolagem do feed ao voltar de outra tela (perfil do autor, comentários, atendimento...).
// Guarda um ÂNCORA (o primeiro card visível e a distância dele ao topo), não um scrollY: com
// `content-visibility`, a altura dos cards ainda não desenhados é estimada, então um número absoluto
// derivaria; o card âncora, uma vez desenhado, devolve a posição exata. Só restaura quando o usuário
// VOLTA (navegação POP) e as páginas do feed já estão na tela (a cache do feed guarda todas as páginas).
const anchors = new Map()
onPageCacheClear(() => anchors.clear())

export function useFeedScrollMemory(key, ready, disabled = false) {
  const navigationType = useNavigationType()
  const restored = useRef(false)

  // Layout effect: o cleanup roda ANTES de os cards saírem do DOM, quando ainda dá para medir.
  useLayoutEffect(
    () => () => {
      const anchor = captureScrollAnchor()
      if (anchor) anchors.set(key, anchor)
      else anchors.delete(key)
    },
    [key]
  )

  useEffect(() => {
    if (restored.current || !ready || disabled) return undefined
    restored.current = true
    const saved = anchors.get(key)
    if (!saved || navigationType !== 'POP') return undefined
    anchors.delete(key)
    const frame = window.requestAnimationFrame(() => restoreScrollAnchor(saved))
    return () => window.cancelAnimationFrame(frame)
  }, [ready, key, disabled, navigationType])
}
