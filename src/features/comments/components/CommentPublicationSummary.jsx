import { Link } from 'react-router-dom'
import { CalendarIcon, ClockIcon, LocationIcon, TrophyIcon } from '@primer/octicons-react'
import { ProfileAvatar } from '../../../components/ProfileAvatar'
import { formatDateTime } from '../../../utils/format'
import { toDate } from '../../../utils/date'

const TYPE_LABELS = {
  text: 'Publicação',
  workout: 'Treino marcado',
  achievement: 'Conquista',
  poll: 'Enquete',
  photo: 'Foto',
}

function SummaryContent({ status }) {
  if (status.type === 'workout') {
    return (
      <>
        <strong>{status.workout?.title}</strong>
        <span className="comment-publication-detail">
          <ClockIcon size={14} /> {formatDateTime(toDate(status.workout?.date))}
        </span>
        {status.workout?.location && (
          <span className="comment-publication-detail">
            <LocationIcon size={14} /> {status.workout.location}
          </span>
        )}
      </>
    )
  }
  if (status.type === 'achievement') {
    return (
      <>
        <strong className="comment-publication-detail">
          <TrophyIcon size={14} /> Conquista do dia
        </strong>
        {status.achievement?.text && <p>{status.achievement.text}</p>}
      </>
    )
  }
  if (status.type === 'poll') return <strong>{status.poll?.question}</strong>
  if (status.type === 'photo') return <p>{status.caption || 'Publicação com foto'}</p>
  return <p>{status.text}</p>
}

export function CommentPublicationSummary({ status, communityName }) {
  const authorName = status.authorUsername ? `@${status.authorUsername}` : 'Membro'
  const publicationAnchor =
    status.type === 'workout' ? `treino-${status.id}` : `publicacao-${status.id}`
  return (
    <article className="comment-publication-summary" aria-label="Publicação original">
      <header className="comment-publication-header">
        <ProfileAvatar name={status.authorUsername || 'M'} className="comment-publication-avatar" />
        <div>
          <strong>{authorName}</strong>
          <span>{formatDateTime(toDate(status.createdAt))}</span>
        </div>
        <span className="comment-publication-type">
          {status.type === 'workout' && <CalendarIcon size={13} />}
          {TYPE_LABELS[status.type] || 'Publicação'}
        </span>
      </header>
      <div className="comment-publication-content">
        <SummaryContent status={status} />
      </div>
      <footer>
        <span>{communityName || 'Comunidade'}</span>
        <Link to={`/comunidades/${status.communityId}#${publicationAnchor}`}>Ver publicação</Link>
      </footer>
    </article>
  )
}
