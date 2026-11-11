import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Heading, Spinner, Text } from '@primer/react'
import { HistoryIcon } from '@primer/octicons-react'
import { useProgressDays } from '../hooks/useProgressDays'
import { useProgressSheetSummary } from '../hooks/useProgressSheetSummary'
import { msUntilNextBusinessDay } from '../utils/businessDate'
import {
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
import { SponsoredAdBanner } from '../components/SponsoredAdBanner'
import { useGlobalSponsoredAds } from '../hooks/useGlobalSponsoredAds'
import { useAuth } from '../hooks/useAuth'

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
    label: 'Dias ativos',
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
    <Text sx={{ color: 'fg.muted', fontSize: 0 }}>
      {change > 0 ? '+' : ''}
      {change.toFixed(1)}% vs. período anterior
    </Text>
  )
}

export default function Progress() {
  const { user, offlineLocal } = useAuth()
  const { bannerAds } = useGlobalSponsoredAds(Boolean(user) && !offlineLocal, 'progress_banner')
  const [period, setPeriod] = useState('month')
  const [metric, setMetric] = useState('strengthVolumeKg')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer
    const advance = () => {
      const current = new Date()
      setNow(current)
      timer = setTimeout(advance, msUntilNextBusinessDay(current) + 50)
    }
    timer = setTimeout(advance, msUntilNextBusinessDay(now) + 50)
    return () => clearTimeout(timer)
  }, [now])
  const { exercises } = useExercises()
  const exerciseNames = useMemo(
    () => new Map(exercises.map((exercise) => [exercise.id, exercise.name])),
    [exercises]
  )
  const range = useMemo(() => getProgressPeriod(period, now), [period, now])
  const { days, available, offline, loading, error, refresh } = useProgressDays(
    dateKey(range.start),
    dateKey(range.end),
    dateKey(range.previousStart),
    dateKey(range.previousEnd)
  )
  const {
    data: sheetSummary,
    loading: sheetsLoading,
    error: sheetsError,
    refresh: refreshSheets,
  } = useProgressSheetSummary(dateKey(range.start), dateKey(range.end))
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
  const hasChartData = chart.some((point) => point.currentValue > 0 || point.previousValue > 0)

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

      <div className="metric-tabs" role="group" aria-label="Período">
        {PERIODS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={period === key}
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

      {!loading && !error && available && (
        <>
          <Box className="stats-grid progress-stats-grid progress-overview-grid">
            <IndicatorCard label="Dias ativos" value={current.trainingDays} />
            <IndicatorCard
              label="Volume realizado"
              value={`${Math.round(current.volumeKg).toLocaleString('pt-BR')} kg`}
            />
            {!offline && sheetSummary && (
              <IndicatorCard
                label="Atividade por fichas"
                value={`${sheetSummary.trainedOccurrences} ficha/dia`}
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
              <span className="section-summary" aria-live="polite">
                <strong>{config.format(selectedCurrent)}</strong>
                <br />
                <Variation current={selectedCurrent} previous={selectedPrevious} />
                <Text as="span" sx={{ display: 'block', color: 'fg.muted', fontSize: 0 }}>
                  Atual: {dateKey(range.start)} a {dateKey(range.end)}
                </Text>
                <Text as="span" sx={{ display: 'block', color: 'fg.muted', fontSize: 0 }}>
                  Anterior: {config.format(selectedPrevious)} · {dateKey(range.previousStart)} a{' '}
                  {dateKey(range.previousEnd)}
                </Text>
              </span>
            </div>
            <div className="metric-tabs" role="group" aria-label="Indicador">
              {Object.entries(METRICS).map(([key, item]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={metric === key}
                  className={metric === key ? 'is-active' : ''}
                  onClick={() => setMetric(key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {hasChartData ? (
              <ProgressChart data={chart} formatValue={config.format} showPrevious={showPrevious} />
            ) : (
              <Text sx={{ color: 'fg.muted' }}>Sem registros neste período.</Text>
            )}
          </section>

          {!offline && bannerAds.length > 0 && (
            <SponsoredAdBanner ads={bannerAds} placement="progress_banner" />
          )}

          <section className="progress-section" aria-labelledby="sheets-title">
            <div className="section-heading">
              <div>
                <span className="eyebrow">FICHAS</span>
                <Heading as="h2" id="sheets-title">
                  Atividade por fichas
                </Heading>
              </div>
            </div>
            {offline ? (
              <Text>Dados de fichas indisponíveis sem conexão.</Text>
            ) : sheetsLoading && !sheetSummary ? (
              <Spinner />
            ) : null}
            <ErrorState error={sheetsError} onRetry={refreshSheets} />
            {sheetSummary && (
              <>
                <Text as="p" sx={{ color: 'fg.muted', fontSize: 1 }}>
                  Atividade: uma ocorrência por ficha e dia. Conclusão: confirmação explícita do
                  servidor. Exercícios antigos com todas as séries previstas e cardio seguem a regra
                  legada de conclusão. Registros sem ficha permanecem nos totais.
                </Text>
                <Box className="stats-grid progress-stats-grid">
                  <IndicatorCard
                    label="Fichas concluídas"
                    value={sheetSummary.completedOccurrences}
                  />
                  <IndicatorCard label="Fichas distintas" value={sheetSummary.distinctSheets} />
                  <IndicatorCard
                    label="Exercícios registrados"
                    value={sheetSummary.exerciseRecords}
                  />
                  <IndicatorCard
                    label="Exercícios concluídos"
                    value={sheetSummary.completedExercises}
                  />
                </Box>
                {sheetSummary.sheets?.map((sheet) => (
                  <Text as="p" key={sheet.id} sx={{ display: 'block', color: 'fg.muted' }}>
                    {sheet.name}: {sheet.trainedDays} dia(s) de atividade · {sheet.completedDays}{' '}
                    conclusão(ões)
                  </Text>
                ))}
              </>
            )}
          </section>
          <StrengthProgress days={currentDays} exerciseNames={exerciseNames} />
        </>
      )}
      {!loading && !error && !available && (
        <Text>Progresso indisponível sem um registro sincronizado para este período.</Text>
      )}
      {offline && available && (
        <Text as="p" sx={{ color: 'fg.muted' }}>
          Dados salvos anteriormente; alterações locais podem estar pendentes de sincronização.
        </Text>
      )}
      <BodyCompositionCard />
    </div>
  )
}
