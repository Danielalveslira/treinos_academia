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
      <Button
        sx={{ minHeight: 44 }}
        leadingVisual={BlockedIcon}
        disabled={busy}
        onClick={onDisable}
      >
        Desativar
      </Button>
      <Button sx={{ minHeight: 44 }} leadingVisual={CheckIcon} disabled={busy} onClick={onEnable}>
        Reativar
      </Button>
      <Button sx={{ minHeight: 44 }} leadingVisual={DownloadIcon} onClick={onExport}>
        Exportar CSV
      </Button>
      <Button sx={{ minHeight: 44 }} variant="invisible" onClick={onClear}>
        Limpar seleção
      </Button>
    </Box>
  )
}
