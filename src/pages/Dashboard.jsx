import { useMemo, useState } from 'react'
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
import { ActivityCalendarDialog } from '../components/ActivityCalendarDialog'
import { ShareProgressDialog } from '../components/ShareProgressDialog'
import { buildShareOptions } from '../utils/shareProgress'
import { TrainingPlanDialog } from '../components/TrainingPlanDialog'
import { dateFromKey, localDayKey } from '../utils/activityCalendar'
import { buildConsistencySnapshot } from '../utils/consistencySnapshot'
import { ErrorState } from '../components/ErrorState'
import { ProfessionalsDiscovery } from '../components/ProfessionalsDiscovery'
import { saveTrainingPreferences } from '../services/usersService'
import { isPreferredReminderDue, normalizeTrainingPreferences } from '../utils/trainingPlan'

function getVolumeTrend(days) {
  const now = new Date()
  const startCurrent = new Date(now)
  startCurrent.setDate(now.getDate() - 6)
  startCurrent.setHours(0, 0, 0, 0)
  const startPrevious = new Date(startCurrent)
  startPrevious.setDate(startPrevious.getDate() - 7)
  let current = 0
  let previous = 0

  days.forEach((day) => {
    const date = dateFromKey(day.dateKey)
    const volume = Number(day.strengthVolumeKg) || 0
    if (date >= startCurrent) current += volume
    else if (date >= startPrevious) previous += volume
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
  const { recentWorkouts, progressDays, loading, error, refresh } = useHomeDashboard()
  const { exercises } = useExercises()
  const { profile, user, refreshProfile } = useAuth()
  const { bannerAds } = useGlobalSponsoredAds(Boolean(user))
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
    const date = new Date()
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
    return localDayKey(date)
  }, [])
  const weeklyFrequency = progressDays.filter(
    (day) => day.dateKey >= weekStartKey && day.dateKey <= localDayKey(new Date())
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
    const last = [...progressDays].reverse().find((day) => day.dateKey < localDayKey(new Date()))
    return last
      ? Math.floor(
          (new Date().setHours(0, 0, 0, 0) - dateFromKey(last.dateKey).setHours(0, 0, 0, 0)) /
            86400000
        )
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

      <SponsoredAdBanner ads={bannerAds} />

      {recentWorkouts.length === 0 ? (
        <section className="empty-workout" aria-labelledby="empty-workout-title">
          <ResponsivePicture
            name={heroImage.name}
            alt={heroImage.alt}
            width={heroImage.width}
            height={heroImage.height}
            sizes="(max-width: 767px) 100vw, 60vw"
          />
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
          <ResponsivePicture
            name={heroImage.name}
            alt={heroImage.alt}
            width={heroImage.width}
            height={heroImage.height}
            sizes="(max-width: 767px) 100vw, 60vw"
          />
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
        consistency={consistency}
        hasTrainingPlan={trainingPreferences.plannedTrainingDays.length > 0}
        onConfigurePlan={() => setPlanOpen(true)}
        onOpenCalendar={() => setCalendarOpen(true)}
        onShare={() => setShareOpen(true)}
      />

      <section className="performance-strip" aria-label="Resumo do progresso">
        <div>
          <CalendarIcon size={18} />
          <span>Dias de treino nesta semana</span>
          <strong>{weeklyFrequency}x</strong>
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

      <ProfessionalsDiscovery />
      {calendarOpen && (
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
      )}
      {shareOpen && shareOptions.length > 0 && (
        <ShareProgressDialog options={shareOptions} onClose={() => setShareOpen(false)} />
      )}
      {planOpen && (
        <TrainingPlanDialog
          preferences={trainingPreferences}
          onSave={handleSaveTrainingPlan}
          onClose={() => setPlanOpen(false)}
        />
      )}
    </div>
  )
}
