import { useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Button, Heading, Spinner, Flash } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PlayIcon, PulseIcon } from '@primer/octicons-react'
import { useWorkouts } from '../hooks/useWorkouts'
import { useToast } from '../hooks/useToast'
import { WorkoutForm } from '../components/WorkoutForm'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { completeWorkoutSheet, getMyEvocoinDay } from '../services/economyService'
import { flushPending } from '../services/offline/syncScheduler'
import { classifyReadError } from '../services/offline/readError'
import { useAuth } from '../hooks/useAuth'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { FINISH_MESSAGES, FINISH_OFFLINE_MESSAGE, runFinishWorkout } from '../utils/finishWorkout'
import { loadDoneExerciseIds } from '../utils/doneExercisesStorage'
import { canStartExercise } from '../utils/personalExercises.js'
import { originState, returnToOrigin } from '../utils/navigation'
import { plannedWorkoutNotice } from '../utils/plannedWorkout'
import { useWorkoutSheets } from '../features/workoutSheets/useWorkoutSheets.js'
import { sheetError } from '../features/workoutSheets/workoutSheetsService.js'
import { sheetScopeExercises } from '../features/workoutSheets/workoutSheetValidation.js'
import '../features/workoutSheets/workoutSheets.css'
import { invalidateWorkoutCache } from '../utils/pageCache'
import { businessDayKey, isBusinessDayKey } from '../utils/businessDate'
import { sheetPickerUrl, validSheetId } from '../utils/workoutEntry.js'

// "Hoje" é o dia de NEGÓCIO (America/Sao_Paulo), não o do aparelho (ver utils/businessDate.js).
const localDateKey = () => businessDayKey()

// O servidor determina o dia que deve estar sincronizado; falhas bloqueiam a finalização.
async function serverBusinessDay() {
  const result = await getMyEvocoinDay()
  if (!isBusinessDayKey(result?.day)) throw new Error('INVALID_SERVER_DAY')
  return result.day
}

export default function NewWorkout() {
  const [params] = useSearchParams()
  const { user } = useAuth()
  const sheetId = params.get('ficha')
  const location = useLocation()
  return validSheetId(sheetId) ? (
    <SheetWorkout key={`${user.uid}:${sheetId}`} id={sheetId} />
  ) : (
    <Navigate to={sheetPickerUrl(params)} replace state={location.state} />
  )
}

function SheetWorkout({ id }) {
  const { data, loading, error, refresh, online } = useWorkoutSheets(id, true)
  const retained = useRef(null)
  if (online && error) retained.current = null
  if (data) retained.current = data
  if ((loading || !online) && retained.current)
    return <WorkoutSession sheetScope={retained.current} />
  if (loading) return <Spinner aria-label="Validando ficha" />
  if (error || (!online && !data)) {
    // SHEET_NOT_READY: a ficha está arquivada, vazia ou com exercício indisponível — o
    // servidor já recusou o início (nenhum bypass client-side). Dá o caminho direto para
    // corrigir, em vez de só deixar "Tentar novamente".
    const canEdit = String(error?.message || '').includes('SHEET_NOT_READY')
    return (
      <Flash variant="danger" role="alert">
        {sheetError(error || new Error('SHEET_NETWORK_REQUIRED'))}{' '}
        <Button onClick={refresh}>Tentar novamente</Button>{' '}
        {canEdit && (
          <Button as={Link} to={`/fichas/${id}/editar`}>
            Editar ficha
          </Button>
        )}
      </Flash>
    )
  }
  return data ? <WorkoutSession sheetScope={data} /> : null
}

function WorkoutSession({ sheetScope }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const defaultExerciseId = searchParams.get('exercicio') || ''
  const plannedNotice = plannedWorkoutNotice(searchParams.get('planejado'), localDateKey())

  const exercises = sheetScope.items.map((item) => ({
    ...item.exercise,
    catalogAvailable: item.available,
  }))
  const loading = false
  const error = null
  const refresh = undefined
  const { workouts, add, save } = useWorkouts()
  const { toasts, showToast } = useToast()
  const { user, offlineLocal } = useAuth()
  const connected = useOnlineStatus()
  const online = connected && !offlineLocal
  // O botão "Finalizar treino" só aparece depois de registrar ao menos um exercício hoje (nesta
  // sessão ou, após recarregar, pela marcação local de exercícios feitos hoje).
  const [hasRegistered, setHasRegistered] = useState(
    () => loadDoneExerciseIds(localDateKey(), `${user.uid}:${sheetScope.id}`).size > 0
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
    // Regras (online-only, esvaziar a fila antes, nunca recompensa local) em utils/finishWorkout.js.
    const { outcome, error } = await runFinishWorkout({
      isOnline: () => online && navigator.onLine !== false,
      getDay: serverBusinessDay,
      flushPending: (day) => flushPending(user.uid, { date: day }),
      completeSession: () => completeWorkoutSheet(sheetScope.id),
      classifyError: classifyReadError,
    })
    if (outcome === 'done') {
      invalidateWorkoutCache(user.uid)
      // replace: o formulário concluído não deve ser reaberto pelo botão Voltar.
      navigate('/historico', { replace: true })
      return
    }
    if (error) console.error('[NewWorkout] finish:', error)
    showToast(FINISH_MESSAGES[outcome], 'danger')
    finishingRef.current = false
    setFinishing(false)
  }

  // Cada série concluída chega aqui (WorkoutForm -> utils/rowSaver.js): a primeira cria o registro do
  // exercício, as seguintes o atualizam. Sem toast por série — a própria série mostra se foi salva, está
  // pendente neste aparelho ou falhou; erros sobem para o saver, que oferece "Tentar novamente".
  async function handleCreate(values, options) {
    try {
      if (
        values.sheetId !== sheetScope.id ||
        !sheetScope.items.some((item) => item.available && item.exercise_id === values.exerciseId)
      )
        throw new Error('SHEET_INVALID_PAYLOAD')
      const result = await add(values, options)
      setHasRegistered(true)
      if (sheetScope && result?.synced === false)
        showToast(
          'Registro salvo neste aparelho. Aguarde a sincronização antes de finalizar esta ficha.',
          'default'
        )
      return result
    } catch (err) {
      console.error('[NewWorkout] create:', err)
      throw err
    }
  }

  async function handleUpdate(id, values) {
    try {
      return await save(id, values)
    } catch (err) {
      console.error('[NewWorkout] update:', err)
      throw err
    }
  }

  const activeExercises = sheetScopeExercises(exercises, sheetScope).filter(canStartExercise)
  // Ao abrir uma ficha, o fluxo vai direto para o primeiro exercício elegível na sequência
  // planejada (sem a tela de escolha solta) — ver WorkoutForm.jsx (step inicial = 'register'
  // quando o exercício inicial já está nas opções disponíveis).
  const sheetDefaultExerciseId =
    activeExercises.find((exercise) => exercise.id === defaultExerciseId)?.id ||
    activeExercises[0]?.id ||
    ''

  return (
    <Box className="workout-session-page">
      <ToastFlash toasts={toasts} />
      <header className="session-heading">
        <span className="session-icon">
          <PulseIcon size={20} />
        </span>
        <div>
          <span className="eyebrow">SESSÃO DE TREINO</span>
          <Heading as="h1">{sheetScope.name}</Heading>
          {plannedNotice && <p>{plannedNotice}</p>}
        </div>
      </header>

      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />
      {sheetScope && !online && (
        <Flash variant="warning" sx={{ mb: 3 }}>
          Dados salvos neste aparelho — validação pendente. A disponibilidade dos exercícios será
          confirmada ao sincronizar os registros.
        </Flash>
      )}

      {!loading && !error && activeExercises.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <PlayIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhum exercício ativo</Blankslate.Heading>
          <Blankslate.Description>
            Escolha exercícios ativos no Catálogo Evolutus. Exercícios antigos continuam disponíveis
            no histórico; escolha um oficial para os próximos treinos.
          </Blankslate.Description>
          <Blankslate.PrimaryAction
            onClick={() =>
              navigate('/exercicios', { state: { ...originState(location), openCatalog: true } })
            }
          >
            Escolher no Catálogo Evolutus
          </Blankslate.PrimaryAction>
        </Blankslate>
      )}

      {!loading && !error && activeExercises.length > 0 && (
        <WorkoutForm
          exercises={exercises}
          sheetScope={sheetScope}
          progressScope={`${user.uid}:${sheetScope.id}`}
          history={workouts}
          defaultExerciseId={sheetDefaultExerciseId}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onCancel={() => returnToOrigin(navigate, location, '/app')}
        />
      )}

      {!loading && !error && hasRegistered && (
        <div className="workout-finish">
          <Button variant="primary" onClick={handleFinish} disabled={finishing || !online}>
            {finishing ? 'Finalizando…' : 'Finalizar treino'}
          </Button>
          {!online && <p className="workout-finish-hint">{FINISH_OFFLINE_MESSAGE}</p>}
        </div>
      )}
    </Box>
  )
}
