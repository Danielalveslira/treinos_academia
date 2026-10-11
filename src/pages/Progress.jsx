import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Heading, Spinner, Text } from '@primer/react'
import { HistoryIcon } from '@primer/octicons-react'
import { useProgressDays } from '../hooks/useProgressDays'
import {
  aggregateMuscleGroups,
  aggregateProgress,
  buildProgressComparisonChart,
  dateKey,
  getProgressPeriod,
  percentChange,
} from '../utils/progress'
import { IndicatorCard } from '../components/IndicatorCard'
import { ProgressChart } from '../components/ProgressChart'
import { BodyCompositionCard } from '../components/BodyCompositionCard'
import { ErrorState } from '../components/ErrorState'
import { useExercises } from '../contexts/ExercisesContext'
import { StrengthProgress } from '../components/StrengthProgress'
import { getMuscleGroupIcon } from '../constants/muscleGroupIcons'
import { MuscleIconBadge } from '../components/MuscleIconBadge'

const PERIODS = [
  ['today', 'Hoje'],
  ['week', 'Semana'],
  ['month', 'Mês'],
  ['quarter', 'Trimestre'],
  ['year', 'Ano'],
]

const METRICS = {
  strengthVolumeKg: {
    label: 'Volume',
    format: (value) => `${Math.round(value).toLocaleString('pt-BR')} kg`,
  },
  strengthSets: { label: 'Séries', format: (value) => Math.round(value).toLocaleString('pt-BR') },
  strengthReps: {
    label: 'Repetições',
    format: (value) => Math.round(value).toLocaleString('pt-BR'),
  },
  trainingDays: {
    label: 'Dias de treino',
    format: (value) => Math.round(value).toLocaleString('pt-BR'),
  },
  cardioMinutes: {
    label: 'Cardio',
    format: (value) => `${Math.round(value).toLocaleString('pt-BR')} min`,
  },
}

function Variation({ current, previous }) {
  const change = percentChange(current, previous)
  if (change == null) return <Text sx={{ color: 'fg.muted', fontSize: 0 }}>Sem base anterior</Text>
  return (
    <Text
      sx={{ color: change > 0 ? 'success.fg' : change < 0 ? 'danger.fg' : 'fg.muted', fontSize: 0 }}
    >
      {change > 0 ? '+' : ''}
      {change.toFixed(1)}% vs. período anterior
    </Text>
  )
}

export default function Progress() {
  const [period, setPeriod] = useState('month')
  const [metric, setMetric] = useState('strengthVolumeKg')
  const { exercises } = useExercises()
  const exerciseNames = useMemo(
    () => new Map(exercises.map((exercise) => [exercise.id, exercise.name])),
    [exercises]
  )
  const muscleGroupsByExercise = useMemo(
    () => new Map(exercises.map((exercise) => [exercise.id, exercise.muscleGroup])),
    [exercises]
  )
  const range = useMemo(() => getProgressPeriod(period), [period])
  const { days, loading, error, refresh } = useProgressDays(
    dateKey(range.start),
    dateKey(range.end),
    dateKey(range.previousStart),
    dateKey(range.previousEnd)
  )
  const currentDays = useMemo(
    () =>
      days.filter(
        (day) => day.dateKey >= dateKey(range.start) && day.dateKey <= dateKey(range.end)
      ),
    [days, range]
  )
  const previousDays = useMemo(
    () =>
      days.filter(
        (day) =>
          day.dateKey >= dateKey(range.previousStart) && day.dateKey <= dateKey(range.previousEnd)
      ),
    [days, range]
  )
  const current = useMemo(() => aggregateProgress(currentDays), [currentDays])
  const previous = useMemo(() => aggregateProgress(previousDays), [previousDays])
  const chart = useMemo(
    () =>
      buildProgressComparisonChart(currentDays, previousDays, period, metric, range, exerciseNames),
    [currentDays, previousDays, period, metric, range, exerciseNames]
  )
  const muscleGroups = useMemo(
    () => aggregateMuscleGroups(currentDays, muscleGroupsByExercise),
    [currentDays, muscleGroupsByExercise]
  )
  const config = METRICS[metric]
  const selectedCurrent =
    current[
      metric === 'strengthVolumeKg'
        ? 'volumeKg'
        : metric === 'strengthSets'
          ? 'sets'
          : metric === 'strengthReps'
            ? 'reps'
            : metric
    ]
  const selectedPrevious =
    previous[
      metric === 'strengthVolumeKg'
        ? 'volumeKg'
        : metric === 'strengthSets'
          ? 'sets'
          : metric === 'strengthReps'
            ? 'reps'
            : metric
    ]
  const showPrevious = selectedPrevious > 0
  const hasCurrentChartData = chart.some((point) => point.currentValue > 0)

  return (
    <div className="dashboard fitness-dashboard progress-page">
      <header className="section-heading">
        <div>
          <span className="eyebrow">EVOLUÇÃO</span>
          <Heading as="h1">Progresso</Heading>
          <Text as="p" sx={{ color: 'fg.muted', m: 0 }}>
            Indicadores objetivos dos seus registros.
          </Text>
        </div>
        <Button as={RouterLink} to="/historico" leadingVisual={HistoryIcon}>
          Histórico
        </Button>
      </header>

      <div className="metric-tabs" role="tablist" aria-label="Período">
        {PERIODS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={period === key}
            className={period === key ? 'is-active' : ''}
            onClick={() => setPeriod(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && days.length === 0 && (
        <Box className="center-loading">
          <Spinner />
        </Box>
      )}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && (
        <>
          <Box className="stats-grid progress-stats-grid progress-overview-grid">
            <IndicatorCard label="Dias de treino" value={current.trainingDays} />
            <IndicatorCard label="Treinos registrados" value={current.workoutCount} />
            <IndicatorCard label="Exercícios distintos" value={current.distinctExercises} />
            {current.cardioMinutes > 0 && (
              <IndicatorCard
                label="Cardio"
                value={`${current.cardioMinutes.toLocaleString('pt-BR')} min`}
              />
            )}
            {current.cardioDistanceKm > 0 && (
              <IndicatorCard
                label="Distância"
                value={`${current.cardioDistanceKm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`}
              />
            )}
          </Box>

          <section className="progress-section" aria-labelledby="progress-chart-title">
            <div className="section-heading">
              <div>
                <span className="eyebrow">TREINO</span>
                <Heading as="h2" id="progress-chart-title">
                  {config.label}
                </Heading>
              </div>
              <span className="section-summary">
                <strong>{config.format(selectedCurrent)}</strong>
                <br />
                <Variation current={selectedCurrent} previous={selectedPrevious} />
              </span>
            </div>
            <div className="metric-tabs" role="tablist" aria-label="Indicador">
              {Object.entries(METRICS).map(([key, item]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={metric === key}
                  className={metric === key ? 'is-active' : ''}
                  onClick={() => setMetric(key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {hasCurrentChartData ? (
              <ProgressChart data={chart} formatValue={config.format} showPrevious={showPrevious} />
            ) : (
              <Text sx={{ color: 'fg.muted' }}>Sem registros neste período.</Text>
            )}
          </section>

          <StrengthProgress days={currentDays} exerciseNames={exerciseNames} />

          <section className="progress-section" aria-labelledby="volume-title">
            <div className="section-heading">
              <div>
                <span className="eyebrow">VOLUME</span>
                <Heading as="h2" id="volume-title">
                  Carga e trabalho realizado
                </Heading>
              </div>
            </div>
            <Box className="stats-grid progress-stats-grid">
              <IndicatorCard
                label="Volume total"
                value={`${Math.round(current.volumeKg).toLocaleString('pt-BR')} kg`}
              />
              <IndicatorCard
                label="Média por treino"
                value={`${Math.round(current.averageVolumePerWorkout).toLocaleString('pt-BR')} kg`}
              />
              <IndicatorCard
                label="Média por dia ativo"
                value={`${Math.round(current.averageVolumePerActiveDay).toLocaleString('pt-BR')} kg`}
              />
              <IndicatorCard label="Séries" value={current.sets} />
              <IndicatorCard label="Repetições" value={current.reps} />
            </Box>
            <Text as="p" sx={{ color: 'fg.muted', fontSize: 1 }}>
              Volume de carga = soma de peso × repetições das séries. Carga zero e exercícios de
              peso corporal não recebem peso estimado; séries, repetições e frequência continuam
              contabilizadas.
            </Text>
          </section>

          {muscleGroups.length > 0 && (
            <section className="progress-section" aria-labelledby="muscle-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">DISTRIBUIÇÃO</span>
                  <Heading as="h2" id="muscle-title">
                    Grupos musculares por séries
                  </Heading>
                </div>
              </div>
              <div className="muscle-distribution">
                {muscleGroups.map((item) => (
                  <div key={item.muscleGroup}>
                    <span className="progress-muscle-label">
                      <MuscleIconBadge icon={getMuscleGroupIcon(item.muscleGroup)} size="sm" />
                      {item.muscleGroup}
                    </span>
                    <strong>{item.sets} séries</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
          <BodyCompositionCard />
        </>
      )}
    </div>
  )
}
