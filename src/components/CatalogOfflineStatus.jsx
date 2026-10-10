import { Box, Button, ProgressBar, Spinner, Text } from '@primer/react'
import { CheckCircleFillIcon, CloudIcon, ImageIcon, SyncIcon, XCircleFillIcon } from '@primer/octicons-react'
import { useCatalogSnapshotStatus } from '../hooks/useCatalogSnapshotStatus.js'
import { useExerciseImagePrep } from '../hooks/useExerciseImagePrep.js'

const KIND_LABEL = {
  'not-prepared': 'Não preparado',
  downloading: 'Baixando…',
  available: 'Disponível offline',
  'update-pending': 'Atualização pendente',
  'storage-error': 'Erro de armazenamento',
  error: 'Erro ao atualizar',
}

// Mesmo vocabulário de cor que o resto do app já usa pra estado (success/attention/danger via
// Primer) -- a marca Evolutus (--fitness-accent) fica só no cartão em si, não nos estados.
const KIND_TONE = {
  'not-prepared': { Icon: CloudIcon, fg: 'fg.muted', bg: 'neutral.muted' },
  downloading: { Icon: null, fg: 'attention.fg', bg: 'attention.subtle' },
  available: { Icon: CheckCircleFillIcon, fg: 'success.fg', bg: 'success.subtle' },
  'update-pending': { Icon: SyncIcon, fg: 'attention.fg', bg: 'attention.subtle' },
  'storage-error': { Icon: XCircleFillIcon, fg: 'danger.fg', bg: 'danger.subtle' },
  error: { Icon: XCircleFillIcon, fg: 'danger.fg', bg: 'danger.subtle' },
}

function StatusPill({ kind, busy }) {
  const tone = KIND_TONE[kind] || KIND_TONE['not-prepared']
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        width: 'fit-content',
        px: 2,
        py: '3px',
        borderRadius: 999,
        fontSize: 0,
        fontWeight: 'bold',
        bg: tone.bg,
        color: tone.fg,
      }}
    >
      {busy ? <Spinner size="small" /> : tone.Icon ? <tone.Icon size={14} /> : null}
      {KIND_LABEL[kind] || KIND_LABEL['not-prepared']}
    </Box>
  )
}

function formatSyncedAt(timestamp) {
  if (!timestamp) return null
  try {
    return new Date(timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  } catch {
    return null
  }
}

function catalogSupportText({ kind, totalActive, progress, lastSuccessfulSyncAt }) {
  if (kind === 'downloading') {
    return progress?.downloaded ? `Baixando ${progress.downloaded}${totalActive ? ` de ${totalActive}` : ''}…` : 'Preparando a lista completa…'
  }
  if (kind === 'available') {
    const synced = formatSyncedAt(lastSuccessfulSyncAt)
    return `${totalActive ?? 0} exercícios${synced ? ` · atualizado em ${synced}` : ''}`
  }
  if (kind === 'update-pending') return 'Outra aba está sincronizando agora.'
  if (kind === 'storage-error') return 'Armazenamento local indisponível neste aparelho.'
  if (kind === 'error') return 'Não foi possível atualizar agora. Tente de novo.'
  return 'Baixe o catálogo para buscar e ver detalhes offline.'
}

// Módulo compacto do Catálogo (seção 5 do prompt): status do snapshot completo de texto +
// preparo seletivo de imagens da rotina. Nunca dispara sozinho -- preparar/atualizar é sempre ação
// explícita. Um cartão só, duas seções (texto e imagens): empilhadas no mobile, lado a lado a
// partir do breakpoint `sm` do Primer -- sem cor nova no app.css (tudo via sx/variáveis CSS
// existentes), então não pesa no orçamento de boot.
export function CatalogOfflineStatus({ personalExercises }) {
  const catalog = useCatalogSnapshotStatus()
  const images = useExerciseImagePrep(personalExercises)

  const catalogBusy = catalog.kind === 'downloading'
  const imagesBusy = images.preparing
  const catalogNotPrepared = catalog.kind === 'not-prepared'
  const imagesSupport =
    images.total === 0
      ? 'Nenhuma imagem publicada para sua rotina ainda.'
      : `${images.available} de ${images.total} arquivo${images.total === 1 ? '' : 's'} disponíveis`

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        display: 'grid',
        gap: 3,
        gridTemplateColumns: ['1fr', '1fr 1fr'],
        p: 3,
        mt: 3,
        mb: 3,
        bg: 'var(--fitness-surface)',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 'var(--fitness-radius-md)',
      }}
    >
      <Box sx={{ display: 'grid', gap: 2, alignContent: 'start' }}>
        <StatusPill kind={catalog.kind} busy={catalogBusy} />
        <Text as="p" sx={{ m: 0, fontSize: 0, color: 'fg.muted', lineHeight: 1.4 }}>
          {catalogSupportText(catalog)}
        </Text>
        {catalogBusy && catalog.progress && (
          <ProgressBar
            progress={catalog.totalActive ? Math.round((catalog.progress.downloaded / catalog.totalActive) * 100) : undefined}
            aria-label="Progresso da sincronização do catálogo"
            sx={{ width: '100%' }}
          />
        )}
        <Button
          block
          size="small"
          variant={catalogNotPrepared ? 'primary' : 'default'}
          disabled={catalogBusy}
          onClick={() => (catalogNotPrepared ? catalog.prepare() : catalog.update())}
        >
          {catalogNotPrepared ? 'Preparar para uso offline' : 'Atualizar'}
        </Button>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          alignContent: 'start',
          borderTop: ['1px solid', 'none'],
          borderColor: 'border.muted',
          pt: [3, 0],
        }}
      >
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'fg.muted' }}>
          <ImageIcon size={14} />
          <Text sx={{ fontSize: 0, fontWeight: 'bold' }}>Imagens da rotina</Text>
        </Box>
        <Text as="p" sx={{ m: 0, fontSize: 0, color: 'fg.muted', lineHeight: 1.4 }}>
          {imagesSupport}
          {!imagesBusy && images.failed > 0 && (
            <Text as="span" sx={{ display: 'block', color: 'danger.fg', mt: 1 }}>
              {images.failed} imagem{images.failed === 1 ? '' : 'ns'} não {images.failed === 1 ? 'pôde' : 'puderam'} ser
              preparada{images.failed === 1 ? '' : 's'} agora.
            </Text>
          )}
        </Text>
        {imagesBusy && images.progress && (
          <ProgressBar
            progress={images.progress.total ? Math.round(((images.progress.done + images.progress.failed) / images.progress.total) * 100) : 0}
            aria-label="Progresso da preparação de imagens"
            sx={{ width: '100%' }}
          />
        )}
        {imagesBusy ? (
          <Button block size="small" onClick={images.cancel}>
            Cancelar
          </Button>
        ) : (
          <Button block size="small" variant={images.available === 0 && images.total > 0 ? 'primary' : 'default'} disabled={images.total === 0} onClick={images.prepare}>
            Preparar imagens
          </Button>
        )}
      </Box>
    </Box>
  )
}
