import { Box, Spinner, Text, Link as PrimerLink } from '@primer/react'
import { AlertIcon, GraphIcon, ImageIcon } from '@primer/octicons-react'
import { useStatusPhoto } from '../hooks/useStatusPhoto'
import { useInView } from '../hooks/useInView'

export function PhotoStatus({ status, preloadedBlob, hideCaption = false }) {
  // A foto só é baixada quando chega perto da tela: num feed longo, as de baixo não custam rede nem memória
  // até o usuário se aproximar delas.
  const [photoRef, nearScreen] = useInView({
    rootMargin: '600px 0px',
    disabled: Boolean(preloadedBlob),
  })
  const { url, loading, error, retry } = useStatusPhoto(status.photoPath, preloadedBlob, nearScreen)

  return (
    <Box>
      {status.progress && (
        <Text as="span" className="status-progress-tag">
          <GraphIcon size={12} /> Progresso
        </Text>
      )}
      <Box className="status-photo" aria-busy={loading} ref={photoRef}>
        {url && (
          <img
            src={url}
            alt={
              status.caption?.trim() ||
              (status.progress ? 'Card de progresso' : 'Foto publicada na comunidade')
            }
            loading="lazy"
            decoding="async"
          />
        )}
        {loading && (
          <Box className="status-photo-state">
            <Spinner size="small" />
          </Box>
        )}
        {error && !loading && (
          <Box className="status-photo-state">
            <AlertIcon size={16} />
            <Text sx={{ fontSize: 0 }}>Não foi possível carregar a foto.</Text>
            <PrimerLink as="button" type="button" onClick={retry} sx={{ fontSize: 0 }}>
              Tentar novamente
            </PrimerLink>
          </Box>
        )}
        {!url && !loading && !error && (
          <Box className="status-photo-state">
            <ImageIcon size={16} />
          </Box>
        )}
      </Box>
      {!hideCaption && status.caption?.trim() && (
        <Text as="p" className="status-caption">
          {status.caption}
        </Text>
      )}
    </Box>
  )
}
