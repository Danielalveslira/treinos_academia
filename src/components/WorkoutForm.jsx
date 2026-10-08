import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, FormControl, TextInput, Textarea, Text } from '@primer/react'
import {
  CheckCircleFillIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
} from '@primer/octicons-react'
import { MUSCLE_GROUPS } from '../constants/muscleGroups'
import { getMuscleGroupIcon } from '../constants/muscleGroupIcons'
import { validateWorkout, hasErrors } from '../utils/validators'
import { getWorkoutSets, isValidSet } from '../utils/workoutSets'
import { toDate } from '../utils/date'
import { formatDate } from '../utils/format'
import { ExerciseComplete, SaveStatus, SetCard } from './SetCard'
import { calculateVolume } from '../utils/calculations'
import { useFocusWithinBodyClass } from '../hooks/useFocusWithinBodyClass'
import { getExerciseType, isCardioExercise } from '../utils/exerciseType'
import { formatCardioSession, isValidCardioSession } from '../utils/cardioSessions'
import {
  loadDoneExerciseIds,
  saveDoneExerciseIds,
  cleanupStaleDoneExerciseKeys,
} from '../utils/doneExercisesStorage'
import { sortExercisesInGroup } from '../utils/exerciseOrder'
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

function orderedGroups(exercises) {
  const present = new Set(exercises.map((exercise) => exercise.muscleGroup || 'Outros'))
  return [
    ...MUSCLE_GROUPS.filter((group) => present.has(group)),
    ...[...present]
      .filter((group) => !MUSCLE_GROUPS.includes(group))
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
  ]
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
  history = [],
  initialValue,
  defaultExerciseId,
  onSubmit,
  onCreate,
  onUpdate,
  onCancel,
}) {
  // Dois modos: SESSÃO (novo treino — cada série concluída já é gravada, ver utils/rowSaver.js) e
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
    const active = exercises.filter(
      (exercise) => exercise.active || exercise.id === initialValue?.exerciseId
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
  }, [exercises, initialValue?.exerciseId, editingType])
  const initialExerciseId = initialValue?.exerciseId || defaultExerciseId || ''
  const initialExercise = availableExercises.find((exercise) => exercise.id === initialExerciseId)

  // Valores de um exercício que ainda não foi tocado: sugestão do último treino quando existe
  // (marcada como 'history', nunca como concluída) e campos vazios quando não existe.
  function freshValues(exercise, { date = todayString(), note = '' } = {}) {
    const last = history.find((workout) => workout.exerciseId === exercise?.id)
    const base = {
      exerciseId: exercise?.id || '',
      setDetails: [],
      durationMinutes: '',
      distanceKm: '',
      cardioDone: false,
      cardioCommitted: null,
      cardioSource: 'empty',
      date,
      note,
    }
    if (isCardioExercise(exercise)) {
      return last ? { ...base, ...cardioValues(last), cardioSource: 'history' } : base
    }
    return { ...base, setDetails: buildSessionSets(last, nextKey) }
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
  const [step, setStep] = useState(() => (initialExercise ? 'register' : 'group'))
  const [selectedGroup, setSelectedGroup] = useState(initialExercise?.muscleGroup || 'Outros')
  const [search, setSearch] = useState('')
  const drafts = useRef(new Map())
  // Exercícios finalizados HOJE, neste aparelho (localStorage, sem sync com o banco --
  // ver doneExercisesStorage.js). É por EXERCÍCIO, através de todo o fluxo de sessão
  // (grupo -> exercício -> séries), e é o que marca "concluído" na lista e decide qual é o
  // próximo exercício. Não se aplica a edição avulsa vinda de History.jsx (initialValue
  // setado).
  const [doneExerciseIds, setDoneExerciseIds] = useState(() => {
    if (initialValue) return new Set()
    const today = todayString()
    cleanupStaleDoneExerciseKeys(today)
    return loadDoneExerciseIds(today)
  })
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
      saver = createRowSaver({
        createRow: (payload, options) => writers.current.onCreate(payload, options),
        updateRow: (id, payload) => writers.current.onUpdate(id, payload),
        onChange: (state) => setSaveStates((previous) => ({ ...previous, [exerciseId]: state })),
      })
      savers.current.set(exerciseId, saver)
    }
    return saver
  }

  const groups = useMemo(() => orderedGroups(availableExercises), [availableExercises])
  const groupCounts = useMemo(() => {
    const counts = new Map()
    availableExercises.forEach((exercise) => {
      const group = exercise.muscleGroup || 'Outros'
      counts.set(group, (counts.get(group) || 0) + 1)
    })
    return counts
  }, [availableExercises])
  const selectedExercise = useMemo(
    () => availableExercises.find((exercise) => exercise.id === values.exerciseId),
    [availableExercises, values.exerciseId]
  )
  const cardio = isCardioExercise(selectedExercise)
  // Sem o filtro de busca -- é a lista "de verdade" do grupo, usada pra achar o próximo
  // exercício não concluído. exercisesInGroup (abaixo) é só a versão filtrada exibida na tela.
  const allExercisesInGroup = useMemo(
    () =>
      sortExercisesInGroup(
        availableExercises.filter(
          (exercise) => (exercise.muscleGroup || 'Outros') === selectedGroup
        )
      ),
    [availableExercises, selectedGroup]
  )
  const exercisesInGroup = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return allExercisesInGroup.filter(
      (exercise) => !term || exercise.name.toLocaleLowerCase('pt-BR').includes(term)
    )
  }, [allExercisesInGroup, search])
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
    update((previous) => ({ ...previous, setDetails: buildSessionSets(lastWorkout, nextKey) }))
  }, [lastWorkout, initialValue, cardio])

  const sets = values.setDetails
  const rowState = saveStates[values.exerciseId]
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
    const base = {
      exerciseId: current.exerciseId,
      type: getExerciseType(selectedExercise),
      date: current.date,
      note: current.note,
    }
    if (cardio) {
      const committed = current.cardioCommitted || cardioValues()
      return { ...base, ...committed }
    }
    return { ...base, setDetails: doneSetsPayload(current.setDetails) }
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
    if (editing || doneExerciseIds.has(exerciseId)) return
    const next = new Set(doneExerciseIds).add(exerciseId)
    setDoneExerciseIds(next)
    saveDoneExerciseIds(todayString(), next)
  }

  function rememberDraft() {
    if (!valuesRef.current.exerciseId) return
    drafts.current.set(valuesRef.current.exerciseId, valuesRef.current)
  }

  function showStep(next, group) {
    rememberDraft()
    if (group) setSelectedGroup(group)
    setSearch('')
    setErrors({})
    setStep(next)
  }

  function chooseGroup(group) {
    showStep('exercise', group)
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
    setSelectedGroup(exercise.muscleGroup || 'Outros')
    setSearch('')
    setErrors({})
    setStep('register')
  }

  function showGroups() {
    showStep('group')
  }

  function showExercises() {
    showStep('exercise', selectedExercise ? selectedExercise.muscleGroup || 'Outros' : undefined)
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
    if (result.finished) markExerciseDone(next.exerciseId)
    else setActive(result.nextIndex)
    persist(next)
  }

  // Corrige uma série já concluída: só ela muda; as demais permanecem como foram registradas.
  function handleCommitEdit() {
    const committed = commitSetEdit(valuesRef.current.setDetails, activeRef.current)
    if (!committed) return
    const next = update((previous) => ({ ...previous, setDetails: committed }))
    persist(next)
  }

  function handleAddSet() {
    const index = valuesRef.current.setDetails.length
    changeSets((current) => addSet(current, nextKey))
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
    if (target.done) persist(next)
    if (allSetsDone(next.setDetails)) markExerciseDone(next.exerciseId)
  }

  function handleFinishNow() {
    const next = update((previous) => ({
      ...previous,
      setDetails: dropPendingSets(previous.setDetails),
    }))
    setActive(0)
    if (allSetsDone(next.setDetails)) markExerciseDone(next.exerciseId)
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
    markExerciseDone(next.exerciseId)
    persist(next)
  }

  function handleRetry() {
    saverFor(valuesRef.current.exerciseId).retry()
  }

  // Data e observação são gravadas junto com a próxima série — ou, se o registro já existe, ao sair do
  // campo, para nunca ficarem só na tela.
  function handleMetaBlur() {
    const current = valuesRef.current
    if (editing || !savedMeta.current.has(current.exerciseId)) return
    if (savedMeta.current.get(current.exerciseId) === `${current.date}|${current.note}`) return
    persist(current)
  }

  // Próximo exercício NÃO CONCLUÍDO do mesmo grupo (na ordem do grupo, dando a volta); sem sobra, volta
  // para a escolha de grupo. Só acontece por toque do usuário.
  const nextExercise = useMemo(() => {
    const list = allExercisesInGroup
    const index = list.findIndex((exercise) => exercise.id === values.exerciseId)
    return [...list.slice(index + 1), ...list.slice(0, Math.max(index, 0))].find(
      (exercise) => exercise.id !== values.exerciseId && !doneExerciseIds.has(exercise.id)
    )
  }, [allExercisesInGroup, values.exerciseId, doneExerciseIds])
  const nextLabel = nextExercise ? 'Próximo exercício' : 'Escolher outro grupo'

  function handleNext() {
    if (nextExercise) chooseExercise(nextExercise)
    else showGroups()
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

  return (
    <Box as="form" ref={formRef} className="workout-form workout-execution" onSubmit={handleSubmit}>
      <nav className="workout-progress" aria-label="Etapas do treino">
        {step === 'group' ? (
          <span className="is-current" aria-current="step">
            1 Grupo
          </span>
        ) : (
          <button type="button" className="is-done" disabled={submitting} onClick={showGroups}>
            1 Grupo
          </button>
        )}
        {step === 'register' ? (
          <button type="button" className="is-done" disabled={submitting} onClick={showExercises}>
            2 Exercício
          </button>
        ) : (
          <span
            className={step === 'exercise' ? 'is-current' : ''}
            aria-current={step === 'exercise' ? 'step' : undefined}
          >
            2 Exercício
          </span>
        )}
        <span
          className={step === 'register' ? 'is-current' : ''}
          aria-current={step === 'register' ? 'step' : undefined}
        >
          3 {cardio ? 'Sessão' : 'Séries'}
        </span>
      </nav>

      {step === 'group' && (
        <section className="workout-step" aria-labelledby="muscle-group-title">
          <div className="workout-step-heading">
            <h2 id="muscle-group-title">Qual grupo você vai treinar?</h2>
          </div>
          <div className="muscle-group-grid">
            {groups.map((group) => {
              const GroupIcon = getMuscleGroupIcon(group)
              return (
                <button
                  className={`muscle-group-card${selectedGroup === group ? ' is-selected' : ''}`}
                  type="button"
                  key={group}
                  aria-pressed={selectedGroup === group}
                  onClick={() => chooseGroup(group)}
                >
                  <span className="muscle-group-mark" aria-hidden="true">
                    <GroupIcon size={20} strokeWidth={2} />
                  </span>
                  <span>
                    <strong>{group}</strong>
                    <small>{groupCounts.get(group)} exercícios</small>
                  </span>
                  <ChevronRightIcon size={16} />
                </button>
              )
            })}
          </div>
          <Button type="button" className="workout-step-cancel" onClick={onCancel}>
            Cancelar
          </Button>
        </section>
      )}

      {step === 'exercise' && (
        <section className="workout-step" aria-labelledby="exercise-choice-title">
          <button className="workout-back" type="button" onClick={showGroups}>
            <ChevronLeftIcon size={16} /> Trocar grupo
          </button>
          <div className="workout-step-heading">
            <h2 id="exercise-choice-title">Escolha o exercício</h2>
          </div>
          {groupCounts.get(selectedGroup) > 6 && (
            <label className="exercise-search">
              <span className="sr-only">Buscar exercício em {selectedGroup}</span>
              <SearchIcon size={16} />
              <input
                type="search"
                value={search}
                placeholder={`Buscar em ${selectedGroup}`}
                onChange={(event) => setSearch(event.target.value)}
                autoFocus
              />
            </label>
          )}
          <div className="workout-exercise-list">
            {exercisesInGroup.map((exercise) => {
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
          {exercisesInGroup.length === 0 && (
            <Text className="workout-no-results">Nenhum exercício encontrado.</Text>
          )}
        </section>
      )}

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
            <fieldset className="cardio-fieldset" disabled={submitting}>
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
            <fieldset className="sets-fieldset" disabled={submitting}>
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
                disabled={submitting}
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
