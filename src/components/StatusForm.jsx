import { useState } from 'react'
import {
  Box,
  Flash,
  Button,
  FormControl,
  TextInput,
  Select,
  Stack,
  IconButton,
} from '@primer/react'
import { XIcon, PlusIcon } from '@primer/octicons-react'
import { MarkdownField } from './MarkdownField'
import {
  validateTextStatus,
  validatePollStatus,
  validateWorkoutStatus,
  hasErrors,
} from '../utils/validators'

const TYPES = [
  { value: 'text', label: 'Texto' },
  { value: 'poll', label: 'Enquete' },
  { value: 'workout', label: 'Treino marcado' },
]

const EMPTY_OPTIONS = ['', '']

export function StatusForm({ onSubmit, onCancel }) {
  const [type, setType] = useState('text')
  const [text, setText] = useState('')
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(EMPTY_OPTIONS)
  const [workoutTitle, setWorkoutTitle] = useState('')
  const [workoutDate, setWorkoutDate] = useState('')
  const [workoutLocation, setWorkoutLocation] = useState('')
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  function updateOption(index, value) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)))
  }

  function addOption() {
    if (options.length < 6) setOptions((prev) => [...prev, ''])
  }

  function removeOption(index) {
    setOptions((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return

    let validationErrors = {}
    if (type === 'text') validationErrors = validateTextStatus({ text })
    else if (type === 'poll') validationErrors = validatePollStatus({ question, options })
    else if (type === 'workout') {
      validationErrors = validateWorkoutStatus({
        title: workoutTitle,
        date: workoutDate,
        location: workoutLocation,
      })
    }
    setErrors(validationErrors)
    if (hasErrors(validationErrors)) return

    setSubmitting(true)
    try {
      if (type === 'text') await onSubmit({ type, text })
      else if (type === 'poll') {
        await onSubmit({ type, question, options: options.filter((o) => o.trim()) })
      } else if (type === 'workout') {
        await onSubmit({
          type,
          title: workoutTitle,
          date: workoutDate,
          location: workoutLocation,
        })
      }
    } catch {
      setErrors({ form: 'Não foi possível publicar. Tente novamente.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box as="form" className="community-form" onSubmit={handleSubmit}>
      <Stack gap="condensed">
        {errors.form && (
          <Flash variant="danger" role="alert">
            {errors.form}
          </Flash>
        )}
        <FormControl>
          <FormControl.Label>Tipo de publicação</FormControl.Label>
          <Select value={type} onChange={(e) => setType(e.target.value)} block>
            {TYPES.map((t) => (
              <Select.Option key={t.value} value={t.value}>
                {t.label}
              </Select.Option>
            ))}
          </Select>
        </FormControl>

        {type === 'text' && (
          <MarkdownField
            label="O que você quer compartilhar?"
            value={text}
            onChange={setText}
            required
            rows={4}
            maxLength={500}
            error={errors.text}
          />
        )}

        {type === 'poll' && (
          <>
            <FormControl required>
              <FormControl.Label>Pergunta</FormControl.Label>
              <TextInput value={question} onChange={(e) => setQuestion(e.target.value)} block />
              {errors.question && (
                <FormControl.Validation variant="error">{errors.question}</FormControl.Validation>
              )}
            </FormControl>
            <FormControl>
              <FormControl.Label>Opções</FormControl.Label>
              <Stack gap="condensed">
                {options.map((option, index) => (
                  <Box key={index} sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <TextInput
                      value={option}
                      onChange={(e) => updateOption(index, e.target.value)}
                      placeholder={`Opção ${index + 1}`}
                      block
                    />
                    {options.length > 2 && (
                      <IconButton
                        icon={XIcon}
                        variant="invisible"
                        aria-label="Remover opção"
                        onClick={() => removeOption(index)}
                      />
                    )}
                  </Box>
                ))}
              </Stack>
              {errors.options && (
                <FormControl.Validation variant="error">{errors.options}</FormControl.Validation>
              )}
              {options.length < 6 && (
                <Button
                  type="button"
                  size="small"
                  leadingVisual={PlusIcon}
                  onClick={addOption}
                  sx={{ mt: 2 }}
                >
                  Adicionar opção
                </Button>
              )}
            </FormControl>
          </>
        )}

        {type === 'workout' && (
          <>
            <FormControl required>
              <FormControl.Label>Título</FormControl.Label>
              <TextInput
                value={workoutTitle}
                onChange={(e) => setWorkoutTitle(e.target.value)}
                placeholder="Ex.: Peito + Tríceps"
                block
              />
              {errors.title && (
                <FormControl.Validation variant="error">{errors.title}</FormControl.Validation>
              )}
            </FormControl>
            <FormControl required>
              <FormControl.Label>Data e hora</FormControl.Label>
              <TextInput
                type="datetime-local"
                value={workoutDate}
                onChange={(e) => setWorkoutDate(e.target.value)}
                block
              />
              {errors.date && (
                <FormControl.Validation variant="error">{errors.date}</FormControl.Validation>
              )}
            </FormControl>
            <FormControl required>
              <FormControl.Label>Local</FormControl.Label>
              <TextInput
                value={workoutLocation}
                onChange={(e) => setWorkoutLocation(e.target.value)}
                placeholder="Ex.: Academia X"
                block
              />
              {errors.location && (
                <FormControl.Validation variant="error">{errors.location}</FormControl.Validation>
              )}
            </FormControl>
          </>
        )}

        <Box className="community-form-actions">
          <Button type="button" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            Publicar
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}
