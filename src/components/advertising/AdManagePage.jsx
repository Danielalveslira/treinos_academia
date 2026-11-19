import { lazy, Suspense, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Dialog, Flash, Label, Spinner, Text } from '@primer/react'
import { ArrowLeftIcon } from '@primer/octicons-react'
import {
  getAdvertisingOrders,
  getAdvertisingRevisions,
  confirmAdvertisingPauseLimit,
  interruptAdvertisingCampaign,
  resumeMyAdvertisingCampaign,
} from '../../services/advertisingService'
import AdvertisingCreativePreview from './AdvertisingCreativePreview'
import { deriveAdStatus } from '../../utils/advertisingStatus'
import { placementsSummary } from '../../utils/placementLabels'
import { commercialDate, commercialError } from '../../utils/commercial'

const CommercialOrderHistory = lazy(() => import('../CommercialOrderHistory'))
const CommercialLeasePurchase = lazy(() => import('../CommercialLeasePurchase'))

const BADGE_VARIANT = {
  draft: 'secondary',
  submitted: 'accent',
  rejected: 'danger',
  approved_unpaid: 'attention',
  contracted_pending_start: 'accent',
  live: 'success',
  blocked: 'severe',
  paused: 'severe',
  suspended: 'danger',
  pause_limit_suspended: 'danger',
  legacy_suspended: 'danger',
  ended: 'secondary',
  archived: 'secondary',
}
const SUSPENDED_KEYS = new Set(['suspended', 'pause_limit_suspended', 'legacy_suspended'])
const TABS = [
  { key: 'overview', label: 'Visão geral' },
  { key: 'payments', label: 'Pagamentos' },
  { key: 'changes', label: 'Alterações' },
  { key: 'results', label: 'Resultados' },
]

// Página própria de gerenciamento (seção 4.2 do prompt de reestruturação): URL/estado
// dedicados (controlados pelo adId na query string de AdvertisingCentral), botão Voltar
// funcional e cada aba carregando sua própria dependência só quando aberta -- nenhuma
// consulta de histórico/pagamento acontece antes disso.
export default function AdManagePage({ campaign, onBack, onEdit, onChange, onViewResults }) {
  const status = deriveAdStatus(campaign)
  const hasFeed = campaign.placements?.some((item) => item.code === 'community_feed')
  const [tab, setTab] = useState('overview')
  const [revisions, setRevisions] = useState(null)
  const [revisionsError, setRevisionsError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmPause, setConfirmPause] = useState(false)
  const lock = useRef(false)
  const pauseRequestId = useRef(null)
  const resumeRequestId = useRef(null)

  async function run(action) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (action === 'interrupt') {
        pauseRequestId.current ||= crypto.randomUUID()
        await interruptAdvertisingCampaign(
          campaign,
          'Interrupção solicitada pelo anunciante',
          pauseRequestId.current
        )
        pauseRequestId.current = null
      }
      if (action === 'confirm-limit')
        await confirmAdvertisingPauseLimit(
          campaign,
          'Suspensão confirmada pelo anunciante após três pausas'
        )
      if (action === 'resume') {
        resumeRequestId.current ||= crypto.randomUUID()
        await resumeMyAdvertisingCampaign(campaign, resumeRequestId.current)
        resumeRequestId.current = null
      }
      await onChange?.()
      if (action === 'interrupt' || action === 'confirm-limit') setConfirmPause(false)
    } catch (e) {
      if (String(e?.message).includes('AD_PAUSE_LIMIT_CONFIRM_REQUIRED')) {
        try {
          const fresh = (await onChange?.())?.find((row) => row.ad_id === campaign.ad_id)
          setConfirmPause(fresh?.pauses_available === 0 && deriveAdStatus(fresh).key === 'live')
          setError(
            'O limite de pausas foi atingido. Confira a situação atualizada antes de confirmar a suspensão.'
          )
        } catch (refreshError) {
          setConfirmPause(false)
          setError(commercialError(refreshError))
        }
      } else {
        setError(commercialError(e))
        if (action === 'confirm-limit') {
          setConfirmPause(false)
          try {
            await onChange?.()
          } catch (refreshError) {
            setError(commercialError(refreshError))
          }
        } else if (/AD_(?:RESUME|PAUSE)_STALE/.test(String(e?.message))) {
          if (action === 'interrupt') pauseRequestId.current = null
          if (action === 'resume') resumeRequestId.current = null
          try {
            await onChange?.()
          } catch (refreshError) {
            setError(commercialError(refreshError))
          }
        }
      }
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  function primaryAction() {
    const action = status.primaryAction
    if (!action || action.type === 'wait') return null
    if (action.type === 'edit' || action.type === 'view' || action.type === 'view_schedule')
      return (
        <Button variant="primary" onClick={() => onEdit?.(campaign)}>
          {action.type === 'edit' ? action.label : 'Editar anúncio'}
        </Button>
      )
    if (action.type === 'resume')
      return (
        <Button variant="primary" disabled={busy} onClick={() => run('resume')}>
          {action.label}
        </Button>
      )
    if (action.type === 'contract') return null // renderizado abaixo, junto da prévia
    if (action.type === 'view_reason')
      return (
        <Button as={Link} to="/atendimento?tipo=appeal">
          {action.label}
        </Button>
      )
    if (action.type === 'track_review') return null
    return null
  }

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Button
          leadingVisual={ArrowLeftIcon}
          aria-label="Voltar para Meus anúncios"
          onClick={onBack}
          sx={{ flexShrink: 0 }}
        >
          Voltar
        </Button>
        <Text as="p" sx={{ fontWeight: 'bold', fontSize: 2, minWidth: 0, overflowWrap: 'anywhere' }}>
          {campaign.title}
        </Text>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Label variant={BADGE_VARIANT[status.key] || 'default'} sx={{ whiteSpace: 'normal' }}>
          {status.label}
        </Label>
        <Text as="span" sx={{ fontSize: 0, color: 'fg.muted' }}>
          {placementsSummary(campaign.placements)}
        </Text>
      </Box>

      {/* Botões simples e roláveis, não UnderlineNav: com 4 abas o componente colapsa as que
         não cabem num menu "More" cujo overlay quebra o z-index nesta tela (visto em
         produção) -- o mesmo problema que o filtro "Outras situações" da listagem evita ao
         não usar um menu flutuante. */}
      <Box
        role="tablist"
        aria-label="Seções do anúncio"
        sx={{
          display: 'flex',
          gap: 2,
          mb: 3,
          overflowX: 'auto',
          pb: 1,
          borderBottom: '1px solid',
          borderColor: 'border.default',
        }}
      >
        {TABS.map((item) => (
          <Button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            size="small"
            variant={tab === item.key ? 'primary' : 'default'}
            sx={{ flexShrink: 0 }}
            onClick={() => {
              if (item.key === 'results') {
                onViewResults?.(campaign)
                return
              }
              setTab(item.key)
              if (item.key === 'changes' && revisions === null) {
                getAdvertisingRevisions(campaign.ad_id)
                  .then(setRevisions)
                  .catch((e) => setRevisionsError(commercialError(e)))
              }
            }}
          >
            {item.label}
          </Button>
        ))}
      </Box>

      {error && (
        <Flash variant="danger" sx={{ mb: 2 }}>
          {error}
        </Flash>
      )}

      {tab === 'overview' && (
        <Box>
          {status.detail && (
            <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mb: 2 }}>
              {status.detail}
            </Text>
          )}
          {SUSPENDED_KEYS.has(status.key) && (
            <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mb: 2 }}>
              Informe o identificador do anúncio ao atendimento: {campaign.ad_id}
            </Text>
          )}
          {status.pendingRevisionNote && (
            <Flash variant="attention" sx={{ mb: 2 }}>
              {status.pendingRevisionNote}
            </Flash>
          )}
          {status.remainingDays != null && (
            <Text as="p" sx={{ fontSize: 0, mb: 1 }}>
              {status.remainingDays} dia(s) restante(s)
            </Text>
          )}
          {campaign.expires_at && (
            <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mb: 2 }}>
              {commercialDate(campaign.starts_at)} até {commercialDate(campaign.expires_at)}
            </Text>
          )}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
            {primaryAction()}
            {status.key === 'live' && (
              <Button disabled={busy} onClick={() => setConfirmPause(true)}>
                Pausar anúncio
              </Button>
            )}
            {status.primaryAction?.type !== 'edit' && (
              <Button disabled={busy} onClick={() => onEdit?.(campaign)}>
                Editar anúncio
              </Button>
            )}
          </Box>

          {status.primaryAction?.type === 'contract' && campaign.can_pay && (
            <CommercialLeasePurchase
              resourceId={campaign.ad_id}
              resourceName={campaign.title}
              subjectLabel="anúncio"
              tariff={campaign.tariff}
              expiresAt={campaign.expires_at}
              initialDays={campaign.desired_duration_days}
              onComplete={onChange}
              compact
            />
          )}
          {status.primaryAction?.type === 'contract' && !campaign.can_pay && (
            <Text as="p" sx={{ color: 'fg.muted' }}>
              Apenas o proprietário da conta pode contratar a publicação deste anúncio.
            </Text>
          )}

          {(status.key === 'live' || hasFeed) && (
            <Box sx={{ mt: 2 }}>
              <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', mb: 1 }}>
                Prévia — a posição e a rotação reais no app variam.
              </Text>
              <AdvertisingCreativePreview
                placements={campaign.placements}
                partnerName={campaign.partner_name}
                title={campaign.title}
                description={campaign.description}
                mediaId={campaign.media_id}
              />
              {status.key === 'live' && campaign.destination && (
                <Button as="a" href={campaign.destination} target="_blank" rel="noopener noreferrer" sx={{ mt: 1 }}>
                  Abrir destino do anúncio
                </Button>
              )}
            </Box>
          )}

          {campaign.moderation_state === 'approved' && (
            <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mt: 2 }}>
              Alterações no anúncio podem exigir nova aprovação antes de aparecerem.
            </Text>
          )}
        </Box>
      )}

      {tab === 'payments' && (
        <Box>
          {campaign.can_pay ? (
            <Suspense fallback={<Spinner aria-label="Carregando pagamentos" />}>
              <CommercialOrderHistory resourceId={campaign.ad_id} load={getAdvertisingOrders} />
            </Suspense>
          ) : (
            <Text as="p" sx={{ color: 'fg.muted' }}>
              Apenas o proprietário da conta vê o histórico de pagamentos deste anúncio.
            </Text>
          )}
        </Box>
      )}

      {tab === 'changes' && (
        <Box>
          {revisionsError && <Flash variant="danger">{revisionsError}</Flash>}
          {revisions === null && !revisionsError && <Spinner aria-label="Carregando alterações" />}
          {revisions?.length === 0 && (
            <Text as="p" sx={{ color: 'fg.muted' }}>
              Nenhuma alteração registrada ainda.
            </Text>
          )}
          {revisions?.map((v) => (
            <Box
              key={v.version}
              sx={{ p: 2, bg: 'canvas.subtle', borderRadius: 2, mb: 2, overflowWrap: 'anywhere' }}
            >
              <Text as="p" sx={{ fontWeight: 'bold', fontSize: 0 }}>
                Revisão {v.version}: {v.title}
              </Text>
              <Text as="p" sx={{ fontSize: 0 }}>
                {v.description}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {confirmPause && (
        <Dialog
          title={status.pausesAvailable === 0 ? 'Limite de pausas atingido' : 'Pausar este anúncio?'}
          onClose={() => !busy && setConfirmPause(false)}
          width="medium"
        >
          <Box sx={{ p: 3 }}>
            {status.pausesAvailable === 0 ? (
              <Text as="p">
                Você já utilizou as três pausas permitidas. Se continuar, seu anúncio ficará
                suspenso e precisará de liberação do Evolutus para voltar a aparecer. O período
                contratado continuará contando.
              </Text>
            ) : (
              <>
                <Text as="p">
                  Seu anúncio deixará de aparecer temporariamente. Os dias contratados continuarão
                  contando.
                </Text>
                {status.pausesAvailable != null && (
                  <Text as="p" sx={{ color: 'fg.muted' }}>
                    Pausas disponíveis após esta ação: {status.pausesAvailable - 1} de 3.
                  </Text>
                )}
              </>
            )}
            {error && (
              <Flash variant="danger" role="alert">
                {error}
              </Flash>
            )}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 3 }}>
              <Button disabled={busy} onClick={() => setConfirmPause(false)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                aria-label={status.pausesAvailable === 0 ? 'Confirmar suspensão' : 'Confirmar pausa'}
                onClick={() => run(status.pausesAvailable === 0 ? 'confirm-limit' : 'interrupt')}
              >
                {status.pausesAvailable === 0 ? 'Confirmar suspensão' : 'Pausar anúncio'}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  )
}
