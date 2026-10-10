import { Button } from '@primer/react'
import { CommunityIcon } from './CommunityIcon'
import { CommunityBlockedNotice } from './CommunityBlockedNotice'
import { formatMemberCount } from '../utils/communityActivity'
import { COMMUNITY_MESSAGES, exploreCardAction } from '../utils/communityAccess'
import '../styles/community-access.css'

// Cartão de "Explorar". O estado de acesso vem do servidor junto com a listagem (community.access):
//   not_member -> "Entrar"; banned -> "Acesso bloqueado" (desabilitado, sem clique que sabidamente será
//   recusado); unavailable -> "Indisponível" (desabilitado). Membro nunca recebe "Entrar".
// `showBlockedNotice` mostra o aviso compacto logo abaixo (quando uma tentativa acabou de ser recusada).
// A barreira de segurança continua no servidor; isto só reflete o estado.
export function CommunityExploreCard({
  community,
  joining,
  disabled,
  onJoin,
  showBlockedNotice = false,
}) {
  const action = exploreCardAction(community.access)
  return (
    <article className="community-explore-card" data-access={community.access ?? 'not_member'}>
      <div className="community-explore-head">
        <CommunityIcon community={community} size={44} />
        <div className="community-card-info">
          <h3 className="community-explore-name">{community.name}</h3>
          <p className="community-card-meta">
            <span>{formatMemberCount(community.memberCount)}</span>
          </p>
        </div>
        {action === 'join' && (
          <Button
            variant="primary"
            className="community-join-button"
            loading={joining}
            disabled={disabled}
            onClick={() => onJoin(community)}
            aria-label={`Entrar em ${community.name}`}
          >
            Entrar
          </Button>
        )}
        {action === 'blocked' && (
          <Button
            className="community-join-button community-join-button--blocked"
            disabled
            aria-label={`${COMMUNITY_MESSAGES.blockedBadge} em ${community.name}`}
          >
            {COMMUNITY_MESSAGES.blockedBadge}
          </Button>
        )}
        {action === 'unavailable' && (
          <Button
            className="community-join-button community-join-button--blocked"
            disabled
            aria-label={`${community.name}: ${COMMUNITY_MESSAGES.unavailable}`}
          >
            {COMMUNITY_MESSAGES.unavailableBadge}
          </Button>
        )}
      </div>
      {community.description && (
        <p className="community-explore-description">{community.description}</p>
      )}
      {action === 'blocked' && showBlockedNotice && (
        <CommunityBlockedNotice
          className="community-blocked-notice--in-card"
          title={COMMUNITY_MESSAGES.joinBlockedTitle}
          text={COMMUNITY_MESSAGES.joinBlockedText}
        />
      )}
    </article>
  )
}
