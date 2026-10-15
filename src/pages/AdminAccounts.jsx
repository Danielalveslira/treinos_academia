import '../features/adminAccounts/accounts.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  Flash,
  Heading,
  Select,
  Spinner,
  Text,
  UnderlineNav,
  useResponsiveValue,
} from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PersonIcon, SyncIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { ToastFlash } from '../components/ToastFlash'
import AdminNav from '../components/AdminNav'
import { formatDateTime } from '../utils/format'
import { useAdminAccountsSnapshot } from '../features/adminAccounts/hooks/useAdminAccountsSnapshot'
import { useAccountDetails } from '../features/adminAccounts/hooks/useAccountDetails'
import {
  fetchAuditLog,
  requestAccountDeletion,
  setAccountsStatus,
} from '../features/adminAccounts/api/adminAccounts.api'
import {
  DEFAULT_VISIBLE_COLUMNS,
  EMPTY_FILTERS,
  PAGE_SIZES,
  TABS,
  buildAccountsCsv,
  canDelete,
  canManageStatus,
  csvFileName,
  deletionRequestedChange,
  describeActionError,
  filterAccounts,
  paginate,
  sortAccounts,
  statusChangeFor,
} from '../features/adminAccounts/utils/accounts'
import { AccountsMetrics } from '../features/adminAccounts/components/AccountsMetrics'
import { AccountsToolbar } from '../features/adminAccounts/components/AccountsToolbar'
import { AccountsTable } from '../features/adminAccounts/components/AccountsTable'
import { AccountDrawer } from '../features/adminAccounts/components/AccountDrawer'
import { BulkActionsBar } from '../features/adminAccounts/components/BulkActionsBar'
import { AuditLogList } from '../features/adminAccounts/components/AuditLogList'
import {
  DeleteAccountDialog,
  StatusDialog,
} from '../features/adminAccounts/components/AccountDialogs'

function downloadCsv(accounts) {
  const url = URL.createObjectURL(
    new Blob([buildAccountsCsv(accounts)], { type: 'text/csv;charset=utf-8' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = csvFileName()
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// Só a ação "Atualizar" lê a lista; busca, filtros, ordenação, abas, paginação, painel (Visão
// geral) e CSV trabalham sobre o snapshot em memória. Nada aqui usa timer, foco de janela ou
// realtime.
export default function AdminAccounts() {
  const { user, isSuperAdmin, loading } = useAuth()
  if (loading || !isSuperAdmin || !user?.uid) return null
  return <AdminAccountsSession key={user.uid} />
}

function AdminAccountsSession() {
  const { snapshot, isRefreshing, error, localChangeAt, syncedVersion, refresh, applyChanges } =
    useAdminAccountsSnapshot()
  const { toasts, showToast } = useToast()

  const [tab, setTab] = useState('all')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort] = useState({ key: 'created_at', direction: 'desc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[1])
  const [selection, setSelection] = useState(() => new Set())
  const [openId, setOpenId] = useState(null)
  const details = useAccountDetails(syncedVersion, openId)
  const active = useRef(true)
  const logRevision = useRef(0)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      logRevision.current += 1
    }
  }, [])
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(DEFAULT_VISIBLE_COLUMNS))
  const [dialog, setDialog] = useState(null) // { type: 'status'|'delete', ... }
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState({ status: 'idle', data: [] })

  const accounts = useMemo(() => snapshot?.accounts ?? [], [snapshot])
  const byId = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const filtered = useMemo(() => filterAccounts(accounts, filters, tab), [accounts, filters, tab])
  const sorted = useMemo(() => sortAccounts(filtered, sort), [filtered, sort])
  const pagination = useMemo(() => paginate(sorted, page, pageSize), [sorted, page, pageSize])
  const selectedAccounts = useMemo(
    () => [...selection].map((id) => byId.get(id)).filter(Boolean),
    [selection, byId]
  )
  const openAccount = openId ? byId.get(openId) : null

  function changeFilter(key, value) {
    setFilters((previous) => ({ ...previous, [key]: value }))
    setPage(1)
    setSelection(new Set())
  }

  function changeSort(key) {
    setSelection(new Set())
    setPage(1)
    setSort((previous) =>
      previous.key === key
        ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'username' ? 'asc' : 'desc' }
    )
  }

  function toggleRow(id) {
    setSelection((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  function togglePage() {
    setSelection((previous) => {
      const next = new Set(previous)
      const everySelected = pagination.rows.every((row) => next.has(row.id))
      for (const row of pagination.rows) {
        if (everySelected) next.delete(row.id)
        else next.add(row.id)
      }
      return next
    })
  }

  function toggleColumn(key) {
    setVisibleColumns((previous) => {
      const next = new Set(previous)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  const handleCopied = useCallback(
    (copied, label) =>
      copied ? showToast(`${label} copiado.`) : showToast('Não foi possível copiar.', 'danger'),
    [showToast]
  )

  function afterAdminAction(ids) {
    logRevision.current += 1
    for (const id of ids) details.invalidate(id, 'audit')
    setLogs((previous) => (previous.status === 'idle' ? previous : { status: 'idle', data: [] }))
  }

  async function handleRefresh() {
    const ok = await refresh()
    if (!active.current) return
    if (ok) {
      logRevision.current += 1
      setSelection(new Set())
      setLogs({ status: 'idle', data: [] })
    }
  }

  // Desativar/reativar 1..N contas: 1 escrita; o estado local é atualizado com o resultado e
  // nenhum snapshot novo é pedido.
  async function runStatusChange(targets, disabled, reason) {
    try {
      const results = await setAccountsStatus(
        targets.map((account) => account.id),
        disabled,
        reason
      )
      if (!active.current) return
      const changes = new Map()
      const failures = []
      for (const result of results) {
        if (result.ok) changes.set(result.id, statusChangeFor(byId.get(result.id), result))
        else failures.push(result)
      }
      applyChanges(changes)
      afterAdminAction([...changes.keys()])
      setSelection((previous) => new Set([...previous].filter((id) => !changes.has(id))))
      setDialog(null)
      const verb = disabled ? 'desativada' : 'reativada'
      if (failures.length === 0) {
        showToast(changes.size === 1 ? `Conta ${verb}.` : `${changes.size} contas ${verb}s.`)
      } else {
        showToast(
          `${changes.size} ${verb}(s), ${failures.length} com falha: ${describeActionError(failures[0].error, 'erro inesperado')}`,
          'danger'
        )
      }
    } catch (err) {
      return describeActionError(err, 'Erro ao alterar o status. Tente novamente.')
    }
  }

  async function runDeletion(account, reason) {
    try {
      await requestAccountDeletion(account.id, reason)
      if (!active.current) return
      applyChanges(new Map([[account.id, deletionRequestedChange]]))
      afterAdminAction([account.id])
      setDialog(null)
      showToast('Exclusão agendada. A conta já está bloqueada.')
    } catch (err) {
      return describeActionError(err, 'Erro ao excluir conta.')
    }
  }

  const openStatusDialog = (targets, disabled) => {
    if (busy || isRefreshing) return
    if (targets.length > 100) {
      showToast('Selecione até 100 contas por ação.', 'danger')
      return
    }
    const eligible = targets.filter(
      (account) =>
        canManageStatus(account) &&
        (disabled ? account.status !== 'disabled' : account.status === 'disabled')
    )
    if (eligible.length === 0) {
      showToast('Nenhuma das contas pode ser alterada por esta ação.', 'danger')
      return
    }
    setDialog({
      type: 'status',
      targets: eligible,
      skipped: targets.length - eligible.length,
      disabled,
    })
  }

  async function loadLogs() {
    const revision = ++logRevision.current
    setLogs((previous) => ({ ...previous, status: 'loading' }))
    try {
      const data = await fetchAuditLog({ limit: 100 })
      if (!active.current || revision !== logRevision.current) return
      setLogs({ status: 'ready', data })
    } catch {
      if (!active.current || revision !== logRevision.current) return
      setLogs((previous) => ({ ...previous, status: 'error' }))
    }
  }

  const mobile = useResponsiveValue({ narrow: true, regular: false }, false)
  const changeTab = (next) => {
    setTab(next)
    setPage(1)
    setSelection(new Set())
  }
  const initial = !snapshot && !isRefreshing && !error
  const drawerOpen = Boolean(openAccount) && tab !== 'logs'

  return (
    <Box
      className="admin-accounts"
      sx={{
        minWidth: 0,
        pb: 'calc(80px + env(safe-area-inset-bottom))',
        button: { minHeight: 44 },
      }}
    >
      <AdminNav current="/admin/contas" currentLabel="Contas" />
      <ToastFlash toasts={toasts} />
      <Box className="accounts-heading">
        <Box>
          <Heading as="h1" sx={{ fontSize: 4, letterSpacing: '-0.02em' }}>
            Contas
          </Heading>
          <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Acesso, status e solicitações.</Text>
        </Box>
        <Button
          variant="invisible"
          leadingVisual={isRefreshing ? Spinner : SyncIcon}
          onClick={handleRefresh}
          disabled={isRefreshing || busy}
        >
          {isRefreshing ? 'Atualizando...' : snapshot ? 'Atualizar' : 'Atualizar dados'}
        </Button>
        {snapshot && (
          <Text
            className="accounts-sync"
            sx={{ fontSize: 0, color: 'fg.muted' }}
            aria-live="polite"
          >
            Última atualização: {formatDateTime(snapshot.generated_at)}
            {localChangeAt ? ` · alterações locais às ${formatDateTime(localChangeAt)}` : ''}
          </Text>
        )}
      </Box>

      {error && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          <Text sx={{ display: 'block' }}>Não foi possível atualizar os dados.</Text>
          {snapshot && (
            <Text sx={{ display: 'block' }}>
              Os dados exibidos são da última atualização bem-sucedida.
            </Text>
          )}
          <Box sx={{ mt: 2 }}>
            <Button size="small" onClick={handleRefresh} disabled={isRefreshing || busy}>
              Tentar novamente
            </Button>
          </Box>
        </Flash>
      )}

      {initial && (
        <Blankslate>
          <Blankslate.Visual>
            <PersonIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Dados ainda não carregados</Blankslate.Heading>
          <Blankslate.Description>
            A lista só é lida quando você pede, para economizar o banco.
          </Blankslate.Description>
          <Blankslate.PrimaryAction onClick={handleRefresh}>
            Atualizar dados
          </Blankslate.PrimaryAction>
        </Blankslate>
      )}

      {!snapshot && isRefreshing && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}

      {snapshot && (
        <>
          {snapshot.meta.truncated && (
            <Flash variant="warning" sx={{ mb: 3 }}>
              O snapshot traz as {snapshot.meta.returned.toLocaleString('pt-BR')} contas mais
              recentes de {snapshot.meta.total.toLocaleString('pt-BR')}. Busca e filtros valem só
              para elas. O CSV também inclui somente contas deste snapshot.
            </Flash>
          )}
          <AccountsMetrics
            metrics={snapshot.metrics}
            activeCard={filters.card}
            onSelectCard={(card) => {
              changeFilter('card', card)
              setTab('all')
            }}
          />
          <AccountsToolbar
            filters={filters}
            onFilterChange={changeFilter}
            onClearFilters={() => {
              setFilters(EMPTY_FILTERS)
              setPage(1)
              setSelection(new Set())
            }}
            visibleColumns={visibleColumns}
            onToggleColumn={toggleColumn}
            onExport={() => downloadCsv(sorted)}
            exportCount={sorted.length}
          />

          {mobile ? (
            <Box className="accounts-context">
              <Select
                aria-label="Seção de contas"
                className="accounts-context-select"
                value={tab}
                onChange={(event) => changeTab(event.target.value)}
                sx={{
                  border: 'none',
                  boxShadow: 'none',
                  bg: 'transparent',
                  minHeight: 44,
                  fontWeight: 'bold',
                  minWidth: 0,
                }}
              >
                {TABS.map((item) => (
                  <Select.Option key={item.key} value={item.key}>
                    {item.label}
                  </Select.Option>
                ))}
              </Select>
              {tab !== 'logs' && (
                <Text
                  sx={{ fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap' }}
                  aria-live="polite"
                >
                  {sorted.length} contas
                </Text>
              )}
            </Box>
          ) : (
            <UnderlineNav aria-label="Seções de contas" sx={{ mb: 2 }}>
              {TABS.map((item) => (
                <UnderlineNav.Item
                  key={item.key}
                  as="button"
                  aria-current={tab === item.key ? 'page' : undefined}
                  onSelect={() => changeTab(item.key)}
                >
                  {item.label}
                </UnderlineNav.Item>
              ))}
            </UnderlineNav>
          )}

          {tab === 'logs' ? (
            <Box>
              {logs.status === 'idle' && (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    alignItems: 'flex-start',
                  }}
                >
                  <Text sx={{ color: 'fg.muted' }}>Nenhum log carregado.</Text>
                  <Button onClick={loadLogs}>Carregar logs</Button>
                </Box>
              )}
              {logs.status === 'loading' && <Spinner />}
              {logs.status === 'error' && (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    alignItems: 'flex-start',
                  }}
                >
                  <Text sx={{ color: 'danger.fg' }}>Não foi possível carregar os logs.</Text>
                  <Button onClick={loadLogs}>Tentar novamente</Button>
                </Box>
              )}
              {logs.status === 'ready' && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <Box>
                    <Button size="small" onClick={loadLogs}>
                      Recarregar logs
                    </Button>
                    <Text sx={{ ml: 2, fontSize: 0, color: 'fg.muted' }}>
                      Últimos 100 registros.
                    </Text>
                  </Box>
                  <AuditLogList entries={logs.data} showTarget />
                </Box>
              )}
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr)',
                gap: 3,
                alignItems: 'start',
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <BulkActionsBar
                  count={selectedAccounts.length}
                  busy={busy || isRefreshing}
                  onDisable={() => openStatusDialog(selectedAccounts, true)}
                  onEnable={() => openStatusDialog(selectedAccounts, false)}
                  onExport={() => downloadCsv(selectedAccounts)}
                  onClear={() => setSelection(new Set())}
                />
                {sorted.length === 0 ? (
                  <Blankslate>
                    <Blankslate.Visual>
                      <PersonIcon size={24} />
                    </Blankslate.Visual>
                    <Blankslate.Heading>Nenhuma conta encontrada</Blankslate.Heading>
                    <Blankslate.Description>
                      Ajuste a busca ou os filtros para ver outras contas.
                    </Blankslate.Description>
                  </Blankslate>
                ) : (
                  <AccountsTable
                    rows={pagination.rows}
                    selectedIds={selection}
                    openId={openId}
                    sort={sort}
                    visibleColumns={visibleColumns}
                    disabled={busy || isRefreshing}
                    compact={false}
                    pagination={pagination}
                    total={sorted.length}
                    pageSize={pageSize}
                    onSort={changeSort}
                    onToggleRow={toggleRow}
                    onTogglePage={togglePage}
                    onOpen={setOpenId}
                    onDisable={(account) => openStatusDialog([account], true)}
                    onEnable={(account) => openStatusDialog([account], false)}
                    onDelete={(account) =>
                      canDelete(account) && setDialog({ type: 'delete', account })
                    }
                    onPageChange={(next) => {
                      setPage(next)
                      setSelection(new Set())
                    }}
                    onPageSizeChange={(size) => {
                      setPageSize(size)
                      setPage(1)
                      setSelection(new Set())
                    }}
                  />
                )}
              </Box>
              {drawerOpen && (
                <AccountDrawer
                  key={openAccount.id}
                  account={openAccount}
                  entries={details.entries}
                  busy={busy || isRefreshing}
                  onLoadSection={details.load}
                  onClose={() => setOpenId(null)}
                  onDisable={(account) => openStatusDialog([account], true)}
                  onEnable={(account) => openStatusDialog([account], false)}
                  onDelete={(account) => setDialog({ type: 'delete', account })}
                  onCopied={handleCopied}
                />
              )}
            </Box>
          )}
        </>
      )}

      {dialog?.type === 'status' && (
        <StatusDialog
          targets={dialog.targets}
          skipped={dialog.skipped}
          disabled={dialog.disabled}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            setBusy(true)
            try {
              return await runStatusChange(dialog.targets, dialog.disabled, reason)
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
      {dialog?.type === 'delete' && (
        <DeleteAccountDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            setBusy(true)
            try {
              return await runDeletion(dialog.account, reason)
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </Box>
  )
}
