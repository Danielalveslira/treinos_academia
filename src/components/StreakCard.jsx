import {
  ArrowRightIcon,
  CheckIcon,
  GearIcon,
  MoonIcon,
  ShareIcon,
  SunIcon,
} from '@primer/octicons-react'
import { ConsistencyFlame } from './ConsistencyFlame'
import { useDayPeriod } from '../hooks/useDayPeriod'

const STATE_LABELS = {
  completed: 'treino concluído',
  planned: 'treino planejado, ainda pendente',
  in_progress: 'treino iniciado',
  rest: 'descanso planejado',
  none: 'sem atividade',
}

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const LEGEND = [
  { state: 'completed', label: 'Concluído' },
  { state: 'planned', label: 'Planejado' },
  { state: 'rest', label: 'Descanso' },
  { state: 'none', label: 'Pendente' },
]

function weekdayOf(day) {
  return new Date(`${day.dateKey}T12:00:00`).getDay()
}

function dayLabel(day) {
  return `${WEEKDAY_SHORT[weekdayOf(day)]}: ${STATE_LABELS[day.state]}`
}

function todayCopy(day) {
  if (day.state === 'completed') {
    return {
      title: 'Treino concluído. Hoje é dia de recuperar.',
      hint: 'Excelente trabalho! O descanso também faz parte da evolução.',
    }
  }
  if (day.state === 'planned') {
    return {
      title: day.reminderTime
        ? `Treino planejado · ${day.reminderTime}`
        : day.title
          ? `${day.title} planejado`
          : 'Treino planejado para hoje',
      hint: 'Ainda dá tempo de cumprir o que você planejou.',
    }
  }
  if (day.state === 'in_progress') {
    return { title: day.title ? `${day.title} em andamento` : 'Treino em andamento', hint: null }
  }
  if (day.state === 'rest') {
    return { title: 'Descanso planejado', hint: 'Recuperar também faz parte do plano.' }
  }
  return { title: 'Nenhum treino programado', hint: null }
}

function PeriodIcon() {
  // Sol de dia, lua à noite, pelo horário local (troca sozinha na virada, sem recarregar).
  const period = useDayPeriod()
  const Icon = period === 'day' ? SunIcon : MoonIcon
  return (
    <span className={`streak-period is-${period}`} data-period={period} aria-hidden="true">
      <Icon size={22} />
    </span>
  )
}

// `unavailable`: offline e SEM snapshot de atividade -- não há como saber a sequência nem o que foi feito, então
// nada de "0 dias" nem de dias marcados como sem atividade: o cartão diz que depende da conexão.
export function StreakCard({
  unavailable = false,
  consistency,
  hasTrainingPlan,
  onConfigurePlan,
  onOpenCalendar,
  onShare,
  onSharePreload,
}) {
  const today = todayCopy(consistency.today)
  return (
    <section className="streak-card" aria-labelledby="consistency-title">
      <div className="streak-summary">
        <span className="streak-flame">
          <ConsistencyFlame active={consistency.trainedToday} />
        </span>
        <div>
          <strong id="consistency-title">
            {unavailable ? '—' : consistency.current}{' '}
            {consistency.current === 1 && !unavailable ? 'dia' : 'dias'} de consistência
          </strong>
          <span>
            {unavailable
              ? 'Disponível quando houver conexão'
              : `Melhor sequência no ano: ${consistency.longest} ${consistency.longest === 1 ? 'dia' : 'dias'}`}
          </span>
        </div>
      </div>
      {!unavailable && (
        <div className="streak-week">
          <ul className="streak-days" aria-label="Resumo dos últimos sete dias">
            {consistency.recent.map((day) => (
              <li
                key={day.dateKey}
                className={`streak-day${day.isToday ? ' is-today' : ''}`}
                aria-label={dayLabel(day)}
              >
                <span className="streak-day-name" aria-hidden="true">
                  {WEEKDAY_SHORT[weekdayOf(day)]}
                </span>
                <span className={`streak-pip is-${day.state}`} aria-hidden="true">
                  {day.state === 'completed' && <CheckIcon size={16} />}
                  {day.state === 'rest' && <span>–</span>}
                </span>
              </li>
            ))}
          </ul>
          <ul className="streak-legend" aria-hidden="true">
            {LEGEND.map((item) => (
              <li key={item.state}>
                <span className={`streak-legend-dot is-${item.state}`} />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!unavailable && (
        <div className="streak-today">
          <PeriodIcon />
          <div>
            <span className="streak-today-label">Hoje</span>
            <strong>{today.title}</strong>
            {today.hint && <small>{today.hint}</small>}
          </div>
        </div>
      )}
      <div className="streak-actions">
        <button type="button" className="streak-action" onClick={onConfigurePlan}>
          <GearIcon size={16} /> {hasTrainingPlan ? 'Ajustar planejamento' : 'Planejar semana'}
        </button>
        {onShare && !unavailable && (
          <button
            type="button"
            className="streak-action"
            onClick={onShare}
            onPointerEnter={onSharePreload}
            onFocus={onSharePreload}
          >
            <ShareIcon size={16} /> Compartilhar progresso
          </button>
        )}
        {!unavailable && (
          <button type="button" className="streak-action" onClick={onOpenCalendar}>
            Ver calendário <ArrowRightIcon size={16} />
          </button>
        )}
      </div>
    </section>
  )
}
