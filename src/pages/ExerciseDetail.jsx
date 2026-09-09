import { formatWorkoutSets, getWorkoutLoad } from '../utils/workoutSets'
import { useMemo } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { Box, Button, Heading, Text, Label, Link, Spinner, Flash } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  ChevronLeftIcon,
  HistoryIcon,
  TrophyIcon,
  GraphBarVerticalIcon,
  ChecklistIcon,
  CalendarIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ZapIcon,
  DatabaseIcon,
} from '@primer/octicons-react'
import { useExercises } from '../contexts/ExercisesContext'
import { useExerciseHistory } from '../hooks/useExerciseHistory'
import {
  getExerciseIndicators,
  buildLoadHistory,
  groupVolumeByDate,
  calculateVolume,
} from '../utils/calculations'
import { formatPercent, formatWeight, formatDate } from '../utils/format'
import { IndicatorCard } from '../components/IndicatorCard'
import { LoadChart } from '../components/LoadChart'
import { VolumeChart } from '../components/VolumeChart'
import { ErrorState } from '../components/ErrorState'

function EvolutionValue({ percent }) {
  if (percent == null) return <Text sx={{ color: 'fg.muted' }}>—</Text>
  const tone = percent > 0 ? 'success.fg' : percent < 0 ? 'danger.fg' : 'fg.muted'
  const Arrow = percent > 0 ? ArrowUpIcon : percent < 0 ? ArrowDownIcon : ArrowRightIcon
  return (
    <Text sx={{ color: tone, display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <Arrow size={16} /> {formatPercent(percent)}
    </Text>
  )
}

export default function ExerciseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { exercises, loading: loadingExercises } = useExercises()
  const { workouts, loading: loadingWorkouts, error, refresh } = useExerciseHistory(id)

  const exercise = exercises.find((e) => e.id === id)
  const indicators = useMemo(() => getExerciseIndicators(workouts), [workouts])
  const chartData = useMemo(() => buildLoadHistory(workouts), [workouts])

  const volumeData = useMemo(() => groupVolumeByDate(workouts), [workouts])

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
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 3,
          mb: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 48,
              height: 48,
              flexShrink: 0,
              borderRadius: '50%',
              bg: 'accent.subtle',
              color: 'accent.fg',
            }}
          >
            <GraphBarVerticalIcon size={24} />
          </Box>
          <Box>
            <Heading as="h1" sx={{ fontSize: 3 }}>
              {exercise?.name || 'Exercício'}
            </Heading>
            {exercise?.muscleGroup && (
              <Text sx={{ color: 'fg.muted', display: 'block' }}>{exercise.muscleGroup}</Text>
            )}
          </Box>
        </Box>
        <Button onClick={refresh} loading={loadingWorkouts} disabled={loadingWorkouts}>
          Atualizar
        </Button>
      </Box>

      {loading && workouts.length === 0 && (
        <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />
      )}
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

      {!error && workouts.length > 0 && (
        <>
          {indicators.isPersonalRecord && (
            <Flash variant="success" sx={{ mb: 3 }}>
              🏆 Novo recorde de carga neste exercício!
            </Flash>
          )}
          <Box className="stats-grid" sx={{ mb: 3 }}>
            <IndicatorCard
              icon={GraphBarVerticalIcon}
              label="Maior carga atual"
              value={formatWeight(indicators.currentLoad)}
            />
            <IndicatorCard
              icon={TrophyIcon}
              label="Maior carga"
              value={formatWeight(indicators.maxLoad)}
            />
            <IndicatorCard
              icon={HistoryIcon}
              label="Maior carga anterior"
              value={formatWeight(indicators.previousLoad)}
            />
            <IndicatorCard
              label="Evolução"
              value={<EvolutionValue percent={indicators.evolutionPercent} />}
            />
            <IndicatorCard
              icon={ZapIcon}
              label="Volume do último treino"
              value={formatWeight(indicators.lastVolume)}
            />
            <IndicatorCard
              icon={DatabaseIcon}
              label="Volume acumulado"
              value={formatWeight(indicators.accumulatedVolume)}
            />
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
            <LoadChart data={chartData} label="Maior carga por treino (kg)" />
          </Box>
          <Heading as="h2" sx={{ fontSize: 2, mt: 3, mb: 2 }}>
            Volume por dia
          </Heading>
          <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3 }}>
            <VolumeChart data={volumeData} />
          </Box>
          <Heading as="h2" sx={{ fontSize: 2, mt: 3, mb: 2 }}>
            Séries por treino
          </Heading>
          {workouts.map((workout) => {
            const date = workout.date?.toDate ? workout.date.toDate() : new Date(workout.date)
            const isRecord = getWorkoutLoad(workout) === indicators.maxLoad
            return (
              <Box
                as="article"
                key={workout.id}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 2,
                  p: 3,
                  mb: 2,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 2,
                  }}
                >
                  <Link
                    as={RouterLink}
                    to={`/historico?exercicio=${id}`}
                    sx={{ fontWeight: 'bold' }}
                  >
                    {formatDate(date)}
                  </Link>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <Label variant={isRecord ? 'success' : 'accent'}>
                      {isRecord && <TrophyIcon size={12} />} {formatWeight(getWorkoutLoad(workout))}{' '}
                      máx
                    </Label>
                    <Label variant="secondary">{formatWeight(calculateVolume(workout))} volume</Label>
                  </Box>
                </Box>
                <Text as="p" sx={{ fontSize: 1, color: 'fg.muted', m: 0 }}>
                  {formatWorkoutSets(workout)}
                </Text>
                {workout.note && (
                  <Text as="p" sx={{ fontSize: 1, fontStyle: 'italic', m: 0 }}>
                    “{workout.note}”
                  </Text>
                )}
              </Box>
            )
          })}
        </>
      )}
    </Box>
  )
}
