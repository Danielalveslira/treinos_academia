import { useCallback, useEffect, useState } from 'react'
import { loadMunicipalityCatalog, peekMunicipalityCatalog } from '../services/municipalityCatalog'
import { isStaleChunkError } from '../utils/staleChunk'

// { status: 'loading' | 'ready' | 'error', index, stale, retry }. `stale`: o chunk do catálogo é de
// um deploy anterior (só recarregar a página resolve -- "tentar novamente" não adiantaria).
export function useMunicipalityCatalog() {
  const [state, setState] = useState(() => {
    const index = peekMunicipalityCatalog()
    return index
      ? { status: 'ready', index, stale: false }
      : { status: 'loading', index: null, stale: false }
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (state.status === 'ready') return undefined
    let active = true
    loadMunicipalityCatalog()
      .then((index) => {
        if (active) setState({ status: 'ready', index, stale: false })
      })
      .catch((error) => {
        console.error('[CitySelector] catálogo de municípios:', error)
        if (active) setState({ status: 'error', index: null, stale: isStaleChunkError(error) })
      })
    return () => {
      active = false
    }
    // state.status fora das dependências de propósito: só (re)carrega na montagem e a cada retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', index: null, stale: false })
    setAttempt((n) => n + 1)
  }, [])

  return { ...state, retry }
}
