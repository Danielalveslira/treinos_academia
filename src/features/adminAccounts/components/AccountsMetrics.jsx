import { Box, Text } from '@primer/react'

const CARDS = [
  { key: '', metric: 'total_accounts', label: 'Total de contas' },
  { key: 'active', metric: 'active_accounts', label: 'Ativas' },
  { key: 'suspended', metric: 'suspended_accounts', label: 'Suspensas' },
  { key: 'new7d', metric: 'new_accounts_7d', label: 'Novas em 7 dias' },
  { key: 'deletions', metric: 'pending_deletions', label: 'Exclusões pendentes' },
]

// Os cartões vêm do mesmo snapshot da tabela e funcionam como filtro local: clicar de novo
// no cartão ativo remove o filtro (o primeiro cartão, "Total", só limpa o filtro de cartão).
export function AccountsMetrics({ metrics, activeCard, onSelectCard }) {
  return (
    <Box
      role="group"
      aria-label="Resumo das contas"
      sx={{
        display: 'grid',
        gridTemplateColumns: ['repeat(2, 1fr)', null, 'repeat(3, 1fr)', 'repeat(5, 1fr)'],
        gap: 2,
        mb: 3,
      }}
    >
      {CARDS.map((card) => {
        const pressed = card.key !== '' && activeCard === card.key
        const isTotal = card.key === ''
        return (
          <Box
            as="button"
            type="button"
            key={card.metric}
            aria-pressed={isTotal ? activeCard === '' : pressed}
            onClick={() => onSelectCard(isTotal || pressed ? '' : card.key)}
            sx={{
              textAlign: 'left',
              cursor: 'pointer',
              p: 3,
              borderRadius: 2,
              border: '1px solid',
              borderColor: (isTotal ? activeCard === '' : pressed)
                ? 'accent.emphasis'
                : 'border.default',
              bg: 'canvas.subtle',
              color: 'fg.default',
              font: 'inherit',
              '&:hover': { borderColor: 'accent.fg' },
            }}
          >
            <Text sx={{ display: 'block', fontSize: 1, color: 'fg.muted' }}>{card.label}</Text>
            <Text sx={{ display: 'block', fontSize: 4, fontWeight: 'bold', mt: 1 }}>
              {Number(metrics[card.metric] ?? 0).toLocaleString('pt-BR')}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
