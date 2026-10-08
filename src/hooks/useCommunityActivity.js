import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { listLatestCommunityActivity } from '../services/statusesService'
import { fetchCached, invalidateCache } from '../utils/pageCache'

// Prévia da última publicação de cada comunidade do usuário. A chave começa com
// `communities:{uid}`, então entrar/sair/criar (invalidateCommunitiesCache) também derruba
// esta cache. Carregamento secundário: nunca entra no loading/erro da tela — enquanto não
// chega (ou se falhar) os cartões só aparecem sem a prévia.
export function useCommunityActivity(communityIds) {
  const { user } = useAuth()
  const idsKey = [...communityIds].sort().join(',')
  const [state, setState] = useState({ key: '', activity: {}, checked: new Set(), ready: false })

  const load = useCallback(
    async (force = false) => {
      if (!idsKey) {
        setState({ key: '', activity: {}, checked: new Set(), ready: true })
        return
      }
      try {
        const cacheKey = `communities:${user.uid}:activity:${idsKey}`
        const { activity, checkedIds, partial } = await fetchCached(
          cacheKey,
          () => listLatestCommunityActivity(idsKey.split(',')),
          { force }
        )
        // Resultado incompleto (algum lote falhou) não fica em cache: a próxima visita tenta de novo.
        if (partial) invalidateCache(cacheKey)
        setState({ key: idsKey, activity, checked: new Set(checkedIds), ready: true })
      } catch (err) {
        console.error('[useCommunityActivity]', err)
        setState((current) => ({ ...current, key: idsKey, checked: new Set(), ready: true }))
      }
    },
    [user.uid, idsKey]
  )

  useEffect(() => {
    load(false)
  }, [load])

  // "Sem publicações" só vale para comunidades realmente consultadas nesta leitura: enquanto
  // a lista mudou e a nova prévia não chegou (ou se a leitura daquele lote falhou), não afirma que a
  // comunidade está vazia.
  const isFresh = state.ready && state.key === idsKey
  return {
    activity: state.activity,
    isActivityChecked: (communityId) => isFresh && state.checked.has(communityId),
    reloadActivity: () => load(true),
  }
}
