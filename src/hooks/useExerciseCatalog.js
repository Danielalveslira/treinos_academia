import { useCallback, useEffect, useState } from 'react'
import { loadExerciseCatalog } from '../services/exerciseCatalogService.js'

export function useExerciseCatalog({ enabled = true } = {}) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null })

  const load = useCallback(async (force = false) => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await loadExerciseCatalog({ force })
      setState({ data, loading: false, error: null })
    } catch (error) {
      setState({ data: null, loading: false, error })
    }
  }, [])

  useEffect(() => {
    if (enabled) load()
    else setState({ data: null, loading: false, error: null })
  }, [enabled, load])

  return { ...state, retry: () => (enabled ? load(true) : Promise.resolve()) }
}
