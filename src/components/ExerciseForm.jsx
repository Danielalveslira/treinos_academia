import { useState } from 'react'
import { MUSCLE_GROUPS } from '../constants/muscleGroups'
import { validateExercise, hasErrors } from '../utils/validators'
import { FormField } from './FormField'

const EMPTY = { name: '', muscleGroup: MUSCLE_GROUPS[0], note: '', active: true }

export function ExerciseForm({ initialValue, onSubmit, onCancel }) {
  const [values, setValues] = useState(initialValue || EMPTY)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  function setField(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const validationErrors = validateExercise(values)
    setErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      await onSubmit(values)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="exercise-form" onSubmit={handleSubmit}>
      <FormField label="Nome" error={errors.name}>
        <input
          value={values.name}
          onChange={(e) => setField('name', e.target.value)}
          autoFocus
        />
      </FormField>

      <FormField label="Grupo muscular" error={errors.muscleGroup}>
        <select
          value={values.muscleGroup}
          onChange={(e) => setField('muscleGroup', e.target.value)}
        >
          {MUSCLE_GROUPS.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Observação (opcional)">
        <textarea
          value={values.note}
          onChange={(e) => setField('note', e.target.value)}
          rows={2}
        />
      </FormField>

      {initialValue && (
        <FormField label="Status">
          <select
            value={values.active ? 'active' : 'inactive'}
            onChange={(e) => setField('active', e.target.value === 'active')}
          >
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
        </FormField>
      )}

      <div className="form-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="button button--primary" disabled={submitting}>
          {submitting ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}
