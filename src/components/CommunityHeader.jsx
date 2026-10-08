import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { ActionList, ActionMenu, IconButton } from '@primer/react'
import {
  AlertIcon,
  BookIcon,
  ChevronLeftIcon,
  GearIcon,
  KebabHorizontalIcon,
  PeopleIcon,
  SignOutIcon,
  SyncIcon,
} from '@primer/octicons-react'
import { CommunityIcon } from './CommunityIcon'
import { PromotedBadge } from './PromotedBadge'
import { formatMemberCount } from '../utils/communityActivity'
import { toMillis } from '../utils/expiry'

// Menu contextual da comunidade: um único gatilho discreto (⋯, alvo de toque de 44px) em vez de uma
// fileira de botões/links. Cada ação aparece só quando a permissão/estado permite (membro, dono ou
// superadmin); as regras e a denúncia valem inclusive antes de entrar.
export function CommunityMenu({
  communityId,
  member,
  canManage,
  managing,
  membershipPending,
  refreshing = false,
  onRefresh,
  onManage,
  onLeave,
}) {
  const navigate = useNavigate()
  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButton
          icon={KebabHorizontalIcon}
          variant="invisible"
          aria-label="Mais ações da comunidade"
          className="cd-icon-button"
        />
      </ActionMenu.Anchor>
      <ActionMenu.Overlay align="end">
        <ActionList>
          {member && onRefresh && (
            <ActionList.Item disabled={refreshing} onSelect={onRefresh}>
              <ActionList.LeadingVisual>
                <SyncIcon />
              </ActionList.LeadingVisual>
              {refreshing ? 'Atualizando…' : 'Atualizar publicações'}
            </ActionList.Item>
          )}
          {canManage && !managing && (
            <ActionList.Item onSelect={onManage}>
              <ActionList.LeadingVisual>
                <GearIcon />
              </ActionList.LeadingVisual>
              Gerenciar comunidade
            </ActionList.Item>
          )}
          <ActionList.Item onSelect={() => navigate('/regras-da-comunidade')}>
            <ActionList.LeadingVisual>
              <BookIcon />
            </ActionList.LeadingVisual>
            Regras da Comunidade
          </ActionList.Item>
          <ActionList.Item
            onSelect={() =>
              navigate(`/atendimento?tipo=report&comunidade=${encodeURIComponent(communityId)}`)
            }
          >
            <ActionList.LeadingVisual>
              <AlertIcon />
            </ActionList.LeadingVisual>
            Denunciar violação
          </ActionList.Item>
          {member && (
            <>
              <ActionList.Divider />
              <ActionList.Item variant="danger" disabled={membershipPending} onSelect={onLeave}>
                <ActionList.LeadingVisual>
                  <SignOutIcon />
                </ActionList.LeadingVisual>
                Sair da comunidade
              </ActionList.Item>
            </>
          )}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

// Barra de topo (voltar + menu) e identidade da comunidade: ícone, nome, membros e descrição, todos
// dados reais da comunidade. Compacta no celular; a descrição fica limitada a 3 linhas.
export function CommunityHeader({ communityId, community, menuProps }) {
  const promoted = Boolean(community?.promoted) && toMillis(community?.promotedUntil) > Date.now()
  return (
    <header className="cd-header">
      <div className="cd-topbar">
        <RouterLink to="/comunidades" className="cd-back" aria-label="Voltar para Comunidades">
          <ChevronLeftIcon size={20} />
          <span className="cd-back-label">Comunidades</span>
        </RouterLink>
        <CommunityMenu communityId={communityId} {...menuProps} />
      </div>
      {community && (
        <div className="cd-identity">
          <CommunityIcon community={community} size={64} />
          <div className="cd-identity-text">
            <h1>{community.name}</h1>
            <p className="cd-meta">
              <PeopleIcon size={14} />
              <span>{formatMemberCount(community.memberCount)}</span>
              {promoted && <PromotedBadge />}
            </p>
            {community.description && <p className="cd-description">{community.description}</p>}
          </div>
        </div>
      )}
    </header>
  )
}
