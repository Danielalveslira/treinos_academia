import { lazy, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import { Box, Button, Heading, Spinner } from '@primer/react'
import {
  ArrowRightIcon,
  CalendarIcon,
  GraphIcon,
  PlayIcon,
  PulseIcon,
} from '@primer/octicons-react'
import { useHomeDashboard } from '../hooks/useHomeDashboard'
import { useExercises } from '../contexts/ExercisesContext'
import { useAuth } from '../hooks/useAuth'
import { useGlobalSponsoredAds } from '../hooks/useGlobalSponsoredAds'
import { SponsoredAdBanner } from '../components/SponsoredAdBanner'
import { ResponsivePicture } from '../components/ResponsivePicture'
import { originState } from '../utils/navigation'
import { getProfileHeroImage } from '../constants/profileHeroImage'
import { getDashboardGreeting } from '../utils/greeting'
import { buildExerciseNameMap } from '../utils/format'
import { StreakCard } from '../components/StreakCard'
import { buildShareOptions } from '../utils/shareProgress'
import { buildConsistencySnapshot } from '../utils/consistencySnapshot'
import { addDaysToDayKey, businessDayKey, businessDayKeyDaysAgo } from '../utils/businessDate'
import { ErrorState } from '../components/ErrorState'
import { LazyDialogBoundary } from '../components/LazyDialogBoundary'
import { saveTrainingPreferences } from '../services/usersService'
import { isPreferredReminderDue, normalizeTrainingPreferences } from '../utils/trainingPlan'

// Diálogos só entram no bundle da Home quando alguém os abre (o share puxa o gerador de imagem/canvas).
const loadShareDialog = () => import('../components/ShareProgressDialog')
const ShareProgressDialog = lazy(() =>
  loadShareDialog().then((module) => ({ default: module.ShareProgressDialog }))
)
const loadCalendarDialog = () => import('../components/ActivityCalendarDialog')
const loadPlanDialog = () => import('../components/TrainingPlanDialog')
const ActivityCalendarDialog = lazy(() =>
  loadCalendarDialog().then((module) => ({ default: module.ActivityCalendarDialog }))
)
const TrainingPlanDialog = lazy(() =>
  loadPlanDialog().then((module) => ({ default: module.TrainingPlanDialog }))
)

// Depois que a Home pintou e o aparelho ficou ocioso, baixa os diálogos (uma vez, só online): abrem na hora e o
// service worker os guarda para funcionar offline também -- sem pesar no carregamento inicial.
function warmDialogChunks() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  loadShareDialog().catch(() => {})
  loadCalendarDialog().catch(() => {})
  loadPlanDialog().catch(() => {})
}

function getVolumeTrend(days) {
  const startCurrent = businessDayKeyDaysAgo(6)
  const startPrevious = businessDayKeyDaysAgo(13)
  let current = 0
  let previous = 0

  days.forEach((day) => {
    const volume = Number(day.strengthVolumeKg) || 0
    if (day.dateKey >= startCurrent) current += volume
    else if (day.dateKey >= startPrevious) previous += volume
  })

  const percent = previous ? Math.round(((current - previous) / previous) * 100) : null
  return { current, percent }
}

export default function Dashboard() {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    const idle = globalThis.requestIdleCallback || ((callback) => setTimeout(callback, 1500))
    const cancel = globalThis.cancelIdleCallback || clearTimeout
    const handle = idle(warmDialogChunks, { timeout: 4000 })
    return () => cancel(handle)
  }, [])
  const { recentWorkouts, progressDays, progressAvailable, loading, error, refresh } =
    useHomeDashboard()
  const { exercises } = useExercises()
  const { profile, user, refreshProfile, offlineLocal } = useAuth()
  const { bannerAds } = useGlobalSponsoredAds(Boolean(user) && !offlineLocal)
  const heroImage = getProfileHeroImage(profile?.sexo)
  const exerciseNameById = useMemo(() => buildExerciseNameMap(exercises), [exercises])
  const trainingPreferences = useMemo(
    () => normalizeTrainingPreferences(profile?.trainingPreferences),
    [profile?.trainingPreferences]
  )
  const { activityDays, consistency } = useMemo(
    () => buildConsistencySnapshot(progressDays, trainingPreferences),
    [progressDays, trainingPreferences]
  )
  // Só calcula quando o modal abre, a partir do que a Home já carregou (nenhuma consulta nova).
  const shareOptions = useMemo(
    () =>
      shareOpen
        ? buildShareOptions({
            progressDays,
            preferences: trainingPreferences,
            consistency,
            username: profile?.username,
          })
        : [],
    [shareOpen, progressDays, trainingPreferences, consistency, profile?.username]
  )
  const volume = useMemo(() => getVolumeTrend(progressDays), [progressDays])
  const weekStartKey = useMemo(() => {
    const today = businessDayKey()
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
    return addDaysToDayKey(today, -((weekday + 6) % 7))
  }, [])
  const weeklyFrequency = progressDays.filter(
    (day) => day.dateKey >= weekStartKey && day.dateKey <= businessDayKey()
  ).length
  const lastWorkout = recentWorkouts[0]
  const lastExercise = lastWorkout
    ? exerciseNameById.get(lastWorkout.exerciseId) || 'seu último exercício'
    : null
  const firstName =
    profile?.displayName?.trim().split(/\s+/)[0] ||
    profile?.username ||
    user?.user_metadata?.display_name?.trim().split(/\s+/)[0] ||
    user?.displayName?.trim().split(/\s+/)[0] ||
    'atleta'
  const daysSinceLastActivity = useMemo(() => {
    const last = [...progressDays].reverse().find((day) => day.dateKey < businessDayKey())
    return last
      ? Math.floor((Date.parse(businessDayKey()) - Date.parse(last.dateKey)) / 86400000)
      : null
  }, [progressDays])
  const greeting = useMemo(
    () =>
      getDashboardGreeting({
        firstName,
        todayState: consistency.today.state,
        reminderDue:
          consistency.today.state === 'planned' && isPreferredReminderDue(trainingPreferences),
        daysSinceLastActivity,
        uid: user?.uid,
      }),
    [firstName, consistency.today.state, daysSinceLastActivity, trainingPreferences, user?.uid]
  )

  async function handleSaveTrainingPlan(preferences) {
    await saveTrainingPreferences(preferences)
    await refreshProfile(user.uid)
  }

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

  return (
    <div className="dashboard fitness-dashboard">
      <header className="dashboard-greeting">
        <div>
          <span className="eyebrow">{greeting.eyebrow}</span>
          <Heading as="h1">{greeting.heading}</Heading>
        </div>
      </header>

      <SponsoredAdBanner ads={bannerAds} placement="home_banner" />

      {recentWorkouts.length === 0 ? (
        <section className="empty-workout" aria-labelledby="empty-workout-title">
          {!offlineLocal && (
            <ResponsivePicture
              name={heroImage.name}
              alt={heroImage.alt}
              width={heroImage.width}
              height={heroImage.height}
              sizes="(max-width: 767px) 100vw, 60vw"
            />
          )}
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
              onClick={() => navigate('/novo-treino', { state: originState(location) })}
            >
              Iniciar primeiro treino
            </Button>
          </div>
        </section>
      ) : (
        <section className="workout-hero" aria-labelledby="next-workout-title">
          {!offlineLocal && (
            <ResponsivePicture
              name={heroImage.name}
              alt={heroImage.alt}
              width={heroImage.width}
              height={heroImage.height}
              sizes="(max-width: 767px) 100vw, 60vw"
            />
          )}
          <div className="workout-hero-shade" />
          <div className="workout-hero-content">
            <span className="hero-kicker">
              <PulseIcon size={14} /> SUGESTÃO DE TREINO
            </span>
            <Heading as="h2" id="next-workout-title">
              Supere sua última sessão
            </Heading>
            <p>Continue por {lastExercise}.</p>
            <Button
              as={RouterLink}
              to={`/novo-treino?exercicio=${lastWorkout.exerciseId}`}
              state={originState(location)}
              className="start-workout-button"
              leadingVisual={PlayIcon}
              variant="primary"
            >
              Iniciar treino
            </Button>
          </div>
        </section>
      )}

      <StreakCard
        unavailable={!progressAvailable}
        consistency={consistency}
        hasTrainingPlan={trainingPreferences.plannedTrainingDays.length > 0}
        onConfigurePlan={() => setPlanOpen(true)}
        onOpenCalendar={() => setCalendarOpen(true)}
        onShare={() => setShareOpen(true)}
        onSharePreload={() => loadShareDialog().catch(() => {})}
      />

      <section className="performance-strip" aria-label="Resumo do progresso">
        <div>
          <CalendarIcon size={18} />
          <span>Dias de treino nesta semana</span>
          <strong>{progressAvailable ? `${weeklyFrequency}x` : '—'}</strong>
        </div>
        <div>
          <GraphIcon size={18} />
          <span>Volume de carga · 7 dias</span>
          <strong>
            {progressAvailable ? `${Math.round(volume.current).toLocaleString('pt-BR')} kg` : '—'}
          </strong>
          {progressAvailable && volume.percent != null && (
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

      {calendarOpen && (
        <LazyDialogBoundary onFail={() => setCalendarOpen(false)}>
          <ActivityCalendarDialog
            days={activityDays}
            consistency={consistency}
            exerciseNameById={exerciseNameById}
            onClose={() => setCalendarOpen(false)}
            onShare={() => {
              setCalendarOpen(false)
              setShareOpen(true)
            }}
          />
        </LazyDialogBoundary>
      )}
      {shareOpen && shareOptions.length > 0 && (
        <LazyDialogBoundary onFail={() => setShareOpen(false)}>
          <ShareProgressDialog options={shareOptions} onClose={() => setShareOpen(false)} />
        </LazyDialogBoundary>
      )}
      {planOpen && (
        <LazyDialogBoundary onFail={() => setPlanOpen(false)}>
          <TrainingPlanDialog
            preferences={trainingPreferences}
            onSave={handleSaveTrainingPlan}
            onClose={() => setPlanOpen(false)}
          />
        </LazyDialogBoundary>
      )}
    </div>
  )
}
