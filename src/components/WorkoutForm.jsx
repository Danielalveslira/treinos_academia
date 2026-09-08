import { useState } from 'react'
import { validateWorkout, hasErrors } from '../utils/validators'
import { FormField } from './FormField'

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

function buildEmpty(defaultExerciseId) {
  return {
    exerciseId: defaultExerciseId || '',
    weight: '',
    sets: '',
    reps: '',
    date: todayString(),
    note: '',
  }
}

export function WorkoutForm({ exercises, initialValue, defaultExerciseId, onSubmit, onCancel }) {
  const [values, setValues] = useState(initialValue || buildEmpty(defaultExerciseId))
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  function setField(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
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

  const activeExercises = exercises.filter((e) => e.active)

  return (
    <form className="workout-form" onSubmit={handleSubmit}>
      <FormField label="Exercício" error={errors.exerciseId}>
        <select
          value={values.exerciseId}
          onChange={(e) => setField('exerciseId', e.target.value)}
          autoFocus={!defaultExerciseId}
        >
          <option value="">Selecione</option>
          {activeExercises.map((exercise) => (
            <option key={exercise.id} value={exercise.id}>
              {exercise.name}
            </option>
          ))}
        </select>
      </FormField>

      <div className="workout-form__row">
        <FormField label="Peso (kg)" error={errors.weight}>
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={values.weight}
            onChange={(e) => setField('weight', e.target.value)}
          />
        </FormField>

        <FormField label="Séries" error={errors.sets}>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            value={values.sets}
            onChange={(e) => setField('sets', e.target.value)}
          />
        </FormField>

        <FormField label="Repetições" error={errors.reps}>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            value={values.reps}
            onChange={(e) => setField('reps', e.target.value)}
          />
        </FormField>
      </div>

      <FormField label="Data" error={errors.date}>
        <input
          type="date"
          value={values.date}
          onChange={(e) => setField('date', e.target.value)}
        />
      </FormField>

      <FormField label="Observação (opcional)">
        <textarea
          value={values.note}
          onChange={(e) => setField('note', e.target.value)}
          rows={2}
        />
      </FormField>

      <div className="form-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="button button--primary" disabled={submitting}>
          {submitting ? 'Salvando...' : 'Salvar treino'}
        </button>
      </div>
    </form>
  )
}
