import { useRef, useState } from 'react'
import { hasErrors } from '../utils/validators'

// Unifica o ciclo values/errors/submitting repetido em ExercisePreferencesForm, CommunityForm e
// BodyMeasurementForm. `prepareSubmit` permite normalizar valores antes de validar/enviar.
export function useFormState({ initialValues, validate, onSubmit, prepareSubmit }) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  function setField(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (submittingRef.current) return
    const finalValues = prepareSubmit ? prepareSubmit(values) : values
    const validationErrors = validate(finalValues)
    setErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    submittingRef.current = true
    setSubmitting(true)
    try {
      await onSubmit(finalValues)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return { values, setValues, setField, errors, submitting, handleSubmit }
}
