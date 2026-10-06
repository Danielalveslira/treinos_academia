import { useEffect } from 'react'
import { useAuth } from './useAuth'
import { touchUserActivity } from '../services/activityService'
import { createActivityPinger, startActivityHeartbeat } from '../utils/activityPing'

// Marca "último uso" no servidor ao abrir/retomar o app e no máximo a cada 10 min enquanto a
// página está visível (ver utils/activityPing.js). Montado só dentro do Layout autenticado.
export function useActivityHeartbeat() {
  const { user, offlineLocal } = useAuth()
  const uid = offlineLocal ? null : user?.uid
  useEffect(() => {
    if (!uid) return undefined
    return startActivityHeartbeat({
      pinger: createActivityPinger({ send: touchUserActivity, uid }),
    })
  }, [uid])
}
