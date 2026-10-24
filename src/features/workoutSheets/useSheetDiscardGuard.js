import { useCallback, useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
export function useSheetDiscardGuard(dirty) {
  const allowed = useRef(false)
  const block = useCallback(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !allowed.current &&
      `${currentLocation.pathname}${currentLocation.search}` !==
        `${nextLocation.pathname}${nextLocation.search}`,
    [dirty]
  )
  const blocker = useBlocker(block)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('Descartar as alterações não salvas desta ficha?')) blocker.proceed()
    else blocker.reset()
  }, [blocker])
  useEffect(() => {
    if (!dirty) return
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  return () => {
    allowed.current = true
  }
}
