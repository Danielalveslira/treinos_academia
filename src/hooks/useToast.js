import { useCallback, useEffect, useRef, useState } from 'react'

let idCounter = 0

export function useToast() {
  const [toasts, setToasts] = useState([])
  const timeoutIds = useRef(new Set())

  useEffect(() => {
    const ids = timeoutIds.current
    return () => ids.forEach(clearTimeout)
  }, [])

  const showToast = useCallback((message, type = 'success') => {
    const id = ++idCounter
    setToasts((current) => [...current, { id, message, type }])
    const timeoutId = setTimeout(() => {
      timeoutIds.current.delete(timeoutId)
      setToasts((current) => current.filter((t) => t.id !== id))
    }, 3000)
    timeoutIds.current.add(timeoutId)
  }, [])

  return { toasts, showToast }
}
