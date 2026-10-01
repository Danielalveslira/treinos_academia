import { useCallback } from 'react'
import { listUpcomingWorkouts } from '../services/statusesService'
import { useCachedQuery } from './useCachedQuery'

// "Próximos treinos" (Treino Marcado V1) -- consulta própria (workout.date > agora),
// independente do feed recente (useCommunityFeed.js filtra por expiresAt, sem relação
// com a data do evento -- ver canJoinWorkout em utils/scheduledWorkout.js, hoje só
// aplicado no cliente). enabled deve ser a mesma flag de "isMember() confirmado" que já
// controla o resto da tela da comunidade (mesmo motivo de useSponsoredAds.js: evita
// disparar a consulta antes da hora).
export function useUpcomingWorkouts(communityId, enabled) {
  const cacheKey = `upcomingWorkouts:${communityId}`
  const fetchUpcoming = useCallback(() => listUpcomingWorkouts(communityId), [communityId])
  const {
    data: workouts = [],
    loading,
    error,
    refresh,
    setData: setWorkouts,
  } = useCachedQuery(cacheKey, fetchUpcoming, {
    enabled: enabled && Boolean(communityId),
    context: 'useUpcomingWorkouts',
  })
  return { workouts, loading, error, refresh, setWorkouts }
}
