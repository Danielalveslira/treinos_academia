import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAdMetricsDashboard } from '../api/adMetrics.api'
import { cacheKey, classifyError } from '../utils/metrics'

// Cache SÓ em memória, por conta + filtros (nada em IndexedDB/localStorage). Sem TTL automático nem polling/Realtime:
// um snapshot só é refeito quando o usuário toca em "Atualizar" (que descarta o cache da conta) ou quando os
// filtros mudam para uma combinação ainda não vista.
const cache = new Map()

export function clearAdMetricsCache(userId = null) {
  for (const key of [...cache.keys()])
    if (!userId || key.startsWith(`${userId}|`)) cache.delete(key)
}

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

// `enabled` = aba aberta. Fechada, o hook não faz nenhuma leitura. Respostas de filtros antigos são ignoradas e, se uma
// leitura falha, o último snapshot válido continua na tela (stale) com o aviso do erro.
export function useAdMetricsDashboard({
  userId,
  filters,
  enabled,
  fetcher = fetchAdMetricsDashboard,
}) {
  const key = `${userId}|${cacheKey(filters)}`
  const [state, setState] = useState(() => {
    const hit = cache.get(key)
    return hit
      ? { status: 'ready', snapshot: hit.snapshot, fetchedAt: hit.fetchedAt, error: null }
      : { status: 'idle', snapshot: null, fetchedAt: null, error: null }
  })
  const token = useRef(0)
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(
    async (force) => {
      const hit = force ? null : cache.get(key)
      if (hit) {
        token.current += 1
        setState({ status: 'ready', snapshot: hit.snapshot, fetchedAt: hit.fetchedAt, error: null })
        return
      }
      const mine = ++token.current
      if (!isOnline()) {
        setState((prev) => ({ ...prev, status: 'error', error: 'offline' }))
        return
      }
      setState((prev) => ({ ...prev, status: 'loading', error: null }))
      try {
        const snapshot = await fetcherRef.current(filtersRef.current)
        if (mine !== token.current) return // chegou depois de outro filtro: descarta
        const entry = { snapshot, fetchedAt: Date.now() }
        cache.set(key, entry)
        setState({ status: 'ready', snapshot, fetchedAt: entry.fetchedAt, error: null })
      } catch (err) {
        if (mine !== token.current) return
        console.error('[adMetrics] dashboard:', err)
        setState((prev) => ({ ...prev, status: 'error', error: classifyError(err, isOnline()) }))
      }
    },
    [key]
  )

  // Abre a aba / muda o filtro: usa o cache ou faz UMA leitura.
  useEffect(() => {
    if (!enabled) return undefined
    load(false)
    return () => {
      token.current += 1 // invalida resposta em voo ao trocar de filtro ou fechar
    }
  }, [enabled, load])

  const refresh = useCallback(() => {
    clearAdMetricsCache(userId)
    return load(true)
  }, [load, userId])

  return { ...state, refresh }
}
