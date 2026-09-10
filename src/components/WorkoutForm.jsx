import { useMemo, useRef, useState } from 'react'
import { Box, Button, FormControl, TextInput, Select, Textarea, Text } from '@primer/react'
import { CheckIcon, CopyIcon, PlusIcon, TrashIcon, TrophyIcon } from '@primer/octicons-react'
import { validateWorkout, hasErrors } from '../utils/validators'
import { getWorkoutSets, getWorkoutLoad, MAX_WORKOUT_SETS, isValidSet } from '../utils/workoutSets'
import { calculateVolume } from '../utils/calculations'

function todayString() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`
}

function buildEmpty(defaultExerciseId) {
  return {
    exerciseId: defaultExerciseId || '',
    setDetails: [{ weight: '', reps: '' }],
    date: todayString(),
    note: '',
  }
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
  const [values, setValues] = useState(() => {
    const value = initialValue || buildEmpty(defaultExerciseId)
    return {
      ...value,
      setDetails: getWorkoutSets(value).map((set) => ({ ...set, key: nextSetId.current++ })),
    }
  })
  const [completed, setCompleted] = useState(() => new Set())
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  const exerciseHistory = useMemo(
    () => history.filter((workout) => workout.exerciseId === values.exerciseId),
    [history, values.exerciseId]
  )
  const lastWorkout = exerciseHistory[0]
  const bestLoad = exerciseHistory.length
    ? Math.max(...exerciseHistory.map((workout) => getWorkoutLoad(workout)))
    : null

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
    if (field === 'exerciseId') setCompleted(new Set())
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
    const validationErrors = validateWorkout(values)
    setErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      await onSubmit(values)
    } finally {
      setSubmitting(false)
    }
  }

  const activeExercises = exercises.filter(
    (exercise) => exercise.active || exercise.id === initialValue?.exerciseId
  )
  const validSetCount = values.setDetails.filter(isValidSet).length

  return (
    <Box as="form" className="workout-form" onSubmit={handleSubmit}>
      <section className="exercise-picker" aria-label="Exercício selecionado">
        <FormControl required>
          <FormControl.Label>Qual exercício?</FormControl.Label>
          <Select
            value={values.exerciseId}
            onChange={(event) => setField('exerciseId', event.target.value)}
            block
            autoFocus={!defaultExerciseId}
          >
            <Select.Option value="">Selecione um exercício</Select.Option>
            {activeExercises.map((exercise) => (
              <Select.Option key={exercise.id} value={exercise.id}>
                {exercise.name}
              </Select.Option>
            ))}
          </Select>
          {errors.exerciseId && (
            <FormControl.Validation variant="error">{errors.exerciseId}</FormControl.Validation>
          )}
        </FormControl>

        {values.exerciseId && (
          <div className="workout-reference" aria-live="polite">
            <div>
              <span>Última sessão</span>
              <strong>
                {lastWorkout
                  ? getWorkoutSets(lastWorkout)
                      .map((set) => `${set.weight} kg × ${set.reps}`)
                      .join('  ·  ')
                  : 'Primeiro registro'}
              </strong>
            </div>
            <div>
              <TrophyIcon size={15} />
              <span>Melhor carga</span>
              <strong>{bestLoad == null ? '—' : `${bestLoad.toLocaleString('pt-BR')} kg`}</strong>
            </div>
          </div>
        )}
      </section>

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
                  onClick={() => changeSets((sets) => sets.filter((item) => item.key !== set.key))}
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
            disabled={!values.setDetails.length || values.setDetails.length >= MAX_WORKOUT_SETS}
            onClick={() => addSet(true)}
          >
            Repetir série
          </Button>
        </div>
      </fieldset>

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

      <details className="workout-details">
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
          Finalizar treino
        </Button>
      </div>
    </Box>
  )
}
