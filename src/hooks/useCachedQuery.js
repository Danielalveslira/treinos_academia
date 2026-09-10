import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCached, getCached, setCached, invalidateCache } from '../utils/pageCache'
import { describeFirestoreError } from '../utils/firestoreError'

export function useCachedQuery(key, fetchValue) {
  const [state, setState] = useState(() => ({
    key,
    data: getCached(key),
    loading: getCached(key) === undefined,
    error: null,
  }))
  const revision = useRef(0)
  const activeKey = useRef(key)
  activeKey.current = key

  const run = useCallback(
    async (force) => {
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
            error: describeFirestoreError(error, 'query'),
          })
        }
      }
    },
    [key, fetchValue]
  )

  useEffect(() => {
    run(false)
    return () => {
      revision.current += 1
    }
  }, [run])

  const refresh = useCallback(() => run(true), [run])
  const setData = useCallback(
    (data) => {
      if (activeKey.current !== key) return
      revision.current += 1
      invalidateCache(key)
      setCached(key, data)
      setState({ key, data, loading: false, error: null })
    },
    [key]
  )

  const current = state.key === key ? state : { data: getCached(key), loading: true, error: null }
  return { ...current, refresh, setData }
}
