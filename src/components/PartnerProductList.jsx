import { useState } from 'react'
import { Box, Text, Label, Button } from '@primer/react'
import { ImageIcon } from '@primer/octicons-react'

// Status derivado das mesmas regras da política pública de leitura (RLS
// partner_products_public_read, migration 20261108000001_public_commercial.sql):
// approved and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()).
// `now` chega por parâmetro (mesmo padrão de isExpired() em AdminSponsoredAds.jsx) --
// mantém a função pura e fácil de testar com um instante fixo.
function productStatus(product, now) {
  if (!product.approved) return { label: 'Rascunho', variant: 'secondary' }
  const startsAt = product.starts_at ? new Date(product.starts_at).getTime() : null
  const endsAt = product.ends_at ? new Date(product.ends_at).getTime() : null
  if (startsAt && startsAt > now) return { label: 'Agendado', variant: 'attention' }
  if (endsAt && endsAt <= now) return { label: 'Expirado', variant: 'danger' }
  return { label: 'Publicado', variant: 'success' }
}

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

// Listagem compacta dos produtos da Vitrine (CommercialAdmin). `now` é injetado pelo
// chamador para manter a derivação de status testável sem depender do relógio real.
export function PartnerProductList({ products, now, busy, onEdit, onDelete }) {
  if (products.length === 0) {
    return <Text sx={{ fontSize: 1, color: 'fg.muted' }}>Nenhum produto cadastrado ainda.</Text>
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, overflow: 'hidden' }}>
      {products.map((product, index) => {
        const status = productStatus(product, now)
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
                <Label variant={status.variant}>{status.label}</Label>
                {product.sponsored && <Label variant="accent">Patrocinado</Label>}
              </Box>
              <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block' }}>
                {product.brand} · {product.category}
              </Text>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              <Button size="small" disabled={busy} onClick={() => onEdit(product)}>
                Editar
              </Button>
              <Button size="small" variant="danger" disabled={busy} onClick={() => onDelete(product)}>
                Excluir
              </Button>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
