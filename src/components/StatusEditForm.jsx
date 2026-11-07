import { useState } from 'react'
import { Box, Button, Text, Textarea } from '@primer/react'
import { updateStatusContent } from '../services/statusesService'
import { STATUS_TEXT_MAX_LENGTH } from '../utils/statusLimits'
import { describeStatusEditError } from '../utils/statusEditError'

const CAPTION_MAX_LENGTH = 280

// Só texto e legenda de foto editam nesta primeira entrega (ver StatusCard: o botão "Editar"
// só aparece para esses dois tipos) -- enquete, treino marcado e conquista continuam somente
// leitura, então este formulário nunca recebe outro status.type.
export function StatusEditForm({ status, onCancel, onSaved }) {
  const isText = status.type === 'text'
  const maxLength = isText ? STATUS_TEXT_MAX_LENGTH : CAPTION_MAX_LENGTH
  const [value, setValue] = useState((isText ? status.text : status.caption) || '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (pending) return
    const trimmed = value.trim()
    if (isText && !trimmed) {
      setError('Escreva algo para publicar.')
      return
    }
    if (trimmed.length > maxLength) {
      setError('Texto muito longo.')
      return
    }
    setPending(true)
    setError('')
    try {
      const updated = await updateStatusContent(status.id, {
        text: isText ? trimmed : null,
        photoCaption: isText ? null : trimmed,
        expectedEditedAt: status.editedAt ?? null,
      })
      onSaved(
        isText
          ? { text: updated.text, editedAt: updated.edited_at }
          : { caption: updated.photo_caption, editedAt: updated.edited_at }
      )
    } catch (err) {
      setError(describeStatusEditError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Box className="status-edit-form">
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={isText ? 5 : 2}
        maxLength={maxLength}
        disabled={pending}
        aria-label={isText ? 'Editar publicação' : 'Editar legenda da foto'}
        block
      />
      {error && (
        <Text className="status-edit-error" role="alert">
          {error}
        </Text>
      )}
      <Box className="status-edit-actions">
        <Button size="small" variant="invisible" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button
          size="small"
          variant="primary"
          onClick={handleSave}
          loading={pending}
          disabled={pending}
        >
          Salvar alterações
        </Button>
      </Box>
    </Box>
  )
}
