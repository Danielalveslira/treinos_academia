import { useEffect, useRef } from 'react'

// Alterna uma classe em <body> enquanto o teclado virtual provavelmente está aberto
// (algum campo dentro do container tem foco) — usado pra CSS esconder elementos fixos
// que só atrapalham durante a digitação (barra de navegação inferior, botão de
// instalar PWA), sem depender de medir a altura da viewport, que varia muito entre
// navegadores. O atraso no blur evita o "piscar" quando o foco pula de um campo pro
// outro dentro do mesmo formulário (blur do campo antigo dispara antes do focus do
// novo — sem o atraso, a classe seria removida e recolocada a cada troca de campo).
const BLUR_GRACE_MS = 80

export function useFocusWithinBodyClass(className) {
  const ref = useRef(null)
  const blurTimeout = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return undefined

    function handleFocusIn() {
      clearTimeout(blurTimeout.current)
      document.body.classList.add(className)
    }
    function handleFocusOut() {
      blurTimeout.current = setTimeout(() => {
        document.body.classList.remove(className)
      }, BLUR_GRACE_MS)
    }

    node.addEventListener('focusin', handleFocusIn)
    node.addEventListener('focusout', handleFocusOut)
    return () => {
      node.removeEventListener('focusin', handleFocusIn)
      node.removeEventListener('focusout', handleFocusOut)
      clearTimeout(blurTimeout.current)
      document.body.classList.remove(className)
    }
  }, [className])

  return ref
}
