import { useEffect, useState } from 'react'

// One writer per sheet/day in this browser. The database and offline outbox remain
// authoritative; this only stops two open tabs from racing the same exercise row.
export function useWorkoutSessionLock(userId, sheetId, day) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState('checking')
  useEffect(() => {
    const key = `evolutus:workout-writer:${userId}:${sheetId}:${day}`
    let active = true
    let release = null
    let timer = null
    let token = null
    setState('checking')

    if (navigator.locks?.request) {
      navigator.locks
        .request(key, { ifAvailable: true }, (lock) => {
          if (!active || !lock) {
            if (active) setState('blocked')
            return
          }
          setState('owner')
          return new Promise((resolve) => {
            release = resolve
          })
        })
        .catch(() => {
          if (active) setState('blocked')
        })
    } else {
      // Older browsers: a short lease expires after a crash. A storage event closes
      // the first editor if another tab takes the lease at the same instant.
      try {
        token = crypto.randomUUID()
        const previous = JSON.parse(localStorage.getItem(key) || 'null')
        if (previous?.expires > Date.now()) setState('blocked')
        else {
          const renew = () => {
            const current = JSON.parse(localStorage.getItem(key) || 'null')
            if (current?.token !== token && current?.expires > Date.now()) {
              clearInterval(timer)
              timer = null
              setState('blocked')
              return
            }
            localStorage.setItem(key, JSON.stringify({ token, expires: Date.now() + 15000 }))
          }
          renew()
          setState(JSON.parse(localStorage.getItem(key)).token === token ? 'owner' : 'blocked')
          timer = setInterval(renew, 5000)
          const changed = (event) => {
            if (event.key === key && event.newValue && JSON.parse(event.newValue).token !== token) {
              clearInterval(timer)
              timer = null
              setState('blocked')
            }
          }
          window.addEventListener('storage', changed)
          release = () => window.removeEventListener('storage', changed)
        }
      } catch {
        // Private mode can disable storage. Keep the workout usable; server IDs and
        // the outbox still provide the persistence protections available there.
        setState('owner')
      }
    }
    return () => {
      active = false
      release?.()
      if (timer) clearInterval(timer)
      if (token) {
        try {
          if (JSON.parse(localStorage.getItem(key) || 'null')?.token === token)
            localStorage.removeItem(key)
        } catch {
          /* Storage may be unavailable during cleanup. */
        }
      }
    }
  }, [userId, sheetId, day, attempt])
  return { state, retry: () => setAttempt((value) => value + 1) }
}
