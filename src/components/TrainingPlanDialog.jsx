import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Flash } from '@primer/react'
import {
  getDeviceTimezone,
  isValidTrainingTime,
  normalizeTrainingPreferences,
  TRAINING_WEEKDAYS,
} from '../utils/trainingPlan'

export function TrainingPlanDialog({ preferences, onSave, onClose }) {
  const dialogRef = useRef(null)
  const initialFocusRef = useRef(null)
  const initial = normalizeTrainingPreferences(preferences)
  const [selectedDays, setSelectedDays] = useState(() => new Set(initial.plannedTrainingDays))
  const [reminderEnabled, setReminderEnabled] = useState(initial.reminderEnabled)
  const [weeklyTimes, setWeeklyTimes] = useState(initial.weeklyTimes)
  const [copyFrom, setCopyFrom] = useState('')
  const [copyTargets, setCopyTargets] = useState(() => new Set())
  const [overwriteTimes, setOverwriteTimes] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const copyWouldOverwrite = [...copyTargets].some(
    (day) =>
      day !== copyFrom &&
      selectedDays.has(TRAINING_WEEKDAYS[Number(day) - 1]?.id) &&
      Boolean(weeklyTimes[day])
  )

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return undefined
    const syncHeight = () =>
      dialogRef.current?.style.setProperty('--training-viewport-height', `${viewport.height}px`)
    syncHeight()
    viewport.addEventListener('resize', syncHeight)
    return () => viewport.removeEventListener('resize', syncHeight)
  }, [])

  function toggleDay(day) {
    setSelectedDays((current) => {
      const next = new Set(current)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  function copyTime() {
    if (!copyFrom || !weeklyTimes[copyFrom]) return
    const targets = [...copyTargets].filter(
      (day) => selectedDays.has(TRAINING_WEEKDAYS[Number(day) - 1]?.id) && day !== copyFrom
    )
    if (copyWouldOverwrite && !overwriteTimes) return
    setWeeklyTimes((current) =>
      Object.fromEntries([
        ...Object.entries(current),
        ...targets.map((day) => [day, current[copyFrom]]),
      ])
    )
    setCopyTargets(new Set())
    setOverwriteTimes(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const activeTimes = Object.fromEntries(
        Object.entries(weeklyTimes).filter(
          ([day, time]) => selectedDays.has(TRAINING_WEEKDAYS[Number(day) - 1]?.id) && time
        )
      )
      if (Object.values(activeTimes).some((time) => !isValidTrainingTime(time))) {
        setError('Confira os horários. Use o formato HH:mm.')
        return
      }
      await onSave({
        plannedTrainingDays: TRAINING_WEEKDAYS.map((day) => day.id).filter((day) =>
          selectedDays.has(day)
        ),
        reminderEnabled,
        weeklyTimes: activeTimes,
        timezone: getDeviceTimezone(),
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
    <Dialog
      ref={dialogRef}
      className="training-plan-dialog"
      title="Planejamento de treinos"
      subtitle="Organize seus dias e horários da semana."
      onClose={onClose}
      width="xlarge"
      position={{ narrow: 'fullscreen', regular: 'center' }}
      initialFocusRef={initialFocusRef}
      renderFooter={() => (
        <Dialog.Footer className="training-plan-footer">
          <Button type="button" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="training-plan-form" variant="primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar planejamento'}
          </Button>
        </Dialog.Footer>
      )}
    >
      <form id="training-plan-form" className="training-plan-form" onSubmit={handleSubmit}>
        <fieldset className="training-plan-days" disabled={saving}>
          <legend>Dias de treino</legend>
          <small>
            Escolha os dias em que pretende treinar. Os demais serão dias de recuperação.
          </small>
          {TRAINING_WEEKDAYS.map((day) => (
            <label key={day.id} className={selectedDays.has(day.id) ? 'is-selected' : ''}>
              <input
                ref={day.id === 'monday' ? initialFocusRef : undefined}
                type="checkbox"
                checked={selectedDays.has(day.id)}
                onChange={() => toggleDay(day.id)}
              />
              <span aria-hidden="true">{day.short}</span>
              <span className="sr-only">{day.label}</span>
            </label>
          ))}
        </fieldset>

        <div className="training-plan-reminders">
          <strong>Lembretes</strong>
          <label className="training-reminder-toggle">
            <input
              type="checkbox"
              checked={reminderEnabled}
              disabled={saving}
              onChange={(event) => setReminderEnabled(event.target.checked)}
            />
            <span>Lembrar na Home e receber Push</span>
          </label>
          {reminderEnabled && (
            <small>
              Um aviso uma hora antes e outro no horário configurado, se o treino ainda não começou.
              Push exige ativação nas notificações deste dispositivo.
            </small>
          )}
        </div>

        <div className="training-plan-times">
          <strong>Horários preferidos</strong>
          <small>Opcional. Cada horário vale apenas para o dia de treino correspondente.</small>
          {TRAINING_WEEKDAYS.map((day, index) => {
            const active = selectedDays.has(day.id)
            const key = String(index + 1)
            return (
              <label key={day.id} className="training-plan-time-row">
                <span>{day.label}</span>
                {active ? (
                  <input
                    type="time"
                    lang="pt-BR"
                    aria-label={`Horário de ${day.label}`}
                    value={weeklyTimes[key] || ''}
                    disabled={saving}
                    onChange={(event) =>
                      setWeeklyTimes((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                ) : (
                  <span className="training-plan-rest">Descanso</span>
                )}
              </label>
            )
          })}
        </div>

        <details className="training-plan-copy">
          <summary>Aplicar horário a outros dias</summary>
          <div className="training-plan-copy-content">
            <select
              aria-label="Copiar horário de"
              value={copyFrom}
              onChange={(event) => {
                setCopyFrom(event.target.value)
                setOverwriteTimes(false)
              }}
              disabled={saving}
            >
              <option value="">Escolha o dia de origem</option>
              {TRAINING_WEEKDAYS.map(
                (day, index) =>
                  selectedDays.has(day.id) &&
                  weeklyTimes[String(index + 1)] && (
                    <option key={day.id} value={String(index + 1)}>
                      {day.label} · {weeklyTimes[String(index + 1)]}
                    </option>
                  )
              )}
            </select>
            <div className="training-plan-copy-targets">
              {TRAINING_WEEKDAYS.map(
                (day, index) =>
                  selectedDays.has(day.id) &&
                  String(index + 1) !== copyFrom && (
                    <label key={day.id}>
                      <input
                        type="checkbox"
                        checked={copyTargets.has(String(index + 1))}
                        disabled={saving}
                        onChange={() => {
                          setOverwriteTimes(false)
                          setCopyTargets((current) => {
                            const next = new Set(current)
                            const key = String(index + 1)
                            if (next.has(key)) next.delete(key)
                            else next.add(key)
                            return next
                          })
                        }}
                      />
                      {day.short}
                    </label>
                  )
              )}
            </div>
            {copyWouldOverwrite && (
              <label className="training-plan-overwrite">
                <input
                  type="checkbox"
                  checked={overwriteTimes}
                  disabled={saving}
                  onChange={(event) => setOverwriteTimes(event.target.checked)}
                />
                Substituir horários já configurados
              </label>
            )}
            <Button
              type="button"
              onClick={copyTime}
              disabled={
                saving ||
                !copyFrom ||
                copyTargets.size === 0 ||
                (copyWouldOverwrite && !overwriteTimes)
              }
            >
              Aplicar
            </Button>
          </div>
        </details>
        <small className="training-plan-timezone">
          Fuso horário ao salvar: {getDeviceTimezone()}
        </small>
        {error && <Flash variant="danger">{error}</Flash>}
      </form>
    </Dialog>
  )
}
