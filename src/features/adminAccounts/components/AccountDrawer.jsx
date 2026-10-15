import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ActionList,
  ActionMenu,
  Box,
  Button,
  Dialog,
  Heading,
  IconButton,
  Label,
  Spinner,
  Text,
} from '@primer/react'
import { CheckIcon, CopyIcon, KebabHorizontalIcon, XIcon } from '@primer/octicons-react'
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
const count = (value) => (value == null ? '—' : Number(value).toLocaleString('pt-BR'))

function Group({ title, children }) {
  return (
    <Box as="section" className="accounts-detail-group" aria-label={title}>
      <Heading as="h3" className="accounts-detail-group-title" sx={{ fontSize: 1 }}>
        {title}
      </Heading>
      {children}
    </Box>
  )
}

function Field({ label, children, action, stacked = false }) {
  return (
    <Box className={`accounts-detail-field${stacked ? ' accounts-detail-field-stacked' : ''}`}>
      <Text className="accounts-detail-label" sx={{ color: 'fg.muted', fontSize: 1 }}>
        {label}
      </Text>
      <Text className="accounts-detail-value" sx={{ fontSize: 1 }}>
        {children}
      </Text>
      {action && <Box className="accounts-detail-copy">{action}</Box>}
    </Box>
  )
}

function CopyField({ label, value, onCopied }) {
  const [copied, setCopied] = useState(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return (
    <Field
      stacked
      label={
        <>
          {label}
          {copied !== null && (
            <Text
              role="status"
              sx={{ fontSize: 0, ml: 2, color: copied ? 'success.fg' : 'danger.fg' }}
            >
              {copied ? 'Copiado' : 'Não foi possível copiar'}
            </Text>
          )}
        </>
      }
      action={
        value ? (
          <IconButton
            icon={copied ? CheckIcon : CopyIcon}
            variant="invisible"
            aria-label={`Copiar ${label}`}
            onClick={async () => {
              const result = await copyTextToClipboard(value)
              if (!mounted.current) return
              setCopied(result.copied)
              onCopied(result.copied, label)
            }}
          />
        ) : null
      }
    >
      {value || '—'}
    </Field>
  )
}

function Section({ entry, onRetry, children }) {
  if (entry?.status === 'error')
    return (
      <Box className="accounts-detail-empty">
        <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Não foi possível carregar esta seção.</Text>
        <Button onClick={onRetry}>Tentar novamente</Button>
      </Box>
    )
  if (entry?.data !== undefined) return children(entry.data)
  if (!entry) return <Button onClick={onRetry}>Carregar seção</Button>
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }} role="status">
      <Spinner size="small" />
      <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Carregando seção...</Text>
    </Box>
  )
}

function Overview({ account, onCopied }) {
  return (
    <>
      <Group title="Identificação">
        <CopyField label="E-mail" value={account.email} onCopied={onCopied} />
        <CopyField label="UID" value={account.id} onCopied={onCopied} />
      </Group>
      <Group title="Atividade">
        <Field label="Último uso">
          {account.last_active_at ? formatDateTime(account.last_active_at) : 'Sem registro de uso'}
        </Field>
        <Field label="Último login">
          {account.last_sign_in_at ? formatDateTime(account.last_sign_in_at) : 'Nunca'}
        </Field>
        <Field label="Criado em">{formatDate(account.created_at)}</Field>
      </Group>
      <Group title="Situação da conta">
        <Box className="accounts-detail-facts">
          <Field label="Versão legal aceita">{account.accepted_legal_version || '—'}</Field>
          <Field label="Comunidades">{count(account.community_count)}</Field>
          <Field label="Vitrine">
            {SHOWCASE_LABELS[account.showcase_status] || account.showcase_status}
          </Field>
          <Field label="Financeiro">
            {account.financial_status === 'pending' ? (
              <Label variant="attention">Pendente</Label>
            ) : (
              FINANCIAL_LABELS[account.financial_status] || account.financial_status
            )}
          </Field>
          <Field label="Flags">{count(account.flags_count)}</Field>
          <Field label="Exclusão">
            {account.deletion_status === 'none' ? (
              'Não solicitada'
            ) : (
              <Label variant="attention">
                {DELETION_LABELS[account.deletion_status] || account.deletion_status}
              </Label>
            )}
          </Field>
        </Box>
        {account.restriction_action && (
          <Box className="accounts-detail-note">
            <Text sx={{ color: 'fg.muted', fontSize: 0 }}>Restrição vigente</Text>
            <Text sx={{ display: 'block', fontSize: 1 }}>
              {RESTRICTION_LABELS[account.restriction_action] || account.restriction_action}
              {account.restriction_until ? ` até ${formatDateTime(account.restriction_until)}` : ''}
            </Text>
          </Box>
        )}
        {account.status === 'disabled' && account.disabled_reason && (
          <Box className="accounts-detail-note">
            <Text sx={{ color: 'fg.muted', fontSize: 0 }}>Motivo da desativação</Text>
            <Text sx={{ display: 'block', fontSize: 1 }}>{account.disabled_reason}</Text>
          </Box>
        )}
      </Group>
    </>
  )
}

function Communities({ data }) {
  const [limit, setLimit] = useState(10)
  if (!data.length) return <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Nenhuma comunidade.</Text>
  return (
    <Group title="Vínculos com comunidades">
      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>
        Mostrando {Math.min(limit, data.length)} de {data.length} vínculos carregados.
      </Text>
      <Box as="ul" className="accounts-detail-list">
        {data.slice(0, limit).map((community) => (
          <Box as="li" key={community.id} className="accounts-detail-list-row">
            <Text sx={{ display: 'block', fontSize: 1, fontWeight: 600 }}>{community.name}</Text>
            <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
              {community.is_owner ? 'Responsável' : 'Membro'} · {count(community.member_count)}{' '}
              membros · desde {formatDate(community.joined_at)}
              {community.is_active ? '' : ' · inativa'}
            </Text>
          </Box>
        ))}
      </Box>
      {limit < data.length && (
        <Button variant="invisible" onClick={() => setLimit((previous) => previous + 10)}>
          Mostrar mais comunidades
        </Button>
      )}
    </Group>
  )
}

function Financial({ data }) {
  return (
    <>
      <Group title="Saldos">
        <Box className="accounts-detail-balances">
          <Box>
            <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>EvoCoins</Text>
            <Text sx={{ fontSize: 3, fontWeight: 600 }}>{count(data.coin_balance)}</Text>
          </Box>
          <Box>
            <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>EvoCash</Text>
            <Text sx={{ fontSize: 3, fontWeight: 600 }}>{count(data.cash_balance)}</Text>
          </Box>
        </Box>
      </Group>
      {data.deletion && (
        <Group title="Revisão de exclusão">
          <Field label="Situação">
            {DELETION_LABELS[data.deletion.state] || data.deletion.state}
          </Field>
          <Field label="Solicitação">{data.deletion.protocol}</Field>
          {data.deletion.financial_case_protocol && (
            <Field label="Caso financeiro">{data.deletion.financial_case_protocol}</Field>
          )}
        </Group>
      )}
      <Group title="Últimas compras de EvoCash">
        {!data.recent_purchases.length ? (
          <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Nenhuma compra.</Text>
        ) : (
          <Box as="ul" className="accounts-detail-list">
            {data.recent_purchases.map((purchase) => (
              <Box as="li" key={purchase.id} className="accounts-detail-list-row">
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 2,
                    flexWrap: 'wrap',
                  }}
                >
                  <Text sx={{ fontSize: 1, fontWeight: 600 }}>
                    {count(purchase.cash_amount)} EvoCash
                  </Text>
                  <Text sx={{ fontSize: 1 }}>{formatCentavosBRL(purchase.amount_centavos)}</Text>
                </Box>
                <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
                  {formatDateTime(purchase.created_at)} ·{' '}
                  {PURCHASE_STATUS_LABELS[purchase.status] || purchase.status}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Group>
    </>
  )
}

function Audit({ data }) {
  const [limit, setLimit] = useState(10)
  return (
    <Group title="Histórico administrativo">
      <AuditLogList entries={data.slice(0, limit)} compact />
      {limit < data.length && (
        <Button variant="invisible" onClick={() => setLimit((previous) => previous + 10)}>
          Mostrar mais registros
        </Button>
      )}
    </Group>
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
  const closeRef = useRef(null)
  const bodyRef = useRef(null)
  const [section, setSection] = useState('overview')
  useEffect(() => {
    setSection('overview')
  }, [account.id])
  useEffect(() => {
    if (section !== 'overview') onLoadSection(account.id, section)
  }, [account.id, section, onLoadSection])
  useEffect(() => {
    bodyRef.current?.parentElement?.scrollTo?.({ top: 0 })
  }, [section, account.id])
  const entry = entries[`${account.id}:${section}`]
  const retry = () => onLoadSection(account.id, section, { force: true })
  const name = account.username ? `@${account.username}` : '(sem @usuário)'
  const hasSecondaryActions =
    canDelete(account) || account.flags_count > 0 || account.deletion_status !== 'none'
  return (
    <Dialog
      className="admin-account-dialog accounts-detail-dialog"
      title={`Detalhes da conta ${name}`}
      onClose={onClose}
      width="large"
      height="large"
      position={{ narrow: 'fullscreen', regular: 'right', wide: 'right' }}
      initialFocusRef={closeRef}
      renderHeader={({ dialogLabelId }) => (
        <Dialog.Header className="accounts-detail-header">
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Dialog.Title
                id={dialogLabelId}
                sx={{ fontSize: 3, fontWeight: 600, overflowWrap: 'anywhere' }}
              >
                <span className="accounts-visually-hidden">Detalhes da conta </span>
                {name}
              </Dialog.Title>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mt: 1 }}>
                <Text sx={{ fontSize: 1, color: 'fg.muted' }}>
                  {ROLE_LABELS[account.role] || account.role}
                </Text>
                <AccountStatusBadge status={account.status} />
              </Box>
            </Box>
            <IconButton
              ref={closeRef}
              icon={XIcon}
              variant="invisible"
              aria-label="Fechar painel"
              onClick={onClose}
              sx={{ minWidth: 44 }}
            />
          </Box>
          {(canManageStatus(account) || hasSecondaryActions) && (
            <Box className="accounts-detail-actions">
              <Text sx={{ fontSize: 0, color: 'fg.muted' }}>Gerenciar conta</Text>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {canManageStatus(account) &&
                  (account.status === 'disabled' ? (
                    <Button variant="invisible" disabled={busy} onClick={() => onEnable(account)}>
                      Reativar
                    </Button>
                  ) : (
                    <Button
                      variant="invisible"
                      disabled={busy}
                      onClick={() => onDisable(account)}
                      sx={{ color: 'danger.fg' }}
                    >
                      Desativar
                    </Button>
                  ))}
                {hasSecondaryActions && (
                  <ActionMenu>
                    <ActionMenu.Anchor>
                      <IconButton
                        icon={KebabHorizontalIcon}
                        variant="invisible"
                        disabled={busy}
                        aria-label="Mais ações da conta"
                        sx={{ minWidth: 44 }}
                      />
                    </ActionMenu.Anchor>
                    <ActionMenu.Overlay align="end" width="medium">
                      <ActionList>
                        {account.deletion_status !== 'none' && (
                          <ActionList.LinkItem as={Link} to="/admin/exclusao-contas">
                            Abrir exclusão pendente
                          </ActionList.LinkItem>
                        )}
                        {account.flags_count > 0 && (
                          <ActionList.LinkItem as={Link} to="/admin/moderacao">
                            Revisar moderação
                          </ActionList.LinkItem>
                        )}
                        {canDelete(account) && (
                          <ActionList.Item variant="danger" onSelect={() => onDelete(account)}>
                            Excluir permanentemente
                          </ActionList.Item>
                        )}
                      </ActionList>
                    </ActionMenu.Overlay>
                  </ActionMenu>
                )}
              </Box>
            </Box>
          )}
          <Box role="group" aria-label="Seções da conta" className="accounts-detail-tabs">
            {SECTIONS.map((item) => (
              <Box
                as="button"
                type="button"
                key={item.key}
                aria-pressed={section === item.key}
                onClick={() => setSection(item.key)}
                sx={{
                  color: section === item.key ? 'fg.default' : 'fg.muted',
                  borderColor: section === item.key ? 'accent.emphasis' : 'transparent',
                }}
              >
                {item.label}
              </Box>
            ))}
          </Box>
        </Dialog.Header>
      )}
      renderBody={({ children }) => (
        <Box ref={bodyRef} className="accounts-detail-body">
          {children}
        </Box>
      )}
    >
      {section === 'overview' && <Overview account={account} onCopied={onCopied} />}
      {section === 'communities' && (
        <Section entry={entry} onRetry={retry}>
          {(data) => <Communities data={data} />}
        </Section>
      )}
      {section === 'financial' && (
        <Section entry={entry} onRetry={retry}>
          {(data) => <Financial data={data} />}
        </Section>
      )}
      {section === 'audit' && (
        <Section entry={entry} onRetry={retry}>
          {(data) => <Audit data={data} />}
        </Section>
      )}
    </Dialog>
  )
}
