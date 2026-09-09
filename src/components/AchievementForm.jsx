import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Flash,
  FormControl,
  Heading,
  Text,
  Spinner,
  Stack,
  Textarea,
} from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { getWorkoutStatistics } from '../services/workoutsService'
import { localDayKey, validateAchievement } from '../utils/achievements'
import { AchievementSummary } from './AchievementSummary'

export function AchievementForm({ onSubmit, onCancel }) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const saving = useRef(false)
  useEffect(() => {
    let active = true
    const day = localDayKey()
    getWorkoutStatistics(user.uid, day)
      .then((totals) => {
        if (active) setPreview({ ...totals, day })
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os totais. Tente novamente.')
      })
    return () => {
      active = false
    }
  }, [user.uid, attempt])
  function reload() {
    setPreview(null)
    setError('')
    setAttempt((n) => n + 1)
  }
  async function submit(e) {
    e.preventDefault()
    if (!preview || saving.current) return
    const achievement = { ...preview, text: text.trim() }
    const validation = validateAchievement(achievement)
    if (validation) {
      setError(validation)
      return
    }
    saving.current = true
    setSubmitting(true)
    setError('')
    try {
      await onSubmit({ type: 'achievement', achievement })
    } catch {
      setError('Não foi possível publicar. Sua conquista foi mantida para tentar novamente.')
    } finally {
      saving.current = false
      setSubmitting(false)
    }
  }
  return (
    <Box
      as="form"
      onSubmit={submit}
      sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, mb: 4 }}
    >
      <Stack gap="condensed">
        <Box>
          <Heading as="h2" sx={{ fontSize: 2, mb: 1 }}>
            Sua conquista de hoje
          </Heading>
          <Text sx={{ color: 'fg.muted', fontSize: 1, display: 'block' }}>
            Compartilhe um passo importante da sua jornada.
          </Text>
        </Box>

        {error && (
          <Flash variant="danger" role="alert">
            {error}
          </Flash>
        )}
        {!preview && !error && <Spinner aria-label="Carregando conquistas" />}
        {preview && (
          <Box aria-label="Prévia da conquista">
            <AchievementSummary achievement={{ ...preview, text }} />
          </Box>
        )}
        <FormControl disabled={submitting}>
          <FormControl.Label>Qual foi sua conquista?</FormControl.Label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ex.: Voltei a treinar depois de uma semana!"
            rows={3}
            maxLength={300}
            block
          />
          <FormControl.Caption>{text.length}/300 caracteres</FormControl.Caption>
        </FormControl>
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
          A mensagem e os totais acima ficarão visíveis nesta comunidade por 24 horas, mesmo com as
          estatísticas do perfil privadas. Você pode excluir a publicação depois.
        </Text>
        <Box
          sx={{
            display: 'flex',
            flexDirection: ['column-reverse', 'row'],
            gap: 2,
            justifyContent: ['stretch', 'flex-end'],
          }}
        >
          <Button
            type="button"
            onClick={reload}
            disabled={submitting}
            sx={{ width: ['100%', 'auto'] }}
          >
            Atualizar prévia
          </Button>
          <Button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            sx={{ width: ['100%', 'auto'] }}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={!preview || submitting}
            sx={{ width: ['100%', 'auto'] }}
          >
            Compartilhar conquista
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}
