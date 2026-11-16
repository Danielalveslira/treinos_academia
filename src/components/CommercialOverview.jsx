import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Heading, Label, Spinner, Text } from '@primer/react'
import { getCommercialPendingCounts } from '../services/commercialOverviewService'

// Etapa A: o Início consulta só esta RPC (nenhuma lista completa de anúncios,
// vitrines ou reembolsos) -- os quatro contadores que ela já retornava sempre
// existiram; só não eram todos exibidos aqui. Uma resposta sem os quatro campos
// numéricos é tratada como falha de consulta, nunca como "zero pendências".
const PENDING_KEYS = ['pendingAds', 'pendingStorefronts', 'pendingBoosts', 'openRefunds']

function isValidCounts(value) {
  return !!value && PENDING_KEYS.every((key) => Number.isFinite(value[key]))
}

function approvalsBreakdown(value) {
  const parts = [
    value.pendingAds > 0 &&
      `${value.pendingAds} ${value.pendingAds === 1 ? 'anúncio' : 'anúncios'}`,
    value.pendingStorefronts > 0 &&
      `${value.pendingStorefronts} ${value.pendingStorefronts === 1 ? 'vitrine' : 'vitrines'}`,
    value.pendingBoosts > 0 &&
      `${value.pendingBoosts} ${value.pendingBoosts === 1 ? 'impulsionamento' : 'impulsionamentos'}`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function SummaryCard({ title, to, action, state, count, detail }) {
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
      {state === 'ready' && (
        <>
          <Label variant={count > 0 ? 'attention' : 'secondary'}>
            {count} {count === 1 ? 'pendente' : 'pendentes'}
          </Label>
          {detail && (
            <Text as="p" sx={{ color: 'fg.muted', fontSize: 1, mt: 1, mb: 0 }}>
              {detail}
            </Text>
          )}
        </>
      )}
      <Box sx={{ mt: 2 }}>
        <Button as={Link} to={to}>
          {action}
        </Button>
      </Box>
    </Box>
  )
}

export default function CommercialOverview() {
  const [counts, setCounts] = useState({ state: 'loading', value: null })
  useEffect(() => {
    let active = true
    getCommercialPendingCounts().then(
      (value) => {
        if (!active) return
        setCounts(
          isValidCounts(value) ? { state: 'ready', value } : { state: 'error', value: null }
        )
      },
      () => active && setCounts({ state: 'error', value: null })
    )
    return () => {
      active = false
    }
  }, [])

  const { state, value } = counts
  const approvalsTotal =
    state === 'ready'
      ? value.pendingAds + value.pendingStorefronts + value.pendingBoosts
      : undefined

  return (
    // Grade de 2 colunas no desktop: já comporta um terceiro cartão (o futuro
    // assistente de lançamento, PR4b) sem mudança de layout. Nenhum cartão vazio
    // é renderizado antes de existir funcionalidade real para ele.
    <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', 'repeat(2,minmax(0,1fr))'], gap: 2 }}>
      <SummaryCard
        title="Aprovações pendentes"
        to="/admin/parcerias?area=aprovacoes"
        action="Ver aprovações"
        state={state}
        count={approvalsTotal}
        detail={state === 'ready' ? approvalsBreakdown(value) : null}
      />
      <SummaryCard
        title="Reembolsos em andamento"
        to="/admin/compras-evocash?tab=refunds"
        action="Consultar reembolsos"
        state={state}
        count={state === 'ready' ? value.openRefunds : undefined}
      />
    </Box>
  )
}
