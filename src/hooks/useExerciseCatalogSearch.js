import { useCallback, useEffect, useRef, useState } from 'react'
import { searchExercises } from '../services/exerciseCatalogService.js'
import { isLocalFallback } from '../services/offline/localFallback.js'

const DEBOUNCE_MS = 400
// Abaixo disso, ainda não vale a pena consultar -- "s", "su" só gerariam ruído. A tela
// mostra o estado vazio normalmente até o usuário digitar mais.
const MIN_QUERY_LENGTH = 2
const PAGE_SIZE = 20

function describeError() {
  return 'Não foi possível carregar o catálogo. Tente novamente.'
}

// Busca + filtros + paginação do Catálogo Evolutus, direto no nosso Postgres (ver
// exerciseCatalogService.searchExercises) -- debounce + tamanho mínimo de busca, nunca
// dispara a cada tecla.
export function useExerciseCatalogSearch({ enabled = true, q = '', category, muscle, equipment, level }) {
  const [debouncedQuery, setDebouncedQuery] = useState(q)
  const [state, setState] = useState({
    items: [],
    total: null,
    loading: enabled,
    error: null,
    fromCache: false,
    isPartialCache: false,
  })
  const [offset, setOffset] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const revision = useRef(0)
  const debounceTimer = useRef(null)

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    // Sem debounce pra esvaziar o campo -- voltar ao estado inicial deve ser imediato.
    if (!q) {
      setDebouncedQuery('')
      return undefined
    }
    debounceTimer.current = setTimeout(() => setDebouncedQuery(q), DEBOUNCE_MS)
    return () => clearTimeout(debounceTimer.current)
  }, [q])

  const effectiveQuery = debouncedQuery.trim()
  const queryTooShort = effectiveQuery.length > 0 && effectiveQuery.length < MIN_QUERY_LENGTH
  const hasAnyFilter = Boolean(category || muscle || equipment || level)
  // Sem termo de busca válido E sem nenhum filtro: não existe intenção nenhuma do
  // usuário ainda -- nunca busca "o catálogo inteiro" por padrão.
  const noQueryIntent = effectiveQuery.length === 0 && !hasAnyFilter
  const filterKey = JSON.stringify({ q: effectiveQuery, category, muscle, equipment, level })

  const load = useCallback(
    async (loadOffset, { append } = {}) => {
      if (!enabled || queryTooShort || noQueryIntent) return
      const request = ++revision.current
      if (append) setLoadingMore(true)
      else setState((previous) => ({ ...previous, loading: true, error: null }))

      try {
        const result = await searchExercises({
          limit: PAGE_SIZE,
          offset: loadOffset,
          q: effectiveQuery || undefined,
          category,
          muscle,
          equipment,
          level,
        })
        if (request !== revision.current) return
        const { data, total } = result
        const fromCache = isLocalFallback(result)
        setState((previous) => ({
          items: append ? [...previous.items, ...data] : data,
          total,
          loading: false,
          error: null,
          // true = servidor inalcançável, resultado parcial vindo do aparelho (ver offline/readThrough).
          fromCache,
          // Só é "parcial" quando o cache local ainda não tem o snapshot completo (ver
          // exerciseCache.searchCachedCatalog) -- com snapshot completo, mesmo offline, o
          // resultado é tão confiável quanto o do servidor (inclusive zero resultado verdadeiro).
          isPartialCache: fromCache && result.complete !== true,
        }))
        setOffset(loadOffset)
      } catch {
        if (request !== revision.current) return
        setState((previous) => ({ ...previous, loading: false, error: describeError() }))
      } finally {
        if (request === revision.current) setLoadingMore(false)
      }
    },
    [enabled, queryTooShort, noQueryIntent, effectiveQuery, category, muscle, equipment, level]
  )

  useEffect(() => {
    if (!enabled || queryTooShort || noQueryIntent) {
      setState({ items: [], total: null, loading: false, error: null, fromCache: false, isPartialCache: false })
      return
    }
    load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, filterKey, queryTooShort, noQueryIntent])

  const hasMore = state.total != null && offset + PAGE_SIZE < state.total
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    load(offset + PAGE_SIZE, { append: true })
  }, [loadingMore, hasMore, offset, load])

  return { ...state, loadingMore, hasMore, loadMore, queryTooShort, noQueryIntent }
}
