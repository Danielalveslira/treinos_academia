import { useMemo, useRef, useState } from 'react'
import { Box, Button, FormControl, TextInput, Textarea, Text, Link } from '@primer/react'
import {
  CheckCircleFillIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from '@primer/octicons-react'
import { MUSCLE_GROUPS } from '../constants/muscleGroups'
import { getMuscleGroupIcon } from '../constants/muscleGroupIcons'
import { validateWorkout, hasErrors } from '../utils/validators'
import { getWorkoutSets, getWorkoutLoad, MAX_WORKOUT_SETS, isValidSet } from '../utils/workoutSets'
import { calculateVolume } from '../utils/calculations'
import { useFocusWithinBodyClass } from '../hooks/useFocusWithinBodyClass'
import { getExerciseType, isCardioExercise } from '../utils/exerciseType'
import { formatCardioSession } from '../utils/cardioSessions'
import {
  loadDoneExerciseIds,
  saveDoneExerciseIds,
  cleanupStaleDoneExerciseKeys,
} from '../utils/doneExercisesStorage'
import { nextStepAfterFinishing, valuesForNextExercise } from '../utils/workoutSessionFlow'

// Enquanto o teclado virtual está provavelmente aberto (um campo do formulário tem
// foco), CSS esconde a barra de navegação inferior e o botão flutuante de instalar o
// app (ver navigation.css/app.css) — nenhum dos dois serve pra nada durante a
// digitação, e liberar esse espaço é o que evita o footer de ações brigando com o
// teclado por altura de tela.
const KEYBOARD_ACTIVE_CLASS = 'keyboard-active'

function todayString() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`
}

// setDetails e durationMinutes/distanceKm coexistem aqui sempre, os dois tipos — só o
// tipo do exercício selecionado (selectedExercise, via getExerciseType) decide qual
// metade é validada, renderizada e enviada (ver handleSubmit). Mais simples do que
// trocar a forma do objeto a cada troca de exercício.
function buildEmpty(defaultExerciseId) {
  return {
    exerciseId: defaultExerciseId || '',
    setDetails: [{ weight: '', reps: '' }],
    durationMinutes: '',
    distanceKm: '',
    date: todayString(),
    note: '',
  }
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

export function WorkoutForm({
  exercises,
  history = [],
  initialValue,
  defaultExerciseId,
  onSubmit,
  onCancel,
}) {
  const nextSetId = useRef(0)
  // Editando, o tipo do treino já existente trava qual exercício dá pra escolher —
  // trocar pra um exercício de outro tipo faria a checagem de imutabilidade de type
  // nas firestore.rules recusar o salvamento (ver isValidWorkout/allow update). Mais
  // simples barrar isso aqui, na lista de opções, do que deixar o usuário chegar até
  // "Finalizar exercício" pra só então descobrir que não pode.
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
  const [values, setValues] = useState(() => {
    const value = initialValue || buildEmpty(initialExercise?.id)
    return {
      ...value,
      exerciseId: initialExercise?.id || value.exerciseId,
      setDetails: getWorkoutSets(value).map((set) => ({ ...set, key: nextSetId.current++ })),
    }
  })
  const [step, setStep] = useState(() => (initialExercise ? 'register' : 'group'))
  const [selectedGroup, setSelectedGroup] = useState(initialExercise?.muscleGroup || 'Outros')
  const [search, setSearch] = useState('')
  const [completed, setCompleted] = useState(() => new Set())
  const drafts = useRef(new Map())
  const completionDrafts = useRef(new Map())
  // Exercícios finalizados HOJE, neste aparelho (localStorage, sem sync com Firestore --
  // ver doneExercisesStorage.js). Diferente de `completed` acima: aquele é por SÉRIE,
  // dentro do exercício atual; este é por EXERCÍCIO, através de todo o fluxo de sessão
  // (grupo -> exercício -> séries), e é o que decide a navegação ao finalizar (ver
  // handleSubmit/nextStepAfterFinishing). Não se aplica a edição avulsa vinda de
  // History.jsx (initialValue setado) -- editar um registro já existente fecha o
  // formulário sozinho, sem o conceito de "próximo exercício do grupo".
  const [doneExerciseIds, setDoneExerciseIds] = useState(() => {
    if (initialValue) return new Set()
    const today = todayString()
    cleanupStaleDoneExerciseKeys(today)
    return loadDoneExerciseIds(today)
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

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
  // Sem o filtro de busca -- é a lista "de verdade" do grupo, usada por
  // nextStepAfterFinishing pra saber se sobra exercício não concluído. exercisesInGroup
  // (abaixo) é só a versão filtrada exibida na tela.
  const allExercisesInGroup = useMemo(
    () => availableExercises.filter((exercise) => (exercise.muscleGroup || 'Outros') === selectedGroup),
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
  const bestLoad = exerciseHistory.length
    ? Math.max(...exerciseHistory.map((workout) => getWorkoutLoad(workout)))
    : null

  function rememberDraft() {
    if (!values.exerciseId) return
    drafts.current.set(values.exerciseId, values)
    completionDrafts.current.set(values.exerciseId, completed)
  }

  function chooseGroup(group) {
    rememberDraft()
    setSelectedGroup(group)
    setSearch('')
    setErrors({})
    setStep('exercise')
  }

  function chooseExercise(exercise) {
    if (exercise.id !== values.exerciseId) {
      rememberDraft()
      const saved = drafts.current.get(exercise.id)
      setValues(
        saved || {
          ...buildEmpty(exercise.id),
          date: values.date,
          note: values.note,
          setDetails: [{ weight: '', reps: '', key: nextSetId.current++ }],
        }
      )
      setCompleted(completionDrafts.current.get(exercise.id) || new Set())
    }
    setSelectedGroup(exercise.muscleGroup || 'Outros')
    setSearch('')
    setErrors({})
    setStep('register')
  }

  function showGroups() {
    rememberDraft()
    setSearch('')
    setStep('group')
  }

  function showExercises() {
    rememberDraft()
    if (selectedExercise) setSelectedGroup(selectedExercise.muscleGroup || 'Outros')
    setSearch('')
    setStep('exercise')
  }

  function changeSets(change) {
    setValues((previous) => ({ ...previous, setDetails: change(previous.setDetails) }))
    setErrors({})
  }

  function addSet(repeat = false) {
    const key = nextSetId.current++
    changeSets((sets) => [...sets, { ...(repeat ? sets.at(-1) : { weight: '', reps: '' }), key }])
  }

  function setField(field, value) {
    setValues((previous) => ({ ...previous, [field]: value }))
  }

  function updateSet(key, field, value) {
    changeSets((sets) => sets.map((set) => (set.key === key ? { ...set, [field]: value } : set)))
    setCompleted((previous) => {
      const next = new Set(previous)
      next.delete(key)
      return next
    })
  }

  function toggleComplete(key) {
    setCompleted((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (step !== 'register') return
    const payload = { ...values, type: getExerciseType(selectedExercise) }
    const validationErrors = validateWorkout(payload)
    setErrors(validationErrors)
    if (validationErrors.date || validationErrors.note) setDetailsOpen(true)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      await onSubmit(payload)
    } catch {
      // onSubmit (NewWorkout.jsx/History.jsx) já mostrou o toast de erro e relança --
      // não marca o exercício como concluído nem avança de aba num salvamento que falhou.
      return
    } finally {
      setSubmitting(false)
    }

    if (initialValue) return // edição avulsa -- sem fluxo de sessão pra navegar.

    const { doneExerciseIds: nextDone, step: nextStep } = nextStepAfterFinishing({
      allExercisesInGroup,
      doneExerciseIds,
      finishedExerciseId: values.exerciseId,
    })
    setDoneExerciseIds(nextDone)
    saveDoneExerciseIds(todayString(), nextDone)
    setValues((previous) => ({
      ...valuesForNextExercise(previous),
      setDetails: [{ weight: '', reps: '', key: nextSetId.current++ }],
    }))
    setSearch('')
    setStep(nextStep)
  }

  const validSetCount = values.setDetails.filter(isValidSet).length
  const formRef = useFocusWithinBodyClass(KEYBOARD_ACTIVE_CLASS)

  return (
    <Box as="form" ref={formRef} className="workout-form" onSubmit={handleSubmit}>
      <nav className="workout-progress" aria-label="Etapas do treino">
        <span className={step === 'group' ? 'is-current' : 'is-done'}>1 Grupo</span>
        <span className={step === 'exercise' ? 'is-current' : step === 'register' ? 'is-done' : ''}>
          2 Exercício
        </span>
        <span className={step === 'register' ? 'is-current' : ''}>3 {cardio ? 'Sessão' : 'Séries'}</span>
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
          <section className="exercise-picker" aria-label="Exercício selecionado">
            <div className="selected-workout-context">
              <div>
                <span>{selectedGroup}</span>
                <strong>{selectedExercise.name}</strong>
              </div>
              <div>
                <Button size="small" type="button" onClick={showExercises}>
                  Trocar exercício
                </Button>
                <Link as="button" type="button" onClick={showGroups} sx={{ fontSize: 0 }}>
                  Trocar grupo
                </Link>
              </div>
            </div>

            <p className="workout-reference" aria-live="polite">
              {!lastWorkout
                ? 'Primeiro registro'
                : `Última: ${
                    cardio
                      ? formatCardioSession(lastWorkout)
                      : getWorkoutSets(lastWorkout)
                          .map((set) => `${set.weight}kg×${set.reps}`)
                          .join(' · ')
                  }`}
              {/* Cardio ainda não tem noção de recorde nesta primeira versão — ver
                  ExerciseDetail.jsx, mesmo motivo (sem carga, "melhor" não se aplica). */}
              {!cardio && bestLoad != null && (
                <>
                  {' · '}
                  <span className="workout-reference-best">
                    Melhor {bestLoad.toLocaleString('pt-BR')}kg
                  </span>
                </>
              )}
            </p>
          </section>

          {cardio && (
            <fieldset className="cardio-fieldset" disabled={submitting}>
              <legend>Sessão</legend>
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
                  placeholder="0"
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
                  placeholder="0"
                  block
                />
              </FormControl>
              {errors.durationMinutes && (
                <Text role="alert" className="form-error">
                  {errors.durationMinutes}
                </Text>
              )}
            </fieldset>
          )}

          {!cardio && (
            <fieldset className="sets-fieldset" disabled={submitting}>
              <div className="sets-heading">
                <legend>Séries</legend>
                <span>
                  {completed.size}/{values.setDetails.length} concluídas
                </span>
              </div>
              <div className="set-column-headings" aria-hidden="true">
                <span>SÉRIE</span>
                <span>PESO (KG)</span>
                <span>REPS</span>
                <span>FEITO</span>
              </div>
              <div className="set-list">
                {values.setDetails.map((set, index) => {
                  const isComplete = completed.has(set.key)
                  return (
                    <div className={`set-row${isComplete ? ' is-complete' : ''}`} key={set.key}>
                      <span className="set-number">{index + 1}</span>
                      <label>
                        <span className="sr-only">Peso em kg, série {index + 1}</span>
                        <TextInput
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={10000}
                          step="any"
                          value={set.weight}
                          aria-label={`Peso (kg), série ${index + 1}`}
                          aria-invalid={!!errors[`set${index}`]}
                          aria-describedby={
                            errors[`set${index}`] ? `set-error-${set.key}` : undefined
                          }
                          onChange={(event) => updateSet(set.key, 'weight', event.target.value)}
                          placeholder="0"
                          block
                        />
                      </label>
                      <label>
                        <span className="sr-only">Repetições, série {index + 1}</span>
                        <TextInput
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={100000}
                          step={1}
                          value={set.reps}
                          aria-label={`Repetições, série ${index + 1}`}
                          aria-invalid={!!errors[`set${index}`]}
                          aria-describedby={
                            errors[`set${index}`] ? `set-error-${set.key}` : undefined
                          }
                          onChange={(event) => updateSet(set.key, 'reps', event.target.value)}
                          placeholder="0"
                          block
                        />
                      </label>
                      <button
                        className="complete-set"
                        type="button"
                        disabled={!isValidSet(set)}
                        aria-label={`${isComplete ? 'Reabrir' : 'Concluir'} série ${index + 1}`}
                        aria-pressed={isComplete}
                        onClick={() => toggleComplete(set.key)}
                      >
                        <CheckIcon size={20} />
                      </button>
                      <button
                        className="remove-set"
                        type="button"
                        aria-label={`Remover série ${index + 1}`}
                        disabled={values.setDetails.length === 1}
                        onClick={() =>
                          changeSets((sets) => sets.filter((item) => item.key !== set.key))
                        }
                      >
                        <TrashIcon size={14} />
                      </button>
                      {errors[`set${index}`] && (
                        <Text className="set-error" id={`set-error-${set.key}`} role="alert">
                          {errors[`set${index}`]}
                        </Text>
                      )}
                    </div>
                  )
                })}
              </div>
              {errors.setDetails && (
                <Text role="alert" className="form-error">
                  {errors.setDetails}
                </Text>
              )}
              <div className="set-actions">
                <Button
                  type="button"
                  leadingVisual={PlusIcon}
                  disabled={values.setDetails.length >= MAX_WORKOUT_SETS}
                  onClick={() => addSet()}
                >
                  Adicionar série
                </Button>
                <Button
                  type="button"
                  leadingVisual={CopyIcon}
                  disabled={
                    !values.setDetails.length || values.setDetails.length >= MAX_WORKOUT_SETS
                  }
                  onClick={() => addSet(true)}
                >
                  Repetir série
                </Button>
              </div>
            </fieldset>
          )}

          {!cardio && (
            <div className="session-summary" aria-live="polite">
              <div>
                <span>Séries válidas</span>
                <strong>{validSetCount}</strong>
              </div>
              <div>
                <span>Volume estimado</span>
                <strong>
                  {values.setDetails.every(isValidSet)
                    ? `${calculateVolume(values).toLocaleString('pt-BR')} kg`
                    : '—'}
                </strong>
              </div>
            </div>
          )}

          <details
            className="workout-details"
            open={detailsOpen}
            onToggle={(event) => setDetailsOpen(event.target.open)}
          >
            <summary>Data e observações</summary>
            <div className="workout-details-fields">
              <FormControl required>
                <FormControl.Label>Data</FormControl.Label>
                <TextInput
                  type="date"
                  value={values.date}
                  onChange={(event) => setField('date', event.target.value)}
                  max={todayString()}
                  block
                />
                {errors.date && (
                  <FormControl.Validation variant="error">{errors.date}</FormControl.Validation>
                )}
              </FormControl>
              <FormControl>
                <FormControl.Label>Observação (opcional)</FormControl.Label>
                <Textarea
                  value={values.note}
                  onChange={(event) => setField('note', event.target.value)}
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

          <div className="workout-form-actions">
            <Button type="button" onClick={onCancel}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              leadingVisual={CheckIcon}
              loading={submitting}
              disabled={submitting}
            >
              Finalizar exercício
            </Button>
          </div>
        </div>
      )}
    </Box>
  )
}
