import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import {
  listWorkoutsPage,
  createWorkout,
  updateWorkout,
  deleteWorkout,
} from '../services/workoutsService'
import { describeQueryError } from '../utils/queryError'

const EMPTY = []
export function useWorkouts(filters = {}) {
  const { user, offlineLocal } = useAuth()
  const { exerciseId, startDate, endDate } = filters
  const key = `workouts:${user.uid}:${exerciseId || ''}:${startDate || ''}:${endDate || ''}:${offlineLocal ? 'local' : 'online'}`
  const fetchValue = useCallback(
    () => listWorkoutsPage(user.uid, { exerciseId, startDate, endDate, localOnly: offlineLocal }),
    [user.uid, exerciseId, startDate, endDate, offlineLocal]
  )
  // Ao voltar a rede a chave passa de 'local' para 'online': a lista atual fica na tela até a nova chegar.
  const query = useCachedQuery(key, fetchValue, {
    keepPreviousScope: `${user.uid}:${exerciseId || ''}:${startDate || ''}:${endDate || ''}`,
  })
  const [pagination, setPagination] = useState({ key, loading: false, error: null })
  const pending = useRef(null)
  useEffect(
    () => () => {
      pending.current = null
    },
    [key]
  )

  async function loadMore() {
    if (!query.data?.nextCursor || query.loading || pending.current) return
    const request = {}
    pending.current = request
    setPagination({ key, loading: true, error: null })
    try {
      const page = await listWorkoutsPage(user.uid, {
        exerciseId,
        startDate,
        endDate,
        localOnly: offlineLocal,
        cursor: query.data.nextCursor,
      })
      if (pending.current !== request) return
      const items = [
        ...new Map([...query.data.items, ...page.items].map((item) => [item.id, item])).values(),
      ]
      query.setData({ items, nextCursor: page.nextCursor })
      setPagination({ key, loading: false, error: null })
    } catch (error) {
      if (pending.current === request)
        setPagination({ key, loading: false, error: describeQueryError(error, 'loadMore') })
    } finally {
      if (pending.current === request) pending.current = null
    }
  }

  async function refresh() {
    pending.current = null
    setPagination({ key, loading: false, error: null })
    await query.refresh()
  }
  async function edit(id, workout) {
    pending.current = null
    const result = await updateWorkout(user.uid, id, workout)
    await refresh()
    return result
  }
  async function remove(id) {
    pending.current = null
    const result = await deleteWorkout(user.uid, id)
    query.setData({ ...query.data, items: query.data.items.filter((item) => item.id !== id) })
    setPagination({ key, loading: false, error: null })
    return result
  }
  return {
    workouts: query.data?.items || EMPTY,
    loading: query.loading || (pagination.key === key && pagination.loading),
    error: query.error || (pagination.key === key ? pagination.error : null),
    hasMore: !!query.data?.nextCursor,
    loadMore,
    refresh,
    add: (workout) => createWorkout(user.uid, workout),
    edit,
    remove,
  }
}
