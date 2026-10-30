import { useRef, useState } from 'react'
import { Box, Button, Flash, Label, Text } from '@primer/react'
import {
  archiveAdvertisingCampaign,
  getAdvertisingOrders,
  getAdvertisingRevisions,
  interruptAdvertisingCampaign,
} from '../../services/advertisingService'
import CommercialLeasePurchase from '../CommercialLeasePurchase'
import CommercialOrderHistory from '../CommercialOrderHistory'
import StorefrontImage from '../StorefrontImage'
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
  ended: 'secondary',
  archived: 'secondary',
}

export default function AdStatusCard({ campaign, onChange, onEdit }) {
  const status = deriveAdStatus(campaign)
  const [expanded, setExpanded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [revisions, setRevisions] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)

  async function run(action) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (action === 'archive') await archiveAdvertisingCampaign(campaign.ad_id)
      if (action === 'interrupt')
        await interruptAdvertisingCampaign(campaign.ad_id, 'Interrupção solicitada pelo anunciante')
      await onChange?.()
    } catch (e) {
      setError(commercialError(e))
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
    if (action.type === 'wait')
      return (
        <Button disabled>{action.label}</Button>
      )
    if (action.type === 'contract' || action.type === 'view_schedule' || action.type === 'view') {
      return (
        <Button variant="primary" onClick={() => setExpanded(true)}>
          {action.label}
        </Button>
      )
    }
    if (action.type === 'track_review' || action.type === 'view_reason')
      return <Button onClick={() => setExpanded(true)}>{action.label}</Button>
    return null
  }

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        my: 3,
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', minWidth: 0 }}>
        {campaign.media_id ? (
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
            <Text sx={{ fontSize: 0, color: 'fg.muted' }}>sem imagem</Text>
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
        </Box>
      </Box>

      {error && (
        <Flash variant="danger" sx={{ mt: 2 }}>
          {error}
        </Flash>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 3 }}>
        {primaryButton()}
        <Button onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Ver menos' : 'Ver detalhes'}
        </Button>
      </Box>

      {expanded && (
        <Box sx={{ mt: 3, pt: 3, borderTop: '1px solid', borderColor: 'border.default' }}>
          {status.detail && <Text as="p">{status.detail}</Text>}
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
            <Box sx={{ mt: 2, p: 2, bg: 'canvas.subtle', borderRadius: 2 }} aria-label="Prévia do anúncio">
              <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', mb: 1 }}>
                Prévia — a posição e a rotação reais no app variam.
              </Text>
              {campaign.media_id && <StorefrontImage id={campaign.media_id} size={160} />}
              <Text as="p" sx={{ fontWeight: 'bold' }}>
                {campaign.title}
              </Text>
              {campaign.description && <Text as="p">{campaign.description}</Text>}
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
            />
          )}
          {status.primaryAction?.type === 'contract' && !campaign.can_pay && (
            <Text as="p" sx={{ color: 'fg.muted' }}>
              Apenas o proprietário da conta pode contratar a publicação deste anúncio.
            </Text>
          )}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 3 }}>
            <Button disabled={busy} onClick={() => onEdit?.(campaign)}>
              Preparar revisão
            </Button>
            <Button
              disabled={busy || campaign.moderation_state === 'suspended'}
              onClick={() => run('interrupt')}
            >
              Interromper veiculação
            </Button>
            <Button disabled={busy || campaign.state === 'archived'} onClick={() => run('archive')}>
              Arquivar campanha
            </Button>
            {campaign.can_pay && (
              <Button onClick={() => setShowHistory((v) => !v)}>Histórico de contratações</Button>
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
              Histórico do material
            </Button>
          </Box>
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
    </Box>
  )
}
