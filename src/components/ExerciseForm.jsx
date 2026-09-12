import { useState } from 'react'
import { FormControl, TextInput, Select, Textarea, Link, Text } from '@primer/react'
import { MUSCLE_GROUPS, mergeCustomGroups, resolveMuscleGroup } from '../constants/muscleGroups'
import { validateExercise } from '../utils/validators'
import { EXERCISE_TYPE_LABELS, getExerciseType } from '../utils/exerciseType'
import { useFormState } from '../hooks/useFormState'
import { FormShell } from './FormShell'

const EMPTY = { name: '', muscleGroup: MUSCLE_GROUPS[0], type: 'strength', note: '', active: true }
const NEW_GROUP_OPTION = '__new__'

export function ExerciseForm({ initialValue, exercises, onSubmit, onCancel }) {
  const [creatingGroup, setCreatingGroup] = useState(false)
  const muscleGroups = mergeCustomGroups(exercises)

  const { values, setField, errors, submitting, handleSubmit } = useFormState({
    initialValues: () =>
      initialValue ? { ...initialValue, type: getExerciseType(initialValue) } : EMPTY,
    prepareSubmit: (v) => ({ ...v, muscleGroup: resolveMuscleGroup(v.muscleGroup, muscleGroups) }),
    validate: validateExercise,
    onSubmit,
  })

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

  return (
    <FormShell onSubmit={handleSubmit} onCancel={onCancel} submitting={submitting}>
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
    </FormShell>
  )
}
