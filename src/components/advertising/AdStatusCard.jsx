import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Dialog, Flash, Label, Text } from '@primer/react'
import {
  getAdvertisingOrders,
  getAdvertisingRevisions,
  confirmAdvertisingPauseLimit,
  interruptAdvertisingCampaign,
  resumeMyAdvertisingCampaign,
} from '../../services/advertisingService'
import CommercialLeasePurchase from '../CommercialLeasePurchase'
import CommercialOrderHistory from '../CommercialOrderHistory'
import StorefrontImage from '../StorefrontImage'
import AdvertisingCreativePreview from './AdvertisingCreativePreview'
import { deriveAdStatus } from '../../utils/advertisingStatus'
import { placementsSummary } from '../../utils/placementLabels'
import { commercialDate, commercialError } from '../../utils/commercial'

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
  ended: 'secondary',
  archived: 'secondary',
}

export default function AdStatusCard({ campaign, onChange, onEdit }) {
  const status = deriveAdStatus(campaign)
  const hasFeed = campaign.placements?.some((item) => item.code === 'community_feed')
  const [expanded, setExpanded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [revisions, setRevisions] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmPause, setConfirmPause] = useState(false)
  const lock = useRef(false)
  // Uma intenção de pausa/retomada mantém o mesmo requestId entre tentativas (ex.: o usuário
  // repete o clique depois de um erro de rede) até ser concluída com sucesso -- é o que permite
  // ao backend reconhecer uma requisição atrasada/duplicada da MESMA intenção e não aplicá-la
  // de novo, mesmo que o anúncio já tenha sido retomado e pausado outra vez nesse meio-tempo.
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
          // A situação mudou enquanto a tela estava aberta (ex.: outra ação já pausou/retomou
          // de novo); atualiza para que o próximo clique carregue o pause_operation_id correto.
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

  function primaryButton() {
    const action = status.primaryAction
    if (!action) return null
    if (action.type === 'edit')
      return (
        <Button variant="primary" onClick={() => onEdit?.(campaign)}>
          {action.label}
        </Button>
      )
    if (action.type === 'wait') return null
    if (action.type === 'resume')
      return (
        <Button variant="primary" disabled={busy} onClick={() => run('resume')}>
          {action.label}
        </Button>
      )
    if (action.type === 'contract' || action.type === 'view_schedule' || action.type === 'view') {
      return (
        <Button variant="primary" onClick={() => setExpanded(true)}>
          {action.label}
        </Button>
      )
    }
    if (action.type === 'view_reason')
      return (
        <Button as={Link} to="/atendimento?tipo=appeal">
          {action.label}
        </Button>
      )
    if (action.type === 'track_review')
      return <Button onClick={() => setExpanded(true)}>{action.label}</Button>
    return null
  }

  return (
    <Box
      data-testid={`ad-${campaign.ad_id}`}
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        my: 3,
        minWidth: 0,
        overflowWrap: 'anywhere',
        '& button': { minHeight: 44 },
      }}
    >
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', minWidth: 0 }}>
        {hasFeed && campaign.media_id ? (
          <StorefrontImage id={campaign.media_id} size={64} />
        ) : (
          <Box
            sx={{
              width: 64,
              height: 64,
              flexShrink: 0,
              borderRadius: 2,
              bg: 'canvas.subtle',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-hidden="true"
          >
            <Text sx={{ fontSize: 0, color: 'fg.muted' }}>{hasFeed ? 'sem imagem' : 'Banner'}</Text>
          </Box>
        )}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Text as="p" sx={{ fontWeight: 'bold', fontSize: 2 }}>
            {campaign.title}
          </Text>
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
            {placementsSummary(campaign.placements)}
          </Text>
          <Label
            variant={BADGE_VARIANT[status.key] || 'default'}
            sx={{ mt: 1, display: 'inline', whiteSpace: 'normal', maxWidth: '100%' }}
          >
            {status.label}
          </Label>
          {status.remainingDays != null && (
            <Text as="p" sx={{ fontSize: 0, mt: 1 }}>
              {status.remainingDays} dia(s) restante(s)
            </Text>
          )}
          {status.pausesAvailable != null && (
            <Text as="p" sx={{ fontSize: 0, mt: 1, color: 'fg.muted' }}>
              Pausas disponíveis: {status.pausesAvailable} de 3
            </Text>
          )}
        </Box>
      </Box>

      {error && (
        <Flash variant="danger" sx={{ mt: 2 }}>
          {error}
        </Flash>
      )}

      {(status.key === 'paused' || status.key === 'suspended') && status.detail && (
        <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mt: 2 }}>
          {status.detail}
        </Text>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 3 }}>
        {primaryButton()}
        {status.key === 'live' && (
          <Button disabled={busy} onClick={() => setConfirmPause(true)}>
            Pausar anúncio
          </Button>
        )}
        <Button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? 'Fechar' : 'Gerenciar'}
        </Button>
      </Box>

      {expanded && (
        <Box sx={{ mt: 3, pt: 3, borderTop: '1px solid', borderColor: 'border.default' }}>
          {status.detail && status.key !== 'paused' && status.key !== 'suspended' && (
            <Text as="p">{status.detail}</Text>
          )}
          {status.key === 'suspended' && (
            <Text as="p" sx={{ color: 'fg.muted', fontSize: 0 }}>
              Informe o identificador do anúncio ao atendimento: {campaign.ad_id}
            </Text>
          )}
          {status.pendingRevisionNote && (
            <Text as="p" sx={{ color: 'attention.fg' }}>
              {status.pendingRevisionNote}
            </Text>
          )}
          {campaign.expires_at && (
            <Text as="p">
              {commercialDate(campaign.starts_at)} até {commercialDate(campaign.expires_at)}
            </Text>
          )}

          {status.key === 'live' && (
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
              {campaign.destination && (
                <Button
                  as="a"
                  href={campaign.destination}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ mt: 1 }}
                >
                  Abrir destino do anúncio
                </Button>
              )}
            </Box>
          )}

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

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 3 }}>
            <Button disabled={busy} onClick={() => onEdit?.(campaign)}>
              Editar anúncio
            </Button>
            {campaign.can_pay && (
              <Button onClick={() => setShowHistory((v) => !v)}>Histórico de pagamentos</Button>
            )}
            <Button
              onClick={async () => {
                try {
                  setRevisions(revisions ? null : await getAdvertisingRevisions(campaign.ad_id))
                } catch (e) {
                  setError(commercialError(e))
                }
              }}
            >
              Histórico de alterações
            </Button>
          </Box>
          {campaign.moderation_state === 'approved' && (
            <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mt: 2 }}>
              Alterações no anúncio podem exigir nova aprovação antes de aparecerem.
            </Text>
          )}
          {showHistory && (
            <CommercialOrderHistory resourceId={campaign.ad_id} load={getAdvertisingOrders} />
          )}
          {revisions?.map((v) => (
            <Box key={v.version} sx={{ p: 2, bg: 'canvas.subtle', my: 2 }}>
              <Text as="p">
                Revisão {v.version}: {v.title}
              </Text>
              <Text as="p">{v.description}</Text>
            </Box>
          ))}
        </Box>
      )}
      {confirmPause && (
        <Dialog
          title={
            status.pausesAvailable === 0 ? 'Limite de pausas atingido' : 'Pausar este anúncio?'
          }
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
