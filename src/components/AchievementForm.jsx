import { useEffect, useRef, useState } from 'react'
import { Button, Flash, FormControl, Spinner, Textarea } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { getWorkoutStatistics } from '../services/workoutsService'
import { localDayKey, validateAchievement } from '../utils/achievements'

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
    <form onSubmit={submit} className="profile-card profile-form">
      <div>
        <h2 style={{ margin: 0, fontSize: 18 }}>Sua conquista de hoje</h2>
        <p>Compartilhe um passo importante da sua jornada.</p>
      </div>
      {error && (
        <Flash variant="danger" role="alert">
          {error}
        </Flash>
      )}
      {!preview && !error && <Spinner aria-label="Carregando conquistas" />}
      {preview && (
        <section className="achievement-card" aria-label="Prévia da conquista">
          <span className="profile-eyebrow">
            {new Date(`${preview.day}T12:00:00`).toLocaleDateString('pt-BR')}
          </span>
          <div className="achievement-totals">
            <span>
              <strong>{preview.entries}</strong> registros de exercícios
            </span>
            <span>
              <strong>{preview.sets}</strong> séries realizadas
            </span>
          </div>
          {text && <p>{text}</p>}
        </section>
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
          sx={{ fontSize: 2 }}
        />
        <FormControl.Caption>{text.length}/300 caracteres</FormControl.Caption>
      </FormControl>
      <p style={{ margin: 0, fontSize: 12 }}>
        A mensagem e os totais acima ficarão visíveis nesta comunidade por 24 horas, mesmo com as
        estatísticas do perfil privadas. Você pode excluir a publicação depois.
      </p>
      <div className="profile-form-footer">
        <Button type="button" onClick={reload} disabled={submitting}>
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
          Compartilhar conquista
        </Button>
      </div>
    </form>
  )
}
