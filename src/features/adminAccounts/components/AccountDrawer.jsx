import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ActionList, ActionMenu, Box, Button, IconButton, Spinner, Text } from '@primer/react'
import { CopyIcon, KebabHorizontalIcon, XIcon } from '@primer/octicons-react'
import { formatCentavosBRL, formatDate, formatDateTime } from '../../../utils/format'
import { copyTextToClipboard } from '../../../utils/clipboard'
import {
  DELETION_LABELS,
  FINANCIAL_LABELS,
  PURCHASE_STATUS_LABELS,
  RESTRICTION_LABELS,
  ROLE_LABELS,
  SHOWCASE_LABELS,
  canDelete,
  canManageStatus,
} from '../utils/accounts'
import { AccountStatusBadge } from './AccountStatusBadge'
import { AuditLogList } from './AuditLogList'

const SECTIONS = [
  { key: 'overview', label: 'Visão geral' },
  { key: 'communities', label: 'Comunidades' },
  { key: 'financial', label: 'Financeiro' },
  { key: 'audit', label: 'Auditoria' },
]

function Field({ label, children, action }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1, minWidth: 0 }}>
      <Text sx={{ width: 130, flexShrink: 0, fontSize: 1, color: 'fg.muted' }}>{label}</Text>
      <Text sx={{ flex: 1, minWidth: 0, fontSize: 1, overflowWrap: 'anywhere' }}>{children}</Text>
      {action}
    </Box>
  )
}

function CopyField({ label, value, onCopied }) {
  return (
    <Field
      label={label}
      action={
        value ? (
          <IconButton
            icon={CopyIcon}
            size="small"
            variant="invisible"
            aria-label={`Copiar ${label}`}
            onClick={async () => onCopied((await copyTextToClipboard(value)).copied, label)}
          />
        ) : null
      }
    >
      {value || '—'}
    </Field>
  )
}

function Section({ entry, onRetry, children }) {
  if (entry?.status === 'error') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
        <Text sx={{ color: 'danger.fg', fontSize: 1 }}>Não foi possível carregar esta seção.</Text>
        <Button size="small" onClick={onRetry}>
          Tentar novamente
        </Button>
      </Box>
    )
  }
  if (entry?.data !== undefined) return children(entry.data)
  return <Spinner size="small" />
}

function Overview({ account, onCopied }) {
  return (
    <Box>
      <CopyField label="E-mail" value={account.email} onCopied={onCopied} />
      <CopyField label="UID" value={account.id} onCopied={onCopied} />
      <Field label="Papel">{ROLE_LABELS[account.role] || account.role}</Field>
      <Field label="Último uso">
        {account.last_active_at ? formatDateTime(account.last_active_at) : 'Sem registro de uso'}
      </Field>
      <Field label="Último login">
        {account.last_sign_in_at ? formatDateTime(account.last_sign_in_at) : 'Nunca'}
      </Field>
      <Field label="Criado em">{formatDate(account.created_at)}</Field>
      <Field label="Versão legal aceita">{account.accepted_legal_version || '—'}</Field>
      <Field label="Comunidades">{account.community_count}</Field>
      <Field label="Vitrine">
        {SHOWCASE_LABELS[account.showcase_status] || account.showcase_status}
      </Field>
      <Field label="Financeiro">
        {FINANCIAL_LABELS[account.financial_status] || account.financial_status}
      </Field>
      <Field label="Flags">{account.flags_count}</Field>
      <Field label="Exclusão">
        {DELETION_LABELS[account.deletion_status] || account.deletion_status}
      </Field>
      {account.restriction_action && (
        <Field label="Restrição">
          {RESTRICTION_LABELS[account.restriction_action] || account.restriction_action}
          {account.restriction_until ? ` até ${formatDateTime(account.restriction_until)}` : ''}
        </Field>
      )}
      {account.status === 'disabled' && account.disabled_reason && (
        <Field label="Motivo da desativação">{account.disabled_reason}</Field>
      )}
    </Box>
  )
}

export function AccountDrawer({
  account,
  entries,
  busy,
  onLoadSection,
  onClose,
  onDisable,
  onEnable,
  onDelete,
  onCopied,
}) {
  const [section, setSection] = useState('overview')

  useEffect(() => {
    setSection('overview')
  }, [account.id])

  useEffect(() => {
    if (section !== 'overview') onLoadSection(account.id, section)
  }, [account.id, section, onLoadSection])

  useEffect(() => {
    const onKeyDown = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const entry = entries[`${account.id}:${section}`]
  const retry = () => onLoadSection(account.id, section, { force: true })
  const name = account.username ? `@${account.username}` : '(sem @usuário)'

  return (
    <Box
      as="aside"
      aria-label={`Detalhes da conta ${name}`}
      sx={{
        position: ['fixed', null, null, 'sticky'],
        left: [0, null, null, 'auto'],
        right: [0, null, null, 'auto'],
        bottom: [0, null, null, 'auto'],
        top: [0, null, null, 3],
        zIndex: [100, null, null, 'auto'],
        alignSelf: 'start',
        height: ['100vh', null, null, 'auto'],
        maxHeight: ['100vh', null, null, 'calc(100vh - 32px)'],
        overflowY: 'auto',
        p: 3,
        bg: 'canvas.default',
        border: ['none', null, null, '1px solid'],
        borderColor: 'border.default',
        borderRadius: [0, null, null, 2],
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 3 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Text
            sx={{ display: 'block', fontWeight: 'bold', fontSize: 2, overflowWrap: 'anywhere' }}
          >
            {name}
          </Text>
          <Box sx={{ mt: 1 }}>
            <AccountStatusBadge status={account.status} />
          </Box>
        </Box>
        <IconButton icon={XIcon} variant="invisible" aria-label="Fechar painel" onClick={onClose} />
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        {canManageStatus(account) &&
          (account.status === 'disabled' ? (
            <Button disabled={busy} onClick={() => onEnable(account)}>
              Reativar
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => onDisable(account)}>
              Desativar
            </Button>
          ))}
        {account.deletion_status !== 'none' && (
          <Button as={Link} to="/admin/exclusao-contas">
            Abrir exclusão pendente
          </Button>
        )}
        {account.flags_count > 0 && (
          <Button as={Link} to="/admin/moderacao">
            Revisar
          </Button>
        )}
        {canDelete(account) && (
          <ActionMenu>
            <ActionMenu.Anchor>
              <IconButton icon={KebabHorizontalIcon} disabled={busy} aria-label="Mais ações" />
            </ActionMenu.Anchor>
            <ActionMenu.Overlay align="end">
              <ActionList>
                <ActionList.Item variant="danger" onSelect={() => onDelete(account)}>
                  Excluir permanentemente
                </ActionList.Item>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        )}
      </Box>

      <Box
        role="tablist"
        aria-label="Seções da conta"
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0,
          borderBottom: '1px solid',
          borderColor: 'border.default',
        }}
      >
        {SECTIONS.map((item) => (
          <Box
            as="button"
            type="button"
            role="tab"
            key={item.key}
            aria-selected={section === item.key}
            onClick={() => setSection(item.key)}
            sx={{
              all: 'unset',
              cursor: 'pointer',
              px: '6px',
              py: 2,
              fontSize: 1,
              fontWeight: section === item.key ? 'bold' : 'normal',
              color: section === item.key ? 'fg.default' : 'fg.muted',
              borderBottom: '2px solid',
              borderColor: section === item.key ? 'accent.emphasis' : 'transparent',
              mb: '-1px',
              '&:focus-visible': { outline: '2px solid', outlineColor: 'accent.fg' },
            }}
          >
            {item.label}
          </Box>
        ))}
      </Box>

      <Box sx={{ mt: 3 }}>
        {section === 'overview' && <Overview account={account} onCopied={onCopied} />}
        {section === 'communities' && (
          <Section entry={entry} onRetry={retry}>
            {(data) =>
              data.length === 0 ? (
                <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Nenhuma comunidade.</Text>
              ) : (
                <Box
                  as="ul"
                  sx={{
                    m: 0,
                    p: 0,
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  {data.map((community) => (
                    <Box as="li" key={community.id} sx={{ fontSize: 1 }}>
                      <Text sx={{ fontWeight: 'bold' }}>{community.name}</Text>
                      <Text sx={{ color: 'fg.muted' }}>
                        {' '}
                        · {community.is_owner ? 'dona' : 'membro'} desde{' '}
                        {formatDate(community.joined_at)}
                        {community.is_active ? '' : ' · inativa'}
                      </Text>
                    </Box>
                  ))}
                </Box>
              )
            }
          </Section>
        )}
        {section === 'financial' && (
          <Section entry={entry} onRetry={retry}>
            {(data) => (
              <Box>
                <Field label="EvoCoins">{data.coin_balance}</Field>
                <Field label="EvoCash">{data.cash_balance}</Field>
                {data.deletion && (
                  <Field label="Exclusão">
                    {DELETION_LABELS[data.deletion.state] || data.deletion.state} ·{' '}
                    {data.deletion.protocol}
                    {data.deletion.financial_case_protocol
                      ? ` · caso ${data.deletion.financial_case_protocol}`
                      : ''}
                  </Field>
                )}
                <Text sx={{ display: 'block', fontSize: 1, fontWeight: 'bold', mt: 2, mb: 1 }}>
                  Últimas compras de EvoCash
                </Text>
                {data.recent_purchases.length === 0 ? (
                  <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Nenhuma compra.</Text>
                ) : (
                  data.recent_purchases.map((purchase) => (
                    <Text key={purchase.id} sx={{ display: 'block', fontSize: 1 }}>
                      {formatDate(purchase.created_at)} · {purchase.cash_amount} EvoCash ·{' '}
                      {formatCentavosBRL(purchase.amount_centavos)} ·{' '}
                      {PURCHASE_STATUS_LABELS[purchase.status] || purchase.status}
                    </Text>
                  ))
                )}
              </Box>
            )}
          </Section>
        )}
        {section === 'audit' && (
          <Section entry={entry} onRetry={retry}>
            {(data) => <AuditLogList entries={data} />}
          </Section>
        )}
      </Box>
    </Box>
  )
}
