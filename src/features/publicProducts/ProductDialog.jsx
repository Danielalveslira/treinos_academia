import { useState } from 'react'
import { Box, Button, Dialog, Text } from '@primer/react'
import {
  safeHttpsUrl,
  publicProductMediaUrl,
  formatProductPrice,
} from './publicProductCatalogService'

function ZoomBody({ children }) {
  return <Dialog.Body sx={{ p: 0 }}>{children}</Dialog.Body>
}

// Carregado sob demanda (React.lazy no componente que a importa) no primeiro clique na
// imagem: nenhum visitante que não amplia uma foto baixa este código.
export default function ProductDialog({ product, onClose, returnFocusRef }) {
  const [imageFailed, setImageFailed] = useState(false)
  const imageUrl = !imageFailed ? publicProductMediaUrl(product) : null
  const storeUrl = safeHttpsUrl(product.store_url)
  const rel = product.sponsored ? 'noopener noreferrer sponsored' : 'noopener noreferrer'

  return (
    <Dialog
      title={product.name || 'Produto'}
      subtitle={product.brand || undefined}
      onClose={onClose}
      width="large"
      renderBody={ZoomBody}
      returnFocusRef={returnFocusRef}
    >
      <Box
        sx={{
          aspectRatio: '4 / 3',
          bg: 'canvas.subtle',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {imageUrl ? (
          <Box
            as="img"
            src={imageUrl}
            alt={product.name || 'Produto'}
            decoding="async"
            onError={() => setImageFailed(true)}
            sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <Text sx={{ color: 'fg.muted', fontSize: 0 }}>Imagem indisponível</Text>
        )}
      </Box>
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {formatProductPrice(product.price_centavos) && (
          <Text as="p">{formatProductPrice(product.price_centavos)}</Text>
        )}
        {product.description && <Text sx={{ color: 'fg.muted' }}>{product.description}</Text>}
        {storeUrl && (
          <Button
            as="a"
            href={storeUrl}
            target="_blank"
            rel={rel}
            variant="primary"
            sx={{ alignSelf: 'flex-start' }}
          >
            Ver na loja
          </Button>
        )}
      </Box>
    </Dialog>
  )
}
