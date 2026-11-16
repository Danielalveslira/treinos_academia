import { lazy, Suspense, useState } from 'react'
import { Box, Button, Heading, Spinner, Text } from '@primer/react'

// O painel completo (requisitos, ativação, Dialog de reautenticação) só é importado
// quando o administrador clica em "Abrir assistente" -- nem o bundle nem nenhuma
// consulta de rede acontecem com o cartão fechado, preservando a única consulta do
// Início (Etapa A) quando o assistente não está em uso.
const LaunchAssistantPanel = lazy(() => import('./LaunchAssistantPanel'))

export default function LaunchAssistant() {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Box
        as="section"
        sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3 }}
      >
        <Heading as="h2" sx={{ fontSize: 2, mb: 1 }}>
          Preparar publicidade
        </Heading>
        <Text as="p" sx={{ color: 'fg.muted', m: 0, mb: 2 }}>
          Veja o que falta para lançar os serviços de publicidade.
        </Text>
        <Button onClick={() => setOpen(true)}>Abrir assistente</Button>
      </Box>
    )
  }

  return (
    <Suspense fallback={<Spinner aria-label="Carregando assistente de lançamento" />}>
      <LaunchAssistantPanel onClose={() => setOpen(false)} />
    </Suspense>
  )
}
