import { useEffect, useRef, useState } from 'react'
import { Box, Button, Flash, Heading, Text, Spinner, Stack } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { getWorkoutStatistics } from '../services/workoutsService'
import { localDayKey, validateAchievement } from '../utils/achievements'
import { AchievementSummary } from './AchievementSummary'
import { MarkdownField } from './MarkdownField'

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
    <Box as="form" className="community-form" onSubmit={submit}>
      <Stack gap="condensed">
        <Box>
          {preview?.entries > 0 && (
            <Heading as="h2" sx={{ fontSize: 2, mb: 1 }}>
              Sua conquista de hoje
            </Heading>
          )}
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
        {preview?.entries > 0 && <AchievementSummary achievement={preview} />}
        <MarkdownField
          label="Qual foi sua conquista?"
          value={text}
          onChange={setText}
          disabled={submitting}
          placeholder="Ex.: Voltei a treinar depois de uma semana!"
          maxLength={300}
        />
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
          {preview?.entries > 0
            ? 'A mensagem e os totais acima ficarão visíveis nesta comunidade por 24 horas, mesmo com as estatísticas do perfil privadas.'
            : 'A mensagem ficará visível nesta comunidade por 24 horas.'}{' '}
          Você pode excluir a publicação depois.
        </Text>
        <Box className="community-form-actions">
          <Button
            type="button"
            onClick={reload}
            disabled={submitting}
            variant="invisible"
            className="community-preview-refresh"
          >
            Atualizar prévia
          </Button>
          <Button type="button" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={!preview || submitting}
          >
            Compartilhar
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}
