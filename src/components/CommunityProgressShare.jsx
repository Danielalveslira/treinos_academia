import { Box, Dialog, Spinner } from '@primer/react'
import { ErrorState } from './ErrorState'
import { ShareProgressDialog } from './ShareProgressDialog'
import { useProgressShareOptions } from '../hooks/useProgressShareOptions'

// "Compartilhar progresso" dentro de uma comunidade: o MESMO seletor/preview/gerador da Home
// (ShareProgressDialog + shareProgress/shareProgressSvg/shareImage), com a ação "Publicar na comunidade".
// Os dados vêm de 1 RPC agregada (useProgressShareOptions) -- só quando o seletor abre. A publicação em si é
// uma foto normal da comunidade (ver CommunityDetail.handleCreateStatus, type 'progress').
export function CommunityProgressShare({ onCreateStatus, onClose }) {
  const { options, loading, error, refresh } = useProgressShareOptions()

  if (options.length > 0) {
    return (
      <ShareProgressDialog
        options={options}
        onClose={onClose}
        onPublish={({ blob, caption, progress }) =>
          onCreateStatus({ type: 'progress', blob, caption, progress })
        }
      />
    )
  }
  return (
    <Dialog
      title="Compartilhar progresso"
      onClose={onClose}
      width="large"
      position={{ narrow: 'fullscreen', regular: 'center' }}
    >
      <Box sx={{ minHeight: 160, display: 'grid', placeItems: 'center' }}>
        {loading && <Spinner aria-label="Carregando seu progresso" />}
        {!loading && <ErrorState error={error} onRetry={refresh} />}
      </Box>
    </Dialog>
  )
}
