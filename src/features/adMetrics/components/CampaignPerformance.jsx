import { CampaignIdentity } from './CampaignIdentity'
import { useMemo, useState } from 'react'
import { Box, Button, Select, Text, TextInput } from '@primer/react'
import { CAMPAIGN_SORTS, formatCount, formatPercent, organizeCampaigns } from '../utils/metrics'

// Desempenho por campanha. Busca e ordenação são locais (sem nova consulta); o detalhe de uma campanha abre
// em AdMetricsTab com UMA leitura filtrada por campanha (cacheada).
export function CampaignPerformance({ rows, total, truncated, onOpen }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('impressions')
  const visible = useMemo(() => organizeCampaigns(rows, { search, sort }), [rows, search, sort])
  if (!rows.length) return null
  return (
    <Box as="section" aria-label="Desempenho por campanha" sx={{ mb: 3 }}>
      <Text as="h3" sx={{ fontSize: 2, fontWeight: 'bold', mb: 2, display: 'block' }}>
        Por campanha
      </Text>
      <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', '2fr 1fr'], gap: 2, mb: 2 }}>
        <TextInput
          block
          aria-label="Buscar campanha"
          placeholder="Buscar nesta página"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          block
          aria-label="Ordenar campanhas"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {Object.entries(CAMPAIGN_SORTS).map(([key, def]) => (
            <Select.Option key={key} value={key}>
              Ordenar: {def.label}
            </Select.Option>
          ))}
        </Select>
      </Box>
      <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', mb: 2 }}>
        Busca e ordenação desta página; totais e exportações seguem os filtros do relatório.
      </Text>
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {visible.length === 0 && (
          <Text sx={{ display: 'block', p: 3, color: 'fg.muted' }}>
            Nenhuma campanha encontrada.
          </Text>
        )}
        {visible.map((row, index) => (
          <Box
            key={row.ad_id}
            sx={{
              p: 3,
              borderTop: index === 0 ? 'none' : '1px solid',
              borderColor: 'border.default',
            }}
          >
            <CampaignIdentity campaign={row} />
            <Box
              sx={{
                display: 'flex',
                gap: 2,
                alignItems: 'flex-start',
                justifyContent: 'space-between',
              }}
            >
              <Button
                size="small"
                onClick={() => onOpen(row)}
                sx={{ flexShrink: 0, minHeight: 36 }}
              >
                Detalhes
              </Button>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 2,
                mt: 2,
              }}
            >
              <Stat label="Impressões" value={formatCount(row.visible_impressions)} />
              <Stat label="Cliques" value={formatCount(row.clicks)} />
              <Stat label="CTR qualif." value={formatPercent(row.ctr_qualified)} />
            </Box>
          </Box>
        ))}
      </Box>
      {truncated && (
        <Text sx={{ display: 'block', mt: 2, fontSize: 0, color: 'fg.muted' }}>
          Mostrando as {formatCount(rows.length)} campanhas com mais impressões de{' '}
          {formatCount(total)}. Os totais incluem todas; use “Mais campanhas” para continuar.
        </Text>
      )}
    </Box>
  )
}

function Stat({ label, value }) {
  return (
    <Box>
      <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>{label}</Text>
      <Text sx={{ fontWeight: 'bold' }}>{value}</Text>
    </Box>
  )
}
