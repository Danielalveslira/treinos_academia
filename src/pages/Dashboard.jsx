import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDashboard } from '../hooks/useDashboard'
import { useExercises } from '../hooks/useExercises'
import {
  calculateVolume,
  getExerciseIndicators,
  getWeeklyFrequency,
  groupVolumeByDate,
} from '../utils/calculations'
import { formatPercent, formatWeight, formatDate } from '../utils/format'
import { IndicatorCard } from '../components/IndicatorCard'
import { VolumeChart } from '../components/VolumeChart'
import { Spinner } from '../components/Spinner'
import { EmptyState } from '../components/EmptyState'

export default function Dashboard() {
  const navigate = useNavigate()
  const { recentWorkouts, totalWorkouts, loading, error } = useDashboard()
  const { exercises } = useExercises()

  const exerciseNameById = useMemo(() => {
    const map = new Map()
    exercises.forEach((ex) => map.set(ex.id, ex.name))
    return map
  }, [exercises])

  const lastWorkout = recentWorkouts[0]

  const lastExerciseIndicators = useMemo(() => {
    if (!lastWorkout) return null
    const sameExercise = recentWorkouts.filter((w) => w.exerciseId === lastWorkout.exerciseId)
    return getExerciseIndicators(sameExercise)
  }, [recentWorkouts, lastWorkout])

  const accumulatedVolume = useMemo(
    () => recentWorkouts.reduce((sum, w) => sum + calculateVolume(w.weight, w.sets, w.reps), 0),
    [recentWorkouts]
  )

  const weeklyFrequency = useMemo(() => getWeeklyFrequency(recentWorkouts), [recentWorkouts])
  const volumeChartData = useMemo(() => groupVolumeByDate(recentWorkouts), [recentWorkouts])

  if (loading) return <Spinner />
  if (error) return <p className="form-error">{error}</p>

  if (recentWorkouts.length === 0) {
    return (
      <div className="page">
        <h1>Dashboard</h1>
        <EmptyState
          message="Nenhum treino registrado ainda. Comece registrando seu primeiro treino."
          actionLabel="Registrar treino"
          onAction={() => navigate('/novo-treino')}
        />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>Dashboard</h1>
        <Link to="/novo-treino" className="button button--primary">
          Novo treino
        </Link>
      </div>

      <section className="last-workout-card">
        <h2>Treino mais recente</h2>
        <p>
          <strong>{exerciseNameById.get(lastWorkout.exerciseId) || 'Exercício'}</strong> ·{' '}
          {formatWeight(lastWorkout.weight)} · {lastWorkout.sets}x{lastWorkout.reps}
        </p>
        <p className="muted">
          {formatDate(lastWorkout.date?.toDate ? lastWorkout.date.toDate() : new Date(lastWorkout.date))}
        </p>
        {lastExerciseIndicators?.evolutionPercent != null && (
          <p className="evolution-highlight">
            Evolução nesse exercício: {formatPercent(lastExerciseIndicators.evolutionPercent)}
          </p>
        )}
      </section>

      <div className="indicator-grid">
        <IndicatorCard label="Total de treinos" value={totalWorkouts} />
        <IndicatorCard label="Frequência semanal" value={`${weeklyFrequency}x`} />
        <IndicatorCard label="Volume acumulado (recente)" value={accumulatedVolume} />
      </div>

      <h2>Volume por treino</h2>
      <VolumeChart data={volumeChartData} />

      <h2>Últimos registros</h2>
      <ul className="workout-list">
        {recentWorkouts.slice(0, 5).map((workout) => (
          <li key={workout.id} className="workout-list__item">
            <div>
              <strong>{exerciseNameById.get(workout.exerciseId) || 'Exercício'}</strong>
              <div className="workout-list__meta">
                {formatWeight(workout.weight)} · {workout.sets}x{workout.reps}
              </div>
            </div>
            <span className="muted">
              {formatDate(workout.date?.toDate ? workout.date.toDate() : new Date(workout.date))}
            </span>
          </li>
        ))}
      </ul>
      <Link to="/historico" className="link-button">
        Ver histórico completo
      </Link>
    </div>
  )
}
