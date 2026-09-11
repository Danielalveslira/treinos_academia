import { Flash } from '@primer/react'
import { FlameIcon } from '@primer/octicons-react'

function dayLabel(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`)
  return date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
}

// streak vem de getDailyStreak(allWorkouts) — mesma fonte de dados já carregada pelo
// Dashboard pro gráfico de consistência, nunca um valor gravado à parte (ver streak.js).
export function StreakCard({ streak }) {
  return (
    <section className="streak-card" aria-label="Sequência de dias ativos">
      <div className="streak-summary">
        <span className="streak-flame" aria-hidden="true">
          <FlameIcon size={20} />
        </span>
        <div>
          <strong>{streak.current}</strong>
          <span>{streak.current === 1 ? 'dia seguido' : 'dias seguidos'}</span>
        </div>
      </div>
      <ul className="streak-days">
        {streak.last7Days.map((day) => (
          <li
            key={day.date}
            className={`streak-pip${day.trained ? ' is-trained' : ''}${day.isToday ? ' is-today' : ''}`}
            aria-label={`${dayLabel(day.date)}: ${day.trained ? 'treinou' : day.isToday ? 'ainda não treinou hoje' : 'sem treino'}`}
          />
        ))}
      </ul>
      {streak.todayIsUrgent && (
        <Flash variant="attention" className="streak-alert" role="alert">
          Treine hoje até 23:59 para não perder sua sequência.
        </Flash>
      )}
    </section>
  )
}
