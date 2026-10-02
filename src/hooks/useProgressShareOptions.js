import { useCallback, useMemo } from 'react'
import { useAuth } from './useAuth'
import { useCachedQuery } from './useCachedQuery'
import { listProgressDays } from '../services/progressService'
import { getActivityRange } from '../utils/activityCalendar'
import { buildConsistencySnapshot } from '../utils/consistencySnapshot'
import { buildShareOptions } from '../utils/shareProgress'
import { normalizeTrainingPreferences } from '../utils/trainingPlan'

// Opções de "Compartilhar progresso" para telas que NÃO têm os dados da Home carregados (Comunidades). Usa a mesma
// fonte e a mesma matemática da Home: 1 RPC (list_progress_days, já agregada no banco), as preferências de treino
// do perfil e buildConsistencySnapshot/buildShareOptions -- nenhuma regra de cálculo é duplicada aqui. A chave de
// cache começa com "progress:{uid}:", então invalidateWorkoutCache (novo treino) já a invalida; só busca quando
// `enabled` (o seletor está aberto).
export function useProgressShareOptions({ enabled = true } = {}) {
  const { user, profile } = useAuth()
  const { start, end, year } = getActivityRange()
  const fetchValue = useCallback(
    () => listProgressDays(user.uid, start, end),
    [user.uid, start, end]
  )
  const { data, loading, error, refresh } = useCachedQuery(
    `progress:${user.uid}:days:${year}`,
    fetchValue,
    { enabled, context: 'useProgressShareOptions' }
  )
  const preferences = useMemo(
    () => normalizeTrainingPreferences(profile?.trainingPreferences),
    [profile?.trainingPreferences]
  )
  const options = useMemo(() => {
    if (!data) return []
    const { consistency } = buildConsistencySnapshot(data, preferences)
    return buildShareOptions({
      progressDays: data,
      preferences,
      consistency,
      username: profile?.username,
    })
  }, [data, preferences, profile?.username])
  return { options, loading, error, refresh }
}
