import { useState } from 'react'
import { Box, Button, FormControl, TextInput, Select, Textarea, Stack } from '@primer/react'
import { validateWorkout, hasErrors } from '../utils/validators'

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
    <Box as="form" onSubmit={handleSubmit}>
      <Stack gap="condensed">
        <FormControl required>
          <FormControl.Label>Exercício</FormControl.Label>
          <Select
            value={values.exerciseId}
            onChange={(e) => setField('exerciseId', e.target.value)}
            block
            autoFocus={!defaultExerciseId}
          >
            <Select.Option value="">Selecione</Select.Option>
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

        <Stack direction="horizontal" gap="condensed" wrap="wrap">
          <Box sx={{ flex: '1 1 90px' }}>
            <FormControl required>
              <FormControl.Label>Peso (kg)</FormControl.Label>
              <TextInput
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0"
                value={values.weight}
                onChange={(e) => setField('weight', e.target.value)}
                block
              />
              {errors.weight && <FormControl.Validation variant="error">{errors.weight}</FormControl.Validation>}
            </FormControl>
          </Box>

          <Box sx={{ flex: '1 1 90px' }}>
            <FormControl required>
              <FormControl.Label>Séries</FormControl.Label>
              <TextInput
                type="number"
                inputMode="numeric"
                min="1"
                value={values.sets}
                onChange={(e) => setField('sets', e.target.value)}
                block
              />
              {errors.sets && <FormControl.Validation variant="error">{errors.sets}</FormControl.Validation>}
            </FormControl>
          </Box>

          <Box sx={{ flex: '1 1 90px' }}>
            <FormControl required>
              <FormControl.Label>Repetições</FormControl.Label>
              <TextInput
                type="number"
                inputMode="numeric"
                min="1"
                value={values.reps}
                onChange={(e) => setField('reps', e.target.value)}
                block
              />
              {errors.reps && <FormControl.Validation variant="error">{errors.reps}</FormControl.Validation>}
            </FormControl>
          </Box>
        </Stack>

        <FormControl required>
          <FormControl.Label>Data</FormControl.Label>
          <TextInput
            type="date"
            value={values.date}
            onChange={(e) => setField('date', e.target.value)}
            block
          />
          {errors.date && <FormControl.Validation variant="error">{errors.date}</FormControl.Validation>}
        </FormControl>

        <FormControl>
          <FormControl.Label>Observação (opcional)</FormControl.Label>
          <Textarea
            value={values.note}
            onChange={(e) => setField('note', e.target.value)}
            rows={2}
            block
          />
        </FormControl>

        <Stack direction="horizontal" justify="end" gap="condensed">
          <Button type="button" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            Salvar treino
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
