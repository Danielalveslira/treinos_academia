import { Box, Text } from '@primer/react'
import { formatCount, formatPercent, placementLabel } from '../utils/metrics'

// Comparação por posicionamento: barra proporcional às impressões (CSS puro, sem biblioteca).
export function PlacementBreakdown({ rows }) {
  if (!rows.length) return null
  const max = Math.max(1, ...rows.map((r) => r.visible_impressions))
  return (
    <Box as="section" aria-label="Comparação por posicionamento" sx={{ mb: 3 }}>
      <Text as="h3" sx={{ fontSize: 2, fontWeight: 'bold', mb: 2, display: 'block' }}>
        Por posicionamento
      </Text>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((row) => (
          <Box
            key={row.placement}
            sx={{ p: 3, border: '1px solid', borderColor: 'border.default', borderRadius: 2 }}
          >
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}
            >
              <Text sx={{ fontWeight: 'bold' }}>{placementLabel(row.placement)}</Text>
              <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
                CTR qualificado {formatPercent(row.ctr_qualified)}
              </Text>
            </Box>
            <Box
              aria-hidden="true"
              sx={{ height: 6, borderRadius: 3, bg: 'neutral.muted', mt: 2, overflow: 'hidden' }}
            >
              <Box
                sx={{ height: '100%', bg: 'accent.emphasis' }}
                style={{ width: `${Math.max(2, (row.visible_impressions / max) * 100)}%` }}
              />
            </Box>
            <Text sx={{ display: 'block', mt: 2, fontSize: 1, color: 'fg.muted' }}>
              {formatCount(row.visible_impressions)} impressões · {formatCount(row.clicks)} cliques
              · {formatCount(row.unique_viewers)} alcance diário agregado
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
