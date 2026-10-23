import { Box } from '@primer/react'
import { ProductCard } from './ProductCard'

// `auto-fill` (não `auto-fit`) de propósito: com só 1 produto, as colunas extras ficam
// vazias em vez de o card único esticar para a largura inteira do grid.
export function ProductGrid({ items, onZoom, hideBrand = false, allowPriority = false }) {
  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {items.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          hideBrand={hideBrand}
          priority={allowPriority && index === 0}
          onZoom={onZoom}
        />
      ))}
    </Box>
  )
}
