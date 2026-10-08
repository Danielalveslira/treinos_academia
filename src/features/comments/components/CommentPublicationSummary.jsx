import { Link } from 'react-router-dom'
import { CalendarIcon, ClockIcon, LocationIcon, TrophyIcon } from '@primer/octicons-react'
import { ProfileAvatar } from '../../../components/ProfileAvatar'
import { formatDateTime } from '../../../utils/format'
import { toDate } from '../../../utils/date'
import { StatusText } from '../../../components/StatusText'

const TYPE_LABELS = {
  text: 'Publicação',
  workout: 'Treino marcado',
  achievement: 'Conquista',
  poll: 'Enquete',
  photo: 'Foto',
  progress: 'Progresso',
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
          <TrophyIcon size={14} /> Conquista
        </strong>
        {status.achievement?.text && <StatusText value={status.achievement.text} />}
      </>
    )
  }
  if (status.type === 'poll') return <strong>{status.poll?.question}</strong>
  if (status.type === 'photo') {
    return (
      <p>{status.caption || (status.progress ? 'Card de progresso' : 'Publicação com foto')}</p>
    )
  }
  // Mesma renderização do feed (markdown + "Ver mais" para texto longo): com até 7000 caracteres, o texto cru
  // e inteiro empurraria os comentários para muito longe.
  return <StatusText value={status.text} />
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
          {TYPE_LABELS[status.type === 'photo' && status.progress ? 'progress' : status.type] ||
            'Publicação'}
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
