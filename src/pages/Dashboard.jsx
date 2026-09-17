import { useMemo } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Box, Button, Heading, Spinner } from '@primer/react'
import {
  ArrowRightIcon,
  CalendarIcon,
  GraphIcon,
  PlayIcon,
  PulseIcon,
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
import { formatWorkoutSets } from '../utils/workoutSets'
import { isCardioWorkout, formatCardioSession } from '../utils/cardioSessions'
import { StreakCard } from '../components/StreakCard'
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

export default function Dashboard() {
  const navigate = useNavigate()
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
  const strengthWorkouts = useMemo(
    () => allWorkouts.filter((w) => !isCardioWorkout(w)),
    [allWorkouts]
  )
  const volume = useMemo(() => getVolumeTrend(strengthWorkouts), [strengthWorkouts])
  const lastWorkout = recentWorkouts[0]
  const lastExercise = lastWorkout
    ? exerciseNameById.get(lastWorkout.exerciseId) || 'seu último exercício'
    : null
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
          <span>Dias de treino nesta semana</span>
          <strong>{consistency.frequency}x</strong>
        </div>
        <div>
          <GraphIcon size={18} />
          <span>Volume de carga · 7 dias</span>
          <strong>{Math.round(volume.current).toLocaleString('pt-BR')} kg</strong>
          {volume.percent != null && (
            <small className={volume.percent >= 0 ? 'trend-up' : 'trend-down'}>
              {volume.percent >= 0 ? '+' : ''}
              {volume.percent}%
            </small>
          )}
        </div>
        <div>
          <GraphIcon size={18} />
          <span>Análise completa</span>
          <RouterLink to="/progresso" className="text-link">
            Ver progresso <ArrowRightIcon size={14} />
          </RouterLink>
        </div>
      </section>

      <div className="dashboard-flow">
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
    </div>
  )
}
