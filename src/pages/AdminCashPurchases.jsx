import { Link } from 'react-router-dom'
import { useState } from 'react'
import {
  Box,
  Button,
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
import { cancelCashPurchase, confirmCashPurchase } from '../services/cashPurchaseService'
import { PixPaymentSettings } from '../components/PixPaymentSettings'
import { AdminCashPurchasesTabs } from '../components/AdminCashPurchasesTabs'
import { useAdminCashPurchasesTab } from '../hooks/useAdminCashPurchasesTab'
import { formatCentavosBRL, formatDateTime } from '../utils/format'
import {
  canSubmitCancellation,
  ADMIN_CASH_PURCHASE_STATUS_LABELS as STATUS_LABELS,
} from '../utils/cashPurchaseFlow'

// Painel admin de EvoCash (Fase 4, seção 23 do prompt de economia): duas abas no mesmo
// domínio -- "Pedidos" (listar pending/histórico, confirmar pagamento manual com nota
// opcional de auditoria do PIX, cancelar com motivo obrigatório) e "Configuração PIX"
// (PixPaymentSettings.jsx: cadastro/ativação de chaves, ver pix-payment-admin-service.js).
// A aba é guardada em ?tab= na própria URL (normalizeCashPurchasesAdminTab), não em
// estado local perdido no reload -- "pedidos" é sempre o padrão. "Consultar wallet/
// ledger" reaproveita as Rules existentes (link para a conta em /admin/contas) --
// nenhuma callable nova só para leitura.
export default function AdminCashPurchases() {
  const { user } = useAuth()
  const { tab, selectTab } = useAdminCashPurchasesTab()
  const [status, setStatus] = useState('pending')
  const {
    purchases,
    loading,
    hasMore,
    loadMore,
    error: loadError,
    refresh,
  } = useCashPurchases(user.uid, true, status)
  // Batch, nunca N+1: uma consulta por página carregada (ou por status trocado), não
  // uma leitura de users/{uid} por card -- ver resolveUsernamesByIds.
  const usernameById = useUsernamesByIds(purchases.map((purchase) => purchase.userId))
  const [actingOn, setActingOn] = useState(null) // { purchaseId, action: 'confirm' | 'cancel' }
  const [noteDraft, setNoteDraft] = useState('')
  const [reasonDraft, setReasonDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  function startAction(purchaseId, action) {
    setActingOn({ purchaseId, action })
    setNoteDraft('')
    setReasonDraft('')
    setActionError('')
  }
  function cancelAction() {
    setActingOn(null)
    setActionError('')
  }

  async function submitConfirm(purchaseId) {
    if (saving) return
    setSaving(true)
    setActionError('')
    try {
      await confirmCashPurchase(purchaseId, noteDraft.trim() || undefined)
      setActingOn(null)
      await refresh()
    } catch (err) {
      setActionError(
        [
          'functions/failed-precondition',
          'functions/invalid-argument',
          'functions/not-found',
          'functions/permission-denied',
        ].includes(err?.code)
          ? err.message
          : 'Não foi possível confirmar a compra. Tente novamente.'
      )
    } finally {
      setSaving(false)
    }
  }

  async function submitCancel(purchaseId) {
    if (saving) return
    setSaving(true)
    setActionError('')
    try {
      await cancelCashPurchase(purchaseId, reasonDraft)
      setActingOn(null)
      await refresh()
    } catch (err) {
      setActionError(
        [
          'functions/failed-precondition',
          'functions/invalid-argument',
          'functions/not-found',
          'functions/permission-denied',
        ].includes(err?.code)
          ? err.message
          : 'Não foi possível cancelar a compra. Tente novamente.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="support-page">
      <h1>Compras de EvoCash</h1>

      <AdminCashPurchasesTabs tab={tab} onSelectTab={selectTab} />

      {tab === 'pix' && <PixPaymentSettings />}

      {tab === 'pedidos' && (
        <>
          <p>
            Confirmação e cancelamento são sempre manuais. Confirmar credita o valor imediatamente;
            cancelar exige um motivo e não pode ser desfeito.
          </p>

          <FormControl sx={{ mb: 3 }}>
            <FormControl.Label>Mostrar compras</FormControl.Label>
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <Select.Option value="pending">Pendentes</Select.Option>
              <Select.Option value="credited">Creditadas</Select.Option>
              <Select.Option value="cancelled">Canceladas</Select.Option>
              <Select.Option value="">Todas</Select.Option>
            </Select>
          </FormControl>

          {loading && purchases.length === 0 && <Spinner aria-label="Carregando compras" />}
          {loadError && (
            <Flash variant="danger" sx={{ mb: 3 }}>
              {loadError} <Button onClick={refresh}>Tentar novamente</Button>
            </Flash>
          )}
          {!loading && purchases.length === 0 && !loadError && (
            <Text as="p" sx={{ color: 'fg.muted' }}>
              Nenhuma compra encontrada para este filtro.
            </Text>
          )}

          {purchases.map((purchase) => (
            <Box
              as="article"
              key={purchase.id}
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
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 2,
                }}
              >
                <Box>
                  <Heading as="h2" sx={{ fontSize: 1 }}>
                    {purchase.packageLabel}
                  </Heading>
                  <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                    {usernameById[purchase.userId] ? `@${usernameById[purchase.userId]}` : 'sem @'}{' '}
                    · {purchase.userId}
                  </Text>
                  <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                    Protocolo {purchase.id} · {formatDateTime(purchase.createdAt?.toDate())}
                  </Text>
                  <Text as="p" sx={{ fontSize: 0, m: 0 }}>
                    {formatCentavosBRL(purchase.amountCentavos)} — {purchase.cashAmount} EvoCash
                  </Text>
                </Box>
                <Label variant={STATUS_LABELS[purchase.status]?.variant}>
                  {STATUS_LABELS[purchase.status]?.text || purchase.status}
                </Label>
              </Box>
              <Link to={`/admin/contas?usuario=${encodeURIComponent(purchase.userId)}`}>
                Ver conta do comprador (saldo e ledger)
              </Link>
              {purchase.status === 'credited' && (
                <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                  Confirmado por {purchase.creditedBy} em{' '}
                  {formatDateTime(purchase.creditedAt?.toDate())}
                  {purchase.confirmationNote ? ` — ${purchase.confirmationNote}` : ''}
                </Text>
              )}
              {purchase.status === 'cancelled' && (
                <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                  Cancelado por {purchase.cancelledBy} em{' '}
                  {formatDateTime(purchase.cancelledAt?.toDate())} — {purchase.cancelReason}
                </Text>
              )}

              {purchase.status === 'pending' && actingOn?.purchaseId !== purchase.id && (
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Button variant="primary" onClick={() => startAction(purchase.id, 'confirm')}>
                    Confirmar pagamento
                  </Button>
                  <Button variant="danger" onClick={() => startAction(purchase.id, 'cancel')}>
                    Cancelar
                  </Button>
                </Box>
              )}

              {actingOn?.purchaseId === purchase.id && (
                <Box sx={{ borderTop: '1px solid', borderColor: 'border.default', pt: 2 }}>
                  {actionError && (
                    <Flash variant="danger" role="alert" sx={{ mb: 2 }}>
                      {actionError}
                    </Flash>
                  )}
                  {actingOn.action === 'confirm' ? (
                    <>
                      <FormControl disabled={saving}>
                        <FormControl.Label>
                          Nota para auditoria do PIX{' '}
                          <span className="profile-optional">(opcional)</span>
                        </FormControl.Label>
                        <Textarea
                          block
                          maxLength={500}
                          rows={2}
                          placeholder="Ex.: comprovante recebido às 14h32, referência #12345"
                          value={noteDraft}
                          onChange={(event) => setNoteDraft(event.target.value)}
                        />
                      </FormControl>
                      <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                        <Button type="button" disabled={saving} onClick={cancelAction}>
                          Voltar
                        </Button>
                        <Button
                          variant="primary"
                          loading={saving}
                          onClick={() => submitConfirm(purchase.id)}
                        >
                          Confirmar de verdade
                        </Button>
                      </Box>
                    </>
                  ) : (
                    <>
                      <FormControl required disabled={saving}>
                        <FormControl.Label>Motivo do cancelamento</FormControl.Label>
                        <Textarea
                          block
                          required
                          minLength={5}
                          maxLength={500}
                          rows={2}
                          value={reasonDraft}
                          onChange={(event) => setReasonDraft(event.target.value)}
                        />
                      </FormControl>
                      <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                        <Button type="button" disabled={saving} onClick={cancelAction}>
                          Voltar
                        </Button>
                        <Button
                          variant="danger"
                          loading={saving}
                          disabled={!canSubmitCancellation(reasonDraft)}
                          onClick={() => submitCancel(purchase.id)}
                        >
                          Cancelar de verdade
                        </Button>
                      </Box>
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
        </>
      )}
    </div>
  )
}
