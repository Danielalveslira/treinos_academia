import { Box, Text } from '@primer/react'

export function IndicatorCard({ label, value }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3 }}>
      <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', mb: 1 }}>{label}</Text>
      <Text sx={{ display: 'block', fontSize: 3, fontWeight: 'bold' }}>{value}</Text>
    </Box>
  )
}
