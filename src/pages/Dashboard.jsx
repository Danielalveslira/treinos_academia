import { useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Box, Button, Heading, Spinner } from '@primer/react'
import {
  ArrowRightIcon,
  CalendarIcon,
  GraphIcon,
  PlayIcon,
  PulseIcon,
  TrophyIcon,
} from '@primer/octicons-react'
import { useDashboard } from '../hooks/useDashboard'
import { useExercises } from '../contexts/ExercisesContext'
import { useAuth } from '../hooks/useAuth'
import { useGlobalSponsoredAds } from '../hooks/useGlobalSponsoredAds'
import { SponsoredAdBanner } from '../components/SponsoredAdBanner'
import { getProfileHeroImage } from '../constants/profileHeroImage'
import { calculateVolume, getTrainingConsistency } from '../utils/calculations'
import { getDailyStreak } from '../utils/streak'
import { getDashboardGreeting } from '../utils/greeting'
import { formatDate, buildExerciseNameMap } from '../utils/format'
import { toDate } from '../utils/date.js'
import { formatWorkoutSets, getWorkoutLoad } from '../utils/workoutSets'
import { isCardioWorkout, formatCardioSession } from '../utils/cardioSessions'
import { FrequencyChart } from '../components/FrequencyChart'
import { StreakCard } from '../components/StreakCard'
import { BodyCompositionCard } from '../components/BodyCompositionCard'
import { ErrorState } from '../components/ErrorState'

function getVolumeTrend(workouts) {
  const now = new Date()
  const startCurrent = new Date(now)
  startCurrent.setDate(now.getDate() - 6)
  startCurrent.setHours(0, 0, 0, 0)
  const startPrevious = new Date(startCurrent)
  startPrevious.setDate(startPrevious.getDate() - 7)
  let current = 0
  let previous = 0

  workouts.forEach((workout) => {
    const date = toDate(workout.date)
    if (date >= startCurrent) current += calculateVolume(workout)
    else if (date >= startPrevious) previous += calculateVolume(workout)
  })

  const percent = previous ? Math.round(((current - previous) / previous) * 100) : null
  return { current, percent }
}

// Os três indicadores que dão pra acompanhar semana a semana no mesmo gráfico — cada um
// já tinha seu número isolado em algum lugar da tela (dias ativos, volume, e agora
// cardio); juntar num seletor evita um gráfico por indicador, que seria mais poluição,
// não menos.
const INDICATORS = [
  { key: 'trainings', label: 'Treinos', heading: 'Consistência' },
  { key: 'volume', label: 'Peso', heading: 'Volume de treino' },
  { key: 'cardio', label: 'Corrida', heading: 'Corrida' },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const [indicator, setIndicator] = useState('trainings')
  const { recentWorkouts, allWorkouts, loading, error, refresh } = useDashboard()
  const { exercises } = useExercises()
  const { profile, user } = useAuth()
  const { bannerAds } = useGlobalSponsoredAds(Boolean(user))
  const heroImage = getProfileHeroImage(profile?.sexo)
  const exerciseNameById = useMemo(() => buildExerciseNameMap(exercises), [exercises])
  // Sequência/constância conta qualquer treino (inclusive cardio) — "dia ativo" não
  // deveria depender de ter levantado peso. Volume e melhor carga continuam só de força:
  // cardio não tem peso×repetição, então entraria como 0 e sub-representaria os dois.
  const consistency = useMemo(() => getTrainingConsistency(allWorkouts), [allWorkouts])
  const dailyStreak = useMemo(() => getDailyStreak(allWorkouts), [allWorkouts])
  // Nem toda corrida tem distância (é opcional no registro) — se ninguém informou,
  // mostrar duração em vez de "0 km" toda semana.
  const preferredCardioField = consistency.totalDistanceKm > 0 ? 'distanceKm' : 'durationMinutes'
  const chartMetric = indicator === 'cardio' ? preferredCardioField : indicator
  const indicatorMeta = INDICATORS.find((item) => item.key === indicator)
  const indicatorSummary =
    indicator === 'volume'
      ? { value: consistency.totalVolumeKg.toLocaleString('pt-BR'), unit: 'kg no período' }
      : indicator === 'cardio'
        ? preferredCardioField === 'distanceKm'
          ? {
              value: consistency.totalDistanceKm.toLocaleString('pt-BR', {
                maximumFractionDigits: 1,
              }),
              unit: 'km no período',
            }
          : { value: consistency.totalDurationMinutes.toLocaleString('pt-BR'), unit: 'min no período' }
        : {
            value: consistency.total,
            unit: consistency.total === 1 ? 'dia ativo' : 'dias ativos',
          }
  const strengthWorkouts = useMemo(
    () => allWorkouts.filter((w) => !isCardioWorkout(w)),
    [allWorkouts]
  )
  const volume = useMemo(() => getVolumeTrend(strengthWorkouts), [strengthWorkouts])
  const lastWorkout = recentWorkouts[0]
  const lastExercise = lastWorkout
    ? exerciseNameById.get(lastWorkout.exerciseId) || 'seu último exercício'
    : null
  const bestLoad = strengthWorkouts.length
    ? Math.max(...strengthWorkouts.map((workout) => getWorkoutLoad(workout)))
    : 0
  const firstName =
    profile?.displayName?.trim().split(/\s+/)[0] ||
    profile?.username ||
    user?.displayName?.trim().split(/\s+/)[0] ||
    'atleta'
  // allWorkouts já está carregado pelo useDashboard (janela de DASHBOARD_HISTORY_DAYS
  // dias, sempre inclui hoje) — nenhuma consulta nova só para saber se já treinou hoje.
  // useMemo evita recalcular (e reamostrar a frase) a cada render que não muda esses
  // dados; "now" só entra no cálculo quando ele roda, então a frase fica estável entre
  // renders do mesmo carregamento, mas ainda reflete o dia/horário reais quando os
  // dados mudam (ex.: após registrar um treino e o dashboard recarregar).
  const greeting = useMemo(
    () => getDashboardGreeting({ firstName, workouts: allWorkouts, uid: user?.uid }),
    [firstName, allWorkouts, user?.uid]
  )

  if (loading && recentWorkouts.length === 0) {
    return (
      <Box className="center-loading">
        <Spinner />
      </Box>
    )
  }

  if (error) {
    return (
      <Box>
        <span className="eyebrow">VISÃO GERAL</span>
        <Heading as="h1">Seu progresso</Heading>
        <ErrorState error={error} onRetry={refresh} />
      </Box>
    )
  }

  if (recentWorkouts.length === 0) {
    return (
      <section className="empty-workout" aria-labelledby="empty-workout-title">
        <img src={heroImage.src} alt={heroImage.alt} />
        <div className="empty-workout-content">
          <span className="eyebrow">COMECE HOJE</span>
          <Heading as="h1" id="empty-workout-title">
            Seu primeiro treino muda tudo.
          </Heading>
          <p>Registre cada série, acompanhe sua constância e veja a evolução acontecer.</p>
          <Button
            className="empty-workout-cta"
            variant="primary"
            leadingVisual={PlayIcon}
            onClick={() => navigate('/novo-treino')}
          >
            Iniciar primeiro treino
          </Button>
        </div>
      </section>
    )
  }

  return (
    <div className="dashboard fitness-dashboard">
      <header className="dashboard-greeting">
        <div>
          <span className="eyebrow">{greeting.eyebrow}</span>
          <Heading as="h1">{greeting.heading}</Heading>
        </div>
      </header>

      <SponsoredAdBanner ads={bannerAds} />

      <section className="workout-hero" aria-labelledby="next-workout-title">
        <img src={heroImage.src} alt={heroImage.alt} />
        <div className="workout-hero-shade" />
        <div className="workout-hero-content">
          <span className="hero-kicker">
            <PulseIcon size={14} /> PRÓXIMO TREINO
          </span>
          <Heading as="h2" id="next-workout-title">
            Supere sua última sessão
          </Heading>
          <p>Continue por {lastExercise}.</p>
          <Button
            as={RouterLink}
            to={`/novo-treino?exercicio=${lastWorkout.exerciseId}`}
            className="start-workout-button"
            leadingVisual={PlayIcon}
            variant="primary"
          >
            Iniciar treino
          </Button>
        </div>
      </section>

      <StreakCard streak={dailyStreak} />

      <section className="performance-strip" aria-label="Resumo do progresso">
        <div>
          <CalendarIcon size={18} />
          <span>Esta semana</span>
          <strong>{consistency.frequency}x</strong>
        </div>
        <div>
          <GraphIcon size={18} />
          <span>Volume 7 dias</span>
          <strong>{Math.round(volume.current).toLocaleString('pt-BR')} kg</strong>
          {volume.percent != null && (
            <small className={volume.percent >= 0 ? 'trend-up' : 'trend-down'}>
              {volume.percent >= 0 ? '+' : ''}
              {volume.percent}%
            </small>
          )}
        </div>
        <div>
          <TrophyIcon size={18} />
          <span>Melhor carga</span>
          <strong>{bestLoad.toLocaleString('pt-BR')} kg</strong>
        </div>
      </section>

      <div className="dashboard-flow">
        <section className="progress-section" aria-labelledby="frequency-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">RITMO DE TREINO</span>
              <Heading as="h2" id="frequency-title">
                {indicatorMeta.heading}
              </Heading>
            </div>
            <span className="section-summary">
              <strong>{indicatorSummary.value}</strong> {indicatorSummary.unit}
            </span>
          </div>
          <div className="metric-tabs" role="tablist" aria-label="Indicador do gráfico">
            {INDICATORS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={indicator === item.key}
                className={indicator === item.key ? 'is-active' : ''}
                onClick={() => setIndicator(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <FrequencyChart data={consistency.chartData} metric={chartMetric} />
        </section>

        <section className="recent-section" aria-labelledby="recent-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ÚLTIMA ATIVIDADE</span>
              <Heading as="h2" id="recent-title">
                Treinos recentes
              </Heading>
            </div>
            <RouterLink to="/historico" className="text-link">
              Ver tudo <ArrowRightIcon size={14} />
            </RouterLink>
          </div>
          <div className="recent-workouts">
            {recentWorkouts.slice(0, 4).map((workout, index) => (
              <article className="recent-workout-row" key={workout.id}>
                <span className="workout-index">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{exerciseNameById.get(workout.exerciseId) || 'Exercício'}</strong>
                  <span>
                    {isCardioWorkout(workout)
                      ? formatCardioSession(workout)
                      : formatWorkoutSets(workout)}
                  </span>
                </div>
                <time>{formatDate(toDate(workout.date))}</time>
              </article>
            ))}
          </div>
        </section>
      </div>

      <BodyCompositionCard />
    </div>
  )
}
