import { Box, Button, Heading, Text } from '@primer/react'
import { ProductGrid } from './ProductGrid'

export function ProductGroups({ groups, onZoom, onViewAllBrand }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {groups.map((group, index) => (
        <Box as="section" key={group.key} aria-label={`Produtos de ${group.brand}`}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <Heading as="h2" sx={{ fontSize: 2 }}>{group.brand}</Heading>
            <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
              {group.count} produto{group.count === 1 ? '' : 's'}
            </Text>
          </Box>
          <ProductGrid items={group.items || []} onZoom={onZoom} hideBrand allowPriority={index === 0} />
          {group.count > (group.items?.length || 0) && (
            <Box sx={{ mt: 2 }}>
              <Button variant="invisible" onClick={() => onViewAllBrand(group.key)}>
                Ver todos os {group.count} produtos ↗
              </Button>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}
