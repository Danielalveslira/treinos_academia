import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './useAuth'
import { listActiveCommunities } from '../services/communitiesService'
import {
  listMyCommunityIds,
  joinCommunity,
  leaveCommunity,
} from '../services/communityMembersService'
import { describeFirestoreError } from '../utils/firestoreError'
import { getCached, setCached } from '../utils/pageCache'

export function useCommunities() {
  const { user } = useAuth()
  const cacheKey = `communities:${user.uid}`
  const cached = getCached(cacheKey)
  const [communities, setCommunities] = useState(cached?.communities || [])
  const [myCommunityIds, setMyCommunityIds] = useState(new Set(cached?.myCommunityIds || []))
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [communityList, myIds] = await Promise.all([
        listActiveCommunities(),
        listMyCommunityIds(user.uid),
      ])
      setCommunities(communityList)
      setMyCommunityIds(new Set(myIds))
      setCached(cacheKey, { communities: communityList, myCommunityIds: myIds })
    } catch (err) {
      setError(describeFirestoreError(err, 'useCommunities'))
    } finally {
      setLoading(false)
    }
  }, [user.uid, cacheKey])

  useEffect(() => {
    if (!cached) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  const myCommunities = useMemo(
    () => communities.filter((c) => myCommunityIds.has(c.id)),
    [communities, myCommunityIds]
  )
  const exploreCommunities = useMemo(
    () => communities.filter((c) => !myCommunityIds.has(c.id)),
    [communities, myCommunityIds]
  )

  async function join(communityId) {
    await joinCommunity(communityId, user.uid)
    setMyCommunityIds((prev) => {
      const next = new Set(prev).add(communityId)
      setCached(cacheKey, { communities, myCommunityIds: [...next] })
      return next
    })
  }

  async function leave(communityId) {
    await leaveCommunity(communityId, user.uid)
    setMyCommunityIds((prev) => {
      const next = new Set(prev)
      next.delete(communityId)
      setCached(cacheKey, { communities, myCommunityIds: [...next] })
      return next
    })
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
