import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Box, Button, Flash, Select, Spinner, Text } from '@primer/react'
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
import { ReportActions } from './ReportActions'
import { CampaignPerformance } from './CampaignPerformance'

// O gráfico (recharts) só é baixado quando existe algo a desenhar; o espaço é reservado para não deslocar a tela.
const DailyChart = lazy(() => import('./DailyChart'))

function ChartBlock({ daily, period }) {
  const [mode, setMode] = useState('both')
  const data = useMemo(() => fillDailySeries(daily, period), [daily, period])
  return (
    <Box sx={{ mb: 3 }}>
      <Text as="h3" sx={{ fontSize: 2, fontWeight: 'bold', mb: 2, display: 'block' }}>
        Por dia
      </Text>
      <Select
        aria-label="Indicadores no gráfico"
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        sx={{ mb: 2 }}
      >
        <Select.Option value="both">Impressões e cliques</Select.Option>
        <Select.Option value="impressions">Impressões</Select.Option>
        <Select.Option value="clicks">Cliques</Select.Option>
      </Select>
      <Suspense
        fallback={
          <Box sx={{ height: 220, display: 'grid', placeItems: 'center' }}>
            <Spinner size="small" />
          </Box>
        }
      >
        <DailyChart data={data} mode={mode} />
      </Suspense>
      <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
        Barras: impressões visíveis (eixo esquerdo). Linha: cliques (eixo direito). Dias sem
        registro ficam sem valor; não comprovam medição de zero.
      </Text>
      <Box as="details" sx={{ mt: 2 }}>
        <summary>Série diária em tabela</summary>
        <Box sx={{ overflowX: 'auto' }}>
          <Box as="table" sx={{ width: '100%', textAlign: 'left', fontSize: 1 }}>
            <caption>
              Impressões e cliques por dia de medição; — indica ausência de registro.
            </caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Impressões</th>
                <th scope="col">Cliques</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.day}>
                  <th scope="row">{row.day}</th>
                  <td>{formatCount(row.impressions)}</td>
                  <td>{formatCount(row.clicks)}</td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      </Box>
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
                : row.placement === 'progress_banner'
                  ? 'Progresso'
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
          Total de {formatCount(total)} contextos. Use “Mais contextos” para continuar.
        </Text>
      )}
    </Box>
  )
}

export function Snapshot({ snapshot, onOpenCampaign, detail }) {
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
      {detail.snapshot && !detail.error && (
        <ReportActions
          filters={{ ...filters, adId: row.ad_id }}
          snapshot={detail.snapshot}
          fetcher={fetcher}
          onUnauthorized={onClose}
        />
      )}
      {detail.snapshot && <Snapshot snapshot={detail.snapshot} detail />}
    </Box>
  )
}

// Aba "Resultados" de Administração → Central comercial. Carregada sob demanda (React.lazy na página) e só lê o
// servidor depois de aberta. `ads` e `communities` já estão em memória na página (nenhuma consulta extra aqui).
export default function AdMetricsTab({
  userId,
  ads,
  communities,
  fetcher,
  accountId,
  initialFilters,
  onFiltersChange,
  onAccessDenied,
}) {
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS, ...initialFilters, accountId })
  const [detailRow, setDetailRow] = useState(null)
  const { status, snapshot, error, fetchedAt, refresh } = useAdMetricsDashboard({
    userId,
    filters,
    enabled: true,
    fetcher,
  })
  useEffect(() => {
    if (error === 'forbidden') onAccessDenied?.()
  }, [error, onAccessDenied])
  useEffect(() => {
    if (!accountId) return undefined
    const validate = () => {
      if (document.visibilityState !== 'hidden') refresh()
    }
    window.addEventListener('focus', validate)
    document.addEventListener('visibilitychange', validate)
    return () => {
      window.removeEventListener('focus', validate)
      document.removeEventListener('visibilitychange', validate)
    }
  }, [accountId, refresh])
  const scopedCommunities = useMemo(() => {
    const rows = new Map((communities || []).map((row) => [row.id, row]))
    for (const row of snapshot?.by_context || [])
      if (!['home_banner', 'progress_banner'].includes(row.placement))
        rows.set(row.context_id, {
          id: row.context_id,
          name: row.community_name || 'Comunidade removida',
        })
    if (filters.communityId && !rows.has(filters.communityId))
      rows.set(filters.communityId, { id: filters.communityId, name: 'Comunidade selecionada' })
    return [...rows.values()]
  }, [communities, snapshot, filters.communityId])
  const busy = status === 'loading'
  function changeFilters(next) {
    const scoped = { ...next, accountId, campaignOffset: 0, contextOffset: 0 }
    setDetailRow(null)
    if (onFiltersChange) onFiltersChange(scoped)
    else setFilters(scoped)
  }

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
              ? `atualizado às ${new Date(snapshot?.generated_at || fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : 'ainda não atualizado'}
          </Text>
        </Box>
        <Button
          size="small"
          leadingVisual={SyncIcon}
          disabled={busy}
          onClick={() => {
            setDetailRow(null)
            refresh()
          }}
          sx={{ minHeight: 36 }}
        >
          Atualizar
        </Button>
      </Box>

      {snapshot && !busy && !error && (
        <ReportActions
          filters={filters}
          snapshot={snapshot}
          fetcher={fetcher}
          onUnauthorized={refresh}
        />
      )}
      <Text sx={{ display: 'block', mb: 2, color: 'fg.muted', fontSize: 0 }}>
        Dias de medição em America/Sao_Paulo. O horário de atualização é local. Cobertura histórica
        desconhecida: depende do cliente habilitado, autenticação, elegibilidade, ausência de
        oposição e entrega dos eventos. Sem registros não significa zero.
        {snapshot?.collection?.last_day &&
          ` Último dia com eventos neste escopo: ${snapshot.collection.last_day}.`}
      </Text>
      {snapshot?.previous && (
        <Text sx={{ display: 'block', mb: 2, fontSize: 1 }}>
          Período anterior equivalente: {formatPeriod(snapshot.previous.period)}.
          {snapshot.previous.has_data && snapshot.has_data
            ? ` Impressões registradas: ${formatCount(snapshot.previous.summary.visible_impressions)}; cliques: ${formatCount(snapshot.previous.summary.clicks)}. A cobertura da coleta não permite concluir melhora ou piora.`
            : ' Sem registros suficientes para comparar.'}
        </Text>
      )}
      <MetricsFilters
        filters={filters}
        onChange={(next) => {
          changeFilters(next)
        }}
        ads={ads}
        communities={scopedCommunities}
        today={snapshot?.period?.today}
        disabled={busy}
      />

      {error && (
        <Flash variant={snapshot ? 'warning' : 'danger'} sx={{ mb: 3 }}>
          {accountId && error === 'forbidden'
            ? 'Acesso negado a esta conta ou campanha.'
            : ERROR_MESSAGES[error]}
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

      {snapshot && (!accountId || !busy) && (
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
          {(snapshot.campaigns_truncated ||
            filters.campaignOffset > 0 ||
            snapshot.contexts_truncated ||
            filters.contextOffset > 0) && (
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <Button
                disabled={busy || !filters.campaignOffset}
                onClick={() =>
                  setFilters({
                    ...filters,
                    campaignOffset: Math.max(0, (filters.campaignOffset || 0) - 100),
                  })
                }
              >
                Campanhas anteriores
              </Button>
              <Button
                disabled={busy || !snapshot.campaigns_truncated}
                onClick={() =>
                  setFilters({ ...filters, campaignOffset: (filters.campaignOffset || 0) + 100 })
                }
              >
                Mais campanhas
              </Button>
              <Button
                disabled={busy || !filters.contextOffset}
                onClick={() =>
                  setFilters({
                    ...filters,
                    contextOffset: Math.max(0, (filters.contextOffset || 0) - 100),
                  })
                }
              >
                Contextos anteriores
              </Button>
              <Button
                disabled={busy || !snapshot.contexts_truncated}
                onClick={() =>
                  setFilters({ ...filters, contextOffset: (filters.contextOffset || 0) + 100 })
                }
              >
                Mais contextos
              </Button>
            </Box>
          )}
          <Snapshot
            snapshot={snapshot}
            onOpenCampaign={
              accountId ? (row) => changeFilters({ ...filters, adId: row.ad_id }) : setDetailRow
            }
          />
        </Box>
      )}
    </Box>
  )
}
