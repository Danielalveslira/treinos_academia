import { FormControl, Textarea, Select, Text } from '@primer/react'
import { useFormState } from '../hooks/useFormState'
import { validateExercisePreferences } from '../utils/validators'
import { FormShell } from './FormShell'

export function ExercisePreferencesForm({ initialValue, onSubmit, onCancel }) {
  const { values, setField, errors, submitting, handleSubmit } = useFormState({
    initialValues: () => ({ note: initialValue.note || '', active: initialValue.active }),
    validate: validateExercisePreferences,
    onSubmit,
  })
  return (
    <FormShell onSubmit={handleSubmit} onCancel={onCancel} submitting={submitting}>
      <Text as="p">{initialValue.name}</Text>
      <FormControl>
        <FormControl.Label>Observação pessoal (opcional)</FormControl.Label>
        <Textarea
          block
          autoFocus
          rows={2}
          maxLength={300}
          value={values.note}
          onChange={(event) => setField('note', event.target.value)}
        />
        <FormControl.Caption>Use para o treino; evite diagnósticos e outros dados médicos.</FormControl.Caption>
        {errors.note && (
          <FormControl.Validation variant="error">{errors.note}</FormControl.Validation>
        )}
      </FormControl>
      <FormControl>
        <FormControl.Label>Status na biblioteca</FormControl.Label>
        <Select
          value={values.active ? 'active' : 'inactive'}
          block
          onChange={(event) => setField('active', event.target.value === 'active')}
        >
          <Select.Option value="active">Ativo</Select.Option>
          <Select.Option value="inactive">Inativo</Select.Option>
        </Select>
      </FormControl>
    </FormShell>
  )
}
