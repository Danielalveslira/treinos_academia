import { Box, Spinner, Text, Link as PrimerLink } from '@primer/react'
import { AlertIcon, ImageIcon } from '@primer/octicons-react'
import { useStatusPhoto } from '../hooks/useStatusPhoto'

export function PhotoStatus({ status, preloadedBlob }) {
  const { url, loading, error, retry } = useStatusPhoto(status.photoPath, preloadedBlob)

  return (
    <Box>
      <Box className="status-photo" aria-busy={loading}>
        {url && (
          <img
            src={url}
            alt={status.caption?.trim() || 'Foto publicada na comunidade'}
            loading="lazy"
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
      {status.caption?.trim() && (
        <Text as="p" className="status-caption">
          {status.caption}
        </Text>
      )}
    </Box>
  )
}
