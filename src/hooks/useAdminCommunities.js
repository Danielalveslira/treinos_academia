import { useCallback, useEffect, useState } from 'react'
import {
  listCommunitiesPage,
  createCommunity,
  updateCommunity,
  setCommunityActive,
  setMemberCount,
  deleteCommunity,
} from '../services/communitiesService'
import { countMembers } from '../services/communityMembersService'
import { describeFirestoreError } from '../utils/firestoreError'
import { invalidateCommunitiesCache } from '../utils/pageCache'
import { useAuth } from './useAuth'

// memberCount é mantido no servidor (gatilho em communityMembers) — na maioria das
// vezes isto é uma leitura de campo já trazida junto da comunidade, sem nenhuma query
// extra. Só comunidades criadas antes desse campo existir caem no fallback: uma
// aggregation query (1x, nunca mais depois que o valor é regravado).
async function resolveMemberCount(community) {
  if (typeof community.memberCount === 'number') return community.memberCount
  const count = await countMembers(community.id)
  setMemberCount(community.id, count).catch(() => {})
  return count
}

export function useAdminCommunities() {
  const { user } = useAuth()
  const [communities, setCommunities] = useState([])
  const [cursor, setCursor] = useState(null)
  const [memberCounts, setMemberCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const page = await listCommunitiesPage()
      const list = page.items
      setCursor(page.nextCursor)
      setCommunities(list)
      const counts = await Promise.all(list.map(resolveMemberCount))
      setMemberCounts(Object.fromEntries(list.map((c, i) => [c.id, counts[i]])))
    } catch (err) {
      setError(describeFirestoreError(err, 'useAdminCommunities'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true)
    try {
      const page = await listCommunitiesPage(cursor)
      const counts = await Promise.all(page.items.map(resolveMemberCount))
      setCommunities((previous) => [...previous, ...page.items])
      setMemberCounts((previous) => ({
        ...previous,
        ...Object.fromEntries(page.items.map((community, index) => [community.id, counts[index]])),
      }))
      setCursor(page.nextCursor)
    } catch (error) {
      setError(describeFirestoreError(error, 'listCommunitiesPage'))
    } finally {
      setLoading(false)
    }
  }

  // Mesma chamada já usada por CommunityDetail.jsx para estas 4 mutações -- sem isto, um
  // superadmin que também navega em /comunidades continua vendo a versão antiga por até
  // 5min depois de mexer aqui (ver invalidateCommunitiesCache em utils/pageCache.js).
  async function add(community) {
    await createCommunity(user.uid, community)
    invalidateCommunitiesCache(user.uid)
    await refresh()
  }

  async function edit(communityId, community) {
    await updateCommunity(communityId, community)
    invalidateCommunitiesCache(user.uid)
    setCommunities((prev) => prev.map((c) => (c.id === communityId ? { ...c, ...community } : c)))
  }

  async function toggleActive(communityId, isActive) {
    await setCommunityActive(communityId, isActive)
    invalidateCommunitiesCache(user.uid)
    setCommunities((prev) => prev.map((c) => (c.id === communityId ? { ...c, isActive } : c)))
  }

  async function remove(communityId) {
    await deleteCommunity(communityId)
    invalidateCommunitiesCache(user.uid)
    setCommunities((prev) => prev.filter((c) => c.id !== communityId))
  }

  return {
    communities,
    memberCounts,
    hasMore: !!cursor,
    loadMore,
    loading,
    error,
    refresh,
    add,
    edit,
    toggleActive,
    remove,
  }
}
