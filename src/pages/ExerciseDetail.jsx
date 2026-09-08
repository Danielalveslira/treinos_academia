import { useMemo } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { Box, Heading, Text, Link, Spinner, Flash } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  ChevronLeftIcon,
  HistoryIcon,
  TrophyIcon,
  GraphBarVerticalIcon,
  ChecklistIcon,
  CalendarIcon,
} from '@primer/octicons-react'
import { useExercises } from '../hooks/useExercises'
import { useExerciseHistory } from '../hooks/useExerciseHistory'
import { getExerciseIndicators, buildLoadHistory } from '../utils/calculations'
import { formatPercent, formatWeight, formatDate } from '../utils/format'
import { IndicatorCard } from '../components/IndicatorCard'
import { LoadChart } from '../components/LoadChart'
import { ErrorState } from '../components/ErrorState'

export default function ExerciseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { exercises, loading: loadingExercises } = useExercises()
  const { workouts, loading: loadingWorkouts, error, refresh } = useExerciseHistory(id)

  const exercise = exercises.find((e) => e.id === id)
  const indicators = useMemo(() => getExerciseIndicators(workouts), [workouts])
  const chartData = useMemo(() => buildLoadHistory(workouts), [workouts])

  const loading = loadingExercises || loadingWorkouts

  return (
    <Box>
      <Link
        as={RouterLink}
        to="/exercicios"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 2, fontSize: 1 }}
      >
        <ChevronLeftIcon /> Exercícios
      </Link>
      <Heading as="h1" sx={{ fontSize: 3 }}>
        {exercise?.name || 'Exercício'}
      </Heading>
      {exercise?.muscleGroup && (
        <Text sx={{ color: 'fg.muted', display: 'block', mb: 3 }}>{exercise.muscleGroup}</Text>
      )}

      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && workouts.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <HistoryIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhum treino registrado</Blankslate.Heading>
          <Blankslate.Description>
            Registre um treino para acompanhar a evolução deste exercício.
          </Blankslate.Description>
          <Blankslate.PrimaryAction onClick={() => navigate(`/novo-treino?exercicio=${id}`)}>
            Registrar treino
          </Blankslate.PrimaryAction>
        </Blankslate>
      )}

      {!loading && !error && workouts.length > 0 && (
        <>
          {indicators.isPersonalRecord && (
            <Flash variant="success" sx={{ mb: 3 }}>
              🏆 Novo recorde de carga neste exercício!
            </Flash>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
            <IndicatorCard
              icon={GraphBarVerticalIcon}
              label="Carga atual"
              value={formatWeight(indicators.currentLoad)}
            />
            <IndicatorCard
              icon={TrophyIcon}
              label="Maior carga"
              value={formatWeight(indicators.maxLoad)}
            />
            <IndicatorCard label="Carga anterior" value={formatWeight(indicators.previousLoad)} />
            <IndicatorCard label="Evolução" value={formatPercent(indicators.evolutionPercent)} />
            <IndicatorCard icon={ChecklistIcon} label="Sessões" value={indicators.sessionCount} />
            <IndicatorCard
              icon={CalendarIcon}
              label="Último treino"
              value={formatDate(indicators.lastWorkoutDate)}
            />
          </Box>

          <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
            Evolução da carga
          </Heading>
          <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3 }}>
            <LoadChart data={chartData} />
          </Box>
        </>
      )}
    </Box>
  )
}
