import { Link } from 'react-router-dom'
import { useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  Flash,
  FormControl,
  Heading,
  Label,
  Spinner,
  Text,
  Textarea,
} from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { ShieldLockIcon } from '@primer/octicons-react'
import { useAdminAccountDeletions } from '../hooks/useAdminAccountDeletions'
import { getDeletionFinancialHistory } from '../services/adminAccountDeletionsService'
import { useToast } from '../hooks/useToast'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { toDate } from '../utils/date'
import { formatCentavosBRL, formatDateTime } from '../utils/format'
import {
  ADMIN_ACTIONS,
  BLOCK_REASON_LABELS,
  CASE_EVENT_LABELS,
  CASE_STATUS_LABELS,
  DELETION_STATE_LABELS,
  describeCaseRetention,
  NOTE_MIN_LENGTH,
  PURCHASE_STATUS_LABELS,
  REVIEW_RESULT_LABELS,
} from '../utils/accountDeletion'

const KNOWN_ERRORS = {
  JOB_NOT_FOUND: 'Solicitação de exclusão não encontrada.',
  NOT_BLOCKED: 'Esta solicitação não está mais aguardando revisão financeira.',
  NOT_CANCELLABLE: 'A exclusão já foi concluída -- não é mais possível cancelar.',
  DELETION_CANCELLED: 'Esta solicitação já foi cancelada.',
  NO_FINANCIAL_PENDING:
    'Não há pendência financeira -- use "Revalidar bloqueio" para retomar a exclusão.',
  PERMISSION_DENIED: 'Você não tem permissão para esta ação.',
  NOTE_REQUIRED: `A nota administrativa é obrigatória (mínimo ${NOTE_MIN_LENGTH} caracteres).`,
  NOTE_TOO_LONG: 'A nota deve ter no máximo 500 caracteres.',
}

function stateVariant(state) {
  if (state === 'blocked_financial_review') return 'attention'
  if (state === 'complete') return 'done'
  if (state === 'cancelled') return 'secondary'
  return 'accent'
}

// Todas as ações exigem confirmação explícita e nota administrativa (mínimo 5 caracteres,
// a mesma validação que o banco repete). O diálogo só pede; a decisão é do servidor.
function ActionDialog({ request, actionKey, onClose, onConfirm }) {
  const action = ADMIN_ACTIONS[actionKey]
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const valid = note.trim().length >= NOTE_MIN_LENGTH

  return (
    <Dialog
      title={`${action.title} -- ${request.protocol}`}
      onClose={saving ? () => {} : onClose}
      footerButtons={[
        { content: 'Voltar', onClick: onClose, disabled: saving },
        {
          content: action.confirm,
          buttonType: action.danger ? 'danger' : 'primary',
          disabled: !valid || saving,
          onClick: async () => {
            setSaving(true)
            setError((await onConfirm(note.trim())) || '')
            setSaving(false)
          },
        },
      ]}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Text>{action.description}</Text>
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
          Conta {request.username ? `@${request.username}` : request.targetId} · saldo atual{' '}
          {request.cashBalance} EvoCash · {request.pendingPurchases.length} compra(s) pendente(s)
        </Text>
        {error && (
          <Flash variant="danger" role="alert">
            {error}
          </Flash>
        )}
        <FormControl required>
          <FormControl.Label>Nota administrativa</FormControl.Label>
          <Textarea
            block
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Registre o motivo da decisão (fica no histórico auditável)"
          />
        </FormControl>
      </Box>
    </Dialog>
  )
}

function FinancialHistory({ jobId }) {
  const [state, setState] = useState({ status: 'idle', data: null })

  async function load() {
    setState({ status: 'loading', data: null })
    try {
      setState({ status: 'ready', data: await getDeletionFinancialHistory(jobId) })
    } catch (err) {
      console.error('[AdminAccountDeletions] history:', err)
      setState({ status: 'error', data: null })
    }
  }

  if (state.status === 'idle') return <Button onClick={load}>Abrir histórico financeiro</Button>
  if (state.status === 'loading') return <Spinner size="small" />
  if (state.status === 'error') {
    return (
      <Flash variant="danger" role="alert">
        Não foi possível carregar o histórico financeiro.{' '}
        <Button size="small" onClick={load}>
          Tentar novamente
        </Button>
      </Flash>
    )
  }

  const { wallet, ledger, purchases, case: financialCase } = state.data
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 2,
        fontSize: 0,
      }}
      aria-label="Histórico financeiro"
    >
      <Text as="p" sx={{ fontWeight: 'bold', m: 0 }}>
        Histórico financeiro
      </Text>
      <Text as="p" sx={{ m: 0 }}>
        Carteira:{' '}
        {wallet
          ? `${wallet.cashBalance} EvoCash · ${wallet.coinBalance} EvoCoins`
          : 'conta já excluída'}
      </Text>

      {financialCase && (
        <Box sx={{ mt: 2 }}>
          <Text as="p" sx={{ fontWeight: 'bold', m: 0 }}>
            Caso {financialCase.protocol} ·{' '}
            {CASE_STATUS_LABELS[financialCase.status] || financialCase.status}
          </Text>
          <Text as="p" sx={{ m: 0, color: 'fg.muted' }}>
            Saldo na separação: {financialCase.cashBalanceSnapshot} EvoCash
            {financialCase.cashBalanceFinal != null &&
              ` · saldo final na exclusão: ${financialCase.cashBalanceFinal}`}
            {' · '}
            {financialCase.pendingPurchasesSnapshot} compra(s) pendente(s) ·{' '}
            {financialCase.ledgerEntriesSnapshot} lançamento(s) de ledger
          </Text>
          <Text as="p" sx={{ m: 0, color: 'fg.muted' }}>
            Decisão: “{financialCase.decisionNote}”
          </Text>
          {describeCaseRetention(financialCase).map((line) => (
            <Text as="p" key={line} sx={{ m: 0, color: 'fg.muted' }}>
              {line}
            </Text>
          ))}
          {financialCase.events.map((event) => (
            <Text as="p" key={event.id} sx={{ m: 0, color: 'fg.muted' }}>
              {formatDateTime(toDate(event.createdAt))} ·{' '}
              {CASE_EVENT_LABELS[event.kind] || event.kind}
              {event.cashAmount != null ? ` · ${event.cashAmount} EvoCash` : ''}
              {event.note ? ` — “${event.note}”` : ''}
            </Text>
          ))}
        </Box>
      )}

      <Text as="p" sx={{ fontWeight: 'bold', mt: 2, mb: 0 }}>
        Compras de EvoCash ({purchases.length})
      </Text>
      {purchases.length === 0 && <Text sx={{ color: 'fg.muted' }}>Nenhuma compra.</Text>}
      {purchases.map((purchase) => (
        <Text as="p" key={purchase.id} sx={{ m: 0, color: 'fg.muted' }}>
          {formatDateTime(toDate(purchase.createdAt))} · {purchase.packageLabel} ·{' '}
          {purchase.cashAmount} EvoCash · {formatCentavosBRL(purchase.amountCentavos)} ·{' '}
          {PURCHASE_STATUS_LABELS[purchase.status] || purchase.status}
        </Text>
      ))}

      <Text as="p" sx={{ fontWeight: 'bold', mt: 2, mb: 0 }}>
        Ledger ({ledger.length}, mais recentes primeiro)
      </Text>
      {ledger.length === 0 && <Text sx={{ color: 'fg.muted' }}>Nenhum lançamento.</Text>}
      {ledger.map((entry) => (
        <Text as="p" key={entry.id} sx={{ m: 0, color: 'fg.muted' }}>
          {formatDateTime(toDate(entry.createdAt))} · {entry.asset}{' '}
          {entry.direction === 'credit' ? '+' : '−'}
          {entry.amount} · {entry.reason}
        </Text>
      ))}
    </Box>
  )
}

function RequestCard({ request, busy, anyBusy, onAction }) {
  const label = request.username ? `@${request.username}` : request.targetId
  return (
    <Box
      as="article"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        mb: 3,
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Text sx={{ fontWeight: 'bold' }}>{label}</Text>
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
            Protocolo {request.protocol} · {request.targetId} · solicitada em{' '}
            {formatDateTime(toDate(request.createdAt))}
            {request.requestedBy ? ` · por ${request.requestedBy}` : ''}
          </Text>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Label variant={stateVariant(request.state)}>
            {DELETION_STATE_LABELS[request.state] || request.state}
          </Label>
          {request.blockReason && (
            <Label variant="attention">
              {BLOCK_REASON_LABELS[request.blockReason] || request.blockReason}
            </Label>
          )}
          {request.financialCase && (
            <Label variant="accent">
              Caso {request.financialCase.protocol} ·{' '}
              {CASE_STATUS_LABELS[request.financialCase.status]}
            </Label>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Text as="p" sx={{ fontSize: 1, m: 0 }}>
          Saldo EvoCash: <strong>{request.cashBalance}</strong>
        </Text>
        <Text as="p" sx={{ fontSize: 1, m: 0 }}>
          Compras pendentes: <strong>{request.pendingPurchases.length}</strong>
          {request.pendingPurchases.length > 0 &&
            ` (${request.pendingPurchases
              .map(
                (purchase) =>
                  `${purchase.cashAmount} EvoCash · ${formatCentavosBRL(purchase.amountCentavos)}`
              )
              .join('; ')})`}
        </Text>
        {request.financialCase?.heldPaymentsCount > 0 && (
          <Text as="p" sx={{ fontSize: 1, m: 0 }}>
            Pagamentos retidos no caso: <strong>{request.financialCase.heldPaymentsCount}</strong> (
            {request.financialCase.heldCashAmount} EvoCash)
          </Text>
        )}
      </Box>

      {request.history.length > 0 && (
        <Box sx={{ borderTop: '1px solid', borderColor: 'border.default', pt: 2 }}>
          <Text sx={{ fontWeight: 'bold', fontSize: 0 }}>Histórico de revisão</Text>
          {request.history.map((entry) => (
            <Text as="p" key={entry.id} sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
              {formatDateTime(toDate(entry.checkedAt))} · {entry.adminId || 'admin removido'} —{' '}
              {REVIEW_RESULT_LABELS[entry.resultingState] || entry.resultingState}
              {entry.note ? `: “${entry.note}”` : ''}
            </Text>
          ))}
        </Box>
      )}

      <Box
        sx={{
          display: 'flex',
          gap: 2,
          flexWrap: 'wrap',
          borderTop: '1px solid',
          borderColor: 'border.default',
          pt: 2,
        }}
      >
        {request.canRevalidate && (
          <Button
            loading={busy}
            disabled={anyBusy && !busy}
            onClick={() => onAction(request, 'revalidate')}
          >
            Revalidar bloqueio
          </Button>
        )}
        {request.canSeparate && (
          <Button
            variant="primary"
            disabled={anyBusy}
            onClick={() => onAction(request, 'separate')}
          >
            Prosseguir com exclusão mantendo caso financeiro
          </Button>
        )}
        {request.canCancel && (
          <Button variant="danger" disabled={anyBusy} onClick={() => onAction(request, 'cancel')}>
            Cancelar solicitação / reativar conta
          </Button>
        )}
        {request.accountExists ? (
          <Button as={Link} to={`/admin/contas?usuario=${encodeURIComponent(request.targetId)}`}>
            Abrir conta
          </Button>
        ) : (
          <Text sx={{ fontSize: 0, color: 'fg.muted', alignSelf: 'center' }}>
            Conta já excluída
          </Text>
        )}
      </Box>
      <FinancialHistory jobId={request.id} />
    </Box>
  )
}

// Painel "Exclusão de contas". Uma conta com saldo de EvoCash positivo (ou compra
// pendente) fica em blocked_financial_review -- e saldo não some sozinho (não existe
// estorno/perda de saldo). Por isso, além de revalidar, o superadmin pode PROSSEGUIR com a
// exclusão mantendo um caso financeiro separado e auditável (separate_financial_case_and_
// resume_deletion): não zera EvoCash, não apaga ledger, não declara nada quitado -- só
// preserva o que é devido num caso à parte e libera o worker normal. Nunca existe um botão
// de "forçar exclusão": o front não exclui nada, só pede a decisão ao banco.
export default function AdminAccountDeletions() {
  const { scope, setScope, requests, loading, error, busy, refresh, review, separateCase, cancel } =
    useAdminAccountDeletions()
  const { toasts, showToast } = useToast()
  const [dialog, setDialog] = useState(null) // { request, actionKey }

  async function handleConfirm(note) {
    const { request, actionKey } = dialog
    try {
      if (actionKey === 'revalidate') {
        const result = await review(request.id, note)
        showToast(
          result.resumed
            ? 'Bloqueio removido -- a exclusão será retomada automaticamente.'
            : `Revisão registrada -- continua bloqueado (${BLOCK_REASON_LABELS[result.blockReason] || result.blockReason}).`
        )
      } else if (actionKey === 'separate') {
        const result = await separateCase(request.id, note)
        showToast(
          `Caso financeiro ${result.protocol} ${result.replay ? 'já existia' : 'criado'} -- a exclusão seguirá pelo worker.`
        )
      } else {
        await cancel(request.id, note)
        showToast('Solicitação cancelada e conta reativada.')
      }
      setDialog(null)
      return ''
    } catch (err) {
      console.error('[AdminAccountDeletions] action:', actionKey, err)
      return KNOWN_ERRORS[err?.message] || 'Não foi possível concluir a ação. Tente novamente.'
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Button as={Link} to="/admin/contas" replace>
          Contas
        </Button>
        <Button as={Link} to="/admin/compras-evocash" replace>
          Compras de EvoCash
        </Button>
      </Box>
      <ToastFlash toasts={toasts} />
      <Heading as="h1" sx={{ fontSize: 3, mb: 2 }}>
        Exclusão de contas
      </Heading>
      <Text as="p" sx={{ color: 'fg.muted', mb: 3 }}>
        Acompanhe as solicitações de exclusão. Nenhuma ação daqui altera saldo, ledger ou compras: a
        revisão só reavalia o bloqueio, e “manter caso financeiro” registra a pendência num caso
        separado antes de a exclusão seguir. Toda ação exige confirmação e uma nota administrativa.
      </Text>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Button variant={scope === 'open' ? 'primary' : 'default'} onClick={() => setScope('open')}>
          Em andamento
        </Button>
        <Button
          variant={scope === 'closed' ? 'primary' : 'default'}
          onClick={() => setScope('closed')}
        >
          Encerradas (60 dias)
        </Button>
        <Button onClick={refresh} disabled={loading}>
          Atualizar lista
        </Button>
      </Box>
      {loading && requests.length === 0 && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && requests.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <ShieldLockIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>
            {scope === 'open'
              ? 'Nenhuma exclusão em andamento'
              : 'Nenhuma exclusão encerrada recentemente'}
          </Blankslate.Heading>
        </Blankslate>
      )}

      {requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          busy={busy === request.id}
          anyBusy={!!busy}
          onAction={(target, actionKey) => setDialog({ request: target, actionKey })}
        />
      ))}

      {dialog && (
        <ActionDialog
          request={dialog.request}
          actionKey={dialog.actionKey}
          onClose={() => setDialog(null)}
          onConfirm={handleConfirm}
        />
      )}
    </Box>
  )
}
