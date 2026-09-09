import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './useAuth'
import { listActiveCommunities } from '../services/communitiesService'
import {
  listMyCommunityIds,
  joinCommunity,
  leaveCommunity,
} from '../services/communityMembersService'
import { describeFirestoreError } from '../utils/firestoreError'

export function useCommunities() {
  const { user } = useAuth()
  const [communities, setCommunities] = useState([])
  const [myCommunityIds, setMyCommunityIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
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
    } catch (err) {
      setError(describeFirestoreError(err, 'useCommunities'))
    } finally {
      setLoading(false)
    }
  }, [user.uid])

  useEffect(() => {
    refresh()
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
    setMyCommunityIds((prev) => new Set(prev).add(communityId))
  }

  async function leave(communityId) {
    await leaveCommunity(communityId, user.uid)
    setMyCommunityIds((prev) => {
      const next = new Set(prev)
      next.delete(communityId)
      return next
    })
  }

  return {
    communities,
    myCommunities,
    exploreCommunities,
    isMember: (communityId) => myCommunityIds.has(communityId),
    loading,
    error,
    refresh,
    join,
    leave,
  }
}
