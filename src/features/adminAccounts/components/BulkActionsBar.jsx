import { Box, Button, Text } from '@primer/react'
import { BlockedIcon, CheckIcon, DownloadIcon } from '@primer/octicons-react'

export function BulkActionsBar({ count, busy, onDisable, onEnable, onExport, onClear }) {
  if (count === 0) return null
  return (
    <Box
      role="region"
      aria-label="Ações em massa"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 2,
        px: 3,
        py: 2,
        mb: 2,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'accent.muted',
        bg: 'accent.subtle',
      }}
    >
      <Text sx={{ fontWeight: 'bold', mr: 2 }}>
        {count} {count === 1 ? 'selecionada' : 'selecionadas'}
      </Text>
      <Button size="small" leadingVisual={BlockedIcon} disabled={busy} onClick={onDisable}>
        Desativar
      </Button>
      <Button size="small" leadingVisual={CheckIcon} disabled={busy} onClick={onEnable}>
        Reativar
      </Button>
      <Button size="small" leadingVisual={DownloadIcon} onClick={onExport}>
        Exportar CSV
      </Button>
      <Button size="small" variant="invisible" onClick={onClear} sx={{ ml: [0, 'auto'] }}>
        Limpar seleção
      </Button>
    </Box>
  )
}
