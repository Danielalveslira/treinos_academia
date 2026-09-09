import { Flash, Button, Link, Box, Text } from '@primer/react'
import { AlertIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'

const GENERIC_MESSAGE = 'Não foi possível carregar os dados agora. Tente novamente em instantes.'

export function ErrorState({ error, onRetry }) {
  const { isSuperAdmin } = useAuth()
  if (!error) return null

  // Mensagens com link de ação (hoje, só o aviso de índice do Firestore ausente) são
  // instrução técnica pra quem administra o banco — não ajudam um cliente comum e ainda
  // expõem detalhe interno da infraestrutura. O erro real nunca é escondido de verdade:
  // describeFirestoreError já loga tudo no console antes de chegar aqui.
  const showTechnicalDetails = isSuperAdmin || !error.actionHref
  const message = showTechnicalDetails ? error.message : GENERIC_MESSAGE

  return (
    <Flash variant="danger" sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <AlertIcon size={16} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Text sx={{ display: 'block' }}>{message}</Text>
          {showTechnicalDetails && error.actionHref && (
            <Link
              href={error.actionHref}
              target="_blank"
              rel="noreferrer"
              sx={{ display: 'inline-block', mt: 1 }}
            >
              {error.actionLabel}
            </Link>
          )}
          {onRetry && (
            <Box sx={{ mt: 2 }}>
              <Button size="small" onClick={onRetry}>
                Tentar novamente
              </Button>
            </Box>
          )}
        </Box>
      </Box>
    </Flash>
  )
}
