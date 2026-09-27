import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Flash, Heading, Label, Link, Spinner, Text } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { listMyPromotions, cancelPromotion } from '../services/promotionsService'
import { getCommunity } from '../services/communitiesService'
import { formatDateTime } from '../utils/format'
import { toDate } from '../utils/date.js'
import { derivePromotionStatus, PROMOTION_STATUS_LABELS } from '../utils/promotionStatus.js'

// Fase 6 -- "Minhas promoções": único lugar onde o DONO consegue consultar e cancelar
// as próprias promoções (cancelPromotion sem motivo, ver promotion-service.js). Antes
// disso só existia /admin/promocoes (superadmin, exige motivo) -- um usuário comum não
// tinha nenhuma forma de desistir de uma promoção ativa. Não cria nenhuma lógica
// econômica nova: só lê promotions/{id} (já denormalizado com tudo que a tela precisa)
// e chama o cancelPromotion já existente.
export default function MyPromotions() {
  const { user } = useAuth()
  const [promotions, setPromotions] = useState([])
  const [communityNames, setCommunityNames] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  async function load() {
    if (!user?.uid) return
    setLoading(true)
    setLoadError('')
    try {
      const items = await listMyPromotions(user.uid)
      setPromotions(items)
      // Um get() por comunidade ÚNICA (nunca por promoção) -- várias promoções do mesmo
      // alvo/comunidade não geram leituras repetidas. communityId já vem denormalizado
      // no próprio promotions/{id} (tanto para post quanto para comunidade), então não
      // precisa ler statuses/{id} nunca (evita o caso em que o autor já não é mais
      // membro da comunidade do post e perderia acesso de leitura a ela).
      const uniqueCommunityIds = [...new Set(items.map((item) => item.communityId).filter(Boolean))]
      const entries = await Promise.all(
        uniqueCommunityIds.map(async (communityId) => {
          try {
            const community = await getCommunity(communityId)
            return [communityId, community?.name ?? null]
          } catch {
            return [communityId, null]
          }
        })
      )
      setCommunityNames(Object.fromEntries(entries))
    } catch (err) {
      console.error('[MyPromotions] load:', err)
      setLoadError('Não foi possível carregar suas promoções.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  function startCancel(id) {
    setConfirmingId(id)
    setActionError('')
  }
  function stopCancel() {
    setConfirmingId(null)
    setActionError('')
  }
  async function submitCancel(id) {
    if (saving) return
    setSaving(true)
    setActionError('')
    try {
      await cancelPromotion({ promotionId: id })
      setConfirmingId(null)
      await load()
    } catch (err) {
      const KNOWN_ERRORS = {
        PROMOTION_NOT_FOUND: 'Promoção não encontrada.',
        PERMISSION_DENIED: 'Você não tem permissão para cancelar esta promoção.',
        PROMOTION_NOT_ACTIVE: 'Esta promoção não está mais ativa.',
      }
      setActionError(KNOWN_ERRORS[err?.message] || 'Não foi possível cancelar a promoção.')
      // PROMOTION_NOT_ACTIVE normalmente significa que o estado mudou debaixo do usuário
      // (já cancelada em outra aba, ou expirou entre abrir a confirmação e confirmar) --
      // recarrega em silêncio (mantendo a caixa de confirmação e o erro visíveis) pra
      // que ela reflita a realidade assim que o usuário fechar a confirmação, em vez de
      // continuar mostrando "Ativa" com um botão de cancelar que só falharia de novo.
      await load()
    } finally {
      setSaving(false)
    }
  }

  function targetLabel(promotion) {
    const communityName = communityNames[promotion.communityId]
    if (promotion.targetType === 'community') {
      return communityName || 'Comunidade removida'
    }
    return communityName ? `Publicação em ${communityName}` : 'Publicação (comunidade removida)'
  }

  return (
    <div className="profile-page">
      <header className="profile-page-heading">
        <span className="profile-eyebrow">EVOCASH</span>
        <h1>Minhas promoções</h1>
        <p>Publicações e comunidades que você promoveu com EvoCash.</p>
      </header>

      {loading && promotions.length === 0 && <Spinner aria-label="Carregando promoções" />}
      {loadError && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {loadError} <Button onClick={load}>Tentar novamente</Button>
        </Flash>
      )}
      {!loading && promotions.length === 0 && !loadError && (
        <Text as="p" sx={{ color: 'fg.muted' }}>
          Você ainda não promoveu nenhuma publicação ou comunidade.
        </Text>
      )}

      {promotions.map((promotion) => {
        const derivedStatus = derivePromotionStatus(promotion, Date.now())
        const statusInfo = PROMOTION_STATUS_LABELS[derivedStatus]
        const canCancel = derivedStatus === 'active'
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
                  {promotion.targetType === 'community' && communityNames[promotion.communityId] ? (
                    <Link as={RouterLink} to={`/comunidades/${promotion.targetId}`}>
                      {targetLabel(promotion)}
                    </Link>
                  ) : promotion.targetType === 'post' && communityNames[promotion.communityId] ? (
                    <Link as={RouterLink} to={`/comunidades/${promotion.communityId}`}>
                      {targetLabel(promotion)}
                    </Link>
                  ) : (
                    targetLabel(promotion)
                  )}
                </Heading>
                <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                  {promotion.targetType === 'post' ? 'Publicação' : 'Comunidade'} · pacote {promotion.packageId} ·{' '}
                  {promotion.cashAmount} EvoCash
                </Text>
                <Text as="p" sx={{ fontSize: 0, m: 0 }}>
                  Início em {formatDateTime(toDate(promotion.startedAt))} · expira em{' '}
                  {formatDateTime(toDate(promotion.expiresAt))}
                </Text>
              </Box>
              <Label variant={statusInfo.variant}>{statusInfo.text}</Label>
            </Box>

            {promotion.status === 'cancelled' && (
              <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                Cancelada {promotion.cancelledBy === user?.uid ? 'por você' : 'por um administrador'} em{' '}
                {formatDateTime(toDate(promotion.cancelledAt))}
                {promotion.cancelReason ? ` — ${promotion.cancelReason}` : ''}
              </Text>
            )}
            {promotion.status === 'target_removed' && (
              <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
                O conteúdo promovido foi removido em {formatDateTime(toDate(promotion.cancelledAt))}.
              </Text>
            )}

            {canCancel && confirmingId !== promotion.id && (
              <Box>
                <Button variant="danger" onClick={() => startCancel(promotion.id)}>
                  Cancelar promoção
                </Button>
              </Box>
            )}
            {confirmingId === promotion.id && (
              <Box sx={{ borderTop: '1px solid', borderColor: 'border.default', pt: 2 }}>
                {actionError && (
                  <Flash variant="danger" role="alert" sx={{ mb: 2 }}>
                    {actionError}
                  </Flash>
                )}
                <Flash variant="warning" sx={{ mb: 2 }}>
                  O cancelamento não devolve o EvoCash já gasto ({promotion.cashAmount} EvoCash). Esta ação não pode
                  ser desfeita.
                </Flash>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Button type="button" disabled={saving} onClick={stopCancel}>
                    Voltar
                  </Button>
                  <Button variant="danger" loading={saving} onClick={() => submitCancel(promotion.id)}>
                    Cancelar mesmo assim
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
