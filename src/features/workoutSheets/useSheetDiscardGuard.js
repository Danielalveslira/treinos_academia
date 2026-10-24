import { useEffect } from 'react'
export function useSheetDiscardGuard(dirty) {
  useEffect(() => {
    if (!dirty) return
    const question = 'Descartar as alterações não salvas desta ficha?'
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const click = (event) => {
      const link = event.target.closest?.('a[href]')
      if (
        !link ||
        link.target === '_blank' ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        link.href === window.location.href
      )
        return
      if (!window.confirm(question)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const initialIndex = window.history.state?.idx
    let restoring = false
    const back = (event) => {
      if (restoring) {
        restoring = false
        event.stopImmediatePropagation()
        return
      }
      const target = event.state?.idx
      if (typeof initialIndex !== 'number' || typeof target !== 'number' || target === initialIndex)
        return
      if (!window.confirm(question)) {
        event.stopImmediatePropagation()
        restoring = true
        window.history.go(initialIndex - target)
      }
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', click, true)
    window.addEventListener('popstate', back, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', click, true)
      window.removeEventListener('popstate', back, true)
    }
  }, [dirty])
}
