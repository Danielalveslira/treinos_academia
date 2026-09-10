import { useMemo } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Box, Button, Heading, Spinner, IconButton, Text } from '@primer/react'
import {
  ArrowRightIcon,
  CalendarIcon,
  FlameIcon,
  GraphIcon,
  PlayIcon,
  PulseIcon,
  SyncIcon,
  TrophyIcon,
} from '@primer/octicons-react'
import { useDashboard } from '../hooks/useDashboard'
import { useExercises } from '../contexts/ExercisesContext'
import { useAuth } from '../hooks/useAuth'
import { DASHBOARD_HISTORY_DAYS, DASHBOARD_SAFETY_LIMIT } from '../services/workoutsService'
import { calculateVolume, getTrainingConsistency } from '../utils/calculations'
import { getDashboardGreeting } from '../utils/greeting'
import { formatDate, buildExerciseNameMap } from '../utils/format'
import { formatWorkoutSets, getWorkoutLoad } from '../utils/workoutSets'
import { FrequencyChart } from '../components/FrequencyChart'
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
    const date = workout.date?.toDate ? workout.date.toDate() : new Date(workout.date)
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
  const exerciseNameById = useMemo(() => buildExerciseNameMap(exercises), [exercises])
  const consistency = useMemo(() => getTrainingConsistency(allWorkouts), [allWorkouts])
  const volume = useMemo(() => getVolumeTrend(allWorkouts), [allWorkouts])
  const lastWorkout = recentWorkouts[0]
  const lastExercise = lastWorkout
    ? exerciseNameById.get(lastWorkout.exerciseId) || 'seu último exercício'
    : null
  const bestLoad = allWorkouts.length
    ? Math.max(...allWorkouts.map((workout) => getWorkoutLoad(workout)))
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
        <img src="/capa.png" alt="Atleta fazendo barra fixa em uma academia" />
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
        <IconButton
          className="refresh-button"
          icon={SyncIcon}
          onClick={refresh}
          disabled={loading}
          aria-label="Atualizar dados"
          variant="invisible"
        />
      </header>

      <section className="workout-hero" aria-labelledby="next-workout-title">
        <img src="/capa.png" alt="Atleta fazendo barra fixa em uma academia" />
        <div className="workout-hero-shade" />
        <div className="workout-hero-content">
          <span className="hero-kicker">
            <PulseIcon size={14} /> PRÓXIMO TREINO
          </span>
          <Heading as="h2" id="next-workout-title">
            Supere sua última sessão
          </Heading>
          <p>
            Continue por {lastExercise}. Seu histórico já está pronto para servir de referência.
          </p>
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

      <section className="performance-strip" aria-label="Resumo do progresso">
        <div>
          <FlameIcon size={18} />
          <span>Sequência</span>
          <strong>{consistency.streak} sem</strong>
        </div>
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
      <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', mt: 2, mb: 3 }}>
        "Melhor carga" e "dias ativos" consideram os últimos {DASHBOARD_HISTORY_DAYS} dias (até{' '}
        {DASHBOARD_SAFETY_LIMIT} registros) — um recorde mais antigo pode não aparecer.
      </Text>

      <div className="dashboard-flow">
        <section className="progress-section" aria-labelledby="frequency-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">RITMO DE TREINO</span>
              <Heading as="h2" id="frequency-title">
                Consistência
              </Heading>
            </div>
            <span className="section-summary">
              <strong>{consistency.total}</strong> dias ativos
            </span>
          </div>
          <FrequencyChart data={consistency.chartData} />
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
                  <span>{formatWorkoutSets(workout)}</span>
                </div>
                <time>
                  {formatDate(
                    workout.date?.toDate ? workout.date.toDate() : new Date(workout.date)
                  )}
                </time>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
