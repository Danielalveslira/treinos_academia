import { useCallback, useEffect, useRef, useState } from 'react'
import { listCommunityFeed, deleteStatus } from '../services/statusesService'
import { describeQueryError } from '../utils/queryError'
import { toMillis } from '../utils/expiry'
import { fetchCached, getCached, setCached } from '../utils/pageCache'
import { applyEconomyVoteCountDeltaToList } from '../utils/economyVoteCountDelta'

// Um único relógio compartilhado por feed: os cards leem "now" via prop em vez de cada
// um rodar seu próprio timer, e o mesmo tick também remove localmente quem já expirou —
// sem nenhuma leitura extra ao banco, a exclusão física acontece depois, sozinha.
const EXPIRY_TICK_MS = 15000

export function useCommunityFeed(communityId, enabled = true) {
  const cacheKey = `communityFeed:${communityId}`
  const [statuses, setStatuses] = useState(() => (enabled ? getCached(cacheKey) || [] : []))
  const [loading, setLoading] = useState(() => enabled && getCached(cacheKey) === undefined)
  const [ready, setReady] = useState(() => enabled && getCached(cacheKey) !== undefined)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const revision = useRef(0)

  const load = useCallback(
    async (force = false) => {
      if (!enabled || !communityId) return
      const current = ++revision.current
      setLoading(true)
      setError(null)
      try {
        const data = await fetchCached(cacheKey, () => listCommunityFeed(communityId), { force })
        if (current !== revision.current) return
        setNow(Date.now())
        setStatuses(data)
      } catch (err) {
        if (current === revision.current) setError(describeQueryError(err, 'useCommunityFeed'))
      } finally {
        if (current === revision.current) {
          setReady(true)
          setLoading(false)
        }
      }
    },
    [enabled, communityId, cacheKey]
  )

  useEffect(() => {
    if (!enabled) {
      revision.current += 1
      setStatuses([])
      setLoading(false)
      setReady(false)
      setError(null)
      return undefined
    }
    const cached = getCached(cacheKey)
    if (cached !== undefined) {
      setStatuses(cached)
      setLoading(false)
      setReady(true)
      setError(null)
    } else {
      load(false)
    }
    return () => {
      revision.current += 1
    }
  }, [enabled, cacheKey, load])

  useEffect(() => {
    if (!enabled) return undefined
    const id = setInterval(() => {
      const current = Date.now()
      setNow(current)
      setStatuses((prev) => {
        const next = prev.filter((s) => toMillis(s.expiresAt) > current)
        if (next.length !== prev.length) setCached(cacheKey, next)
        return next.length === prev.length ? prev : next
      })
    }, EXPIRY_TICK_MS)
    return () => clearInterval(id)
  }, [enabled, cacheKey])

  const refresh = useCallback(() => load(true), [load])

  function addStatusLocally(status) {
    setStatuses((prev) => {
      const next = [status, ...prev]
      setCached(cacheKey, next)
      return next
    })
  }

  async function remove(statusId) {
    await deleteStatus(statusId)
    setStatuses((prev) => {
      const next = prev.filter((s) => s.id !== statusId)
      setCached(cacheKey, next)
      return next
    })
  }

  // Chamado só DEPOIS de voteOnPost já ter confirmado sucesso (nunca antes -- ver
  // EconomyVoteBar.jsx, sem optimistic update) -- corrige só o status afetado dentro
  // do array, sem refetch. Um statusId que não está neste array (ex.: só existe em
  // featuredStatuses, fora deste hook) é um no-op aqui de propósito.
  function updateEconomyVoteCounts(statusId, delta) {
    setStatuses((prev) => {
      const next = applyEconomyVoteCountDeltaToList(prev, statusId, delta)
      if (next !== prev) setCached(cacheKey, next)
      return next
    })
  }

  // Chamado só depois de createPromotion já ter confirmado sucesso (mesmo raciocínio de
  // updateEconomyVoteCounts) -- sem isso o post promovido só ganharia o selo "Em
  // destaque" depois de um refresh(), já que promoted/promotedUntil só existem no
  // documento que o servidor gravou, nunca no array local até esta função rodar.
  function updatePostPromotion(statusId, patch) {
    setStatuses((prev) => {
      const next = prev.map((s) => (s.id === statusId ? { ...s, ...patch } : s))
      setCached(cacheKey, next)
      return next
    })
  }

  return {
    statuses: enabled ? statuses : [],
    loading: enabled && (!ready || loading),
    error: enabled ? error : null,
    refresh,
    addStatusLocally,
    remove,
    updateEconomyVoteCounts,
    updatePostPromotion,
    now,
  }
}
