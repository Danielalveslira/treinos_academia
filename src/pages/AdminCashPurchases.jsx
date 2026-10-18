import { useState } from 'react'
import { Link } from 'react-router-dom'
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
} from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { useCashPurchases } from '../hooks/useCashPurchases'
import { useUsernamesByIds } from '../hooks/useUsernamesByIds'
import { useToast } from '../hooks/useToast'
import { ToastFlash } from '../components/ToastFlash'
import AdminNav from '../components/AdminNav'
import { formatCentavosBRL, formatDateTime } from '../utils/format'
import {
  adminCancelInfinitepayCashPurchase,
  adminResolveCashPurchaseReview,
} from '../services/cashPurchaseService'
import {
  canSubmitAdminNote,
  cashPurchaseStatusLabel,
  ADMIN_CASH_PURCHASE_STATUS_LABELS as STATUS_LABELS,
} from '../utils/cashPurchaseFlow'

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

export default function AdminCashPurchases() {
  const { user } = useAuth()
  const [status, setStatus] = useState('pending')
  const { purchases, loading, hasMore, loadMore, error, refresh } = useCashPurchases(
    user.uid,
    true,
    status
  )
  const usernames = useUsernamesByIds(purchases.map((purchase) => purchase.userId))
  const { toasts, showToast } = useToast()
  const [dialog, setDialog] = useState(null) // { purchase, actionKey }
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

  return (
    <div className="support-page">
      <AdminNav current="/admin/compras-evocash" currentLabel="Compras de EvoCash" />
      <ToastFlash toasts={toasts} />
      <h1>Compras de EvoCash</h1>
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
              {purchase.packageLabel}
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
          {purchase.paidAfterCancelAt && (
            <Text as="p" sx={{ color: 'attention.fg', fontWeight: 'bold' }}>
              Pago após cancelamento: {date(purchase.paidAfterCancelAt)}
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
                  <Button
                    variant="danger"
                    disabled={!!busyId}
                    onClick={() => setDialog({ purchase, actionKey: 'cancel' })}
                  >
                    Cancelar compra
                  </Button>
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
    </div>
  )
}
