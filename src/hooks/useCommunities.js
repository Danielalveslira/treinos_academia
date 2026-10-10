import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './useAuth'
import { listActiveCommunities } from '../services/communitiesService'
import {
  listMyCommunityAccess,
  joinCommunity,
  leaveCommunity,
} from '../services/communityMembersService'
import { describeQueryError } from '../utils/queryError'
import { getCached, setCached } from '../utils/pageCache'
import {
  accessAfterJoin,
  splitCommunitiesByAccess,
  withCommunityAccess,
} from '../utils/communityAccess'

// `accessById` = estado do usuário em cada comunidade onde ele é membro ou está banido (uma única consulta para
// a página inteira, nunca uma por cartão). Comunidade ausente do mapa = 'not_member'. 'unavailable' só aparece
// localmente, quando uma tentativa de entrada descobriu que a comunidade deixou de estar disponível.
export function useCommunities() {
  const { user } = useAuth()
  const cacheKey = `communities:${user.uid}`
  const cached = getCached(cacheKey)
  const [communities, setCommunities] = useState(cached?.communities || [])
  const [accessById, setAccessById] = useState(cached?.accessById || {})
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [communityList, access] = await Promise.all([
        listActiveCommunities(),
        listMyCommunityAccess(),
      ])
      setCommunities(communityList)
      setAccessById(access)
      setCached(cacheKey, { communities: communityList, accessById: access })
    } catch (err) {
      setError(describeQueryError(err, 'useCommunities'))
    } finally {
      setLoading(false)
    }
  }, [cacheKey])

  useEffect(() => {
    if (!cached) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  // Cada item do Explorar já carrega o estado de acesso ('not_member' | 'banned' | 'unavailable'): o cartão
  // decide entre "Entrar" e "Acesso bloqueado" sem nenhuma chamada extra.
  const { mine: myCommunities, explore: exploreCommunities } = useMemo(
    () => splitCommunitiesByAccess(communities, accessById),
    [communities, accessById]
  )

  function applyAccess(communityId, access) {
    const next = withCommunityAccess(accessById, communityId, access)
    setAccessById(next)
    setCached(cacheKey, { communities, accessById: next })
  }

  // Devolve o resultado do servidor ('joined' | 'already_member' | 'banned' | 'unavailable') e já atualiza o
  // estado local: uma tentativa recusada por banimento troca o cartão para "Acesso bloqueado" sem recarregar.
  async function join(communityId) {
    const result = await joinCommunity(communityId, user.uid)
    const access = accessAfterJoin(result)
    if (access) applyAccess(communityId, access)
    return result
  }

  async function leave(communityId) {
    await leaveCommunity(communityId, user.uid)
    applyAccess(communityId, 'not_member')
  }

  return {
    myCommunities,
    exploreCommunities,
    loading,
    error,
    refresh,
    join,
    leave,
  }
}
