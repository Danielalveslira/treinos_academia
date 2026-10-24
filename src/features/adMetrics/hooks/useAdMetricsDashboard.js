import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAdMetricsDashboard } from '../api/adMetrics.api'
import { cacheKey, classifyError } from '../utils/metrics'

// Cache SÓ em memória, por conta + filtros (nada em IndexedDB/localStorage). Sem TTL automático nem polling/Realtime:
// um snapshot só é refeito quando o usuário toca em "Atualizar" (que descarta o cache da conta) ou quando os
// filtros mudam para uma combinação ainda não vista.
const cache = new Map()
let generation = 0
export const adMetricsGeneration = () => generation

export function clearAdMetricsCache(userId = null) {
  generation += 1
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
  const key = `${userId}|${filters.accountId || 'admin'}|${filters.campaignOffset || 0}|${filters.contextOffset || 0}|${cacheKey(filters)}`
  const [state, setState] = useState(() => {
    const hit = filters.accountId ? null : cache.get(key)
    return hit
      ? { key, status: 'ready', snapshot: hit.snapshot, fetchedAt: hit.fetchedAt, error: null }
      : { key, status: 'idle', snapshot: null, fetchedAt: null, error: null }
  })
  const token = useRef(0)
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(
    async (force) => {
      const hit = force || filtersRef.current.accountId ? null : cache.get(key)
      if (hit) {
        token.current += 1
        setState({
          key,
          status: 'ready',
          snapshot: hit.snapshot,
          fetchedAt: hit.fetchedAt,
          error: null,
        })
        return
      }
      const mine = ++token.current
      const epoch = generation
      if (!isOnline()) {
        setState((prev) => ({
          ...(filtersRef.current.accountId || prev.key !== key
            ? { snapshot: null, fetchedAt: null }
            : prev),
          key,
          status: 'error',
          error: 'offline',
        }))
        return
      }
      setState((prev) => ({
        ...(prev.key === key ? prev : { snapshot: null, fetchedAt: null }),
        key,
        status: 'loading',
        error: null,
      }))
      try {
        const snapshot = await fetcherRef.current(filtersRef.current)
        if (mine !== token.current || epoch !== generation) return // chegou depois de outro filtro: descarta
        const entry = { snapshot, fetchedAt: Date.now() }
        if (!filtersRef.current.accountId) cache.set(key, entry)
        setState({ key, status: 'ready', snapshot, fetchedAt: entry.fetchedAt, error: null })
      } catch (err) {
        if (mine !== token.current || epoch !== generation) return
        console.error('[adMetrics] dashboard:', err)
        const error = classifyError(err, isOnline())
        if (error === 'forbidden' || filtersRef.current.accountId) clearAdMetricsCache(userId)
        setState((prev) => ({
          ...(error === 'forbidden' || filtersRef.current.accountId
            ? { snapshot: null, fetchedAt: null }
            : prev),
          key,
          status: 'error',
          error,
        }))
      }
    },
    [key, userId]
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

  return {
    ...(state.key === key
      ? state
      : { status: 'loading', snapshot: null, error: null, fetchedAt: null }),
    refresh,
  }
}
