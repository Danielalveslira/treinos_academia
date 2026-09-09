import { useRef, useState } from 'react'
import { Box, Button, FormControl, TextInput, Select, Textarea, Stack, Text } from '@primer/react'
import { validateWorkout, hasErrors } from '../utils/validators'

import { getWorkoutSets, MAX_WORKOUT_SETS, isValidSet } from '../utils/workoutSets'
import { calculateVolume } from '../utils/calculations'

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

function buildEmpty(defaultExerciseId) {
  return {
    exerciseId: defaultExerciseId || '',
    setDetails: [{ weight: '', reps: '' }],
    date: todayString(),
    note: '',
  }
}

export function WorkoutForm({ exercises, initialValue, defaultExerciseId, onSubmit, onCancel }) {
  const nextSetId = useRef(0)
  const [values, setValues] = useState(() => {
    const value = initialValue || buildEmpty(defaultExerciseId)
    return {
      ...value,
      setDetails: getWorkoutSets(value).map((set) => ({ ...set, key: nextSetId.current++ })),
    }
  })
  const pendingFocus = useRef(null)

  function changeSets(change, focusKey) {
    pendingFocus.current = focusKey
    setValues((previous) => ({ ...previous, setDetails: change(previous.setDetails) }))
    setErrors({})
  }

  function addSet(repeat = false) {
    const key = nextSetId.current++
    changeSets(
      (sets) => [...sets, { ...(repeat ? sets.at(-1) : { weight: '', reps: '' }), key }],
      key
    )
  }

  function moveSet(index, offset) {
    changeSets((sets) => {
      const reordered = [...sets]
      ;[reordered[index], reordered[index + offset]] = [reordered[index + offset], reordered[index]]
      return reordered
    }, values.setDetails[index].key)
  }
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

  const activeExercises = exercises.filter((e) => e.active || e.id === initialValue?.exerciseId)

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

        <Box as="fieldset" disabled={submitting} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
          <Text as="legend" sx={{ fontWeight: 'bold', mb: 2 }}>
            Séries
          </Text>
          <Stack gap="condensed">
            {values.setDetails.map((set, index) => (
              <Box
                as="fieldset"
                key={set.key}
                sx={{
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 2,
                  p: 2,
                  m: 0,
                  minWidth: 0,
                }}
              >
                <Text as="legend" sx={{ fontSize: 1 }}>
                  Série {index + 1}
                </Text>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                    gap: 2,
                  }}
                >
                  {['weight', 'reps'].map((field) => (
                    <FormControl key={field} required>
                      <FormControl.Label>
                        {field === 'weight' ? 'Peso (kg)' : 'Repetições'}
                      </FormControl.Label>
                      <TextInput
                        ref={
                          field === 'weight'
                            ? (node) => {
                                if (node && pendingFocus.current === set.key) {
                                  node.focus()
                                  pendingFocus.current = null
                                }
                              }
                            : undefined
                        }
                        type="number"
                        inputMode={field === 'weight' ? 'decimal' : 'numeric'}
                        min={field === 'weight' ? 0 : 1}
                        max={field === 'weight' ? 10000 : 100000}
                        step={field === 'weight' ? 'any' : 1}
                        value={set[field]}
                        aria-label={`${field === 'weight' ? 'Peso (kg)' : 'Repetições'}, série ${index + 1}`}
                        aria-invalid={!!errors[`set${index}`]}
                        aria-describedby={
                          errors[`set${index}`] ? `set-error-${set.key}` : undefined
                        }
                        onChange={(e) =>
                          changeSets((sets) =>
                            sets.map((item) =>
                              item.key === set.key ? { ...item, [field]: e.target.value } : item
                            )
                          )
                        }
                        block
                      />
                    </FormControl>
                  ))}
                </Box>
                {errors[`set${index}`] && (
                  <Text
                    as="p"
                    id={`set-error-${set.key}`}
                    role="alert"
                    sx={{ color: 'danger.fg', fontSize: 0 }}
                  >
                    {errors[`set${index}`]}
                  </Text>
                )}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
                  <Button
                    type="button"
                    size="small"
                    aria-label={`Mover série ${index + 1} para cima`}
                    disabled={index === 0}
                    onClick={() => moveSet(index, -1)}
                  >
                    ↑ Subir
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    aria-label={`Mover série ${index + 1} para baixo`}
                    disabled={index === values.setDetails.length - 1}
                    onClick={() => moveSet(index, 1)}
                  >
                    ↓ Descer
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant="danger"
                    aria-label={`Remover série ${index + 1}`}
                    disabled={values.setDetails.length === 1}
                    onClick={() =>
                      changeSets(
                        (sets) => sets.filter((item) => item.key !== set.key),
                        values.setDetails[index === 0 ? 1 : index - 1]?.key
                      )
                    }
                  >
                    Remover
                  </Button>
                </Box>
              </Box>
            ))}
            {errors.setDetails && (
              <Text role="alert" sx={{ color: 'danger.fg' }}>
                {errors.setDetails}
              </Text>
            )}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <Button
                type="button"
                disabled={values.setDetails.length >= MAX_WORKOUT_SETS}
                onClick={() => addSet()}
              >
                Adicionar série
              </Button>
              <Button
                type="button"
                disabled={!values.setDetails.length || values.setDetails.length >= MAX_WORKOUT_SETS}
                onClick={() => addSet(true)}
              >
                Repetir série
              </Button>
            </Box>
            <Text sx={{ fontSize: 0, color: 'fg.muted' }} aria-live="polite">
              {values.setDetails.length} / {MAX_WORKOUT_SETS} séries · Volume total:{' '}
              {values.setDetails.every(isValidSet)
                ? calculateVolume(values).toLocaleString('pt-BR')
                : '—'}{' '}
              kg
            </Text>
          </Stack>
        </Box>

        <FormControl required>
          <FormControl.Label>Data</FormControl.Label>
          <TextInput
            type="date"
            value={values.date}
            onChange={(e) => setField('date', e.target.value)}
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
            onChange={(e) => setField('note', e.target.value)}
            rows={2}
            maxLength={300}
            block
          />
          {errors.note && (
            <FormControl.Validation variant="error">{errors.note}</FormControl.Validation>
          )}
        </FormControl>

        <Box
          sx={{
            display: 'flex',
            flexDirection: ['column-reverse', 'row'],
            gap: 2,
            justifyContent: ['stretch', 'flex-end'],
          }}
        >
          <Button type="button" onClick={onCancel} sx={{ width: ['100%', 'auto'] }}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={submitting}
            sx={{ width: ['100%', 'auto'] }}
          >
            Salvar treino
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}
