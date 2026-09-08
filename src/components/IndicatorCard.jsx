import { Box, Text } from '@primer/react'

export function IndicatorCard({ label, value, icon: Icon }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: 'accent.fg' }}>
        {Icon && <Icon size={14} />}
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>{label}</Text>
      </Box>
      <Text sx={{ display: 'block', fontSize: 3, fontWeight: 'bold' }}>{value}</Text>
    </Box>
  )
}
