import { Suspense, lazy, useMemo, useState } from 'react'
import { Box, Button, Flash, Spinner, Text } from '@primer/react'
import { SyncIcon } from '@primer/octicons-react'
import { useAdMetricsDashboard } from '../hooks/useAdMetricsDashboard'
import {
  DEFAULT_FILTERS,
  ERROR_MESSAGES,
  campaignName,
  classifySnapshot,
  fillDailySeries,
  formatCount,
  formatPeriod,
  formatPercent,
  placementLabel,
} from '../utils/metrics'
import { MetricsFilters } from './MetricsFilters'
import { MetricsSummary } from './MetricsSummary'
import { PlacementBreakdown } from './PlacementBreakdown'
import { CampaignPerformance } from './CampaignPerformance'

// O gráfico (recharts) só é baixado quando existe algo a desenhar; o espaço é reservado para não deslocar a tela.
const DailyChart = lazy(() => import('./DailyChart'))

function ChartBlock({ daily, period }) {
  const data = useMemo(() => fillDailySeries(daily, period), [daily, period])
  return (
    <Box sx={{ mb: 3 }}>
      <Text as="h3" sx={{ fontSize: 2, fontWeight: 'bold', mb: 2, display: 'block' }}>
        Por dia
      </Text>
      <Suspense
        fallback={
          <Box sx={{ height: 220, display: 'grid', placeItems: 'center' }}>
            <Spinner size="small" />
          </Box>
        }
      >
        <DailyChart data={data} />
      </Suspense>
      <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
        Barras: impressões visíveis (eixo esquerdo). Linha: cliques (eixo direito). Dias sem
        registro aparecem como zero.
      </Text>
    </Box>
  )
}

function ContextList({ rows, total, truncated }) {
  if (!rows.length) return null
  return (
    <Box as="details" sx={{ mb: 3 }}>
      <Text
        as="summary"
        sx={{
          cursor: 'pointer',
          fontWeight: 'bold',
          minHeight: 36,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        Por comunidade e posicionamento ({formatCount(total)})
      </Text>
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          overflow: 'hidden',
          mt: 1,
        }}
      >
        {rows.map((row, index) => (
          <Box
            key={`${row.placement}-${row.context_id}`}
            sx={{
              p: 3,
              borderTop: index === 0 ? 'none' : '1px solid',
              borderColor: 'border.default',
            }}
          >
            <Text sx={{ display: 'block', fontWeight: 'bold', overflowWrap: 'anywhere' }}>
              {row.placement === 'home_banner'
                ? 'Home'
                : row.community_name || 'Comunidade removida'}
            </Text>
            <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
              {placementLabel(row.placement)}
            </Text>
            <Text sx={{ display: 'block', fontSize: 1, mt: 1 }}>
              {formatCount(row.visible_impressions)} impressões · {formatCount(row.clicks)} cliques
              · CTR qualificado {formatPercent(row.ctr_qualified)}
            </Text>
          </Box>
        ))}
      </Box>
      {truncated && (
        <Text sx={{ display: 'block', mt: 1, fontSize: 0, color: 'fg.muted' }}>
          Mostrando os 50 maiores de {formatCount(total)}. Use os filtros para ver os demais.
        </Text>
      )}
    </Box>
  )
}

function Snapshot({ snapshot, onOpenCampaign, detail }) {
  const state = classifySnapshot(snapshot)
  const collection = snapshot.collection || {}
  if (state === 'collection_off') {
    return (
      <Flash sx={{ mb: 3 }}>
        A coleta de métricas está desligada e ainda não há dados registrados. Quando for ativada, os
        números aparecem aqui; nenhum valor é estimado ou simulado.
      </Flash>
    )
  }
  if (state === 'empty') {
    return (
      <Box
        sx={{
          p: 4,
          textAlign: 'center',
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          mb: 3,
        }}
      >
        <Text sx={{ display: 'block', fontWeight: 'bold' }}>
          Ainda não há métricas neste período
        </Text>
        <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 1, mt: 1 }}>
          {collection.server_enabled
            ? 'Tente outro período ou remova filtros.'
            : 'A coleta está desligada no momento; há dados de outros períodos.'}
        </Text>
      </Box>
    )
  }
  return (
    <>
      {!collection.server_enabled && (
        <Flash variant="warning" sx={{ mb: 3 }}>
          A coleta está desligada no momento; os números abaixo são de dados já registrados.
        </Flash>
      )}
      <MetricsSummary summary={snapshot.summary} />
      <ChartBlock daily={snapshot.daily} period={snapshot.period} />
      {!detail && <PlacementBreakdown rows={snapshot.by_placement} />}
      {!detail && (
        <CampaignPerformance
          rows={snapshot.by_campaign}
          total={snapshot.campaigns_total}
          truncated={snapshot.campaigns_truncated}
          onOpen={onOpenCampaign}
        />
      )}
      {detail && <PlacementBreakdown rows={snapshot.by_placement} />}
      <ContextList
        rows={snapshot.by_context}
        total={snapshot.contexts_total}
        truncated={snapshot.contexts_truncated}
      />
    </>
  )
}

function DetailPanel({ userId, filters, row, fetcher, onClose }) {
  const detail = useAdMetricsDashboard({
    userId,
    filters: { ...filters, adId: row.ad_id },
    enabled: true,
    fetcher,
  })
  return (
    <Box
      sx={{ border: '1px solid', borderColor: 'accent.emphasis', borderRadius: 2, p: 3, mb: 3 }}
      role="region"
      aria-label={`Detalhe de ${campaignName(row)}`}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 2,
          alignItems: 'center',
          mb: 2,
        }}
      >
        <Text sx={{ fontWeight: 'bold', overflowWrap: 'anywhere' }}>{campaignName(row)}</Text>
        <Button size="small" onClick={onClose} sx={{ minHeight: 36 }}>
          Fechar detalhe
        </Button>
      </Box>
      {detail.status === 'loading' && !detail.snapshot && <Spinner size="small" />}
      {detail.error && (
        <Flash variant="danger" sx={{ mb: 2 }}>
          {ERROR_MESSAGES[detail.error]}
        </Flash>
      )}
      {detail.snapshot && <Snapshot snapshot={detail.snapshot} detail />}
    </Box>
  )
}

// Aba "Métricas" de Administração → Anúncios e parcerias. Carregada sob demanda (React.lazy na página) e só lê o
// servidor depois de aberta. `ads` e `communities` já estão em memória na página (nenhuma consulta extra aqui).
export default function AdMetricsTab({ userId, ads, communities, fetcher }) {
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS })
  const [detailRow, setDetailRow] = useState(null)
  const { status, snapshot, error, fetchedAt, refresh } = useAdMetricsDashboard({
    userId,
    filters,
    enabled: true,
    fetcher,
  })
  const busy = status === 'loading'

  return (
    <Box>
      {/* Cabeçalho de altura estável: sempre duas linhas curtas (placeholder igual ao preenchido) e o botão numa linha
          própria no celular, para a chegada do snapshot não empurrar os filtros (CLS). */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: ['column', null, 'row'],
          alignItems: ['flex-start', null, 'center'],
          justifyContent: 'space-between',
          gap: 2,
          mb: 2,
        }}
      >
        <Box sx={{ fontSize: 1, color: 'fg.muted', lineHeight: '20px' }}>
          <Text sx={{ display: 'block' }}>
            {snapshot ? `${formatPeriod(snapshot.period)} · Brasília` : 'Período · Brasília'}
          </Text>
          <Text sx={{ display: 'block' }}>
            {fetchedAt
              ? `atualizado às ${new Date(fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : 'ainda não atualizado'}
          </Text>
        </Box>
        <Button
          size="small"
          leadingVisual={SyncIcon}
          disabled={busy}
          onClick={() => {
            refresh()
          }}
          sx={{ minHeight: 36 }}
        >
          Atualizar
        </Button>
      </Box>

      <MetricsFilters
        filters={filters}
        onChange={(next) => {
          setDetailRow(null)
          setFilters(next)
        }}
        ads={ads}
        communities={communities}
        today={snapshot?.period?.today}
        disabled={busy}
      />

      {error && (
        <Flash variant={snapshot ? 'warning' : 'danger'} sx={{ mb: 3 }}>
          {ERROR_MESSAGES[error]}
          {snapshot && error !== 'forbidden' ? ' Mostrando o último resultado válido.' : ''}
          {error !== 'forbidden' && error !== 'unavailable' && (
            <Button
              size="small"
              variant="invisible"
              onClick={() => {
                refresh()
              }}
              sx={{ ml: 2 }}
            >
              Tentar de novo
            </Button>
          )}
        </Flash>
      )}

      {busy && !snapshot && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}

      {snapshot && (
        <Box aria-busy={busy} sx={{ opacity: busy ? 0.6 : 1, transition: 'opacity 120ms' }}>
          {detailRow && (
            <DetailPanel
              userId={userId}
              filters={filters}
              row={detailRow}
              fetcher={fetcher}
              onClose={() => setDetailRow(null)}
            />
          )}
          <Snapshot snapshot={snapshot} onOpenCampaign={setDetailRow} />
        </Box>
      )}
    </Box>
  )
}
