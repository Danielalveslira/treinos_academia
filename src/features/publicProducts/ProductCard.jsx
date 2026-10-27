import { useState } from 'react'
import { Box, Button, Label, Text } from '@primer/react'
import {
  safeHttpsUrl,
  publicProductMediaUrl,
  formatProductPrice,
} from './publicProductCatalogService'

export function ProductCard({ product, priority = false, hideBrand = false, onZoom }) {
  const [imageFailed, setImageFailed] = useState(false)
  const storeUrl = safeHttpsUrl(product.store_url)
  const imageUrl = !imageFailed ? publicProductMediaUrl(product) : null
  if (!storeUrl) return null
  const rel = product.sponsored ? 'noopener noreferrer sponsored' : 'noopener noreferrer'

  return (
    <Box
      as="article"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        maxWidth: '360px',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        overflow: 'hidden',
        bg: 'canvas.default',
      }}
    >
      <Box
        as="button"
        type="button"
        onClick={(event) => onZoom(product, event.currentTarget)}
        aria-label={`Ampliar imagem de ${product.name || 'produto'}`}
        sx={{
          display: 'block',
          width: '100%',
          aspectRatio: '4 / 3',
          p: 0,
          m: 0,
          border: 0,
          cursor: 'pointer',
          bg: 'canvas.subtle',
          position: 'relative',
        }}
      >
        {imageUrl ? (
          <Box
            as="img"
            src={imageUrl}
            alt=""
            width={320}
            height={240}
            loading={priority ? 'eager' : 'lazy'}
            fetchpriority={priority ? 'high' : undefined}
            decoding="async"
            onError={() => setImageFailed(true)}
            sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <Text
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'fg.muted',
              fontSize: 0,
              px: 2,
              textAlign: 'center',
            }}
          >
            Imagem indisponível
          </Text>
        )}
      </Box>
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 1, flex: '1 1 auto' }}>
        {!hideBrand && product.brand && (
          <Text sx={{ fontSize: 0, color: 'fg.muted', fontWeight: 600 }}>{product.brand}</Text>
        )}
        <Text as="h3" sx={{ fontSize: 1, fontWeight: 600, m: 0, lineHeight: 1.3 }}>
          {product.name || 'Produto'}
        </Text>
        {formatProductPrice(product.price_centavos) && (
          <Text as="p">{formatProductPrice(product.price_centavos)}</Text>
        )}
        {product.description && (
          <Text
            sx={{
              fontSize: 0,
              color: 'fg.muted',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {product.description}
          </Text>
        )}
        {(product.category || product.sponsored) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            {product.category && <Label variant="secondary">{product.category}</Label>}
            {product.sponsored && <Label variant="accent">Patrocinado</Label>}
          </Box>
        )}
        <Button
          as="a"
          href={storeUrl}
          target="_blank"
          rel={rel}
          variant="primary"
          onClick={(event) => event.stopPropagation()}
          sx={{ mt: 2, alignSelf: 'flex-start' }}
        >
          Ver na loja
        </Button>
      </Box>
    </Box>
  )
}
