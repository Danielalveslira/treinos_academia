import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCached, getCached, setCached, invalidateCache } from '../utils/pageCache'
import { describeQueryError } from '../utils/queryError'

export function useCachedQuery(key, fetchValue, { enabled = true, context = 'query' } = {}) {
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

  const run = useCallback(
    async (force) => {
      if (!enabled) return
      const request = ++revision.current
      setState((previous) => ({
        key,
        data: previous.key === key ? previous.data : getCached(key),
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
    [key, fetchValue, enabled, context]
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
      : { data: getCached(key), loading: true, error: null }
  return { ...current, refresh, setData }
}
