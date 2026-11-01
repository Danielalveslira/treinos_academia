import {
  prescription,
  sheetScopeExercises,
} from '../features/workoutSheets/workoutSheetValidation.js'
import { canStartExercise } from '../utils/personalExercises.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, FormControl, TextInput, Textarea, Text } from '@primer/react'
import {
  CheckCircleFillIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ListUnorderedIcon,
  SearchIcon,
} from '@primer/octicons-react'
import { validateWorkout, hasErrors } from '../utils/validators'
import { getWorkoutSets, isValidSet } from '../utils/workoutSets'
import { toDate } from '../utils/date'
import { formatDate } from '../utils/format'
import { ExerciseComplete, SaveStatus, SetCard } from './SetCard'
import { calculateVolume } from '../utils/calculations'
import { useFocusWithinBodyClass } from '../hooks/useFocusWithinBodyClass'
import { getExerciseType, isCardioExercise } from '../utils/exerciseType'
import { formatCardioSession, isValidCardioSession } from '../utils/cardioSessions'
import { saveDoneExerciseIds, cleanupStaleDoneExerciseKeys } from '../utils/doneExercisesStorage'
import { businessDayKey } from '../utils/businessDate'
import { nextActiveSetIndexAfterRemoval } from '../utils/setCardFlow'
import { recentExerciseSessions } from '../utils/exerciseHistory'
import {
  addSet,
  aggregateSyncStatus,
  allSetsDone,
  buildEditSets,
  buildSessionSets,
  canRemoveSet,
  commitSetEdit,
  concludeSet,
  doneSetsPayload,
  dropPendingSets,
  nextPendingIndex,
  removeSet,
  restoreSessionSets,
  rowSyncStatus,
  setSyncStatus,
  updateSetField,
} from '../utils/setSession'
import { createRowSaver } from '../utils/rowSaver'
import { WorkoutExerciseVisual } from './WorkoutExerciseGuide'
import '../styles/workoutExecution.css'

// Enquanto o teclado virtual está provavelmente aberto (um campo do formulário tem
// foco), CSS esconde a barra de navegação inferior e o botão flutuante de instalar o
// app (ver navigation.css/app.css) — nenhum dos dois serve pra nada durante a
// digitação, e liberar esse espaço é o que evita o footer de ações brigando com o
// teclado por altura de tela.
const KEYBOARD_ACTIVE_CLASS = 'keyboard-active'

// Dois toques seguidos no mesmo botão (duplo clique, toque nervoso) nunca devem concluir duas séries:
// depois de o card avançar, o mesmo botão passa a pertencer à série seguinte.
const CONCLUDE_COOLDOWN_MS = 400

// "Hoje" é o dia de NEGÓCIO (America/Sao_Paulo), não o do aparelho (ver utils/businessDate.js).
function todayString() {
  return businessDayKey()
}

const formatWeight = (weight) => Number(weight).toLocaleString('pt-BR')

// Resumo curto do que foi registrado: "3 séries · 20 kg × 10" ou, se variam, "20×10 · 22,5×8 · …".
function summarizeSets(sets) {
  const done = doneSetsPayload(sets)
  const label = `${done.length} ${done.length === 1 ? 'série' : 'séries'}`
  const same = done.every((set) => set.weight === done[0].weight && set.reps === done[0].reps)
  return same
    ? `${label} · ${formatWeight(done[0].weight)} kg × ${done[0].reps}`
    : `${label} · ${done.map((set) => `${formatWeight(set.weight)}×${set.reps}`).join(' · ')}`
}

const cardioValues = (workout) => ({
  durationMinutes: workout?.durationMinutes != null ? String(workout.durationMinutes) : '',
  distanceKm: workout?.distanceKm != null ? String(workout.distanceKm) : '',
})

export function WorkoutForm({
  exercises,
  sheetScope,
  progressScope,
  history = [],
  sessionRows = [],
  finishGuard,
  finishing = false,
  onUnsafeChange,
  backToSheets,
  initialValue,
  defaultExerciseId,
  onSubmit,
  onCreate,
  onUpdate,
  onCancel,
}) {
  // Dois modos: SESSÃO DE FICHA (novo treino — cada série concluída já é gravada, ver utils/rowSaver.js) e
  // EDIÇÃO (initialValue vindo de History.jsx — todas as séries já existem e "Salvar alterações" grava
  // tudo de uma vez, como antes).
  const editing = Boolean(initialValue)
  const nextSetId = useRef(0)
  const nextKey = () => nextSetId.current++
  // Editando, o tipo do treino já existente trava qual exercício dá pra escolher —
  // trocar pra um exercício de outro tipo faria o trigger de imutabilidade de type
  // (migration workouts_cardio_type) recusar o update. Mais simples barrar isso aqui, na
  // lista de opções, do que deixar o usuário chegar até "Salvar" pra só então descobrir
  // que não pode.
  const editingType = initialValue ? getExerciseType(initialValue) : null
  const availableExercises = useMemo(() => {
    const active = sheetScopeExercises(exercises, editingType ? null : sheetScope).filter(
      (exercise) => canStartExercise(exercise) || exercise.id === initialValue?.exerciseId
    )
    const scoped = editingType
      ? active.filter(
          (exercise) =>
            exercise.id === initialValue.exerciseId || getExerciseType(exercise) === editingType
        )
      : active
    if (
      initialValue?.exerciseId &&
      !scoped.some((exercise) => exercise.id === initialValue.exerciseId)
    ) {
      return [
        ...scoped,
        {
          id: initialValue.exerciseId,
          name: 'Exercício removido',
          muscleGroup: 'Outros',
          type: editingType || 'strength',
          active: false,
        },
      ]
    }
    return scoped
  }, [exercises, initialValue?.exerciseId, editingType, sheetScope])
  const initialExerciseId = initialValue?.exerciseId || defaultExerciseId || ''
  const initialExercise = availableExercises.find((exercise) => exercise.id === initialExerciseId)
  const sessionRowFor = (exerciseId) => sessionRows.find((row) => row.exerciseId === exerciseId)
  const targetSetsFor = useCallback(
    (exerciseId) => sheetScope?.items.find((item) => item.exercise_id === exerciseId)?.target_sets,
    [sheetScope]
  )

  // Valores de um exercício que ainda não foi tocado: sugestão do último treino quando existe
  // (marcada como 'history', nunca como concluída) e campos vazios quando não existe.
  function freshValues(exercise, { date = todayString(), note = '' } = {}) {
    const last = history.find((workout) => workout.exerciseId === exercise?.id)
    const resumed = sessionRowFor(exercise?.id)
    const base = {
      exerciseId: exercise?.id || '',
      setDetails: [],
      durationMinutes: '',
      distanceKm: '',
      cardioDone: false,
      cardioCommitted: null,
      cardioSource: 'empty',
      date,
      note: resumed?.note ?? note,
    }
    if (isCardioExercise(exercise)) {
      return resumed
        ? {
            ...base,
            ...cardioValues(resumed),
            cardioCommitted: cardioValues(resumed),
            cardioDone: true,
            cardioSource: 'manual',
          }
        : last
          ? { ...base, ...cardioValues(last), cardioSource: 'history' }
          : base
    }
    return {
      ...base,
      setDetails: resumed
        ? restoreSessionSets(resumed, last, nextKey, targetSetsFor(exercise?.id))
        : buildSessionSets(last, nextKey, targetSetsFor(exercise?.id)),
    }
  }

  const [values, setValues] = useState(() => {
    if (initialValue) {
      const cardioEdit = editingType === 'cardio'
      const committed = cardioValues(initialValue)
      return {
        ...initialValue,
        exerciseId: initialExercise?.id || initialValue.exerciseId,
        setDetails: cardioEdit ? [] : buildEditSets(getWorkoutSets(initialValue), nextKey),
        durationMinutes: committed.durationMinutes,
        distanceKm: committed.distanceKm,
        cardioDone: cardioEdit,
        cardioCommitted: cardioEdit ? committed : null,
        cardioSource: 'manual',
      }
    }
    return freshValues(initialExercise)
  })
  // Handlers leem daqui (não do state do render): dois toques no mesmo frame enxergariam o mesmo state
  // antigo e concluiriam a mesma série duas vezes.
  const valuesRef = useRef(values)
  function update(change) {
    const next = change(valuesRef.current)
    valuesRef.current = next
    setValues(next)
    return next
  }
  const [step, setStep] = useState(() => (initialExercise ? 'register' : 'exercise'))
  const [search, setSearch] = useState('')
  const drafts = useRef(new Map())
  // A retomada deriva a conclusão das linhas confirmadas no banco ou protegidas pela fila
  // offline. A marca local acompanha a navegação durante esta montagem, mas não substitui
  // o registro persistido após recarregar. Edição avulsa de histórico não usa esse estado.
  const [doneExerciseIds, setDoneExerciseIds] = useState(() => {
    if (initialValue) return new Set()
    const today = todayString()
    cleanupStaleDoneExerciseKeys(today)
    return new Set(
      sessionRows
        .filter(
          (row) =>
            row.exerciseCompleted === true ||
            isCardioExercise(row) ||
            getWorkoutSets(row).length >= (Number(targetSetsFor(row.exerciseId)) || 3)
        )
        .map((row) => row.exerciseId)
    )
  })
  const doneIdsRef = useRef(doneExerciseIds)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  // Qual série o SetCard mostra agora (espelhado num ref pelo mesmo motivo de valuesRef).
  const [activeSetIndex, setActiveSetIndexState] = useState(() =>
    Math.max(0, nextPendingIndex(values.setDetails, -1))
  )
  const activeRef = useRef(activeSetIndex)
  function setActive(index) {
    activeRef.current = index
    setActiveSetIndexState(index)
  }
  const lastConcludeAt = useRef(0)

  // Gravação: um saver por exercício (linha do dia) e o estado dele para a interface.
  const savers = useRef(new Map())
  const savedMeta = useRef(new Map())
  const [saveStates, setSaveStates] = useState({})
  const writers = useRef({ onCreate, onUpdate })
  writers.current = { onCreate, onUpdate }
  function saverFor(exerciseId) {
    let saver = savers.current.get(exerciseId)
    if (!saver) {
      const resumed = sessionRowFor(exerciseId)
      const currentSets =
        valuesRef.current.exerciseId === exerciseId
          ? valuesRef.current.setDetails
          : drafts.current.get(exerciseId)?.setDetails || []
      saver = createRowSaver({
        createRow: (payload, options) => writers.current.onCreate(payload, options),
        updateRow: (id, payload) => writers.current.onUpdate(id, payload),
        onChange: (state) => setSaveStates((previous) => ({ ...previous, [exerciseId]: state })),
        initialRow: resumed && {
          id: resumed.id,
          pendingSync: resumed.pendingSync,
          persisted: Object.fromEntries(
            currentSets
              .filter((set) => set.done)
              .map((set) => [
                set.key,
                `${Number(set.committed.weight)}|${Number(set.committed.reps)}`,
              ])
          ),
        },
      })
      savers.current.set(exerciseId, saver)
    }
    return saver
  }

  const selectedExercise = useMemo(
    () => availableExercises.find((exercise) => exercise.id === values.exerciseId),
    [availableExercises, values.exerciseId]
  )
  const cardio = isCardioExercise(selectedExercise)
  // Posição do exercício atual na ordem planejada da ficha, para o indicador textual "Exercício
  // X de N" (1-based; sem selectedExercise ainda, mostra a primeira posição).
  const sheetPosition = sheetScope
    ? Math.max(
        0,
        availableExercises.findIndex((exercise) => exercise.id === values.exerciseId)
      ) + 1
    : 0
  const sheetGoal = sheetScope
    ? prescription(sheetScope.items.find((item) => item.exercise_id === values.exerciseId))
    : ''
  // A sequência da ficha é preservada; a busca só filtra a lista exibida.
  const orderedExercises = availableExercises
  const selectedGroup = selectedExercise?.muscleGroup || 'Outros'
  const filteredExercises = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return orderedExercises.filter(
      (exercise) => !term || exercise.name.toLocaleLowerCase('pt-BR').includes(term)
    )
  }, [orderedExercises, search])
  const exerciseHistory = useMemo(
    () => history.filter((workout) => workout.exerciseId === values.exerciseId),
    [history, values.exerciseId]
  )
  const lastWorkout = exerciseHistory[0]
  const recentHistory = useMemo(() => recentExerciseSessions(exerciseHistory), [exerciseHistory])

  // O histórico pode chegar depois do formulário: enquanto nada foi tocado, a sugestão entra sozinha.
  useEffect(() => {
    if (!lastWorkout || initialValue) return
    const current = valuesRef.current
    if (cardio) {
      if (current.cardioDone || current.durationMinutes || current.distanceKm) return
      update((previous) => ({ ...previous, ...cardioValues(lastWorkout), cardioSource: 'history' }))
      return
    }
    if (!current.setDetails.every((set) => set.source === 'empty' && !set.done)) return
    update((previous) => ({
      ...previous,
      setDetails: buildSessionSets(lastWorkout, nextKey, targetSetsFor(previous.exerciseId)),
    }))
  }, [lastWorkout, initialValue, cardio, targetSetsFor])

  const sets = values.setDetails
  const resumedRow = sessionRowFor(values.exerciseId)
  const rowState = useMemo(
    () =>
      saveStates[values.exerciseId] ||
      (resumedRow && {
        status: 'saved',
        pendingSync: resumedRow.pendingSync,
        persisted: Object.fromEntries(
          sets
            .filter((set) => set.done)
            .map((set) => [
              set.key,
              `${Number(set.committed.weight)}|${Number(set.committed.reps)}`,
            ])
        ),
      }),
    [saveStates, values.exerciseId, resumedRow, sets]
  )
  const syncStatuses = useMemo(
    () => (editing || cardio ? [] : sets.map((set) => setSyncStatus(set, rowState))),
    [editing, cardio, sets, rowState]
  )
  const cardioDirty =
    values.cardioDone &&
    (values.durationMinutes !== values.cardioCommitted?.durationMinutes ||
      values.distanceKm !== values.cardioCommitted?.distanceKm)
  const exerciseFinished = cardio ? values.cardioDone : allSetsDone(sets)
  const showComplete = !editing && exerciseFinished && !reviewing && !cardioDirty
  const completeStatus = cardio ? rowSyncStatus(rowState) : aggregateSyncStatus(syncStatuses)
  const rowStatus = rowState?.status || 'idle'

  // Reenvia o que ficou sem gravar assim que a conexão volta. Enquanto algo está gravando ou falhou,
  // fechar a aba pede confirmação: é o único jeito de uma série concluída se perder.
  useEffect(() => {
    function retryFailed() {
      savers.current.forEach((saver) => saver.retry())
    }
    window.addEventListener('online', retryFailed)
    return () => window.removeEventListener('online', retryFailed)
  }, [])
  const hasUnsaved = Object.values(saveStates).some(
    (state) => state.status === 'saving' || state.status === 'error'
  )
  useEffect(() => onUnsafeChange?.(hasUnsaved), [hasUnsaved, onUnsafeChange])
  if (finishGuard)
    finishGuard.current = async () => {
      const states = await Promise.all(
        [...savers.current.values()].map((saver) => saver.whenIdle())
      )
      return states.every((state) => state.status !== 'saving' && state.status !== 'error')
    }
  useEffect(() => {
    if (!hasUnsaved) return undefined
    function warn(event) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsaved])

  // Ao trocar de exercício (ou de etapa) a tela volta ao topo do formulário, em vez de manter a rolagem
  // do exercício anterior.
  const formRef = useFocusWithinBodyClass(KEYBOARD_ACTIVE_CLASS)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    formRef.current?.scrollIntoView?.({ block: 'start' })
  }, [step, values.exerciseId, formRef])

  function sessionPayload(current) {
    if (!sheetScope?.id) throw new Error('SHEET_REQUIRED')
    const base = {
      exerciseId: current.exerciseId,
      type: getExerciseType(selectedExercise),
      date: current.date,
      note: current.note,
      // Ficha validada em que este registro nasce -- ver workoutsService.createWorkout.
      // Só importa na criação: updateWorkout nunca recebe/altera sheetId (imutável após criado).
      sheetId: sheetScope?.id || null,
    }
    if (cardio) {
      const committed = current.cardioCommitted || cardioValues()
      return { ...base, ...committed, exerciseCompleted: current.cardioDone }
    }
    return {
      ...base,
      setDetails: doneSetsPayload(current.setDetails),
      exerciseCompleted: allSetsDone(current.setDetails),
    }
  }

  // Grava o estado confirmado do exercício (séries concluídas + data/observação). Sempre o estado
  // completo: o saver descarta pedidos intermediários e nunca grava duas vezes ao mesmo tempo.
  function persist(current) {
    const payload = sessionPayload(current)
    const validationErrors = validateWorkout(payload)
    if (validationErrors.date || validationErrors.note) {
      setErrors(validationErrors)
      setDetailsOpen(true)
    }
    savedMeta.current.set(current.exerciseId, `${current.date}|${current.note}`)
    return saverFor(current.exerciseId).save(payload)
  }

  function markExerciseDone(exerciseId) {
    if (editing || doneIdsRef.current.has(exerciseId)) return
    const next = new Set(doneIdsRef.current).add(exerciseId)
    doneIdsRef.current = next
    setDoneExerciseIds(next)
    saveDoneExerciseIds(todayString(), next, progressScope)
  }

  function unmarkExerciseDone(exerciseId) {
    if (!doneIdsRef.current.has(exerciseId)) return
    const next = new Set(doneIdsRef.current)
    next.delete(exerciseId)
    doneIdsRef.current = next
    setDoneExerciseIds(next)
    saveDoneExerciseIds(todayString(), next, progressScope)
  }

  function markWhenProtected(exerciseId, saving) {
    saving.then(() => {
      const current =
        valuesRef.current.exerciseId === exerciseId
          ? valuesRef.current
          : drafts.current.get(exerciseId)
      const completed =
        current &&
        (isCardioExercise(availableExercises.find((exercise) => exercise.id === exerciseId))
          ? current.cardioDone
          : allSetsDone(current.setDetails))
      if (completed && saverFor(exerciseId).getState().status === 'saved')
        markExerciseDone(exerciseId)
    })
  }

  function rememberDraft() {
    if (!valuesRef.current.exerciseId) return
    drafts.current.set(valuesRef.current.exerciseId, valuesRef.current)
  }

  function showStep(next) {
    rememberDraft()
    setSearch('')
    setErrors({})
    setStep(next)
  }

  function chooseExercise(exercise) {
    if (exercise.id !== valuesRef.current.exerciseId) {
      rememberDraft()
      const saved = drafts.current.get(exercise.id)
      const next = update(
        (previous) => saved || freshValues(exercise, { date: previous.date, note: previous.note })
      )
      setActive(Math.max(0, nextPendingIndex(next.setDetails, -1)))
      setReviewing(false)
    }
    setSearch('')
    setErrors({})
    setStep('register')
  }

  function showExercises() {
    showStep('exercise')
  }

  function setField(field, value) {
    update((previous) => ({ ...previous, [field]: value }))
  }

  function changeSets(change) {
    update((previous) => ({ ...previous, setDetails: change(previous.setDetails) }))
    setErrors({})
  }

  function handleFieldChange(field, value) {
    const key = valuesRef.current.setDetails[activeRef.current]?.key
    changeSets((current) => updateSetField(current, key, field, value))
  }

  // Concluir série: registra, avança no mesmo card e, se era a última, finaliza o exercício. Não abre
  // teclado, diálogo nem outra tela.
  function handleConclude() {
    const now = Date.now()
    if (now - lastConcludeAt.current < CONCLUDE_COOLDOWN_MS) return
    const result = concludeSet(valuesRef.current.setDetails, activeRef.current)
    if (!result) return
    lastConcludeAt.current = now
    const next = update((previous) => ({ ...previous, setDetails: result.sets }))
    setErrors({})
    setReviewing(false)
    if (!result.finished) setActive(result.nextIndex)
    const saving = persist(next)
    if (result.finished) markWhenProtected(next.exerciseId, saving)
  }

  // Corrige uma série já concluída: só ela muda; as demais permanecem como foram registradas.
  function handleCommitEdit() {
    const committed = commitSetEdit(valuesRef.current.setDetails, activeRef.current)
    if (!committed) return
    const next = update((previous) => ({ ...previous, setDetails: committed }))
    persist(next)
  }

  function handleAddSet() {
    const wasFinished = allSetsDone(valuesRef.current.setDetails)
    const index = valuesRef.current.setDetails.length
    changeSets((current) => addSet(current, nextKey))
    if (wasFinished && valuesRef.current.setDetails.length > index)
      unmarkExerciseDone(valuesRef.current.exerciseId)
    setActive(Math.min(index, valuesRef.current.setDetails.length - 1))
  }

  function handleRemoveSet() {
    const current = valuesRef.current.setDetails
    const target = current[activeRef.current]
    if (!target || !canRemoveSet(current, target.key)) return
    const next = update((previous) => ({
      ...previous,
      setDetails: removeSet(previous.setDetails, target.key),
    }))
    setActive(nextActiveSetIndexAfterRemoval(activeRef.current, current.length))
    if (editing) return
    if (!allSetsDone(next.setDetails)) unmarkExerciseDone(next.exerciseId)
    const saving =
      target.done || allSetsDone(next.setDetails)
        ? persist(next)
        : saverFor(next.exerciseId).whenIdle()
    if (allSetsDone(next.setDetails)) markWhenProtected(next.exerciseId, saving)
  }

  function handleFinishNow() {
    const next = update((previous) => ({
      ...previous,
      setDetails: dropPendingSets(previous.setDetails),
    }))
    setActive(0)
    if (allSetsDone(next.setDetails)) markWhenProtected(next.exerciseId, persist(next))
  }

  function handleConcludeCardio() {
    const current = valuesRef.current
    if (!isValidCardioSession(current)) return
    const now = Date.now()
    if (now - lastConcludeAt.current < CONCLUDE_COOLDOWN_MS) return
    lastConcludeAt.current = now
    const next = update((previous) => ({
      ...previous,
      cardioDone: true,
      cardioCommitted: {
        durationMinutes: previous.durationMinutes,
        distanceKm: previous.distanceKm,
      },
    }))
    setErrors({})
    setReviewing(false)
    markWhenProtected(next.exerciseId, persist(next))
  }

  function handleRetry() {
    saverFor(valuesRef.current.exerciseId).retry()
  }

  // Data e observação são gravadas junto com a próxima série — ou, se o registro já existe, ao sair do
  // campo, para nunca ficarem só na tela.
  function handleMetaBlur() {
    const current = valuesRef.current
    if (
      editing ||
      (!savedMeta.current.has(current.exerciseId) && !sessionRowFor(current.exerciseId))
    )
      return
    if (savedMeta.current.get(current.exerciseId) === `${current.date}|${current.note}`) return
    persist(current)
  }

  // Avança na sequência da ficha; ao terminar a lista, permite revisar seus exercícios.
  const nextExercise = useMemo(() => {
    const list = orderedExercises
    const index = list.findIndex((exercise) => exercise.id === values.exerciseId)
    return [...list.slice(index + 1), ...list.slice(0, Math.max(index, 0))].find(
      (exercise) => exercise.id !== values.exerciseId && !doneExerciseIds.has(exercise.id)
    )
  }, [orderedExercises, values.exerciseId, doneExerciseIds])
  const nextLabel = nextExercise ? 'Próximo exercício' : 'Ver exercícios da ficha'

  function handleNext() {
    if (nextExercise) chooseExercise(nextExercise)
    else showExercises()
  }

  function handleReview() {
    setReviewing(true)
    setActive(0)
  }

  // Edição de um registro existente: valida tudo e grava de uma vez (contrato antigo de onSubmit).
  async function handleSubmit(event) {
    event.preventDefault()
    if (!editing) {
      // Enter num campo só fecha o teclado; concluir série é sempre o botão.
      document.activeElement?.blur?.()
      return
    }
    if (step !== 'register' || submitLock.current) return
    const payload = {
      ...values,
      type: getExerciseType(selectedExercise),
      setDetails: sets.map(({ weight, reps }) => ({ weight, reps })),
    }
    const validationErrors = validateWorkout(payload)
    setErrors(validationErrors)
    if (validationErrors.date || validationErrors.note) setDetailsOpen(true)
    const invalidIndex = sets.findIndex((_, index) => validationErrors[`set${index}`])
    if (!cardio && invalidIndex !== -1) setActive(invalidIndex)
    if (hasErrors(validationErrors)) return

    submitLock.current = true
    setSubmitting(true)
    try {
      await onSubmit(payload)
    } catch {
      // onSubmit (History.jsx) já mostrou o toast de erro e relança.
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  if (!editing && !sheetScope?.id)
    return <p role="alert">Escolha uma ficha para iniciar o treino.</p>

  return (
    <Box as="form" ref={formRef} className="workout-form workout-execution" onSubmit={handleSubmit}>
      {!editing && backToSheets && (
        <nav className="workout-session-nav" aria-label="Navegação do treino">
          <Button as={Link} to={backToSheets} size="small" leadingVisual={ChevronLeftIcon}>
            Voltar às fichas
          </Button>
          <Button
            type="button"
            size="small"
            leadingVisual={step === 'register' ? ListUnorderedIcon : ChevronLeftIcon}
            onClick={step === 'register' ? showExercises : () => setStep('register')}
            disabled={finishing}
          >
            {step === 'register' ? 'Exercícios da ficha' : 'Voltar ao exercício'}
          </Button>
        </nav>
      )}
      <nav className="workout-progress" aria-label="Etapas do treino">
        {sheetScope ? (
          <span className="is-current" aria-current="step">
            Exercício {sheetPosition} de {availableExercises.length}
          </span>
        ) : (
          <button type="button" disabled={submitting} onClick={showExercises}>
            Editar exercício
          </button>
        )}
      </nav>

      {step === 'exercise' && (
        <section className="workout-step" aria-labelledby="exercise-choice-title">
          {editing && (
            <button
              className="workout-back"
              type="button"
              onClick={() => (selectedExercise ? setStep('register') : onCancel?.())}
            >
              <ChevronLeftIcon size={16} /> Voltar
            </button>
          )}
          <div className="workout-step-heading">
            <h2 id="exercise-choice-title">Escolha o exercício</h2>
          </div>
          {availableExercises.length > 6 && (
            <label className="exercise-search">
              <span className="sr-only">Buscar exercício</span>
              <SearchIcon size={16} />
              <input
                type="search"
                value={search}
                placeholder="Buscar exercício"
                onChange={(event) => setSearch(event.target.value)}
                autoFocus
              />
            </label>
          )}
          <div className="workout-exercise-list">
            {filteredExercises.map((exercise) => {
              const isDone = doneExerciseIds.has(exercise.id)
              return (
                <button
                  className={`workout-exercise-card${
                    values.exerciseId === exercise.id ? ' is-selected' : ''
                  }`}
                  type="button"
                  key={exercise.id}
                  aria-pressed={values.exerciseId === exercise.id}
                  onClick={() => chooseExercise(exercise)}
                >
                  <span>
                    <strong>{exercise.name}</strong>
                    {exercise.note && <small>{exercise.note}</small>}
                    {isDone && <span className="sr-only">, concluído hoje</span>}
                  </span>
                  {isDone && (
                    <CheckCircleFillIcon
                      size={18}
                      className="workout-exercise-done-icon"
                      aria-hidden="true"
                    />
                  )}
                  <ChevronRightIcon size={18} />
                </button>
              )
            })}
          </div>
          {filteredExercises.length === 0 && (
            <Text className="workout-no-results">Nenhum exercício encontrado.</Text>
          )}
        </section>
      )}

      {sheetScope && sheetGoal && <p className="sheet-reference">Meta da ficha: {sheetGoal}</p>}
      {step === 'register' && selectedExercise && (
        <div className="workout-step workout-register-step">
          <section className="exercise-context-bar" aria-label="Exercício selecionado">
            {selectedExercise.providerExerciseId ? (
              <WorkoutExerciseVisual
                exercise={selectedExercise}
                group={selectedGroup}
                displayName={selectedExercise.name}
              />
            ) : (
              <div className="exercise-context-name">
                <span>{selectedGroup}</span>
                <strong>{selectedExercise.name}</strong>
              </div>
            )}
          </section>

          {showComplete && (
            <ExerciseComplete
              summary={
                cardio
                  ? formatCardioSession({
                      durationMinutes: values.cardioCommitted.durationMinutes,
                      distanceKm:
                        values.cardioCommitted.distanceKm === ''
                          ? null
                          : values.cardioCommitted.distanceKm,
                    })
                  : summarizeSets(sets)
              }
              syncStatus={completeStatus}
              onRetry={handleRetry}
              onNext={handleNext}
              onReview={handleReview}
              nextLabel={nextLabel}
            />
          )}

          {cardio && !showComplete && (
            <fieldset className="cardio-fieldset" disabled={submitting || finishing}>
              <legend>Sessão</legend>
              {values.cardioSource === 'history' && !values.cardioDone && (
                <span className="set-card-source">Sugerido do último treino</span>
              )}
              <div className="cardio-fields">
                <FormControl required>
                  <FormControl.Label>Duração (min)</FormControl.Label>
                  <TextInput
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={600}
                    step={1}
                    value={values.durationMinutes}
                    onChange={(event) => setField('durationMinutes', event.target.value)}
                    placeholder="Ex.: 30"
                    size="large"
                    block
                  />
                </FormControl>
                <FormControl>
                  <FormControl.Label>Distância (km, opcional)</FormControl.Label>
                  <TextInput
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={500}
                    step="any"
                    value={values.distanceKm}
                    onChange={(event) => setField('distanceKm', event.target.value)}
                    placeholder="Ex.: 5"
                    size="large"
                    block
                  />
                </FormControl>
              </div>
              {errors.durationMinutes && (
                <Text role="alert" className="form-error">
                  {errors.durationMinutes}
                </Text>
              )}
              {!editing && (
                <>
                  <button
                    type="button"
                    className="set-card-complete"
                    disabled={!isValidCardioSession(values)}
                    onClick={handleConcludeCardio}
                  >
                    <CheckIcon size={22} />
                    {values.cardioDone ? 'Atualizar sessão' : 'Concluir exercício'}
                  </button>
                  {values.cardioDone && (
                    <SaveStatus
                      status={rowStatus === 'error' ? 'error' : completeStatus}
                      onRetry={handleRetry}
                    />
                  )}
                </>
              )}
            </fieldset>
          )}

          {!cardio && !showComplete && (
            <fieldset className="sets-fieldset" disabled={submitting || finishing}>
              <legend className="sr-only">Séries</legend>
              <SetCard
                mode={editing ? 'edit' : 'session'}
                sets={sets}
                activeIndex={activeSetIndex}
                syncStatuses={syncStatuses}
                rowStatus={rowStatus}
                onSelect={setActive}
                onChange={handleFieldChange}
                onConclude={handleConclude}
                onCommitEdit={handleCommitEdit}
                onAdd={handleAddSet}
                onRemove={handleRemoveSet}
                canRemove={canRemoveSet(sets, sets[activeSetIndex]?.key)}
                onFinishNow={handleFinishNow}
                onRetry={handleRetry}
                disabled={submitting || finishing}
              />
              {(errors.setDetails || errors[`set${activeSetIndex}`]) && (
                <Text role="alert" className="form-error">
                  {errors.setDetails || errors[`set${activeSetIndex}`]}
                </Text>
              )}
            </fieldset>
          )}

          {!editing && exerciseFinished && reviewing && (
            <Button type="button" className="workout-next" onClick={handleNext}>
              {nextLabel}
            </Button>
          )}

          <details
            className="workout-details"
            open={detailsOpen}
            onToggle={(event) => setDetailsOpen(event.target.open)}
          >
            <summary>Data e observações</summary>
            <div className="workout-details-fields">
              <FormControl required disabled={submitting}>
                <FormControl.Label>Data</FormControl.Label>
                <TextInput
                  type="date"
                  value={values.date}
                  onChange={(event) => setField('date', event.target.value)}
                  onBlur={handleMetaBlur}
                  max={todayString()}
                  block
                />
                {errors.date && (
                  <FormControl.Validation variant="error">{errors.date}</FormControl.Validation>
                )}
              </FormControl>
              <FormControl disabled={submitting}>
                <FormControl.Label>Observação (opcional)</FormControl.Label>
                <Textarea
                  value={values.note}
                  onChange={(event) => setField('note', event.target.value)}
                  onBlur={handleMetaBlur}
                  rows={2}
                  maxLength={300}
                  block
                />
                {errors.note && (
                  <FormControl.Validation variant="error">{errors.note}</FormControl.Validation>
                )}
              </FormControl>
            </div>
          </details>

          {editing && (
            <div className="workout-form-actions">
              <Button type="button" disabled={submitting} onClick={onCancel}>
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                leadingVisual={CheckIcon}
                loading={submitting}
                disabled={submitting}
              >
                Salvar alterações
              </Button>
            </div>
          )}
          <details className="workout-past-sessions" key={values.exerciseId}>
            <summary>Sessões anteriores ({recentHistory.length})</summary>
            <p className="workout-history-caption">
              Até 7 dias, contados a partir da sessão mais recente disponível.
            </p>
            {recentHistory.length === 0 ? (
              <p>Nenhuma sessão anterior deste exercício nos registros carregados.</p>
            ) : (
              <ol className="workout-history-list">
                {recentHistory.map((workout, index) => {
                  const sets = getWorkoutSets(workout)
                  const sessionDate = workout.date ? toDate(workout.date) : null
                  const validDate = sessionDate && Number.isFinite(sessionDate.getTime())
                  return (
                    <li key={workout.id || index} className="workout-history-session">
                      <div className="workout-history-heading">
                        <strong>
                          {validDate ? formatDate(sessionDate) : 'Data não informada'}
                        </strong>
                        {!isCardioExercise(workout) &&
                          sets.length > 0 &&
                          sets.every(isValidSet) && (
                            <span>
                              Volume total: {calculateVolume(workout).toLocaleString('pt-BR')} kg
                            </span>
                          )}
                      </div>
                      {isCardioExercise(workout) ? (
                        <p>{formatCardioSession(workout)}</p>
                      ) : (
                        <ul className="workout-history-sets">
                          {sets.map((set, setIndex) => (
                            <li key={setIndex}>
                              <b>S{setIndex + 1}</b>
                              <span>
                                {Number(set.weight).toLocaleString('pt-BR')}kg × {set.reps}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {workout.note && (
                        <p className="workout-history-note">
                          <b>Observação:</b> {workout.note}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
            <Link
              className="workout-history-link"
              to={`/historico?exercicio=${encodeURIComponent(values.exerciseId)}`}
            >
              Ver histórico completo
            </Link>
          </details>
        </div>
      )}
    </Box>
  )
}
