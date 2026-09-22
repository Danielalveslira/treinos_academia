import { useCallback } from 'react'
import { listUpcomingWorkouts } from '../services/statusesService'
import { useCachedQuery } from './useCachedQuery'

// "Próximos treinos" (Treino Marcado V1) -- consulta própria (workout.date > agora),
// independente do feed recente (useCommunityFeed.js filtra por expiresAt, sem relação
// com a data do evento -- ver canJoinWorkout em firestore.rules). enabled deve ser a
// mesma flag de "isMember() confirmado" que já controla o resto da tela da comunidade
// (mesmo motivo de useSponsoredAds.js: a regra de leitura nega a consulta inteira, não
// filtra documento a documento, para quem ainda não é membro confirmado).
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
