import { Box, Button, ProgressBar } from '@primer/react'
import { useCatalogSnapshotStatus } from '../hooks/useCatalogSnapshotStatus.js'
import { useExerciseImagePrep } from '../hooks/useExerciseImagePrep.js'

const KIND_TEXT = {
  'not-prepared': 'Não preparado',
  downloading: 'Baixando',
  available: 'Disponível offline',
  'update-pending': 'Atualização pendente',
  'storage-error': 'Erro de armazenamento',
  error: 'Erro ao atualizar',
}

// Reaproveita os modificadores de cor que .sync-status já define (synced/syncing/pending/failed)
// em vez de criar um conjunto novo -- mesmo significado (verde/laranja/vermelho), sem CSS extra.
const KIND_SYNC_CLASS = {
  downloading: 'sync-status-syncing',
  available: 'sync-status-synced',
  'update-pending': 'sync-status-pending',
  'storage-error': 'sync-status-failed',
  error: 'sync-status-failed',
}

function formatSyncedAt(timestamp) {
  if (!timestamp) return null
  try {
    return new Date(timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return null
  }
}

function catalogInfoText({ kind, totalActive, progress }) {
  if (kind === 'downloading') {
    return progress?.downloaded ? `Baixando ${progress.downloaded}${totalActive ? ` de ${totalActive}` : ''}` : 'Baixando…'
  }
  if (kind === 'available') return `Disponível offline${totalActive ? ` · ${totalActive} exercícios` : ''}`
  return KIND_TEXT[kind] || KIND_TEXT['not-prepared']
}

// Módulo compacto do Catálogo (seção 5 do prompt): status do snapshot completo de texto +
// preparo seletivo de imagens da rotina. Nunca dispara sozinho -- preparar/atualizar é sempre ação
// explícita. Sem banner gigante, sem modal: cabe entre os filtros e o resultado da busca.
export function CatalogOfflineStatus({ personalExercises }) {
  const catalog = useCatalogSnapshotStatus()
  const images = useExerciseImagePrep(personalExercises)

  const catalogBusy = catalog.kind === 'downloading'
  const imagesBusy = images.preparing

  return (
    <Box
      as="div"
      className={`sync-status ${KIND_SYNC_CLASS[catalog.kind] || ''}`.trim()}
      role="status"
      aria-live="polite"
      sx={{ display: 'grid', gap: 2 }}
    >
      <div className="sync-status-line">
        <span className="sync-status-dot" aria-hidden="true" />
        <span className="sync-status-text">{catalogInfoText(catalog)}</span>
        {catalog.kind === 'available' && formatSyncedAt(catalog.lastSuccessfulSyncAt) && (
          <span className="sync-status-detail">atualizado {formatSyncedAt(catalog.lastSuccessfulSyncAt)}</span>
        )}
        <Button
          size="small"
          variant="invisible"
          disabled={catalogBusy}
          onClick={() => (catalog.kind === 'not-prepared' ? catalog.prepare() : catalog.update())}
        >
          {catalog.kind === 'not-prepared' ? 'Preparar para uso offline' : 'Atualizar'}
        </Button>
      </div>

      <div className="sync-status-line">
        <span className="sync-status-text">
          Imagens da minha rotina: {images.available} de {images.total} arquivo
          {images.total === 1 ? '' : 's'} disponíveis
        </span>
        {imagesBusy ? (
          <Button size="small" variant="invisible" onClick={images.cancel}>
            Cancelar
          </Button>
        ) : (
          <Button size="small" variant="invisible" disabled={images.total === 0} onClick={images.prepare}>
            Preparar imagens
          </Button>
        )}
      </div>
      {imagesBusy && images.progress && (
        <Box sx={{ display: 'grid', gap: 1 }}>
          <ProgressBar
            progress={images.progress.total ? Math.round(((images.progress.done + images.progress.failed) / images.progress.total) * 100) : 0}
            aria-label="Progresso da preparação de imagens"
          />
          <span className="sync-status-detail" aria-live="polite">
            Preparando {images.progress.done + images.progress.failed} de {images.progress.total}
          </span>
        </Box>
      )}
      {!imagesBusy && images.failed > 0 && (
        <span className="sync-status-detail">
          {images.failed} imagem{images.failed === 1 ? '' : 'ns'} não {images.failed === 1 ? 'pôde' : 'puderam'} ser
          preparada{images.failed === 1 ? '' : 's'} agora.
        </span>
      )}
    </Box>
  )
}
