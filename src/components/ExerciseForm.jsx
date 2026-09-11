import { useState } from 'react'
import {
  Box,
  Button,
  FormControl,
  TextInput,
  Select,
  Textarea,
  Stack,
  Link,
  Text,
} from '@primer/react'
import { MUSCLE_GROUPS, mergeCustomGroups, resolveMuscleGroup } from '../constants/muscleGroups'
import { validateExercise, hasErrors } from '../utils/validators'
import { EXERCISE_TYPE_LABELS, getExerciseType } from '../utils/exerciseType'

const EMPTY = { name: '', muscleGroup: MUSCLE_GROUPS[0], type: 'strength', note: '', active: true }
const NEW_GROUP_OPTION = '__new__'

export function ExerciseForm({ initialValue, exercises, onSubmit, onCancel }) {
  const [values, setValues] = useState(() =>
    initialValue ? { ...initialValue, type: getExerciseType(initialValue) } : EMPTY
  )
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const muscleGroups = mergeCustomGroups(exercises)

  function setField(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  function handleGroupSelect(value) {
    if (value === NEW_GROUP_OPTION) {
      setCreatingGroup(true)
      setField('muscleGroup', '')
    } else {
      setField('muscleGroup', value)
    }
  }

  function cancelNewGroup() {
    setCreatingGroup(false)
    setField('muscleGroup', muscleGroups[0])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const finalValues = {
      ...values,
      muscleGroup: resolveMuscleGroup(values.muscleGroup, muscleGroups),
    }
    const validationErrors = validateExercise(finalValues)
    setErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      await onSubmit(finalValues)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box
      as="form"
      onSubmit={handleSubmit}
      sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, mb: 3 }}
    >
      <Stack gap="condensed">
        <FormControl required>
          <FormControl.Label>Nome</FormControl.Label>
          <TextInput
            value={values.name}
            onChange={(e) => setField('name', e.target.value)}
            block
            autoFocus
          />
          {errors.name && (
            <FormControl.Validation variant="error">{errors.name}</FormControl.Validation>
          )}
        </FormControl>

        <FormControl required>
          <FormControl.Label>Tipo</FormControl.Label>
          {initialValue ? (
            <>
              <Text sx={{ display: 'block' }}>{EXERCISE_TYPE_LABELS[values.type]}</Text>
              <FormControl.Caption>
                O tipo não pode ser alterado depois de criado.
              </FormControl.Caption>
            </>
          ) : (
            <Select value={values.type} onChange={(e) => setField('type', e.target.value)} block>
              <Select.Option value="strength">Força (séries de peso e repetições)</Select.Option>
              <Select.Option value="cardio">Cardio (duração e distância)</Select.Option>
            </Select>
          )}
        </FormControl>

        <FormControl required>
          <FormControl.Label>Grupo muscular</FormControl.Label>
          {creatingGroup ? (
            <>
              <TextInput
                value={values.muscleGroup}
                onChange={(e) => setField('muscleGroup', e.target.value)}
                placeholder="Nome do novo grupo"
                block
                autoFocus
              />
              <FormControl.Caption>
                <Link as="button" type="button" onClick={cancelNewGroup}>
                  Escolher um grupo existente
                </Link>
              </FormControl.Caption>
            </>
          ) : (
            <Select
              value={values.muscleGroup}
              onChange={(e) => handleGroupSelect(e.target.value)}
              block
            >
              {muscleGroups.map((group) => (
                <Select.Option key={group} value={group}>
                  {group}
                </Select.Option>
              ))}
              <Select.Option value={NEW_GROUP_OPTION}>+ Criar novo grupo…</Select.Option>
            </Select>
          )}
          {errors.muscleGroup && (
            <FormControl.Validation variant="error">{errors.muscleGroup}</FormControl.Validation>
          )}
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

        {initialValue && (
          <FormControl>
            <FormControl.Label>Status</FormControl.Label>
            <Select
              value={values.active ? 'active' : 'inactive'}
              onChange={(e) => setField('active', e.target.value === 'active')}
              block
            >
              <Select.Option value="active">Ativo</Select.Option>
              <Select.Option value="inactive">Inativo</Select.Option>
            </Select>
          </FormControl>
        )}

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
            sx={{ width: ['100%', 'auto'] }}
          >
            Salvar
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}
