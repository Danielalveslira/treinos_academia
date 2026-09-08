import { Flash, Button, Link, Box, Text } from '@primer/react'
import { AlertIcon } from '@primer/octicons-react'

export function ErrorState({ error, onRetry }) {
  if (!error) return null

  return (
    <Flash variant="danger" sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <AlertIcon size={16} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Text sx={{ display: 'block' }}>{error.message}</Text>
          {error.actionHref && (
            <Link href={error.actionHref} target="_blank" rel="noreferrer" sx={{ display: 'inline-block', mt: 1 }}>
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
