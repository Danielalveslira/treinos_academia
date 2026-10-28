import { useState } from 'react'
import { Box, Text, Label, Button } from '@primer/react'
import { ImageIcon } from '@primer/octicons-react'

function ProductThumbnail({ src, alt }) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(src) && !failed

  return (
    <Box
      sx={{
        width: 48,
        height: 48,
        borderRadius: 2,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: 'border.default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bg: 'canvas.subtle',
        color: 'fg.muted',
        flexShrink: 0,
      }}
    >
      {showImage ? (
        <Box
          as="img"
          src={src}
          alt={alt}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageIcon size={16} />
      )}
    </Box>
  )
}

// Legados sem vínculo permanecem privados; seus dados são preservados para administração.
export function PartnerProductList({ products, busy, onEdit, onDelete, onAssociate }) {
  if (products.length === 0) {
    return <Text sx={{ fontSize: 1, color: 'fg.muted' }}>Nenhum produto cadastrado ainda.</Text>
  }

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      {products.map((product, index) => {
        return (
          <Box
            key={product.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              px: 3,
              py: 2,
              flexWrap: 'wrap',
              borderTop: index === 0 ? 'none' : '1px solid',
              borderColor: 'border.default',
            }}
          >
            <ProductThumbnail src={product.image_url} alt="" />

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Text sx={{ fontWeight: 'bold' }}>{product.name}</Text>
                <Label variant="secondary">Legado · privado</Label>
                {product.sponsored && <Label variant="accent">Patrocínio legado</Label>}
              </Box>
              <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block' }}>
                {product.brand} · {product.category}
              </Text>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              <Button size="small" disabled={busy} onClick={() => onEdit(product)}>
                Editar
              </Button>
              {onAssociate && (
                <Button size="small" disabled={busy} onClick={() => onAssociate(product)}>
                  Associar a vitrine
                </Button>
              )}
              <Button
                size="small"
                variant="danger"
                disabled={busy}
                onClick={() => onDelete(product)}
              >
                Excluir
              </Button>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
