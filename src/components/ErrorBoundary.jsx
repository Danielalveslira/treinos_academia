import { Component } from 'react'
import { Box, Button, Heading, Text } from '@primer/react'
import { AlertIcon } from '@primer/octicons-react'
import { isStaleChunkError } from '../utils/staleChunk'

// Um chunk lazy (rota carregada sob demanda) que falha ao importar é esperado quando
// alguém está com uma aba aberta há muito tempo — inclusive uma aba que já está rodando
// o código antigo porque o novo service worker assumiu em segundo plano (ver
// scripts/service-worker.js) antes de o usuário confirmar a atualização em
// PwaControls.jsx.
//
// Recarregar sozinho, sem perguntar, já foi a correção aqui — mas isso podia disparar
// no meio de uma edição em andamento (um formulário de treino ainda não salvo, por
// exemplo) e apagar o que a pessoa estava digitando sem nenhum aviso. Preferimos sempre
// mostrar a tela de fallback abaixo (que já tem um botão de recarregar) e deixar a
// pessoa decidir o momento — o pior caso passa a ser um clique a mais, nunca dado
// perdido sem avisar.

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
  }

  handleReload = () => {
    window.location.reload()
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    const stale = isStaleChunkError(this.state.error)
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 3,
          minHeight: this.props.inline ? '40vh' : '100vh',
          p: 4,
        }}
      >
        <AlertIcon size={32} />
        <Heading as="h1" sx={{ fontSize: 3 }}>
          {stale ? 'Uma nova versão do app foi publicada' : 'Algo deu errado'}
        </Heading>
        <Text sx={{ color: 'fg.muted', maxWidth: 420 }}>
          {stale
            ? 'Esta aba ainda estava com a versão anterior. Salve o que estiver fazendo, se puder, e recarregue para continuar.'
            : 'Não foi possível carregar esta página. Tente novamente em alguns instantes.'}
        </Text>
        <Box>
          {stale ? (
            <Button variant="primary" onClick={this.handleReload}>
              Recarregar página
            </Button>
          ) : (
            <Button variant="primary" onClick={this.handleRetry}>
              Tentar novamente
            </Button>
          )}
        </Box>
      </Box>
    )
  }
}
