import { useCallback, useEffect, useState } from 'react'
import {
  listCommunitiesPage,
  createCommunity,
  updateCommunity,
  setCommunityActive,
  deleteCommunity,
} from '../services/communitiesService'
import { countMembers } from '../services/communityMembersService'
import { describeFirestoreError } from '../utils/firestoreError'
import { useAuth } from './useAuth'

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
      const counts = await Promise.all(list.map((c) => countMembers(c.id)))
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
      const counts = await Promise.all(page.items.map((community) => countMembers(community.id)))
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

  async function add(community) {
    await createCommunity(user.uid, community)
    await refresh()
  }

  async function edit(communityId, community) {
    await updateCommunity(communityId, community)
    setCommunities((prev) => prev.map((c) => (c.id === communityId ? { ...c, ...community } : c)))
  }

  async function toggleActive(communityId, isActive) {
    await setCommunityActive(communityId, isActive)
    setCommunities((prev) => prev.map((c) => (c.id === communityId ? { ...c, isActive } : c)))
  }

  async function remove(communityId) {
    await deleteCommunity(communityId)
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
