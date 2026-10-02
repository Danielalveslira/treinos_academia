import { ArrowRightIcon, CheckIcon, GearIcon, ShareIcon } from '@primer/octicons-react'
import { ConsistencyFlame } from './ConsistencyFlame'

const STATE_LABELS = {
  completed: 'treino concluído',
  planned: 'treino planejado, ainda pendente',
  in_progress: 'treino iniciado',
  rest: 'descanso planejado',
  none: 'sem atividade',
}

function dayLabel(day) {
  const date = new Date(`${day.dateKey}T12:00:00`)
  return `${date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}: ${STATE_LABELS[day.state]}`
}

function todayCopy(day) {
  if (day.state === 'completed') return 'Treino concluído. Hoje é dia de recuperar.'
  if (day.state === 'planned')
    return day.reminderTime
      ? `Treino planejado · ${day.reminderTime}`
      : day.title
        ? `${day.title} planejado`
        : 'Treino planejado para hoje'
  if (day.state === 'in_progress')
    return day.title ? `${day.title} em andamento` : 'Treino em andamento'
  if (day.state === 'rest') return 'Descanso planejado'
  return 'Nenhum treino programado'
}

export function StreakCard({
  consistency,
  hasTrainingPlan,
  onConfigurePlan,
  onOpenCalendar,
  onShare,
}) {
  return (
    <section className="streak-card" aria-labelledby="consistency-title">
      <div className="streak-summary">
        <span className="streak-flame">
          <ConsistencyFlame active={consistency.trainedToday} />
        </span>
        <div>
          <strong id="consistency-title">
            {consistency.current} {consistency.current === 1 ? 'dia' : 'dias'} de consistência
          </strong>
          <span>
            Melhor sequência no ano: {consistency.longest}{' '}
            {consistency.longest === 1 ? 'dia' : 'dias'}
          </span>
        </div>
      </div>
      <ul className="streak-days" aria-label="Resumo dos últimos sete dias">
        {consistency.recent.map((day) => (
          <li
            key={day.dateKey}
            className={`streak-pip is-${day.state}${day.isToday ? ' is-today' : ''}`}
            aria-label={dayLabel(day)}
          >
            {day.state === 'completed' && <CheckIcon size={11} aria-hidden="true" />}
            {day.state === 'rest' && <span aria-hidden="true">–</span>}
          </li>
        ))}
      </ul>
      <div className="streak-today">
        <span>Hoje</span>
        <strong>{todayCopy(consistency.today)}</strong>
      </div>
      <div className="streak-actions">
        <button type="button" className="streak-action-link" onClick={onConfigurePlan}>
          <GearIcon size={14} /> {hasTrainingPlan ? 'Ajustar planejamento' : 'Planejar semana'}
        </button>
        {onShare && (
          <button type="button" className="streak-action-link" onClick={onShare}>
            <ShareIcon size={14} /> Compartilhar progresso
          </button>
        )}
        <button type="button" className="streak-action-link" onClick={onOpenCalendar}>
          Ver calendário <ArrowRightIcon size={14} />
        </button>
      </div>
    </section>
  )
}
