import { useEffect, useState } from 'react'
import { Box, Button, Flash, FormControl, Heading, Label, Spinner, Text, Textarea } from '@primer/react'
import { listAllPromotionsForAdmin, cancelPromotion } from '../services/promotionsService'
import { canSubmitCancellation } from '../utils/cashPurchaseFlow'
import { formatDateTime } from '../utils/format'
import { toDate } from '../utils/date.js'

const STATUS_LABELS = {
  active: { text: 'Ativa', variant: 'success' },
  cancelled: { text: 'Cancelada', variant: 'attention' },
  target_removed: { text: 'Alvo removido', variant: 'danger' },
}

// Fase 6 (promoções pagas com EvoCash) -- painel de MODERAÇÃO, somente leitura +
// cancelar (com motivo obrigatório, nunca reembolsa). Deliberadamente separado de
// /admin/parcerias (AdminSponsoredAds.jsx, anúncios institucionais) -- o usuário/owner
// nunca ganha acesso a nenhum dos dois; este painel também é exclusivo de superadmin
// (ver firestore.rules: promotions/{id} só lê dono/superadmin, e esta LISTA completa só
// resolve para superadmin).
export default function AdminPromotions() {
  const [promotions, setPromotions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [cancelingId, setCancelingId] = useState(null)
  const [reasonDraft, setReasonDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      setPromotions(await listAllPromotionsForAdmin())
    } catch (err) {
      console.error('[AdminPromotions] load:', err)
      setLoadError('Não foi possível carregar as promoções.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  function startCancel(id) {
    setCancelingId(id)
    setReasonDraft('')
    setActionError('')
  }
  function stopCancel() {
    setCancelingId(null)
    setActionError('')
  }
  async function submitCancel(id) {
    if (saving) return
    setSaving(true)
    setActionError('')
    try {
      await cancelPromotion({ promotionId: id, reason: reasonDraft })
      setCancelingId(null)
      await load()
    } catch (err) {
      setActionError(
        [
          'functions/failed-precondition',
          'functions/invalid-argument',
          'functions/not-found',
          'functions/permission-denied',
        ].includes(err?.code)
          ? err.message
          : 'Não foi possível cancelar a promoção.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="support-page">
      <h1>Promoções (EvoCash)</h1>
      <p>
        Moderação das promoções pagas por usuários — distinto do painel de Parcerias
        (anúncios institucionais). Cancelar aqui nunca reembolsa o EvoCash já gasto.
      </p>

      {loading && promotions.length === 0 && <Spinner aria-label="Carregando promoções" />}
      {loadError && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {loadError} <Button onClick={load}>Tentar novamente</Button>
        </Flash>
      )}
      {!loading && promotions.length === 0 && !loadError && (
        <Text as="p" sx={{ color: 'fg.muted' }}>
          Nenhuma promoção encontrada.
        </Text>
      )}

      {promotions.map((promotion) => {
        const expiresAtDate = toDate(promotion.expiresAt)
        const isExpired = promotion.status === 'active' && expiresAtDate && expiresAtDate.getTime() < Date.now()
        return (
          <Box
            as="article"
            key={promotion.id}
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
                  {promotion.targetType === 'post' ? 'Publicação' : 'Comunidade'} promovida
                </Heading>
                <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                  {promotion.packageId} · {promotion.cashAmount} EvoCash · {promotion.durationDays}{' '}
                  {promotion.durationDays === 1 ? 'dia' : 'dias'}
                </Text>
                <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                  Dono: {promotion.ownerId} · Alvo: {promotion.targetId}
                </Text>
                <Text as="p" sx={{ fontSize: 0, m: 0 }}>
                  Criada em {formatDateTime(toDate(promotion.createdAt))} · expira em{' '}
                  {formatDateTime(expiresAtDate)}
                  {/* clique só é rastreado para comunidades (ver Communities.jsx) -- um
                      StatusCard não tem um único "abrir" pra contar clique em cima, então
                      mostrar "0 clique(s)" para posts sugeriria falsamente que o clique
                      está sendo medido e simplesmente nunca acontece. */}
                  {promotion.targetType === 'community' ? ` · ${promotion.clickCount ?? 0} clique(s)` : ''}
                </Text>
              </Box>
              <Label variant={isExpired ? 'attention' : STATUS_LABELS[promotion.status]?.variant || 'default'}>
                {isExpired ? 'Expirada' : STATUS_LABELS[promotion.status]?.text || promotion.status}
              </Label>
            </Box>
            {promotion.status === 'cancelled' && (
              <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                Cancelada por {promotion.cancelledBy || 'sistema'} em {formatDateTime(toDate(promotion.cancelledAt))}
                {promotion.cancelReason ? ` — ${promotion.cancelReason}` : ''}
              </Text>
            )}
            {promotion.status === 'target_removed' && (
              <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                Alvo removido em {formatDateTime(toDate(promotion.cancelledAt))}
              </Text>
            )}

            {promotion.status === 'active' && cancelingId !== promotion.id && (
              <Box>
                <Button variant="danger" onClick={() => startCancel(promotion.id)}>
                  Cancelar promoção
                </Button>
              </Box>
            )}
            {cancelingId === promotion.id && (
              <Box sx={{ borderTop: '1px solid', borderColor: 'border.default', pt: 2 }}>
                {actionError && (
                  <Flash variant="danger" role="alert" sx={{ mb: 2 }}>
                    {actionError}
                  </Flash>
                )}
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
                  <Button type="button" disabled={saving} onClick={stopCancel}>
                    Voltar
                  </Button>
                  <Button
                    variant="danger"
                    loading={saving}
                    disabled={!canSubmitCancellation(reasonDraft)}
                    onClick={() => submitCancel(promotion.id)}
                  >
                    Cancelar de verdade
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        )
      })}
    </div>
  )
}
