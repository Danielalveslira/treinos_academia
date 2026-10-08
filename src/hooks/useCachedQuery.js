import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCached, getCached, setCached, invalidateCache } from '../utils/pageCache'
import { describeQueryError } from '../utils/queryError'

// `keepPreviousScope`: enquanto a chave muda (ex.: voltou a rede e a consulta passa de 'local' para
// 'online'), mantém na tela o último dado carregado DESTE escopo (id do usuário) até o novo chegar --
// sem trocar a tela por um spinner/vazio. Escopo diferente (outra conta) nunca reaproveita nada.
export function useCachedQuery(
  key,
  fetchValue,
  { enabled = true, context = 'query', keepPreviousScope = null } = {}
) {
  const cached = enabled ? getCached(key) : undefined
  const [state, setState] = useState(() => ({
    key,
    data: cached,
    loading: enabled && cached === undefined,
    error: null,
  }))
  const revision = useRef(0)
  const activeKey = useRef(key)
  activeKey.current = key
  const lastGood = useRef({ scope: null, data: undefined })
  if (keepPreviousScope && state.key === key && state.data !== undefined)
    lastGood.current = { scope: keepPreviousScope, data: state.data }
  const kept = () =>
    keepPreviousScope && lastGood.current.scope === keepPreviousScope
      ? lastGood.current.data
      : undefined

  const run = useCallback(
    async (force) => {
      if (!enabled) return
      const request = ++revision.current
      setState((previous) => ({
        key,
        data: previous.key === key ? previous.data : (getCached(key) ?? kept()),
        loading: true,
        error: null,
      }))
      try {
        const data = await fetchCached(key, fetchValue, { force })
        if (request === revision.current && activeKey.current === key)
          setState({ key, data, loading: false, error: null })
      } catch (error) {
        if (request === revision.current && activeKey.current === key) {
          setState({
            key,
            data: undefined,
            loading: false,
            error: describeQueryError(error, context),
          })
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, fetchValue, enabled, context, keepPreviousScope]
  )

  useEffect(() => {
    if (!enabled) {
      revision.current += 1
      return undefined
    }
    run(false)
    return () => {
      revision.current += 1
    }
  }, [enabled, run])

  const refresh = useCallback(() => run(true), [run])
  const setData = useCallback(
    (data) => {
      if (!enabled || activeKey.current !== key) return
      revision.current += 1
      invalidateCache(key)
      setCached(key, data)
      setState({ key, data, loading: false, error: null })
    },
    [key, enabled]
  )

  const current = !enabled
    ? { data: undefined, loading: false, error: null }
    : state.key === key
      ? state
      : { data: getCached(key) ?? kept(), loading: true, error: null }
  return { ...current, refresh, setData }
}
