import {
  ActionList,
  ActionMenu,
  Box,
  Checkbox,
  IconButton,
  Select,
  Text,
  useResponsiveValue,
} from '@primer/react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FlagIcon,
  KebabHorizontalIcon,
  SortDescIcon,
  TriangleDownIcon,
  TriangleUpIcon,
} from '@primer/octicons-react'
import { formatDate, formatDateTime } from '../../../utils/format'
import {
  FINANCIAL_LABELS,
  PAGE_SIZES,
  ROLE_LABELS,
  maskEmail,
  SORT_ACCESSORS,
  canDelete,
  canManageStatus,
} from '../utils/accounts'
import { AccountStatusBadge } from './AccountStatusBadge'

// Colunas secundárias somem em telas estreitas (o usuário continua vendo @usuário, e-mail e
// status); no celular o detalhe completo está no painel da conta.
const COLUMNS = [
  { key: 'role', label: 'Papel', sort: 'role', show: [null, null, 'table-cell'] },
  // Status nunca some (nem pelo seletor "Colunas"): é o dado que a tabela existe para mostrar.
  { key: 'status', label: 'Status', sort: 'status', show: ['table-cell'], always: true },
  {
    key: 'last_active_at',
    label: 'Último uso',
    sort: 'last_active_at',
    show: [null, null, null, 'table-cell'],
  },
  {
    key: 'last_sign_in_at',
    label: 'Último login',
    sort: 'last_sign_in_at',
    show: [null, null, null, 'table-cell'],
  },
  {
    key: 'created_at',
    label: 'Criado em',
    sort: 'created_at',
    show: [null, null, null, 'table-cell'],
  },
  {
    key: 'community_count',
    label: 'Comunidades',
    sort: 'community_count',
    show: [null, null, null, 'table-cell'],
  },
  { key: 'financial_status', label: 'Financeiro', sort: null, show: [null, null, 'table-cell'] },
  { key: 'flags_count', label: 'Flags', sort: 'flags_count', show: [null, null, 'table-cell'] },
]

// Com o painel da conta aberto a tabela perde ~380px: as colunas menos usadas saem da tabela
// (continuam no painel) para o Status e as ações não ficarem cortados.
const COMPACT_HIDDEN = new Set([
  'created_at',
  'community_count',
  'financial_status',
  'last_sign_in_at',
])

const hidden = (show) => ({ display: show.map((value) => value || 'none') })

function SortHeader({ label, sortKey, sort, onSort }) {
  if (!sortKey) return label
  const active = sort.key === sortKey
  return (
    <Box
      as="button"
      type="button"
      onClick={() => onSort(sortKey)}
      sx={{
        all: 'unset',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        '&:focus-visible': { outline: '2px solid', outlineColor: 'accent.fg' },
      }}
    >
      {label}
      {active &&
        (sort.direction === 'asc' ? <TriangleUpIcon size={14} /> : <TriangleDownIcon size={14} />)}
    </Box>
  )
}

function cell(column, account) {
  switch (column) {
    case 'role':
      return ROLE_LABELS[account.role] || account.role
    case 'status':
      return <AccountStatusBadge status={account.status} />
    case 'last_active_at':
      return account.last_active_at ? formatDateTime(account.last_active_at) : 'Sem registro'
    case 'last_sign_in_at':
      return account.last_sign_in_at ? formatDateTime(account.last_sign_in_at) : 'Nunca'
    case 'created_at':
      return formatDate(account.created_at)
    case 'community_count':
      return account.community_count
    case 'financial_status':
      return FINANCIAL_LABELS[account.financial_status] || account.financial_status
    case 'flags_count':
      return account.flags_count > 0 ? (
        <Box
          as="span"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'danger.fg' }}
        >
          <FlagIcon size={14} />
          {account.flags_count}
        </Box>
      ) : (
        '—'
      )
    default:
      return null
  }
}

export function AccountsTable({
  rows,
  selectedIds,
  openId,
  sort,
  visibleColumns,
  disabled,
  compact,
  pagination,
  total,
  pageSize,
  onSort,
  onToggleRow,
  onTogglePage,
  onOpen,
  onDisable,
  onEnable,
  onDelete,
  onPageChange,
  onPageSizeChange,
}) {
  const mobile = useResponsiveValue({ narrow: true, regular: false }, false)
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id))
  const someSelected = rows.some((row) => selectedIds.has(row.id))
  const columns = COLUMNS.filter(
    (column) =>
      (column.always || visibleColumns.has(column.key)) &&
      !(compact && COMPACT_HIDDEN.has(column.key))
  )

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      {mobile && (
        <Box sx={{ display: ['block', null, 'none'] }}>
          <Box
            className="accounts-list-controls"
            sx={{ borderBottom: '1px solid', borderColor: 'border.muted' }}
          >
            <Box as="label" className="accounts-page-selection">
              <Checkbox
                aria-label="Selecionar página na lista móvel"
                checked={allSelected}
                indeterminate={!allSelected && someSelected}
                onChange={onTogglePage}
                disabled={disabled}
              />
              <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Selecionar</Text>
            </Box>
            <ActionMenu>
              <ActionMenu.Button variant="invisible" leadingVisual={SortDescIcon}>
                Ordenar
              </ActionMenu.Button>
              <ActionMenu.Overlay align="end" width="medium">
                <ActionList selectionVariant="single">
                  {Object.keys(SORT_ACCESSORS).map((key) => (
                    <ActionList.Item
                      key={key}
                      selected={sort.key === key}
                      onSelect={() => onSort(key)}
                    >
                      {key === 'username'
                        ? 'Usuário'
                        : COLUMNS.find((c) => c.key === key)?.label || key}
                    </ActionList.Item>
                  ))}
                  <ActionList.Divider />
                  <ActionList.Item onSelect={() => onSort(sort.key)}>
                    Inverter ordenação · {sort.direction === 'asc' ? 'crescente' : 'decrescente'}
                  </ActionList.Item>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </Box>
          {rows.map((account) => (
            <Box
              key={account.id}
              className="accounts-mobile-row"
              sx={{
                borderBottom: '1px solid',
                borderColor: 'border.muted',
                bg: selectedIds.has(account.id) ? 'accent.subtle' : 'canvas.default',
              }}
            >
              <Box as="label" className="accounts-row-selection">
                <Checkbox
                  aria-label={`Selecionar @${account.username || 'sem usuário'} na lista móvel`}
                  checked={selectedIds.has(account.id)}
                  disabled={disabled}
                  onChange={() => onToggleRow(account.id)}
                />
              </Box>
              <Box
                as="button"
                type="button"
                className="accounts-row-open"
                aria-describedby={`account-email-${account.id} account-use-${account.id} account-state-${account.id}`}
                aria-label={account.username ? `@${account.username}` : '(sem @usuário)'}
                onClick={() => onOpen(account.id)}
                sx={{ color: 'fg.default' }}
              >
                <Box className="accounts-row-identity">
                  <Text className="accounts-row-name">
                    {account.username ? `@${account.username}` : '(sem @usuário)'}
                  </Text>
                  <Text id={`account-email-${account.id}`} sx={{ color: 'fg.muted', fontSize: 0 }}>
                    {maskEmail(account.email)}
                  </Text>
                  <Text id={`account-use-${account.id}`} sx={{ color: 'fg.muted', fontSize: 0 }}>
                    Uso:{' '}
                    {account.last_active_at ? formatDate(account.last_active_at) : 'Sem registro'}
                  </Text>
                </Box>
                <Box id={`account-state-${account.id}`} className="accounts-row-state">
                  <AccountStatusBadge status={account.status} compact />
                  <ChevronRightIcon size={16} />
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {!mobile && (
        <Box sx={{ overflowX: 'auto', display: ['none', null, 'block'] }}>
          <Box
            as="table"
            sx={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 1,
              'th, td': { px: 2, py: 2, textAlign: 'left', overflowWrap: 'anywhere' },
              th: { color: 'fg.muted', fontWeight: 'normal', bg: 'canvas.subtle' },
              'tbody tr': { borderTop: '1px solid', borderColor: 'border.default' },
            }}
          >
            <thead>
              <tr>
                <Box as="th" sx={{ width: 40 }}>
                  <Checkbox
                    aria-label="Selecionar todas as contas desta página"
                    checked={allSelected}
                    indeterminate={!allSelected && someSelected}
                    disabled={disabled}
                    onChange={onTogglePage}
                  />
                </Box>
                <th
                  aria-sort={
                    sort.key === 'username'
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <SortHeader label="Usuário" sortKey="username" sort={sort} onSort={onSort} />
                </th>
                <Box as="th" sx={hidden([null, 'table-cell'])}>
                  E-mail
                </Box>
                {columns.map((column) => (
                  <Box
                    as="th"
                    key={column.key}
                    sx={hidden(column.show)}
                    aria-sort={
                      sort.key === column.sort
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    <SortHeader
                      label={column.label}
                      sortKey={column.sort}
                      sort={sort}
                      onSort={onSort}
                    />
                  </Box>
                ))}
                <Box as="th" sx={{ width: 48 }}>
                  <Text
                    sx={{
                      position: 'absolute',
                      width: 1,
                      height: 1,
                      overflow: 'hidden',
                      clip: 'rect(0 0 0 0)',
                    }}
                  >
                    Ações
                  </Text>
                </Box>
              </tr>
            </thead>
            <tbody>
              {rows.map((account) => {
                const selected = selectedIds.has(account.id)
                return (
                  <Box
                    as="tr"
                    key={account.id}
                    data-testid="account-row"
                    aria-selected={openId === account.id}
                    onClick={() => onOpen(account.id)}
                    sx={{
                      cursor: 'pointer',
                      bg: selected
                        ? 'accent.subtle'
                        : openId === account.id
                          ? 'canvas.subtle'
                          : 'transparent',
                      '&:hover': { bg: 'canvas.subtle' },
                    }}
                  >
                    <td onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        aria-label={`Selecionar ${account.username ? `@${account.username}` : account.email || account.id}`}
                        disabled={disabled}
                        checked={selected}
                        onChange={() => onToggleRow(account.id)}
                      />
                    </td>
                    <td>
                      <Box
                        as="button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpen(account.id)
                        }}
                        sx={{
                          all: 'unset',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          color: 'fg.default',
                          minHeight: 44,
                          overflowWrap: 'anywhere',
                          '&:focus-visible': { outline: '2px solid', outlineColor: 'accent.fg' },
                        }}
                      >
                        {account.username ? `@${account.username}` : '(sem @usuário)'}
                      </Box>
                      <Text sx={{ display: ['block', 'none'], fontSize: 0, color: 'fg.muted' }}>
                        {maskEmail(account.email)}
                      </Text>
                    </td>
                    <Box as="td" sx={{ ...hidden([null, 'table-cell']), color: 'fg.muted' }}>
                      {maskEmail(account.email)}
                    </Box>
                    {columns.map((column) => (
                      <Box as="td" key={column.key} sx={hidden(column.show)}>
                        {cell(column.key, account)}
                      </Box>
                    ))}
                    <td onClick={(event) => event.stopPropagation()}>
                      {(canManageStatus(account) || canDelete(account)) && (
                        <ActionMenu>
                          <ActionMenu.Anchor>
                            <IconButton
                              icon={KebabHorizontalIcon}
                              variant="invisible"
                              disabled={disabled}
                              aria-label={`Mais ações de ${account.username ? `@${account.username}` : account.id}`}
                            />
                          </ActionMenu.Anchor>
                          <ActionMenu.Overlay align="end">
                            <ActionList>
                              {canManageStatus(account) &&
                                (account.status === 'disabled' ? (
                                  <ActionList.Item onSelect={() => onEnable(account)}>
                                    Reativar conta
                                  </ActionList.Item>
                                ) : (
                                  <ActionList.Item onSelect={() => onDisable(account)}>
                                    Desativar conta
                                  </ActionList.Item>
                                ))}
                              {canDelete(account) && (
                                <ActionList.Item
                                  variant="danger"
                                  onSelect={() => onDelete(account)}
                                >
                                  Excluir permanentemente
                                </ActionList.Item>
                              )}
                            </ActionList>
                          </ActionMenu.Overlay>
                        </ActionMenu>
                      )}
                    </td>
                  </Box>
                )
              })}
            </tbody>
          </Box>
        </Box>
      )}

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          px: 3,
          py: 2,
          borderTop: '1px solid',
          borderColor: 'border.default',
          fontSize: 1,
          color: 'fg.muted',
        }}
      >
        <Text>
          {total === 0
            ? 'Nenhuma conta'
            : `Mostrando ${pagination.start + 1}–${pagination.start + rows.length} de ${total.toLocaleString('pt-BR')} contas`}
        </Text>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton
            icon={ChevronLeftIcon}
            aria-label="Página anterior"
            sx={{ minHeight: 44, minWidth: 44 }}
            disabled={pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
          />
          <Text sx={{ whiteSpace: 'nowrap' }}>
            {pagination.page} / {pagination.pageCount}
          </Text>
          <IconButton
            icon={ChevronRightIcon}
            aria-label="Próxima página"
            sx={{ minHeight: 44, minWidth: 44 }}
            disabled={pagination.page >= pagination.pageCount}
            onClick={() => onPageChange(pagination.page + 1)}
          />
          <Select
            aria-label="Itens por página"
            sx={{ minHeight: 44, minWidth: 44 }}
            value={String(pageSize)}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {PAGE_SIZES.map((size) => (
              <Select.Option key={size} value={String(size)}>
                {size} por página
              </Select.Option>
            ))}
          </Select>
        </Box>
      </Box>
    </Box>
  )
}
