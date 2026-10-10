import { Button } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PeopleIcon } from '@primer/octicons-react'
import { CommunityBlockedNotice } from './CommunityBlockedNotice'
import { COMMUNITY_MESSAGES, communityAccessView } from '../utils/communityAccess'

// O que a pessoa vê no lugar do feed quando o servidor diz que ela NÃO é membro ativa. Só o fluxo público de
// entrada existe para 'not_member'; banida e indisponível veem um aviso compacto, SEM "Entrar" e sem nenhum
// conteúdo interno (a página nem monta feed, composer ou ações de membro nesses estados).
// Membro (view 'feed') não renderiza nada aqui.
export function CommunityAccessNotice({ access, onJoin, joinDisabled = false, onBack }) {
  const view = communityAccessView(access)
  if (view === 'feed') return null

  if (view === 'join') {
    return (
      <Blankslate>
        <Blankslate.Visual>
          <PeopleIcon size={24} />
        </Blankslate.Visual>
        <Blankslate.Heading>Entre para ver o feed</Blankslate.Heading>
        <Blankslate.Description>
          Só membros podem ver e publicar conteúdos nesta comunidade.
        </Blankslate.Description>
        <Blankslate.PrimaryAction onClick={onJoin} disabled={joinDisabled}>
          Entrar
        </Blankslate.PrimaryAction>
      </Blankslate>
    )
  }

  const banned = view === 'banned'
  return (
    <CommunityBlockedNotice
      className="community-blocked-notice--page"
      title={banned ? COMMUNITY_MESSAGES.pageBlockedTitle : 'Comunidade indisponível'}
      text={banned ? COMMUNITY_MESSAGES.pageBlockedText : COMMUNITY_MESSAGES.unavailable}
    >
      {onBack && (
        <Button
          size="small"
          variant="invisible"
          onClick={onBack}
          className="community-blocked-notice-back"
        >
          Explorar comunidades
        </Button>
      )}
    </CommunityBlockedNotice>
  )
}
