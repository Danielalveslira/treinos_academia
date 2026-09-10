import { Component } from 'react'
import { Box, Button, Heading, Text } from '@primer/react'
import { AlertIcon } from '@primer/octicons-react'

const RELOAD_GUARD_KEY = 'errorBoundary:autoReloaded'

// A falha de importação de um chunk lazy (rota carregada sob demanda) sempre aparece
// assim: o arquivo com hash já não existe mais no servidor porque um novo deploy
// substituiu os assets. Isso é esperado quando alguém está com uma aba aberta há muito
// tempo — a correção é só recarregar, uma vez, para buscar o HTML/manifesto atual.
function isStaleChunkError(error) {
  const message = String(error?.message || '')
  return (
    error?.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
      message
    )
  )
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Log útil para depuração — nunca envia isto para o usuário, só para o console.
    console.error('[ErrorBoundary]', error, info?.componentStack)
    if (isStaleChunkError(error)) {
      let alreadyReloaded = false
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1'
      } catch {
        // sessionStorage indisponível: sem guarda contra loop, mas também sem crash —
        // segue para o fallback manual abaixo, que sempre tem um botão de recarregar.
      }
      if (!alreadyReloaded) {
        try {
          sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
        } catch {
          // Ignorado de propósito: pior caso é o usuário precisar clicar em recarregar.
        }
        window.location.reload()
      }
    }
  }

  handleReload = () => {
    try {
      sessionStorage.removeItem(RELOAD_GUARD_KEY)
    } catch {
      // Sem storage, apenas recarrega — não há guarda para limpar.
    }
    window.location.reload()
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 3,
          minHeight: '100vh',
          p: 4,
        }}
      >
        <AlertIcon size={32} />
        <Heading as="h1" sx={{ fontSize: 3 }}>
          Algo deu errado
        </Heading>
        <Text sx={{ color: 'fg.muted', maxWidth: 420 }}>
          Não foi possível carregar esta página. Isso costuma se resolver recarregando —
          se persistir, tente novamente em alguns instantes.
        </Text>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="primary" onClick={this.handleReload}>
            Recarregar
          </Button>
          <Button onClick={this.handleRetry}>Tentar novamente</Button>
        </Box>
      </Box>
    )
  }
}
