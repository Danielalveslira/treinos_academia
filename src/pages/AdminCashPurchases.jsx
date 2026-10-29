import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Box,
  Button,
  Dialog,
  Flash,
  FormControl,
  Heading,
  Label,
  Select,
  Spinner,
  Text,
  Textarea,
  UnderlineNav,
} from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { useCashPurchases } from '../hooks/useCashPurchases'
import { useUsernamesByIds } from '../hooks/useUsernamesByIds'
import { useLatestCashPurchaseReminders } from '../hooks/useLatestCashPurchaseReminders'
import { useToast } from '../hooks/useToast'
import { ToastFlash } from '../components/ToastFlash'
import { RefundRequestsPanel } from '../components/Refunds'
import AdminNav from '../components/AdminNav'
import { EvoCashPricingPanel, EvoCashPriceHistory } from '../components/EvoCashPricing'
import { formatCentavosBRL, formatDateTime } from '../utils/format'
import {
  getAdminCashReversalEvents,
  adminCancelInfinitepayCashPurchase,
  adminResolveCashPurchaseReview,
  getCashPurchaseReminderPreview,
  requestCashPurchaseReminder,
} from '../services/cashPurchaseService'
import {
  canSubmitAdminNote,
  cashPurchaseStatusLabel,
  ADMIN_CASH_PURCHASE_STATUS_LABELS as STATUS_LABELS,
} from '../utils/cashPurchaseFlow'

function ReversalHistory({ purchaseId }) {
  const [events, setEvents] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function load() {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      setEvents(await getAdminCashReversalEvents(purchaseId))
    } catch {
      setError('Não foi possível carregar os eventos. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Box>
      <Button onClick={load} disabled={loading}>
        {loading ? 'Carregando eventos…' : 'Ver eventos do estorno'}
      </Button>
      {error && (
        <Text as="p" role="alert">
          {error}
        </Text>
      )}
      {events?.map((event) => (
        <Box key={event.id} sx={{ mt: 2 }}>
          <Text as="p" sx={{ m: 0 }}>
            {formatDateTime(new Date(event.confirmed_at))} ·{' '}
            {event.kind === 'refund' ? 'Reembolso' : 'Chargeback'} ·{' '}
            {formatCentavosBRL(event.amount_centavos)}
          </Text>
          <Text as="p" sx={{ m: 0, fontSize: 0 }}>
            Evento: {event.provider_event_id} · Evidência: {event.evidence_reference}
          </Text>
          <Text as="p" sx={{ m: 0, fontSize: 0 }}>
            EvoCash: {event.cash_units} · Recuperado: {event.recovered_units} · Pendente:{' '}
            {event.cash_units - event.recovered_units}
          </Text>
          <Text as="p" sx={{ m: 0, fontSize: 0 }}>
            Responsável: {event.confirmed_by || 'Conta excluída'} · Motivo: {event.note}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

const REMINDER_BLOCK_REASON_LABELS = {
  not_pending: 'Esta compra não está mais pendente.',
  account_not_active: 'A conta do comprador não está ativa -- lembretes são só para contas ativas.',
  daily_limit_reached: 'O limite diário de lembretes para este destinatário já foi atingido.',
}

const ADMIN_PURCHASE_ACTIONS = {
  cancel: {
    title: 'Cancelar compra',
    confirm: 'Cancelar compra',
    danger: true,
    description:
      'Cancela esta compra pendente sem creditar EvoCash. Se a InfinitePay confirmar o pagamento depois, ele ainda será reconciliado normalmente.',
    placeholder: 'Motivo (ex.: sem pagamento confirmado na InfinitePay após verificação manual)',
  },
  credit: {
    title: 'Creditar EvoCash',
    confirm: 'Creditar',
    danger: false,
    description:
      'O pagamento já foi confirmado pela InfinitePay, mas a conta estava desativada no momento da confirmação. Use só depois de decidir reativar a conta ou creditar mesmo assim.',
    placeholder: 'Nota administrativa (decisão tomada e por quê)',
  },
  refund: {
    title: 'Reembolsar externamente',
    confirm: 'Registrar reembolso',
    danger: true,
    description:
      'Registra que o valor foi reembolsado fora do app (ex.: direto na InfinitePay) -- esta compra é cancelada e o EvoCash NUNCA é creditado.',
    placeholder: 'Nota administrativa (como e quando o reembolso foi feito)',
  },
}

function date(value) {
  return formatDateTime(value ? new Date(value) : null)
}

// Mesmo padrão de AdminAccountDeletions.jsx: diálogo único, nota obrigatória (>=5
// caracteres, igual à validação que o banco repete), decisão sempre tomada no servidor.
function PurchaseActionDialog({ purchase, actionKey, onClose, onConfirm }) {
  const action = ADMIN_PURCHASE_ACTIONS[actionKey]
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const valid = canSubmitAdminNote(note)

  return (
    <Dialog
      title={`${action.title} -- ${purchase.id}`}
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
            placeholder={action.placeholder}
          />
        </FormControl>
      </Box>
    </Dialog>
  )
}

// Passo 1 (confirmação): busca nome e e-mail MASCARADO no servidor antes de mostrar
// qualquer botão de envio -- nunca monta a máscara no cliente, nunca recebe o e-mail real.
// Passo 2 (envio): só enfileira (admin_request_cash_purchase_reminder); o envio real é
// assíncrono, então o sucesso aqui significa "na fila", não "entregue".
function ReminderDialog({ purchase, onClose, onConfirm }) {
  const [state, setState] = useState({ status: 'loading', preview: null, error: '' })
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let active = true
    getCashPurchaseReminderPreview(purchase.id)
      .then((preview) => {
        if (active) setState({ status: 'ready', preview, error: '' })
      })
      .catch(() => {
        if (active)
          setState({
            status: 'ready',
            preview: null,
            error: 'Não foi possível carregar os dados do destinatário.',
          })
      })
    return () => {
      active = false
    }
  }, [purchase.id])

  const preview = state.preview
  const blockReason =
    preview && !preview.canSend
      ? preview.reason === 'cooldown'
        ? `Lembrete já enviado recentemente -- próximo envio liberado em ${formatDateTime(new Date(preview.cooldownUntil))}.`
        : REMINDER_BLOCK_REASON_LABELS[preview.reason] || 'Não é possível enviar um lembrete agora.'
      : ''

  return (
    <Dialog
      title={`Enviar lembrete -- ${purchase.id}`}
      onClose={sending ? () => {} : onClose}
      footerButtons={[
        { content: 'Voltar', onClick: onClose, disabled: sending },
        ...(preview?.canSend
          ? [
              {
                content: 'Enviar lembrete',
                buttonType: 'primary',
                disabled: sending,
                onClick: async () => {
                  setSending(true)
                  const errorMessage = await onConfirm()
                  setSending(false)
                  if (errorMessage) setState((previous) => ({ ...previous, error: errorMessage }))
                },
              },
            ]
          : []),
      ]}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {state.status === 'loading' && <Spinner aria-label="Carregando destinatário" />}
        {state.error && (
          <Flash variant="danger" role="alert">
            {state.error}
          </Flash>
        )}
        {preview && (
          <>
            <Text>
              Enviar um e-mail avisando sobre a compra pendente para{' '}
              <strong>@{preview.username || purchase.userId}</strong> ({preview.maskedEmail})?
            </Text>
            {preview.lastSentAt && (
              <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                Último lembrete enviado em {formatDateTime(new Date(preview.lastSentAt))}.
              </Text>
            )}
            {blockReason && (
              <Flash variant="attention" role="alert">
                {blockReason}
              </Flash>
            )}
          </>
        )}
      </Box>
    </Dialog>
  )
}

function PurchasesPanel() {
  const { user } = useAuth()
  const [status, setStatus] = useState('pending')
  const { purchases, loading, hasMore, loadMore, error, refresh } = useCashPurchases(
    user.uid,
    true,
    status
  )
  const usernames = useUsernamesByIds(purchases.map((purchase) => purchase.userId))
  const { latestReminderByPurchaseId, refreshLatestReminders } = useLatestCashPurchaseReminders(
    purchases.map((purchase) => purchase.id)
  )
  const { toasts, showToast } = useToast()
  const [dialog, setDialog] = useState(null) // { purchase, actionKey }
  const [remindPurchase, setRemindPurchase] = useState(null)
  const [busyId, setBusyId] = useState(null)

  async function handleConfirm(note) {
    const { purchase, actionKey } = dialog
    try {
      setBusyId(purchase.id)
      if (actionKey === 'cancel') {
        await adminCancelInfinitepayCashPurchase(purchase.id, note)
        showToast('Compra cancelada.')
      } else if (actionKey === 'credit') {
        await adminResolveCashPurchaseReview(purchase.id, 'credit', note)
        showToast('EvoCash creditado.')
      } else {
        await adminResolveCashPurchaseReview(purchase.id, 'refund_externally', note)
        showToast('Reembolso externo registrado -- EvoCash não foi creditado.')
      }
      setDialog(null)
      await refresh()
      return ''
    } catch (err) {
      console.error('[AdminCashPurchases] action:', actionKey, err)
      return 'Não foi possível concluir a ação. Tente novamente.'
    } finally {
      setBusyId(null)
    }
  }

  async function handleConfirmReminder() {
    try {
      setBusyId(remindPurchase.id)
      const result = await requestCashPurchaseReminder(remindPurchase.id)
      if (!result.queued) {
        return result.reason === 'cooldown'
          ? `Lembrete já enviado recentemente -- próximo envio liberado em ${formatDateTime(new Date(result.cooldownUntil))}.`
          : REMINDER_BLOCK_REASON_LABELS[result.reason] ||
              'Não foi possível enfileirar o lembrete agora.'
      }
      showToast('Lembrete na fila -- o e-mail será enviado em poucos minutos.')
      setRemindPurchase(null)
      await refreshLatestReminders()
      return ''
    } catch (err) {
      console.error('[AdminCashPurchases] reminder:', err)
      return 'Não foi possível enfileirar o lembrete. Tente novamente.'
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Box>
      <ToastFlash toasts={toasts} />
      <Text as="p">Histórico de compras e conciliação automática de pagamentos.</Text>
      <FormControl sx={{ mb: 3 }}>
        <FormControl.Label>Mostrar compras</FormControl.Label>
        <Select value={status} onChange={(event) => setStatus(event.target.value)}>
          <Select.Option value="pending">Pendentes</Select.Option>
          <Select.Option value="needs_review">Em análise</Select.Option>
          <Select.Option value="paid">Pagos</Select.Option>
          <Select.Option value="cancelled">Cancelados</Select.Option>
          <Select.Option value="failed">Falhas</Select.Option>
          <Select.Option value="">Todos</Select.Option>
        </Select>
      </FormControl>
      {loading && purchases.length === 0 && <Spinner aria-label="Carregando compras" />}
      {error && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {error} <Button onClick={refresh}>Tentar novamente</Button>
        </Flash>
      )}
      {!loading && purchases.length === 0 && !error && (
        <Text as="p">Nenhuma compra encontrada para este filtro.</Text>
      )}
      {purchases.map((purchase) => (
        <Box
          as="article"
          key={purchase.id}
          sx={{
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            p: 3,
            mb: 3,
            overflowWrap: 'anywhere',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
            <Heading as="h2" sx={{ fontSize: 1 }}>
              {purchase.purchaseLabel}
            </Heading>
            <Label variant={cashPurchaseStatusLabel(purchase, STATUS_LABELS).variant}>
              {cashPurchaseStatusLabel(purchase, STATUS_LABELS).text}
            </Label>
          </Box>
          <Text as="p" sx={{ m: 0 }}>
            {formatCentavosBRL(purchase.amountCentavos)} · {purchase.cashAmount} EvoCash
          </Text>
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
            Protocolo: {purchase.id}
            <br />
            Usuário:{' '}
            {purchase.userId
              ? usernames[purchase.userId]
                ? `@${usernames[purchase.userId]} · ${purchase.userId}`
                : purchase.userId
              : 'Conta excluída'}
            <br />
            Provedor: {purchase.paymentProvider === 'infinitepay' ? 'InfinitePay' : 'Legado'}
            <br />
            Order NSU: {purchase.orderNsu || '—'}
            <br />
            Transaction NSU: {purchase.transactionNsu || '—'}
            <br />
            Forma de pagamento: {purchase.captureMethod || '—'}
            <br />
            Criada: {date(purchase.createdAt)}
            <br />
            Creditada: {date(purchase.creditedAt)}
            <br />
            Cancelada: {date(purchase.cancelledAt)}
          </Text>
          {purchase.reversedCentavos > 0 && (
            <Text as="p" sx={{ color: 'attention.fg' }}>
              Estorno confirmado: {formatCentavosBRL(purchase.reversedCentavos)}. Histórico
              preservado para análise financeira.
            </Text>
          )}
          {purchase.reversedCentavos > 0 && <ReversalHistory purchaseId={purchase.id} />}
          {purchase.paidAfterCancelAt && (
            <Text as="p" sx={{ color: 'attention.fg', fontWeight: 'bold' }}>
              Pago após cancelamento: {date(purchase.paidAfterCancelAt)}
            </Text>
          )}
          {latestReminderByPurchaseId[purchase.id] && (
            <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
              {latestReminderByPurchaseId[purchase.id].status === 'sent'
                ? `Último lembrete enviado em ${date(latestReminderByPurchaseId[purchase.id].sentAt)}.`
                : latestReminderByPurchaseId[purchase.id].status === 'pending'
                  ? 'Lembrete na fila, enviando em breve...'
                  : 'Última tentativa de lembrete falhou.'}
            </Text>
          )}
          {purchase.userId && (
            <Link to={`/admin/contas?usuario=${encodeURIComponent(purchase.userId)}`}>
              Ver conta do comprador
            </Link>
          )}
          {(purchase.status === 'pending' || purchase.status === 'needs_review') &&
            purchase.paymentProvider === 'infinitepay' && (
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 2 }}>
                {purchase.status === 'pending' && (
                  <>
                    <Button disabled={!!busyId} onClick={() => setRemindPurchase(purchase)}>
                      Enviar lembrete
                    </Button>
                    <Button
                      variant="danger"
                      disabled={!!busyId}
                      onClick={() => setDialog({ purchase, actionKey: 'cancel' })}
                    >
                      Cancelar compra
                    </Button>
                  </>
                )}
                {purchase.status === 'needs_review' && (
                  <>
                    <Button
                      variant="primary"
                      disabled={!!busyId}
                      onClick={() => setDialog({ purchase, actionKey: 'credit' })}
                    >
                      Creditar EvoCash
                    </Button>
                    <Button
                      variant="danger"
                      disabled={!!busyId}
                      onClick={() => setDialog({ purchase, actionKey: 'refund' })}
                    >
                      Reembolsar externamente
                    </Button>
                  </>
                )}
              </Box>
            )}
        </Box>
      ))}
      {hasMore && (
        <Button onClick={loadMore} disabled={loading}>
          Carregar mais compras
        </Button>
      )}
      {dialog && (
        <PurchaseActionDialog
          purchase={dialog.purchase}
          actionKey={dialog.actionKey}
          onClose={() => setDialog(null)}
          onConfirm={handleConfirm}
        />
      )}
      {remindPurchase && (
        <ReminderDialog
          purchase={remindPurchase}
          onClose={() => setRemindPurchase(null)}
          onConfirm={handleConfirmReminder}
        />
      )}
    </Box>
  )
}

const CASH_TABS = [
  ['purchases', 'Compras'],
  ['pricing', 'Precificação'],
  ['prices', 'Histórico de preços'],
  ['refunds', 'Reembolsos'],
]

export default function AdminCashPurchases() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('tab')
  const tab = CASH_TABS.some(([key]) => key === selected) ? selected : 'purchases'
  return (
    <div className="support-page">
      <AdminNav current="/admin/compras-evocash" currentLabel="Compras de EvoCash" />
      <h1>Compras de EvoCash</h1>
      <UnderlineNav aria-label="Seções de compras de EvoCash" sx={{ mb: 3 }}>
        {CASH_TABS.map(([key, label]) => (
          <UnderlineNav.Item
            key={key}
            as="button"
            aria-current={tab === key ? 'page' : undefined}
            onSelect={() => setParams({ tab: key })}
          >
            {label}
          </UnderlineNav.Item>
        ))}
      </UnderlineNav>
      {tab === 'purchases' && <PurchasesPanel />}
      {tab === 'pricing' && <EvoCashPricingPanel />}
      {tab === 'prices' && <EvoCashPriceHistory />}
      {tab === 'refunds' && <RefundRequestsPanel admin />}
    </div>
  )
}
