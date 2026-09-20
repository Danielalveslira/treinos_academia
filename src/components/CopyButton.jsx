import { useState } from 'react'
import { Box, Button, Text } from '@primer/react'
import { copyTextToClipboard } from '../utils/clipboard'

// Sempre copia `value` por inteiro -- nunca a versão abreviada exibida ao lado dele
// (ver abbreviateProtocol em cashPurchaseFlow.js). Se o Clipboard API falhar (contexto
// não seguro, permissão negada), a falha nunca é silenciada: mostra o valor completo pra
// quem quiser selecionar manualmente.
export function CopyButton({ value, label = 'Copiar', successMessage = 'Copiado', testId }) {
  const [status, setStatus] = useState('idle') // 'idle' | 'copied' | 'failed'

  async function handleClick() {
    const { copied } = await copyTextToClipboard(value)
    setStatus(copied ? 'copied' : 'failed')
  }

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, minWidth: 0 }}>
      <Button size="small" onClick={handleClick} data-testid={testId}>
        {label}
      </Button>
      {status === 'copied' && (
        <Text
          as="span"
          role="status"
          data-testid={testId ? `${testId}-feedback` : undefined}
          sx={{ fontSize: 0, color: 'success.fg' }}
        >
          {successMessage}
        </Text>
      )}
      {status === 'failed' && (
        <Text
          as="span"
          role="alert"
          data-testid={testId ? `${testId}-feedback` : undefined}
          sx={{ fontSize: 0, color: 'danger.fg', wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}
        >
          Não foi possível copiar automaticamente. Copie manualmente: {value}
        </Text>
      )}
    </Box>
  )
}
