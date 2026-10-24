import { useCallback, useEffect, useRef, useState } from 'react'
import { advertiserRpc } from '../api/advertisers.api'

const PAGE_SIZE = 100
const MAX_OFFSET = 100000
const empty = (key) => ({
  key,
  rows: [],
  status: 'idle',
  error: null,
  nextOffset: 0,
  hasMore: false,
})

// Administrative catalogs only: one bounded page at a time, with logical cancellation.
// The render key prevents exposing the previous account/search even before effects run.
export function useAdvertiserPage(name, args = {}, enabled = true) {
  const key = JSON.stringify([name, args])
  const request = useRef(0)
  const pending = useRef(false)
  const mounted = useRef(true)
  const argsRef = useRef(args)
  argsRef.current = args
  const [state, setState] = useState(() => empty(key))
  const stateRef = useRef(state)
  stateRef.current = state
  const load = useCallback(
    async (offset = 0) => {
      const mine = ++request.current
      pending.current = true
      setState((current) => ({
        ...(current.key === key ? current : empty(key)),
        status: 'loading',
        error: null,
      }))
      try {
        const rows = await advertiserRpc(name, { ...argsRef.current, p_offset: offset })
        if (!Array.isArray(rows)) throw new Error('INVALID_RESPONSE')
        if (!mounted.current || mine !== request.current) return
        setState((current) => ({
          key,
          rows: offset
            ? [...new Map([...current.rows, ...rows].map((row) => [row.id, row])).values()]
            : rows,
          status: 'ready',
          error: null,
          nextOffset: offset + PAGE_SIZE,
          hasMore: rows.length === PAGE_SIZE,
        }))
      } catch (error) {
        if (!mounted.current || mine !== request.current) return
        // Do not retain snapshots after a failed authorization/read.
        setState({ ...empty(key), status: 'error', error })
      } finally {
        if (mine === request.current) pending.current = false
      }
    },
    [key, name]
  )
  useEffect(() => {
    mounted.current = true
    if (enabled) load()
    return () => {
      request.current += 1
      pending.current = false
      mounted.current = false
    }
  }, [load, enabled])
  const more = useCallback(() => {
    const current = stateRef.current
    if (current.key !== key || pending.current || current.status === 'loading' || !current.hasMore)
      return
    if (current.nextOffset > MAX_OFFSET) {
      setState((previous) => ({
        ...previous,
        error: new Error('Limite da lista atingido. Refine a busca.'),
      }))
      return
    }
    return load(current.nextOffset)
  }, [key, load])
  const patch = useCallback(
    (transform) => {
      request.current += 1
      pending.current = false
      setState((current) =>
        current.key === key ? { ...current, rows: transform(current.rows) } : current
      )
    },
    [key]
  )
  const refresh = useCallback(() => {
    if (!pending.current) return load(0)
  }, [load])
  return { ...(state.key === key && enabled ? state : empty(key)), refresh, more, patch }
}
