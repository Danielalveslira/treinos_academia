import { useEffect, useState } from 'react'
import {
  Box,
  Flash,
  Button,
  FormControl,
  TextInput,
  Textarea,
  Select,
  Stack,
  IconButton,
  Spinner,
  ProgressBar,
  Text,
} from '@primer/react'
import { XIcon, PlusIcon, ImageIcon } from '@primer/octicons-react'
import { MarkdownField } from './MarkdownField'
import { createPhotoStatus } from '../services/statusesService'
import {
  compressImage,
  UnsupportedImageError,
  ALLOWED_INPUT_TYPES,
} from '../utils/imageCompression'
import {
  validateTextStatus,
  validatePollStatus,
  validateWorkoutStatus,
  validatePhotoStatus,
  hasErrors,
} from '../utils/validators'

const TYPES = [
  { value: 'text', label: 'Texto' },
  { value: 'photo', label: 'Foto' },
  { value: 'poll', label: 'Enquete' },
  { value: 'workout', label: 'Treino marcado' },
]

const EMPTY_OPTIONS = ['', '']

// communityId e author só são usados pelo tipo "foto": ao contrário dos outros tipos
// (onde o pai cria o documento a partir de onSubmit), o upload precisa acontecer
// aqui dentro mesmo, porque só quem chama uploadBytesResumable tem acesso à tarefa
// que dá progresso real e permite cancelar — ver createPhotoStatus.
export function StatusForm({ communityId, author, onSubmit, onCancel }) {
  const [type, setType] = useState('text')
  const [text, setText] = useState('')
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(EMPTY_OPTIONS)
  const [workoutTitle, setWorkoutTitle] = useState('')
  const [workoutDate, setWorkoutDate] = useState('')
  const [workoutLocation, setWorkoutLocation] = useState('')
  const [photoBlob, setPhotoBlob] = useState(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null)
  const [compressingPhoto, setCompressingPhoto] = useState(false)
  const [caption, setCaption] = useState('')
  const [uploadProgress, setUploadProgress] = useState(null)
  const [uploadTask, setUploadTask] = useState(null)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl)
    }
  }, [photoPreviewUrl])

  function updateOption(index, value) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)))
  }

  function addOption() {
    if (options.length < 6) setOptions((prev) => [...prev, ''])
  }

  function removeOption(index) {
    setOptions((prev) => prev.filter((_, i) => i !== index))
  }

  function replacePhotoPreview(blob) {
    setPhotoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return blob ? URL.createObjectURL(blob) : null
    })
    setPhotoBlob(blob)
  }

  async function handlePhotoChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setErrors((previous) => ({ ...previous, photo: undefined }))
    setCompressingPhoto(true)
    try {
      const blob = await compressImage(file)
      replacePhotoPreview(blob)
    } catch (error) {
      replacePhotoPreview(null)
      setErrors((previous) => ({
        ...previous,
        photo:
          error instanceof UnsupportedImageError
            ? error.message
            : 'Não foi possível processar a imagem.',
      }))
    } finally {
      setCompressingPhoto(false)
    }
  }

  function handleCancelUpload() {
    uploadTask?.cancel()
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
    } else if (type === 'photo') {
      validationErrors = validatePhotoStatus({ blob: photoBlob, caption })
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
      } else if (type === 'photo') {
        const { task, done } = await createPhotoStatus(
          communityId,
          author,
          { blob: photoBlob, caption },
          { onProgress: setUploadProgress }
        )
        setUploadTask(task)
        const ref = await done
        await onSubmit({ type, ref, blob: photoBlob, caption })
      }
    } catch (error) {
      // storage/canceled vem do botão "Cancelar envio" — não é um erro para o
      // usuário, só volta ao formulário como estava (com a foto ainda selecionada).
      if (error?.code !== 'storage/canceled') {
        setErrors({ form: 'Não foi possível publicar. Tente novamente.' })
      }
    } finally {
      setSubmitting(false)
      setUploadProgress(null)
      setUploadTask(null)
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
            disabled={submitting}
            maxLength={500}
            error={errors.text}
          />
        )}

        {type === 'poll' && (
          <>
            <FormControl required>
              <FormControl.Label>Pergunta</FormControl.Label>
              <TextInput
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={200}
                block
              />
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
                      maxLength={80}
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
                maxLength={100}
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
                maxLength={150}
                block
              />
              {errors.location && (
                <FormControl.Validation variant="error">{errors.location}</FormControl.Validation>
              )}
            </FormControl>
          </>
        )}

        {type === 'photo' && (
          <>
            <FormControl required>
              <FormControl.Label>Foto</FormControl.Label>
              {!photoPreviewUrl ? (
                <>
                  <Box
                    as="label"
                    className="photo-picker"
                    sx={{ opacity: compressingPhoto || submitting ? 0.6 : 1 }}
                  >
                    <ImageIcon size={20} />
                    <span>Escolher foto</span>
                    <input
                      type="file"
                      accept={ALLOWED_INPUT_TYPES.join(',')}
                      onChange={handlePhotoChange}
                      disabled={compressingPhoto || submitting}
                      aria-describedby={errors.photo ? 'photo-error' : undefined}
                    />
                  </Box>
                  {compressingPhoto && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
                      <Spinner size="small" />
                      <Text sx={{ fontSize: 0, color: 'fg.muted' }}>Preparando imagem…</Text>
                    </Box>
                  )}
                </>
              ) : (
                <Box className="photo-preview">
                  <img src={photoPreviewUrl} alt="Prévia da foto selecionada" />
                  <Button
                    type="button"
                    size="small"
                    onClick={() => replacePhotoPreview(null)}
                    disabled={submitting}
                  >
                    Trocar foto
                  </Button>
                </Box>
              )}
              {errors.photo && (
                <FormControl.Validation id="photo-error" variant="error">
                  {errors.photo}
                </FormControl.Validation>
              )}
            </FormControl>
            <FormControl>
              <FormControl.Label>Legenda (opcional)</FormControl.Label>
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={2}
                maxLength={280}
                disabled={submitting}
                block
              />
              {errors.caption && (
                <FormControl.Validation variant="error">{errors.caption}</FormControl.Validation>
              )}
            </FormControl>
            {uploadProgress != null && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <ProgressBar
                  progress={Math.round(uploadProgress * 100)}
                  aria-label="Progresso do envio da foto"
                  bg="accent.emphasis"
                />
                <Box
                  sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Text sx={{ fontSize: 0, color: 'fg.muted' }} aria-live="polite">
                    Enviando… {Math.round(uploadProgress * 100)}%
                  </Text>
                  <Button type="button" size="small" onClick={handleCancelUpload}>
                    Cancelar envio
                  </Button>
                </Box>
              </Box>
            )}
          </>
        )}

        <Box className="community-form-actions">
          <Button type="button" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={submitting || compressingPhoto}
          >
            Publicar
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}
