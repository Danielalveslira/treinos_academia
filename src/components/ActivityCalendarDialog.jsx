import { useMemo, useState } from 'react'
import { Dialog } from '@primer/react'
import { buildCalendarWeeks, dateFromKey } from '../utils/activityCalendar'

const STATE_LABELS = {
  completed: 'Treino concluído',
  planned: 'Treino planejado',
  in_progress: 'Treino iniciado',
  rest: 'Descanso planejado',
  none: 'Sem atividade',
}

function describeDay(day, exerciseNameById) {
  const date = dateFromKey(day.dateKey).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
  })
  if (day.state === 'completed') {
    const names = day.exerciseStats
      .map((stat) => exerciseNameById.get(stat.exerciseId))
      .filter(Boolean)
    const activity = names.length === 1 ? names[0] : `${day.workoutCount} treinos`
    return `${date}. ${activity}. Concluído.`
  }
  return `${date}. ${day.title ? `${day.title}. ` : ''}${STATE_LABELS[day.state]}.`
}

export function ActivityCalendarDialog({ days, consistency, exerciseNameById, onClose }) {
  const weeks = useMemo(() => buildCalendarWeeks(days), [days])
  const [selected, setSelected] = useState(null)
  const year = dateFromKey(days[0].dateKey).getFullYear()

  return (
    <Dialog title={`Atividades em ${year}`} onClose={onClose} width="xlarge">
      <div className="activity-calendar-summary" aria-label="Resumo do período">
        <span>
          <strong>{consistency.current}</strong> sequência atual
        </span>
        <span>
          <strong>{consistency.longest}</strong> melhor sequência
        </span>
        <span>
          <strong>{consistency.totalWorkouts}</strong> treinos
        </span>
      </div>
      <div
        className="activity-calendar-scroll"
        tabIndex="0"
        aria-label="Calendário anual; role horizontalmente para ver todos os meses"
      >
        <div className="activity-calendar-months" aria-hidden="true">
          {weeks.map((week, index) => {
            const first = week.find(Boolean)
            const previous = weeks[index - 1]?.find(Boolean)
            const startsMonth =
              first &&
              (!previous ||
                dateFromKey(first.dateKey).getMonth() !== dateFromKey(previous.dateKey).getMonth())
            return (
              <span key={index}>
                {startsMonth
                  ? dateFromKey(first.dateKey)
                      .toLocaleDateString('pt-BR', { month: 'short' })
                      .replace('.', '')
                  : ''}
              </span>
            )
          })}
        </div>
        <div className="activity-calendar-grid">
          {weeks.map((week, index) => (
            <div className="activity-calendar-week" key={index}>
              {week.map((day, dayIndex) =>
                day ? (
                  <button
                    type="button"
                    key={day.dateKey}
                    className={`activity-day is-${day.state}`}
                    aria-label={describeDay(day, exerciseNameById)}
                    title={describeDay(day, exerciseNameById)}
                    disabled={day.isFuture}
                    onClick={() => setSelected(day)}
                    onFocus={() => setSelected(day)}
                    onMouseEnter={() => setSelected(day)}
                  >
                    <span aria-hidden="true">
                      {day.state === 'completed'
                        ? '✓'
                        : day.state === 'rest'
                          ? '–'
                          : day.state === 'planned'
                            ? '•'
                            : ''}
                    </span>
                  </button>
                ) : (
                  <span className="activity-day-placeholder" key={dayIndex} />
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <p className="activity-calendar-detail" aria-live="polite">
        {selected
          ? describeDay(selected, exerciseNameById)
          : 'Selecione um dia para ver os detalhes.'}
      </p>
      <ul className="activity-legend" aria-label="Legenda do calendário">
        <li>
          <span className="activity-day is-completed" aria-hidden="true">
            ✓
          </span>{' '}
          Concluído
        </li>
        <li>
          <span className="activity-day is-planned" aria-hidden="true">
            •
          </span>{' '}
          Planejado
        </li>
        <li>
          <span className="activity-day is-rest" aria-hidden="true">
            –
          </span>{' '}
          Descanso planejado
        </li>
        <li>
          <span className="activity-day is-none" aria-hidden="true" /> Sem atividade
        </li>
      </ul>
    </Dialog>
  )
}
