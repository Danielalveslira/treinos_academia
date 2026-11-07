import { useState } from 'react'
import { Box, Dialog, Text } from '@primer/react'

export function DeleteSheetDialog({ sheet, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog
      title="Excluir ficha definitivamente?"
      onClose={busy ? () => {} : onClose}
      footerButtons={[
        { content: 'Cancelar', onClick: onClose, disabled: busy },
        {
          content: busy ? 'Excluindo…' : 'Excluir definitivamente',
          buttonType: 'danger',
          disabled: busy,
          onClick: async () => {
            setBusy(true)
            try {
              setError((await onConfirm()) || '')
            } catch {
              // onConfirm nunca deveria rejeitar (sempre resolve com '' ou a mensagem de erro),
              // mas uma falha inesperada aqui não pode travar o modal em "Excluindo…" para sempre.
              setError('Não foi possível concluir. Tente novamente.')
            } finally {
              setBusy(false)
            }
          },
        },
      ]}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Text>
          A ficha "{sheet.name}" será removida permanentemente. Seu histórico de exercícios
          realizados, séries, cargas e progresso será preservado. Esta ação não pode ser
          desfeita.
        </Text>
        {error && (
          <Text as="p" role="alert" sx={{ color: 'danger.fg', m: 0 }}>
            {error}
          </Text>
        )}
      </Box>
    </Dialog>
  )
}
