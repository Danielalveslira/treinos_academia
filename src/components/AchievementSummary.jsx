import { TrophyIcon } from '@primer/octicons-react'
import { formatDate } from '../utils/format'
import { MarkdownViewer } from './MarkdownViewer'

// A prévia e a publicação usam o mesmo resumo.
export function AchievementSummary({ achievement }) {
  const hasRecords = achievement?.entries > 0
  const hasText = typeof achievement?.text === 'string' && achievement.text.trim().length > 0
  if (!hasRecords && !hasText) return null

  return (
    <section className="achievement-summary" aria-label="Conquista">
      <div className="achievement-heading">
        <span className="achievement-title">
          <TrophyIcon size={16} />
          Conquista
        </span>
        <time dateTime={achievement.day}>
          {formatDate(new Date(`${achievement.day}T12:00:00`))}
        </time>
      </div>

      <MarkdownViewer value={achievement.text} sx={{ mt: 2 }} />

      {hasRecords && (
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
      )}
    </section>
  )
}
