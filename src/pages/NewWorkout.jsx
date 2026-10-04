import { useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Button, Heading, Spinner } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PlayIcon, PulseIcon } from '@primer/octicons-react'
import { useExercises } from '../contexts/ExercisesContext'
import { useWorkouts } from '../hooks/useWorkouts'
import { useToast } from '../hooks/useToast'
import { WorkoutForm } from '../components/WorkoutForm'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { completeWorkoutSession } from '../services/economyService'
import { loadDoneExerciseIds } from '../utils/doneExercisesStorage'
import { returnToOrigin } from '../utils/navigation'

function localDateKey() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`
}

export default function NewWorkout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const defaultExerciseId = searchParams.get('exercicio') || ''

  const { exercises, loading, error, refresh } = useExercises()
  const { workouts, add } = useWorkouts()
  const { toasts, showToast } = useToast()
  // O botão "Finalizar treino" só aparece depois de registrar ao menos um exercício hoje (nesta
  // sessão ou, após recarregar, pela marcação local de exercícios feitos hoje).
  const [hasRegistered, setHasRegistered] = useState(
    () => loadDoneExerciseIds(localDateKey()).size > 0
  )
  const [finishing, setFinishing] = useState(false)
  // O ref bloqueia cliques no mesmo ciclo de eventos (o state só reflete no próximo render).
  const finishingRef = useRef(false)

  // Evento de conclusão: o SERVIDOR decide se houve esforço suficiente hoje e quanto paga (o
  // cliente não envia valor nem data). A recompensa, se houver, chega pelo aviso discreto de
  // EvoCoins (WalletContext); aqui só se leva o usuário ao histórico.
  async function handleFinish() {
    if (finishingRef.current) return
    finishingRef.current = true
    setFinishing(true)
    try {
      await completeWorkoutSession()
      // replace: o formulário concluído não deve ser reaberto pelo botão Voltar.
      navigate('/historico', { replace: true })
    } catch (err) {
      console.error('[NewWorkout] finish:', err)
      showToast('Não foi possível finalizar o treino agora. Tente novamente.', 'danger')
      finishingRef.current = false
      setFinishing(false)
    }
  }

  async function handleSubmit(values) {
    try {
      await add(values)
      setHasRegistered(true)
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
          onCancel={() => returnToOrigin(navigate, location, '/')}
        />
      )}

      {!loading && !error && hasRegistered && (
        <div className="workout-finish">
          <Button variant="primary" onClick={handleFinish} disabled={finishing}>
            {finishing ? 'Finalizando…' : 'Finalizar treino'}
          </Button>
        </div>
      )}
    </Box>
  )
}
