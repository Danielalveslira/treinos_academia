import { Box, Button, Label, Text } from '@primer/react'
import StorefrontImage from '../StorefrontImage'
import { deriveAdStatus } from '../../utils/advertisingStatus'
import { placementsSummary } from '../../utils/placementLabels'

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

// Card compacto da listagem (seção 4.1 do prompt de reestruturação): uma ação principal
// contextual + "Gerenciar", sem histórico, pagamento ou contratação expandidos aqui dentro
// -- isso tudo vive na página de gerenciamento própria (AdManagePage), aberta pelo
// callback onManage.
export default function AdStatusCard({ campaign, onEdit, onManage }) {
  const status = deriveAdStatus(campaign)
  const hasFeed = campaign.placements?.some((item) => item.code === 'community_feed')

  function primaryButton() {
    const action = status.primaryAction
    if (!action || action.type === 'wait') return null
    if (action.type === 'edit')
      return (
        <Button variant="primary" onClick={() => onEdit?.(campaign)}>
          {action.label}
        </Button>
      )
    if (['resume', 'contract', 'view_schedule', 'view', 'view_reason', 'track_review'].includes(action.type))
      return (
        <Button variant="primary" onClick={() => onManage?.(campaign)}>
          {action.label}
        </Button>
      )
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
        mb: 2,
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
          <Text as="p" sx={{ fontWeight: 'bold', fontSize: 2, overflowWrap: 'anywhere' }}>
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

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 2 }}>
        {primaryButton()}
        <Button onClick={() => onManage?.(campaign)}>Gerenciar</Button>
      </Box>
    </Box>
  )
}
