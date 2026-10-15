import { Button } from '@primer/react'
import { PlusIcon, AlertIcon } from '@primer/octicons-react'
import { CommunityIcon } from './CommunityIcon'
import { CommunityCoverImage } from './CommunityCoverImage'
import { CommunityBlockedNotice } from './CommunityBlockedNotice'
import { formatMemberCount } from '../utils/communityActivity'
import { COMMUNITY_MESSAGES, exploreCardAction } from '../utils/communityAccess'
import '../styles/community-access.css'

// Cartão de "Explorar". O estado de acesso vem do servidor junto com a listagem (community.access):
//   not_member -> "Participar"; banned -> "Acesso bloqueado" (desabilitado, sem clique que sabidamente será
//   recusado); unavailable -> "Indisponível" (desabilitado). Membro nunca recebe "Participar".
// `error` (de uma tentativa de entrada recusada NESTE cartão) mostra o aviso compacto logo abaixo --
// nunca um toast no topo da página: { kind: 'banned' } usa o texto fixo de banimento; qualquer outro
// kind (rede/inesperado/indisponível) usa `error.title` com o ícone de erro genérico. Sucesso não
// mostra nada aqui -- o cartão já sai da lista sozinho. A barreira de segurança continua no servidor;
// isto só reflete o estado.
export function CommunityExploreCard({ community, joining, disabled, onJoin, error = null }) {
  const action = exploreCardAction(community.access)
  return (
    <article className="community-explore-card" data-access={community.access ?? 'not_member'}>
      <div className="community-cover">
        <CommunityCoverImage path={community.coverPath} className="community-cover-image" />
      </div>
      {/* Fora de .community-cover de propósito: o container da capa tem overflow:hidden
          (pra arredondar a imagem), que cortava a metade de baixo do ícone. Posicionado
          contra o cartão inteiro, que não corta nada, ele aparece inteiro sobrepondo a
          borda da capa (mesma classe usada por .community-card, ver Communities.jsx). */}
      <span className="community-cover-icon">
        <CommunityIcon community={community} size={40} />
      </span>
      <div className="community-explore-body">
        <h3 className="community-explore-name">{community.name}</h3>
        <p className="community-card-meta">
          <span>{formatMemberCount(community.memberCount)}</span>
        </p>
        {community.description && (
          <p className="community-explore-description">{community.description}</p>
        )}
        {action === 'join' && (
          <Button
            variant="primary"
            block
            size="small"
            leadingVisual={PlusIcon}
            className="community-join-button"
            loading={joining}
            disabled={disabled}
            onClick={() => onJoin(community)}
            aria-label={`Participar de ${community.name}`}
          >
            Participar
          </Button>
        )}
        {action === 'blocked' && (
          <Button
            block
            size="small"
            className="community-join-button community-join-button--blocked"
            disabled
            aria-label={`${COMMUNITY_MESSAGES.blockedBadge} em ${community.name}`}
          >
            {COMMUNITY_MESSAGES.blockedBadge}
          </Button>
        )}
        {action === 'unavailable' && (
          <Button
            block
            size="small"
            className="community-join-button community-join-button--blocked"
            disabled
            aria-label={`${community.name}: ${COMMUNITY_MESSAGES.unavailable}`}
          >
            {COMMUNITY_MESSAGES.unavailableBadge}
          </Button>
        )}
        {error?.kind === 'banned' && (
          <CommunityBlockedNotice
            className="community-blocked-notice--in-card"
            title={COMMUNITY_MESSAGES.joinBlockedTitle}
            text={COMMUNITY_MESSAGES.joinBlockedText}
          />
        )}
        {error?.kind === 'error' && (
          <CommunityBlockedNotice
            className="community-blocked-notice--in-card"
            icon={AlertIcon}
            title={error.title}
          />
        )}
      </div>
    </article>
  )
}
