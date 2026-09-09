import { useState } from 'react'
import { Box, Button, FormControl, TextInput, Select, Textarea, Stack } from '@primer/react'
import { validateCommunity, hasErrors } from '../utils/validators'

const EMPTY = { name: '', description: '' }

export function CommunityForm({ initialValue, onSubmit, onCancel }) {
  const [values, setValues] = useState(initialValue || EMPTY)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  function setField(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const validationErrors = validateCommunity(values)
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

        <FormControl>
          <FormControl.Label>Descrição</FormControl.Label>
          <Textarea
            value={values.description}
            onChange={(e) => setField('description', e.target.value)}
            rows={2}
            block
          />
          {errors.description && (
            <FormControl.Validation variant="error">{errors.description}</FormControl.Validation>
          )}
        </FormControl>

        {initialValue && (
          <FormControl>
            <FormControl.Label>Status</FormControl.Label>
            <Select
              value={values.isActive ? 'active' : 'inactive'}
              onChange={(e) => setField('isActive', e.target.value === 'active')}
              block
            >
              <Select.Option value="active">Ativa</Select.Option>
              <Select.Option value="inactive">Inativa</Select.Option>
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
