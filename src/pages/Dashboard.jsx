import { useMemo } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Box, Button, Heading, Text, Spinner, Link } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PlusCircleIcon, GraphIcon } from '@primer/octicons-react'
import { useDashboard } from '../hooks/useDashboard'
import { useExercises } from '../hooks/useExercises'
import {
  calculateVolume,
  getExerciseIndicators,
  getWeeklyFrequency,
  groupVolumeByDate,
} from '../utils/calculations'
import { formatPercent, formatWeight, formatDate } from '../utils/format'
import { IndicatorCard } from '../components/IndicatorCard'
import { VolumeChart } from '../components/VolumeChart'
import { ErrorState } from '../components/ErrorState'

export default function Dashboard() {
  const navigate = useNavigate()
  const { recentWorkouts, totalWorkouts, loading, error, refresh } = useDashboard()
  const { exercises } = useExercises()

  const exerciseNameById = useMemo(() => {
    const map = new Map()
    exercises.forEach((ex) => map.set(ex.id, ex.name))
    return map
  }, [exercises])

  const lastWorkout = recentWorkouts[0]

  const lastExerciseIndicators = useMemo(() => {
    if (!lastWorkout) return null
    const sameExercise = recentWorkouts.filter((w) => w.exerciseId === lastWorkout.exerciseId)
    return getExerciseIndicators(sameExercise)
  }, [recentWorkouts, lastWorkout])

  const accumulatedVolume = useMemo(
    () => recentWorkouts.reduce((sum, w) => sum + calculateVolume(w.weight, w.sets, w.reps), 0),
    [recentWorkouts]
  )

  const weeklyFrequency = useMemo(() => getWeeklyFrequency(recentWorkouts), [recentWorkouts])
  const volumeChartData = useMemo(() => groupVolumeByDate(recentWorkouts), [recentWorkouts])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Spinner />
      </Box>
    )
  }

  if (error) {
    return (
      <Box>
        <Heading as="h1" sx={{ fontSize: 3, mb: 3 }}>
          Dashboard
        </Heading>
        <ErrorState error={error} onRetry={refresh} />
      </Box>
    )
  }

  if (recentWorkouts.length === 0) {
    return (
      <Box>
        <Heading as="h1" sx={{ fontSize: 3, mb: 3 }}>
          Dashboard
        </Heading>
        <Blankslate>
          <Blankslate.Visual>
            <GraphIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhum treino registrado ainda</Blankslate.Heading>
          <Blankslate.Description>Comece registrando seu primeiro treino.</Blankslate.Description>
          <Blankslate.PrimaryAction onClick={() => navigate('/novo-treino')}>
            Registrar treino
          </Blankslate.PrimaryAction>
        </Blankslate>
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Heading as="h1" sx={{ fontSize: 3 }}>
          Dashboard
        </Heading>
        <Button as={RouterLink} to="/novo-treino" leadingVisual={PlusCircleIcon} variant="primary">
          Novo treino
        </Button>
      </Box>

      <Box
        sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, mb: 3 }}
      >
        <Text sx={{ fontSize: 1, color: 'fg.muted', display: 'block', mb: 1 }}>
          Treino mais recente
        </Text>
        <Text sx={{ fontWeight: 'bold', display: 'block' }}>
          {exerciseNameById.get(lastWorkout.exerciseId) || 'Exercício'} ·{' '}
          {formatWeight(lastWorkout.weight)} · {lastWorkout.sets}x{lastWorkout.reps}
        </Text>
        <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block' }}>
          {formatDate(
            lastWorkout.date?.toDate ? lastWorkout.date.toDate() : new Date(lastWorkout.date)
          )}
        </Text>
        {lastExerciseIndicators?.isPersonalRecord && (
          <Text sx={{ color: 'success.fg', fontWeight: 'bold', display: 'block', mt: 2 }}>
            🏆 Novo recorde de carga!
          </Text>
        )}
        {!lastExerciseIndicators?.isPersonalRecord &&
          lastExerciseIndicators?.evolutionPercent != null && (
            <Text sx={{ color: 'success.fg', fontWeight: 'bold', display: 'block', mt: 2 }}>
              Evolução nesse exercício: {formatPercent(lastExerciseIndicators.evolutionPercent)}
            </Text>
          )}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr 1fr', '1fr 1fr 1fr'], gap: 2, mb: 4 }}>
        <IndicatorCard label="Total de treinos" value={totalWorkouts} />
        <IndicatorCard label="Frequência semanal" value={`${weeklyFrequency}x`} />
        <IndicatorCard label="Volume acumulado" value={accumulatedVolume} />
      </Box>

      <Heading as="h2" sx={{ fontSize: 2, mb: 1 }}>
        Volume levantado por dia
      </Heading>
      <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mb: 2 }}>
        Peso × séries × repetições somado de cada dia de treino.
      </Text>
      <Box sx={{ mb: 4 }}>
        <VolumeChart data={volumeChartData} />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Heading as="h2" sx={{ fontSize: 2 }}>
          Últimos registros
        </Heading>
        <Link as={RouterLink} to="/historico" sx={{ fontSize: 1 }}>
          Ver tudo
        </Link>
      </Box>
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {recentWorkouts.slice(0, 5).map((workout, index) => (
          <Box
            key={workout.id}
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 2,
              px: 3,
              py: 2,
              borderTop: index === 0 ? 'none' : '1px solid',
              borderColor: 'border.default',
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Text sx={{ fontWeight: 'bold', display: 'block' }}>
                {exerciseNameById.get(workout.exerciseId) || 'Exercício'}
              </Text>
              <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                {formatWeight(workout.weight)} · {workout.sets}x{workout.reps}
              </Text>
            </Box>
            <Text sx={{ fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap' }}>
              {formatDate(workout.date?.toDate ? workout.date.toDate() : new Date(workout.date))}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
