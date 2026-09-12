import { useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Heading, Spinner } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PlayIcon, PulseIcon } from '@primer/octicons-react'
import { useExercises } from '../contexts/ExercisesContext'
import { useWorkouts } from '../hooks/useWorkouts'
import { useToast } from '../hooks/useToast'
import { WorkoutForm } from '../components/WorkoutForm'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'

export default function NewWorkout() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const defaultExerciseId = searchParams.get('exercicio') || ''

  const { exercises, loading, error, refresh } = useExercises()
  const { workouts, add } = useWorkouts()
  const { toasts, showToast } = useToast()

  async function handleSubmit(values) {
    try {
      await add(values)
      showToast('Treino registrado.')
    } catch (err) {
      console.error('[NewWorkout] create:', err)
      showToast('Erro ao registrar treino.', 'danger')
      // Relançado de propósito: WorkoutForm precisa distinguir sucesso de falha pra não
      // marcar o exercício como concluído nem avançar de aba num salvamento que falhou
      // (ver handleSubmit em WorkoutForm.jsx). A navegação pra fora do fluxo de treino
      // (ex.: /historico) não acontece mais aqui -- ver nextStepAfterFinishing, que
      // mantém o usuário dentro do fluxo por abas (grupo -> exercício -> séries).
      throw err
    }
  }

  const activeExercises = exercises.filter((e) => e.active)

  return (
    <Box className="workout-session-page">
      <ToastFlash toasts={toasts} />
      <header className="session-heading">
        <span className="session-icon">
          <PulseIcon size={20} />
        </span>
        <div>
          <span className="eyebrow">SESSÃO DE TREINO</span>
          <Heading as="h1">Vamos treinar</Heading>
        </div>
      </header>

      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && activeExercises.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <PlayIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhum exercício ativo</Blankslate.Heading>
          <Blankslate.Description>
            Cadastre um exercício antes de registrar um treino.
          </Blankslate.Description>
          <Blankslate.PrimaryAction onClick={() => navigate('/exercicios')}>
            Cadastrar exercício
          </Blankslate.PrimaryAction>
        </Blankslate>
      )}

      {!loading && !error && activeExercises.length > 0 && (
        <WorkoutForm
          exercises={exercises}
          history={workouts}
          defaultExerciseId={defaultExerciseId}
          onSubmit={handleSubmit}
          onCancel={() => navigate(-1)}
        />
      )}
    </Box>
  )
}
