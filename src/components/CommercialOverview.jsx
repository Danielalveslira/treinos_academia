import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Heading, Label, Spinner, Text } from '@primer/react'
import { getAdvertisingCampaigns } from '../services/advertisingService'
import { listStorefronts } from '../services/storefrontService'
import { listRefundRequests } from '../services/refundService'
import { getCommercialPendingCounts } from '../services/commercialOverviewService'

const CLOSED_REFUND_STATES = new Set(['completed', 'rejected', 'canceled_by_requester'])

// `count`/`countState` são opcionais: só os cartões de pendência real (anúncios,
// vitrines, reembolsos) os recebem. Sem eles, o cartão volta ao comportamento
// original baseado só na amostra (ex.: "Campanhas aptas para exibição", que não é
// uma fila de pendências e não precisa de contagem exata no servidor).
function OverviewCard({ title, to, action, state, entries, empty, count, countState }) {
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Heading as="h2" sx={{ fontSize: 2, m: 0 }}>
          {title}
        </Heading>
        {countState === 'ready' && (
          <Label variant={count > 0 ? 'attention' : 'secondary'}>
            {count} {count === 1 ? 'pendente' : 'pendentes'}
          </Label>
        )}
      </Box>
      {countState === 'error' && (
        <Text as="p" role="alert" sx={{ color: 'danger.fg', fontSize: 1 }}>
          Não foi possível confirmar o total real de pendências.
        </Text>
      )}
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
            {/* O total vem do contador real quando disponível: nunca repete "nenhum
                pendente" só porque a amostra recente (de até 20 linhas) veio vazia. */}
            {countState === 'ready' && count > 0
              ? `${count} ${count === 1 ? 'pendente não aparece' : 'pendentes não aparecem'} nos registros recentes mostrados aqui — use "${action}" para ver todos.`
              : empty}
          </Text>
        ))}
      <Button as={Link} to={to} sx={{ mt: 2 }}>
        {action}
      </Button>
    </Box>
  )
}

const emptyCounts = { state: 'loading', value: {} }

export default function CommercialOverview() {
  const [campaigns, setCampaigns] = useState({ state: 'loading', rows: [] })
  const [storefronts, setStorefronts] = useState({ state: 'loading', rows: [] })
  const [refunds, setRefunds] = useState({ state: 'loading', rows: [] })
  const [counts, setCounts] = useState(emptyCounts)
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
    // Contagem real do servidor, independente das três amostras acima: nunca deriva
    // "0 pendências" de uma lista truncada, e sua falha não esconde as amostras.
    getCommercialPendingCounts().then(
      (value) => active && setCounts({ state: 'ready', value }),
      () => active && setCounts({ state: 'error', value: {} })
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
          to="/admin/parcerias?area=aprovacoes"
          action="Revisar anúncios"
          state={campaigns.state}
          entries={pendingCampaigns.map((row) => ({ id: row.ad_id, title: row.title }))}
          empty="Nenhum anúncio pendente."
          count={counts.value.pendingAds}
          countState={counts.state}
        />
        <OverviewCard
          title="Campanhas aptas para exibição"
          to="/admin/parcerias?area=publicidade&tab=campanhas"
          action="Ver campanhas"
          state={campaigns.state}
          entries={eligibleCampaigns.map((row) => ({ id: row.ad_id, title: row.title }))}
          empty="Nenhuma campanha apta nos registros recentes."
        />
        <OverviewCard
          title="Vitrines aguardando análise"
          to="/admin/parcerias?area=aprovacoes"
          action="Analisar vitrines"
          state={storefronts.state}
          entries={pendingStorefronts.map((row) => ({ id: row.id, title: row.name }))}
          empty="Nenhuma vitrine pendente."
          count={counts.value.pendingStorefronts}
          countState={counts.state}
        />
        <OverviewCard
          title="Reembolsos em andamento"
          to="/admin/compras-evocash?tab=refunds"
          action="Consultar reembolsos"
          state={refunds.state}
          entries={openRefunds.map((row) => ({ id: row.id, title: row.protocol }))}
          empty="Nenhum reembolso em andamento."
          count={counts.value.openRefunds}
          countState={counts.state}
        />
      </Box>
    </Box>
  )
}
