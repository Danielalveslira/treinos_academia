import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useExercises } from '../hooks/useExercises'
import { useExerciseHistory } from '../hooks/useExerciseHistory'
import { getExerciseIndicators, buildLoadHistory } from '../utils/calculations'
import { formatPercent, formatWeight, formatDate } from '../utils/format'
import { IndicatorCard } from '../components/IndicatorCard'
import { LoadChart } from '../components/LoadChart'
import { Spinner } from '../components/Spinner'
import { EmptyState } from '../components/EmptyState'

export default function ExerciseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { exercises, loading: loadingExercises } = useExercises()
  const { workouts, loading: loadingWorkouts, error } = useExerciseHistory(id)

  const exercise = exercises.find((e) => e.id === id)
  const indicators = useMemo(() => getExerciseIndicators(workouts), [workouts])
  const chartData = useMemo(() => buildLoadHistory(workouts), [workouts])

  const loading = loadingExercises || loadingWorkouts

  return (
    <div className="page">
      <Link to="/exercicios" className="back-link">
        ← Exercícios
      </Link>
      <h1>{exercise?.name || 'Exercício'}</h1>
      {exercise?.muscleGroup && <p className="muted">{exercise.muscleGroup}</p>}

      {loading && <Spinner />}
      {error && <p className="form-error">{error}</p>}

      {!loading && !error && workouts.length === 0 && (
        <EmptyState
          message="Nenhum treino registrado para este exercício ainda."
          actionLabel="Registrar treino"
          onAction={() => navigate(`/novo-treino?exercicio=${id}`)}
        />
      )}

      {!loading && workouts.length > 0 && (
        <>
          <div className="indicator-grid">
            <IndicatorCard label="Carga atual" value={formatWeight(indicators.currentLoad)} />
            <IndicatorCard label="Maior carga" value={formatWeight(indicators.maxLoad)} />
            <IndicatorCard label="Carga anterior" value={formatWeight(indicators.previousLoad)} />
            <IndicatorCard label="Evolução" value={formatPercent(indicators.evolutionPercent)} />
            <IndicatorCard label="Sessões" value={indicators.sessionCount} />
            <IndicatorCard label="Último treino" value={formatDate(indicators.lastWorkoutDate)} />
          </div>

          <h2>Evolução da carga</h2>
          <LoadChart data={chartData} />
        </>
      )}
    </div>
  )
}
