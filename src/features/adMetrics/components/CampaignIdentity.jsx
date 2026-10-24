import { Box, Text, Label } from '@primer/react'

export function CampaignIdentity({ campaign, measuredAt }) {
  const expired =
    campaign.expires_at &&
    new Date(campaign.expires_at).getTime() <= new Date(measuredAt || Date.now()).getTime()
  return (
    <Box sx={{ display: 'flex', gap: 3, alignItems: 'center', mb: 2, minWidth: 0 }}>
      {!campaign.deleted && campaign.image_url && (
        <Box
          as="img"
          src={campaign.image_url}
          alt="Material da campanha"
          loading="lazy"
          sx={{ width: 80, height: 64, objectFit: 'cover', borderRadius: 2 }}
        />
      )}
      <Box sx={{ minWidth: 0 }}>
        <Text sx={{ display: 'block', fontWeight: 'bold', overflowWrap: 'anywhere' }}>
          {campaign.title || campaign.partner_name || 'Campanha histórica'}
        </Text>
        <Label>
          {campaign.deleted ? 'Campanha excluída' : expired ? 'Encerrada' : 'Anúncio disponível'}
        </Label>
        {campaign.deleted && (
          <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
            Material original indisponível. Identificação histórica preservada.
          </Text>
        )}
        {campaign.starts_at && (
          <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
            Criada em {new Date(campaign.starts_at).toLocaleDateString('pt-BR')}
          </Text>
        )}
        <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
          {campaign.expires_at
            ? `Encerramento: ${new Date(campaign.expires_at).toLocaleString('pt-BR')}`
            : 'Sem encerramento informado'}
        </Text>
      </Box>
    </Box>
  )
}
