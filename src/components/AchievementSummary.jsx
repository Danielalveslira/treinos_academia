import { TrophyIcon } from '@primer/octicons-react'
import { formatDate } from '../utils/format'

// A prévia e a publicação usam o mesmo resumo.
export function AchievementSummary({ achievement }) {
  return (
    <section className="achievement-summary" aria-label="Conquista do dia">
      <div className="achievement-heading">
        <span className="achievement-title">
          <TrophyIcon size={16} />
          Conquista do dia
        </span>
        <time dateTime={achievement.day}>
          {formatDate(new Date(`${achievement.day}T12:00:00`))}
        </time>
      </div>

      {achievement.text && <p className="achievement-message">{achievement.text}</p>}

      <dl className="achievement-stats">
        <div>
          <dt>Registros de exercícios</dt>
          <dd>{achievement.entries}</dd>
        </div>
        <div>
          <dt>Séries realizadas</dt>
          <dd>{achievement.sets}</dd>
        </div>
      </dl>
    </section>
  )
}
