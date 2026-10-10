import { Blankslate } from '@primer/react/experimental'
import { PeopleIcon } from '@primer/octicons-react'
import { communityAccessView } from '../utils/communityAccess'

// O que a pessoa vê no lugar do feed quando o servidor diz que ela NÃO é membro ativa. Só o
// fluxo público de entrada existe para 'not_member'; banida e indisponível não têm "Entrar".
// Membro (view 'feed') não renderiza nada aqui.
export function CommunityAccessNotice({ access, onJoin, joinDisabled = false }) {
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
    <Blankslate>
      <Blankslate.Visual>
        <PeopleIcon size={24} />
      </Blankslate.Visual>
      <Blankslate.Heading>
        {banned ? 'Você não tem acesso a esta comunidade' : 'Comunidade indisponível'}
      </Blankslate.Heading>
      <Blankslate.Description>
        {banned
          ? 'Você foi banido desta comunidade e não pode ver nem publicar conteúdos nela.'
          : 'Esta comunidade não está disponível no momento.'}
      </Blankslate.Description>
    </Blankslate>
  )
}
