import { useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Heading, Spinner } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PlusCircleIcon } from '@primer/octicons-react'
import { useExercises } from '../hooks/useExercises'
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
  const { add } = useWorkouts()
  const { toasts, showToast } = useToast()

  async function handleSubmit(values) {
    try {
      await add(values)
      showToast('Treino registrado.')
      navigate('/historico')
    } catch (err) {
      console.error('[NewWorkout] create:', err)
      showToast('Erro ao registrar treino.', 'danger')
    }
  }

  const activeExercises = exercises.filter((e) => e.active)

  return (
    <Box>
      <ToastFlash toasts={toasts} />
      <Heading as="h1" sx={{ fontSize: 4, mb: 3 }}>
        Novo treino
      </Heading>

      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && activeExercises.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <PlusCircleIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhum exercício ativo</Blankslate.Heading>
          <Blankslate.Description>Cadastre um exercício antes de registrar um treino.</Blankslate.Description>
          <Blankslate.PrimaryAction onClick={() => navigate('/exercicios')}>
            Cadastrar exercício
          </Blankslate.PrimaryAction>
        </Blankslate>
      )}

      {!loading && !error && activeExercises.length > 0 && (
        <WorkoutForm
          exercises={exercises}
          defaultExerciseId={defaultExerciseId}
          onSubmit={handleSubmit}
          onCancel={() => navigate(-1)}
        />
      )}
    </Box>
  )
}
