import { Box, Text } from '@primer/react'

const CARDS = [
  { key: '', metric: 'total_accounts', label: 'Total de contas' },
  { key: 'active', metric: 'active_accounts', label: 'Ativas' },
  { key: 'suspended', metric: 'suspended_accounts', label: 'Suspensas' },
  { key: 'new7d', metric: 'new_accounts_7d', label: 'Novas em 7 dias' },
  { key: 'deletions', metric: 'pending_deletions', label: 'Exclusões pendentes' },
]

export function AccountsMetrics({ metrics, activeCard, onSelectCard }) {
  return (
    <Box
      className="accounts-metrics"
      role="group"
      aria-label="Resumo das contas"
      sx={{ bg: 'canvas.subtle', borderRadius: 2, mb: 3 }}
    >
      {CARDS.map((card) => {
        const selected = card.key !== '' && activeCard === card.key
        return (
          <Box
            as="button"
            type="button"
            key={card.metric}
            className="accounts-metric"
            aria-pressed={card.key === '' ? activeCard === '' : selected}
            onClick={() => onSelectCard(card.key === '' || selected ? '' : card.key)}
            sx={{
              color: 'fg.default',
              bg: selected ? 'accent.subtle' : 'transparent',
              borderColor: selected ? 'accent.emphasis' : 'transparent',
            }}
          >
            <Text className="accounts-metric-label" sx={{ color: 'fg.muted' }}>
              {card.label}
            </Text>
            <Text className="accounts-metric-value">
              {Number(metrics[card.metric] ?? 0).toLocaleString('pt-BR')}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
