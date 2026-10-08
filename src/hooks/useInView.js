import { useEffect, useRef, useState } from 'react'

// Fica `true` quando o elemento chega perto da área visível (rootMargin) e nunca volta a `false`
// (não "descarrega" nada). Serve para adiar trabalho de rede/decodificação de quem está bem abaixo
// do início do feed. Sem IntersectionObserver (ou com `disabled`) começa já como visível.
export function useInView({ rootMargin = '400px 0px', disabled = false } = {}) {
  const ref = useRef(null)
  const [inView, setInView] = useState(disabled || typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (inView) return undefined
    const element = ref.current
    if (!element) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [inView, rootMargin])

  return [ref, inView]
}
