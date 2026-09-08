import { Flash, Button, Link } from '@primer/react'

export function ErrorState({ error, onRetry }) {
  if (!error) return null

  return (
    <Flash variant="danger" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 3 }}>
      <span>
        {error.message}
        {error.actionHref && (
          <>
            {' '}
            <Link href={error.actionHref} target="_blank" rel="noreferrer">
              {error.actionLabel}
            </Link>
          </>
        )}
      </span>
      {onRetry && (
        <Button size="small" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </Flash>
  )
}
