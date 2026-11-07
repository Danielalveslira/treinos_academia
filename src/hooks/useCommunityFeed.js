import { useCallback, useEffect, useRef, useState } from 'react'
import { listCommunityFeedPage, deleteStatus } from '../services/statusesService'
import { describeQueryError } from '../utils/queryError'
import { toMillis } from '../utils/expiry'
import { eligiblePublications } from '../utils/publicationEligibility'
import { getCached, onPageCacheClear, setCached } from '../utils/pageCache'
import { applyEconomyVoteCountDeltaToList } from '../utils/economyVoteCountDelta'
import { mergeFirstPage } from '../utils/feedOrder'
import { captureScrollAnchor, restoreScrollAnchor } from '../utils/scrollAnchor'
import { subscribeClock } from '../utils/clock'

// O feed já carregado fica na cache de sessão por até 30 min e é MOSTRADO na hora ao voltar, mesmo "velho";
// se passou de STALE_AFTER_MS desde a última leitura do servidor, a primeira página é revalidada em segundo
// plano e mesclada (publicações novas no topo, contadores atualizados, o que sumiu removido) sem derrubar as
// páginas de baixo nem a posição de rolagem. Sem polling: só ao montar, ao voltar para a aba e no "Atualizar".
const FEED_CACHE_MAX_AGE_MS = 30 * 60 * 1000
const STALE_AFTER_MS = 60 * 1000

// Uma leitura da primeira página por vez (por usuário+comunidade), mesmo com várias chamadas ao mesmo tempo
// (dupla montagem em dev, navegação rápida, revalidação junto do "Atualizar").
const firstPageRequests = new Map()
onPageCacheClear(() => firstPageRequests.clear())

function requestFirstPage(key, communityId) {
  if (!firstPageRequests.has(key)) {
    firstPageRequests.set(
      key,
      listCommunityFeedPage(communityId)
        .then(({ items, hasMore }) => ({ items, hasMore }))
        .finally(() => firstPageRequests.delete(key))
    )
  }
  return firstPageRequests.get(key)
}

// Cursor da próxima página = o último item JÁ carregado, na forma original do banco (microssegundos
// preservados: um Date do JS perderia precisão e poderia repetir/pular itens). Um item otimista local
// (createdAt: Date) só aparece no topo, nunca no fim de uma lista que ainda tem próxima página.
function cursorOf(items) {
  const last = items.at(-1)
  if (!last) return null
  const createdAt =
    typeof last.createdAt === 'string' ? last.createdAt : new Date(last.createdAt).toISOString()
  return { createdAt, id: last.id }
}

function mergeUnique(items, more) {
  const known = new Set(items.map((item) => item.id))
  return [...items, ...more.filter((item) => !known.has(item.id))]
}

// Feed paginado por cursor, com cache por usuário E comunidade. O relógio compartilhado (utils/clock.js) só
// remove localmente o que já expirou, sem leitura ao banco e sem re-renderizar o feed a cada tick quando
// nada expirou.
export function useCommunityFeed(communityId, enabled = true, uid = 'anon') {
  const cacheKey = `communityFeed:${uid}:${communityId}`
  const [state, setState] = useState(() => {
    const cached = enabled ? getCached(cacheKey) : undefined
    return {
      items: eligiblePublications(cached?.items ?? []),
      hasMore: cached?.hasMore ?? false,
      loadedAt: cached?.loadedAt ?? 0,
    }
  })
  const [loading, setLoading] = useState(() => enabled && getCached(cacheKey) === undefined)
  const [ready, setReady] = useState(() => enabled && getCached(cacheKey) !== undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // Sobe a cada "Atualizar" manual: os cards de enquete/treino recarregam o próprio estado (totais e
  // participação de outras pessoas), que não vêm na linha da publicação.
  const [refreshEpoch, setRefreshEpoch] = useState(0)
  const [error, setError] = useState(null)
  const [moreError, setMoreError] = useState(null)
  const revision = useRef(0)
  const moreFlight = useRef(null)
  const revalidateFlight = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const readyRef = useRef(ready)
  readyRef.current = ready

  // Toda mudança vai para o estado E para a cache. `loadedAt` só avança quando a mudança veio do servidor.
  const commit = useCallback(
    (items, hasMore, loadedAt = stateRef.current.loadedAt) => {
      const next = { items: eligiblePublications(items), hasMore, loadedAt }
      stateRef.current = next
      setState(next)
      setCached(cacheKey, next, FEED_CACHE_MAX_AGE_MS)
    },
    [cacheKey]
  )

  const abortMore = useCallback(() => {
    moreFlight.current?.abort()
    moreFlight.current = null
    setLoadingMore(false)
  }, [])

  // Primeira carga (ou nova tentativa depois de falha): sem nada para mostrar ainda.
  const load = useCallback(async () => {
    if (!enabled || !communityId) return
    abortMore()
    const current = ++revision.current
    setLoading(true)
    setError(null)
    setMoreError(null)
    try {
      const page = await requestFirstPage(cacheKey, communityId)
      if (current !== revision.current) return
      commit(page.items, page.hasMore, Date.now())
    } catch (err) {
      if (current === revision.current) setError(describeQueryError(err, 'useCommunityFeed'))
    } finally {
      if (current === revision.current) {
        setReady(true)
        setLoading(false)
      }
    }
  }, [enabled, communityId, cacheKey, abortMore, commit])

  // Revalida a primeira página e MESCLA no que já está na tela. Falha silenciosa quando automática (a tela
  // continua com o que tinha); no "Atualizar" manual a falha aparece como erro, sem apagar a lista.
  const revalidate = useCallback(
    async ({ manual = false } = {}) => {
      if (!enabled || !communityId) return
      if (revalidateFlight.current) {
        if (!manual) return revalidateFlight.current
        await revalidateFlight.current
      }
      const current = revision.current
      if (manual) {
        setRefreshing(true)
        setError(null)
      }
      const run = (async () => {
        try {
          const fresh = await requestFirstPage(cacheKey, communityId)
          if (current !== revision.current) return
          const before = stateRef.current
          const merged = mergeFirstPage(before, fresh)
          // Se entrou algo no topo, o conteúdo desce: compensa a rolagem para o leitor não perder o lugar.
          const anchor = merged.items[0]?.id !== before.items[0]?.id ? captureScrollAnchor() : null
          commit(merged.items, merged.hasMore, Date.now())
          if (manual) setRefreshEpoch((value) => value + 1)
          if (anchor) {
            window.requestAnimationFrame(() =>
              window.requestAnimationFrame(() => restoreScrollAnchor(anchor))
            )
          }
        } catch (err) {
          if (manual && current === revision.current) {
            setError(describeQueryError(err, 'useCommunityFeed.refresh'))
          } else {
            console.error('[useCommunityFeed] revalidate:', err)
          }
        } finally {
          revalidateFlight.current = null
          if (manual) setRefreshing(false)
        }
      })()
      revalidateFlight.current = run
      return run
    },
    [enabled, communityId, cacheKey, commit]
  )

  useEffect(() => {
    if (!enabled) {
      revision.current += 1
      abortMore()
      setState({ items: [], hasMore: false, loadedAt: 0 })
      setLoading(false)
      setReady(false)
      setError(null)
      setMoreError(null)
      return undefined
    }
    const cached = getCached(cacheKey)
    if (cached !== undefined) {
      const next = { ...cached, items: eligiblePublications(cached.items) }
      stateRef.current = next
      setState(next)
      setLoading(false)
      setReady(true)
      setError(null)
      if (Date.now() - (cached.loadedAt ?? 0) > STALE_AFTER_MS) revalidate()
    } else {
      load()
    }
    return () => {
      revision.current += 1
      // Navegação rápida: a página seguinte em voo de uma comunidade que ficou para trás é cancelada.
      moreFlight.current?.abort()
      moreFlight.current = null
      revalidateFlight.current = null
    }
    // revalidate/load mudam junto com cacheKey/enabled, que já estão nas dependências
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey, load, abortMore])

  // Voltou para a aba/app depois de um tempo: revalida se estiver velho (sem polling).
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !readyRef.current) return
      if (Date.now() - (stateRef.current.loadedAt ?? 0) > STALE_AFTER_MS) revalidate()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled, revalidate])

  // Remove localmente o que expirou (o banco apaga depois, sozinho). Só mexe no estado se algo mudou.
  useEffect(() => {
    if (!enabled) return undefined
    return subscribeClock(() => {
      const { items, hasMore } = stateRef.current
      const next = eligiblePublications(items)
      if (next !== items) commit(next, hasMore)
    })
  }, [enabled, commit])

  // "Atualizar": mescla a primeira página (não derruba as páginas carregadas). Se a primeira carga falhou e
  // não há nada na tela, é uma nova tentativa de carga completa.
  const refresh = useCallback(() => {
    const { items } = stateRef.current
    if (!readyRef.current || (items.length === 0 && error)) return load()
    return revalidate({ manual: true })
  }, [load, revalidate, error])

  // Voltou a conexão depois de uma falha ao carregar mais: tenta de novo sozinho.
  const moreErrorRef = useRef(null)
  moreErrorRef.current = moreError
  const loadMoreRef = useRef(null)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined
    const onOnline = () => {
      if (!moreErrorRef.current) return
      setMoreError(null)
      loadMoreRef.current?.()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [enabled])

  const loadMore = useCallback(async () => {
    const { items, hasMore } = stateRef.current
    if (!enabled || !hasMore || moreFlight.current || !communityId) return
    // Sem conexão (o navegador SABE que está offline): avisa na hora e não envia nada. Sem isto, o cliente
    // do Supabase retentaria o GET com espera crescente (~7 s) e a tela ficaria presa em "Carregando…".
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setMoreError({ message: 'Sem conexão. Conecte-se para ver mais publicações.' })
      return
    }
    const controller = new AbortController()
    moreFlight.current = controller
    const current = revision.current
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = await listCommunityFeedPage(communityId, {
        cursor: cursorOf(items),
        signal: controller.signal,
      })
      if (controller.signal.aborted || current !== revision.current) return
      // Lê o estado MAIS RECENTE: publicações criadas/removidas/revalidadas durante a espera não se perdem.
      const latest = stateRef.current
      commit(mergeUnique(latest.items, page.items), page.hasMore)
    } catch (err) {
      if (controller.signal.aborted) return
      setMoreError(describeQueryError(err, 'useCommunityFeed.loadMore'))
    } finally {
      if (moreFlight.current === controller) {
        moreFlight.current = null
        setLoadingMore(false)
      }
    }
  }, [enabled, communityId, commit])
  loadMoreRef.current = loadMore

  // Handlers estáveis (só leem stateRef/commit): permitem que os cards do feed usem React.memo.
  const addStatusLocally = useCallback(
    (status) => {
      const { items, hasMore } = stateRef.current
      commit([status, ...items.filter((item) => item.id !== status.id)], hasMore)
    },
    [commit]
  )

  const remove = useCallback(
    async (statusId) => {
      await deleteStatus(statusId)
      const { items, hasMore } = stateRef.current
      commit(
        items.filter((s) => s.id !== statusId),
        hasMore
      )
    },
    [commit]
  )

  // Chamado só DEPOIS de voteOnPost já ter confirmado sucesso (nunca antes -- ver
  // EconomyVoteBar.jsx, sem optimistic update) -- corrige só o status afetado dentro
  // do array, sem refetch. Um statusId que não está neste array (ex.: só existe em
  // featuredStatuses, fora deste hook) é um no-op aqui de propósito.
  const updateEconomyVoteCounts = useCallback(
    (statusId, delta) => {
      const { items, hasMore } = stateRef.current
      const next = applyEconomyVoteCountDeltaToList(items, statusId, delta)
      if (next !== items) commit(next, hasMore)
    },
    [commit]
  )

  // Comentário criado nesta sessão: o contador do card (e da cache) acompanha, para o retorno à comunidade
  // não mostrar o número antigo.
  const updateCommentCount = useCallback(
    (statusId, delta) => {
      const { items, hasMore } = stateRef.current
      if (!items.some((s) => s.id === statusId)) return
      commit(
        items.map((s) =>
          s.id === statusId ? { ...s, commentCount: Math.max(0, (s.commentCount ?? 0) + delta) } : s
        ),
        hasMore
      )
    },
    [commit]
  )

  // Chamado só DEPOIS de updateStatusContent (statusesService) já ter confirmado sucesso --
  // mesmo raciocínio de updateEconomyVoteCounts: sem isso, editar um post só refletiria na
  // lista (e na cache de 30 min) depois de um refresh(). O card já se atualiza por conta própria
  // (StatusEditForm/StatusCard têm seu próprio patch local); isto é só para a LISTA e a cache
  // ficarem consistentes com o texto/legenda editados, sem refetch do feed inteiro.
  const applyStatusEdit = useCallback(
    (statusId, patch) => {
      const { items, hasMore } = stateRef.current
      if (!items.some((s) => s.id === statusId)) return
      commit(
        items.map((s) => (s.id === statusId ? { ...s, ...patch } : s)),
        hasMore
      )
    },
    [commit]
  )

  // Chamado só depois de o motor comercial confirmar a contratação (mesmo raciocínio de
  // updateEconomyVoteCounts) -- sem isso o post promovido só ganharia o selo "Em
  // destaque" depois de um refresh(), já que promoted/promotedUntil só existem no
  // documento que o servidor gravou, nunca no array local até esta função rodar.
  const updatePostPromotion = useCallback(
    (statusId, patch) => {
      const { items, hasMore } = stateRef.current
      commit(
        items.map((s) => {
          if (s.id !== statusId) return s
          // Patch recebido somente após o motor comercial confirmar a compra.
          // Permanente continua permanente; os demais usam o novo prazo contratado.
          return {
            ...s,
            ...patch,
            ...(patch.promoted === true && toMillis(patch.promotedUntil) > Date.now()
              ? {
                  publicationExpiresAt:
                    s.publicationExpiresAt === null || s.retentionMode === 'no_auto_expiration'
                      ? null
                      : new Date(
                          Math.max(toMillis(s.expiresAt), toMillis(patch.promotedUntil))
                        ).toISOString(),
                }
              : {}),
          }
        }),
        hasMore
      )
    },
    [commit]
  )

  return {
    statuses: enabled ? state.items : [],
    hasMore: enabled && state.hasMore,
    loading: enabled && (!ready || loading),
    loadingMore,
    refreshing,
    refreshEpoch,
    error: enabled ? error : null,
    moreError,
    refresh,
    loadMore,
    addStatusLocally,
    remove,
    updateEconomyVoteCounts,
    updateCommentCount,
    updatePostPromotion,
    applyStatusEdit,
  }
}
