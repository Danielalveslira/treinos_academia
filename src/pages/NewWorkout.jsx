import { useNavigate, useSearchParams } from 'react-router-dom'
import { useExercises } from '../hooks/useExercises'
import { useWorkouts } from '../hooks/useWorkouts'
import { useToast } from '../hooks/useToast'
import { WorkoutForm } from '../components/WorkoutForm'
import { Spinner } from '../components/Spinner'
import { EmptyState } from '../components/EmptyState'
import { ToastContainer } from '../components/ToastContainer'

export default function NewWorkout() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const defaultExerciseId = searchParams.get('exercicio') || ''

  const { exercises, loading } = useExercises()
  const { add } = useWorkouts()
  const { toasts, showToast } = useToast()

  async function handleSubmit(values) {
    try {
      await add(values)
      showToast('Treino registrado.')
      navigate('/historico')
    } catch {
      showToast('Erro ao registrar treino.', 'error')
    }
  }

  return (
    <div className="page">
      <ToastContainer toasts={toasts} />
      <h1>Novo treino</h1>

      {loading && <Spinner />}

      {!loading && exercises.filter((e) => e.active).length === 0 && (
        <EmptyState
          message="Cadastre um exercício antes de registrar um treino."
          actionLabel="Cadastrar exercício"
          onAction={() => navigate('/exercicios')}
        />
      )}

      {!loading && exercises.filter((e) => e.active).length > 0 && (
        <WorkoutForm
          exercises={exercises}
          defaultExerciseId={defaultExerciseId}
          onSubmit={handleSubmit}
          onCancel={() => navigate(-1)}
        />
      )}
    </div>
  )
}
