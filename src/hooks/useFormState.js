import { useState } from 'react'
import { hasErrors } from '../utils/validators'

// Unifica o ciclo values/errors/submitting repetido em ExerciseForm, CommunityForm e
// BodyMeasurementForm. `prepareSubmit` é opcional — só o ExerciseForm precisa dele hoje,
// para resolver um grupo muscular novo antes de validar/enviar.
export function useFormState({ initialValues, validate, onSubmit, prepareSubmit }) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  function setField(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const finalValues = prepareSubmit ? prepareSubmit(values) : values
    const validationErrors = validate(finalValues)
    setErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      await onSubmit(finalValues)
    } finally {
      setSubmitting(false)
    }
  }

  return { values, setValues, setField, errors, submitting, handleSubmit }
}
