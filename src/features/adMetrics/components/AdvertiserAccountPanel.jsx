import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Flash, Heading, Label, Spinner, Text } from '@primer/react'
import { CircleSlashIcon, PencilIcon, PlayIcon } from '@primer/octicons-react'
import { RowActionsMenu } from '../../../components/RowActionsMenu'
import { advertiserRpc } from '../api/advertisers.api'
import { useAdvertiserPage } from '../hooks/useAdvertiserPage'
import { advertiserDate, advertiserError, isAdvertiserAccessDenied } from '../utils/advertiserAdmin'
import { AdvertiserDialog } from './AdvertiserDialog'
import { CampaignIdentity } from './CampaignIdentity'

export function AdvertiserAccountPanel({ account, onAccountChange, onDenied, showToast }) {
  const campaigns = useAdvertiserPage('admin_advertiser_directory', {
    p_kind: 'campaigns',
    p_account_id: account.id,
  })
  const members = useAdvertiserPage('admin_advertiser_directory', {
    p_kind: 'members',
    p_account_id: account.id,
  })
  const [dialog, setDialog] = useState(null)
  const [member, setMember] = useState(null)
  const menuButton = useRef(null),
    linkButton = useRef(null),
    grantButton = useRef(null),
    revokeButton = useRef(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const denied =
    isAdvertiserAccessDenied(campaigns.error) || isAdvertiserAccessDenied(members.error)
  useEffect(() => {
    if (denied) onDenied()
  }, [denied, onDenied])
  const activeMembers = members.rows.filter((row) => !row.revoked_at)
  const portal = `/meus-anuncios?accountId=${encodeURIComponent(account.id)}`
  async function confirm({ name, selected }) {
    const operation = {
      rename: 'update',
      deactivate: 'update',
      activate: 'update',
      revoke: 'revoke',
      grant: 'grant',
      link: 'link',
    }[dialog]
    try {
      await advertiserRpc('admin_manage_advertiser', {
        p_operation: operation,
        p_account_id: account.id,
        p_name: dialog === 'rename' ? name : account.name,
        p_active: dialog === 'deactivate' ? false : dialog === 'activate' ? true : account.active,
        p_subject_id: dialog === 'revoke' ? member.id : selected?.id || null,
      })
      if (!live.current) return
      if (operation === 'update') {
        onAccountChange({
          ...account,
          name: dialog === 'rename' ? name : account.name,
          active: dialog === 'deactivate' ? false : dialog === 'activate' ? true : account.active,
        })
        showToast(
          dialog === 'rename'
            ? 'Nome do anunciante atualizado.'
            : dialog === 'deactivate'
              ? 'Conta desativada. Acessos bloqueados; histórico preservado.'
              : 'Conta reativada.'
        )
      } else if (dialog === 'link') {
        campaigns.refresh()
        showToast('Campanha vinculada permanentemente ao anunciante.')
      } else if (dialog === 'revoke') {
        revokeButton.current = grantButton.current
        members.patch((rows) => rows.filter((row) => row.id !== member.id))
        members.refresh()
        showToast(`Acesso de @${member.username} revogado.`)
      } else {
        members.refresh()
        showToast(`Acesso de visualização concedido a @${selected.username}.`)
      }
    } catch (error) {
      if (live.current && isAdvertiserAccessDenied(error)) onDenied()
      throw error
    }
  }
  if (denied) return null
  return (
    <Box sx={{ mt: 3 }}>
      <Box
        as="section"
        aria-label="Visão geral"
        sx={{ pb: 3, borderBottom: '1px solid', borderColor: 'border.default' }}
      >
        <Box
          sx={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Box
            sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}
          >
            <Heading as="h3" sx={{ fontSize: 2, overflowWrap: 'anywhere' }}>
              {account.name}
            </Heading>
            <Label variant={account.active ? 'success' : 'secondary'}>
              {account.active ? 'Ativa' : 'Inativa'}
            </Label>
          </Box>
          <RowActionsMenu
            label="Ações da conta"
            triggerRef={menuButton}
            actions={[
              {
                key: 'rename',
                label: 'Renomear',
                icon: PencilIcon,
                onSelect: () => setDialog('rename'),
              },
              {
                key: 'status',
                label: account.active ? 'Desativar conta' : 'Reativar conta',
                icon: account.active ? CircleSlashIcon : PlayIcon,
                variant: account.active ? 'danger' : undefined,
                onSelect: () => setDialog(account.active ? 'deactivate' : 'activate'),
              },
            ]}
          />
        </Box>
        <Box as="dl" sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', my: 2 }}>
          <SummaryCount
            title="Campanhas vinculadas"
            page={campaigns}
            count={campaigns.rows.length}
          />
          <SummaryCount title="Usuários com acesso" page={members} count={activeMembers.length} />
        </Box>
        <Button
          as={account.active ? Link : 'button'}
          {...(account.active ? { to: portal } : { disabled: true })}
        >
          Visualizar portal do anunciante
        </Button>
        <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mb: 0, mt: 1 }}>
          Prévia administrativa com sua sessão de superadmin, sem assumir a identidade do
          anunciante.{!account.active ? ' A conta inativa bloqueia o portal.' : ''}
        </Text>
      </Box>
      <Box
        as="section"
        aria-labelledby="advertiser-campaigns-heading"
        sx={{ py: 3, borderBottom: '1px solid', borderColor: 'border.default' }}
      >
        <SectionHeader
          id="advertiser-campaigns-heading"
          title="Campanhas"
          description="Campanhas vinculadas a este anunciante."
        >
          <Button ref={linkButton} onClick={() => setDialog('link')}>
            Vincular campanha
          </Button>
        </SectionHeader>
        <PageFeedback page={campaigns} loading="Carregando campanhas…" />
        {campaigns.status === 'ready' && !campaigns.rows.length && (
          <Text sx={{ color: 'fg.muted', display: 'block', py: 2 }}>
            Nenhuma campanha vinculada. Use Vincular campanha para começar.
          </Text>
        )}
        <Box as="ul" aria-label="Campanhas vinculadas" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {campaigns.rows.map((row) => (
            <Box
              as="li"
              key={row.id}
              sx={{
                display: 'flex',
                alignItems: ['flex-start', null, 'center'],
                justifyContent: 'space-between',
                gap: 2,
                flexWrap: 'wrap',
                py: 2,
              }}
            >
              <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
                <CampaignIdentity campaign={row} />
              </Box>
              <Button
                as="a"
                size="small"
                href={`/admin/parcerias?report=metrics&adId=${encodeURIComponent(row.id)}`}
                aria-label={`Ver métricas de ${row.title || row.partner_name || 'campanha histórica'}`}
              >
                Ver métricas
              </Button>
            </Box>
          ))}
        </Box>
        {campaigns.hasMore && (
          <Button disabled={campaigns.status === 'loading'} onClick={campaigns.more}>
            Carregar mais campanhas
          </Button>
        )}
      </Box>
      <Box as="section" aria-labelledby="advertiser-users-heading" sx={{ py: 3 }}>
        <SectionHeader
          id="advertiser-users-heading"
          title="Usuários com acesso"
          description="Controle quem pode visualizar os relatórios deste anunciante."
        >
          <Button ref={grantButton} onClick={() => setDialog('grant')}>
            Conceder acesso
          </Button>
        </SectionHeader>
        <PageFeedback page={members} loading="Carregando acessos…" />
        {members.status === 'ready' && !activeMembers.length && (
          <Text sx={{ color: 'fg.muted', display: 'block', py: 2 }}>
            {members.hasMore
              ? 'Nenhum acesso ativo entre os usuários carregados. Carregue mais para continuar.'
              : 'Nenhum usuário com acesso. Use Conceder acesso para autorizar um usuário existente.'}
          </Text>
        )}
        <Box as="ul" aria-label="Usuários autorizados" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {activeMembers.map((row) => (
            <Box
              as="li"
              key={row.id}
              sx={{
                display: 'flex',
                gap: 2,
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                py: 2,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Text sx={{ display: 'block', fontWeight: 'bold', overflowWrap: 'anywhere' }}>
                  @{row.username}
                </Text>
                <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                  Visualização · Concedido em {advertiserDate(row.granted_at)}
                </Text>
              </Box>
              <Button
                variant="invisible"
                size="small"
                aria-label={`Revogar acesso de @${row.username}`}
                onClick={(event) => {
                  revokeButton.current = event.currentTarget
                  setMember(row)
                  setDialog('revoke')
                }}
              >
                Revogar acesso
              </Button>
            </Box>
          ))}
        </Box>
        {members.hasMore && (
          <Button disabled={members.status === 'loading'} onClick={members.more}>
            Carregar mais acessos
          </Button>
        )}
      </Box>
      {dialog && (
        <AdvertiserDialog
          key={dialog}
          kind={dialog}
          account={account}
          member={member}
          authorizedIds={activeMembers.map((row) => row.id)}
          onConfirm={confirm}
          onClose={() => setDialog(null)}
          returnFocusRef={
            dialog === 'link'
              ? linkButton
              : dialog === 'grant'
                ? grantButton
                : dialog === 'revoke'
                  ? revokeButton
                  : menuButton
          }
        />
      )}
    </Box>
  )
}
function SummaryCount({ title, page, count }) {
  return (
    <Box>
      <Text as="dt" sx={{ fontSize: 0, color: 'fg.muted' }}>
        {title}
      </Text>
      <Text as="dd" sx={{ m: 0, fontWeight: 'bold' }}>
        {page.status === 'idle' || page.status === 'loading' || page.error ? '—' : count}
      </Text>
      {page.hasMore && (
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
          Contagem dos itens carregados. Carregue mais para verificar o restante.
        </Text>
      )}
    </Box>
  )
}
function SectionHeader({ id, title, description, children }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 2,
        alignItems: 'center',
        flexWrap: 'wrap',
        mb: 2,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Heading as="h3" id={id} sx={{ fontSize: 1, mb: 1 }}>
          {title}
        </Heading>
        <Text sx={{ fontSize: 1, color: 'fg.muted' }}>{description}</Text>
      </Box>
      {children}
    </Box>
  )
}
export function AdvertiserLoading({ message }) {
  return (
    <Box role="status" sx={{ display: 'flex', gap: 2, alignItems: 'center', my: 2 }}>
      <Spinner size="small" />
      {message}
    </Box>
  )
}
function PageFeedback({ page, loading }) {
  return (
    <>
      {page.status === 'loading' && <AdvertiserLoading message={loading} />}
      {page.error && (
        <Flash role="alert" variant="danger">
          {advertiserError(page.error)}{' '}
          <Button size="small" onClick={() => page.refresh()}>
            Tentar novamente
          </Button>
        </Flash>
      )}
    </>
  )
}
