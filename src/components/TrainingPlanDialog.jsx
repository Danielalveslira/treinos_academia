import { useState } from 'react'
import { Button, Dialog, Flash, FormControl, TextInput } from '@primer/react'
import {
  getDeviceTimezone,
  normalizeTrainingPreferences,
  TRAINING_WEEKDAYS,
} from '../utils/trainingPlan'

export function TrainingPlanDialog({ preferences, onSave, onClose }) {
  const initial = normalizeTrainingPreferences(preferences)
  const [selectedDays, setSelectedDays] = useState(() => new Set(initial.plannedTrainingDays))
  const [reminderEnabled, setReminderEnabled] = useState(initial.reminderEnabled)
  const [reminderTime, setReminderTime] = useState(initial.reminderTime || '18:00')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleDay(day) {
    setSelectedDays((current) => {
      const next = new Set(current)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({
        plannedTrainingDays: TRAINING_WEEKDAYS.map((day) => day.id).filter((day) =>
          selectedDays.has(day)
        ),
        reminderEnabled,
        reminderTime: reminderEnabled ? reminderTime : null,
        timezone: initial.timezone || getDeviceTimezone(),
      })
      onClose()
    } catch (saveError) {
      console.error('[TrainingPlanDialog] save:', saveError)
      setError('Não foi possível salvar o planejamento. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title="Planejar semana" onClose={onClose} width="medium">
      <form className="training-plan-form" onSubmit={handleSubmit}>
        <p>
          Escolha os dias em que pretende treinar. Os demais serão tratados como recuperação
          planejada.
        </p>
        <fieldset className="training-plan-days" disabled={saving}>
          <legend>Dias de treino</legend>
          {TRAINING_WEEKDAYS.map((day) => (
            <label key={day.id} className={selectedDays.has(day.id) ? 'is-selected' : ''}>
              <input
                type="checkbox"
                checked={selectedDays.has(day.id)}
                onChange={() => toggleDay(day.id)}
              />
              <span aria-hidden="true">{day.short}</span>
              <span className="sr-only">{day.label}</span>
            </label>
          ))}
        </fieldset>

        <label className="training-reminder-toggle">
          <input
            type="checkbox"
            checked={reminderEnabled}
            disabled={saving}
            onChange={(event) => setReminderEnabled(event.target.checked)}
          />
          <span>Lembrar na Home em um horário preferido</span>
        </label>

        {reminderEnabled && (
          <FormControl required disabled={saving}>
            <FormControl.Label>Horário preferido</FormControl.Label>
            <TextInput
              type="time"
              value={reminderTime}
              onChange={(event) => setReminderTime(event.target.value)}
            />
            <FormControl.Caption>
              O MVP adapta a mensagem da Home; não envia notificação push.
            </FormControl.Caption>
          </FormControl>
        )}

        <small className="training-plan-timezone">
          Fuso horário: {initial.timezone || getDeviceTimezone()}
        </small>
        {error && <Flash variant="danger">{error}</Flash>}
        <div className="training-plan-actions">
          <Button type="button" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar planejamento'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
