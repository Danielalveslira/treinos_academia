import { useMemo } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Box, Button, Heading, Text, Spinner, Link } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  PlusCircleIcon,
  GraphIcon,
  RocketIcon,
  TrophyIcon,
  ChecklistIcon,
  FlameIcon,
  CalendarIcon,
} from '@primer/octicons-react'
import { useDashboard } from '../hooks/useDashboard'
import { useExercises } from '../contexts/ExercisesContext'
import { getExerciseIndicators, getTrainingConsistency } from '../utils/calculations'
import { formatPercent, formatWeight, formatDate, buildExerciseNameMap } from '../utils/format'
import { IndicatorCard } from '../components/IndicatorCard'
import { FrequencyChart } from '../components/FrequencyChart'
import { ErrorState } from '../components/ErrorState'

export default function Dashboard() {
  const navigate = useNavigate()
  const { recentWorkouts, allWorkouts, totalWorkouts, loading, error, refresh } = useDashboard()
  const { exercises } = useExercises()

  const exerciseNameById = useMemo(() => buildExerciseNameMap(exercises), [exercises])

  const lastWorkout = recentWorkouts[0]

  const lastExerciseIndicators = useMemo(() => {
    if (!lastWorkout) return null
    const sameExercise = recentWorkouts.filter((w) => w.exerciseId === lastWorkout.exerciseId)
    return getExerciseIndicators(sameExercise)
  }, [recentWorkouts, lastWorkout])

  const consistency = useMemo(() => getTrainingConsistency(allWorkouts), [allWorkouts])

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
        <span className="eyebrow">SEU PAINEL DE TREINOS</span>
        <Heading as="h1" sx={{ mb: 3 }}>
          Visão geral
        </Heading>
        <ErrorState error={error} onRetry={refresh} />
      </Box>
    )
  }

  if (recentWorkouts.length === 0) {
    return (
      <Box>
        <span className="eyebrow">SEU PAINEL DE TREINOS</span>
        <Heading as="h1" sx={{ mb: 3 }}>
          Visão geral
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
    <Box className="dashboard">
      <Box className="page-heading">
        <div>
          <span className="eyebrow">SEU PAINEL DE TREINOS</span>
          <Heading as="h1">Visão geral</Heading>
          <p className="page-description">Acompanhe sua constância e a evolução de cada treino.</p>
        </div>
        <Button as={RouterLink} to="/novo-treino" leadingVisual={PlusCircleIcon} variant="primary">
          Novo treino
        </Button>
      </Box>

      <Box
        className="latest-workout"
        sx={{
          bg: 'canvas.subtle',
          border: '1px solid',
          borderColor: 'border.default',
          borderLeft: '4px solid',
          borderLeftColor: 'accent.emphasis',
          borderRadius: 2,
          p: 3,
          mb: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <RocketIcon size={16} fill="var(--fgColor-accent)" />
          <Text sx={{ fontSize: 1, color: 'fg.muted' }}>Treino mais recente</Text>
        </Box>
        <Text sx={{ fontWeight: 'bold', display: 'block' }}>
          {exerciseNameById.get(lastWorkout.exerciseId) || 'Exercício'} ·{' '}
          {formatWeight(lastWorkout.weight)} · {lastWorkout.sets} séries × {lastWorkout.reps} reps
        </Text>
        <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block' }}>
          {formatDate(
            lastWorkout.date?.toDate ? lastWorkout.date.toDate() : new Date(lastWorkout.date)
          )}
        </Text>
        {lastExerciseIndicators?.isPersonalRecord && (
          <Text sx={{ color: 'success.fg', fontWeight: 'bold', display: 'block', mt: 2 }}>
            <TrophyIcon size={16} /> Novo recorde de carga!
          </Text>
        )}
        {!lastExerciseIndicators?.isPersonalRecord &&
          lastExerciseIndicators?.evolutionPercent != null && (
            <Text
              sx={{
                color: lastExerciseIndicators.evolutionPercent > 0 ? 'success.fg' : 'fg.muted',
                fontWeight: 'bold',
                display: 'block',
                mt: 2,
              }}
            >
              Evolução nesse exercício: {formatPercent(lastExerciseIndicators.evolutionPercent)}
            </Text>
          )}
      </Box>

      <Box className="stats-grid">
        <IndicatorCard icon={ChecklistIcon} label="Registros de treino" value={totalWorkouts} />
        <IndicatorCard
          icon={CalendarIcon}
          label="Frequência semanal"
          value={`${consistency.frequency}x`}
        />
        <IndicatorCard
          icon={FlameIcon}
          label="Sequência atual"
          value={`${consistency.streak} ${consistency.streak === 1 ? 'semana' : 'semanas'}`}
        />
      </Box>

      <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mt: -2, mb: 3 }}>
        Registros conta cada exercício lançado (mais de um no mesmo dia soma mais de um registro).
        Frequência e sequência contam dias distintos: a sequência continua se você treinou na semana
        passada e ainda não treinou nesta.
      </Text>
      <div className="dashboard-columns">
        <section className="panel chart-panel">
          <Heading as="h2" sx={{ fontSize: 2, mb: 1 }}>
            Frequência de treinos
          </Heading>
          <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mb: 2 }}>
            Últimas 8 semanas · segunda a domingo · um treino por dia com registros.
          </Text>
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              p: 3,
              mb: 3,
            }}
          >
            <FrequencyChart data={consistency.chartData} />
          </Box>
        </section>
        <section className="panel recent-panel">
          <Box
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
          >
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
                className="workout-row"
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
                    {formatWeight(workout.weight)} · {workout.sets} × {workout.reps} reps
                  </Text>
                </Box>
                <Text sx={{ fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap' }}>
                  {formatDate(
                    workout.date?.toDate ? workout.date.toDate() : new Date(workout.date)
                  )}
                </Text>
              </Box>
            ))}
          </Box>
        </section>
      </div>
    </Box>
  )
}
