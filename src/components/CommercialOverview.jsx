import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Heading, Spinner, Text } from '@primer/react'
import { getAdvertisingCampaigns } from '../services/advertisingService'
import { listStorefronts } from '../services/storefrontService'
import { listRefundRequests } from '../services/refundService'

const CLOSED_REFUND_STATES = new Set(['completed', 'rejected', 'canceled_by_requester'])

function OverviewCard({ title, to, action, state, entries, empty }) {
  return (
    <Box
      as="section"
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        minWidth: 0,
      }}
    >
      <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
        {title}
      </Heading>
      {state === 'loading' && <Spinner aria-label={`Carregando ${title}`} />}
      {state === 'error' && (
        <Text as="p" role="alert" sx={{ color: 'danger.fg' }}>
          Não foi possível consultar estes dados.
        </Text>
      )}
      {state === 'ready' &&
        (entries.length ? (
          <Box as="ul" sx={{ pl: 3, my: 2 }}>
            {entries.slice(0, 3).map((entry) => (
              <Text as="li" key={entry.id} sx={{ mb: 1, overflowWrap: 'anywhere' }}>
                {entry.title}
              </Text>
            ))}
          </Box>
        ) : (
          <Text as="p" sx={{ color: 'fg.muted' }}>
            {empty}
          </Text>
        ))}
      <Button as={Link} to={to} sx={{ mt: 2 }}>
        {action}
      </Button>
    </Box>
  )
}

export default function CommercialOverview() {
  const [campaigns, setCampaigns] = useState({ state: 'loading', rows: [] })
  const [storefronts, setStorefronts] = useState({ state: 'loading', rows: [] })
  const [refunds, setRefunds] = useState({ state: 'loading', rows: [] })
  useEffect(() => {
    let active = true
    // Each source has its own result. A failed service cannot hide the other tasks.
    getAdvertisingCampaigns(null).then(
      (rows) => active && setCampaigns({ state: 'ready', rows }),
      () => active && setCampaigns({ state: 'error', rows: [] })
    )
    listStorefronts(true).then(
      (page) => active && setStorefronts({ state: 'ready', rows: page.items }),
      () => active && setStorefronts({ state: 'error', rows: [] })
    )
    listRefundRequests(true).then(
      (rows) => active && setRefunds({ state: 'ready', rows }),
      () => active && setRefunds({ state: 'error', rows: [] })
    )
    return () => {
      active = false
    }
  }, [])

  const pendingCampaigns = campaigns.rows.filter((row) => row.state === 'submitted')
  const eligibleCampaigns = campaigns.rows.filter((row) => row.placement_delivery_active === true)
  const pendingStorefronts = storefronts.rows.filter((row) => row.editorialState === 'submitted')
  const openRefunds = refunds.rows.filter((row) => !CLOSED_REFUND_STATES.has(row.status))
  return (
    <Box>
      <Text as="p" sx={{ color: 'fg.muted', mt: 0 }}>
        Atividade recente por área. As listas mostram somente os registros consultados nesta página;
        abra cada seção para ver o histórico completo.
      </Text>
      <Box
        sx={{ display: 'grid', gridTemplateColumns: ['1fr', 'repeat(2,minmax(0,1fr))'], gap: 2 }}
      >
        <OverviewCard
          title="Anúncios aguardando análise"
          to="/admin/parcerias?section=settings"
          action="Revisar anúncios"
          state={campaigns.state}
          entries={pendingCampaigns.map((row) => ({ id: row.ad_id, title: row.title }))}
          empty="Nenhum anúncio pendente nos registros recentes."
        />
        <OverviewCard
          title="Campanhas aptas para exibição"
          to="/admin/parcerias?section=advertising"
          action="Ver campanhas"
          state={campaigns.state}
          entries={eligibleCampaigns.map((row) => ({ id: row.ad_id, title: row.title }))}
          empty="Nenhuma campanha apta nos registros recentes."
        />
        <OverviewCard
          title="Vitrines aguardando análise"
          to="/admin/parcerias?section=storefronts"
          action="Analisar vitrines"
          state={storefronts.state}
          entries={pendingStorefronts.map((row) => ({ id: row.id, title: row.name }))}
          empty="Nenhuma vitrine pendente nos registros recentes."
        />
        <OverviewCard
          title="Reembolsos em andamento"
          to="/admin/compras-evocash?tab=refunds"
          action="Consultar reembolsos"
          state={refunds.state}
          entries={openRefunds.map((row) => ({ id: row.id, title: row.protocol }))}
          empty="Nenhum reembolso em andamento nos registros recentes."
        />
      </Box>
    </Box>
  )
}
