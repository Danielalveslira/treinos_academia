import { Box, Flash } from '@primer/react'

export function ToastFlash({ toasts }) {
  if (toasts.length === 0) return null

  return (
    <Box
      sx={{
        position: 'fixed',
        top: '64px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        width: ['calc(100% - 32px)', 'auto'],
        maxWidth: '420px',
      }}
    >
      {toasts.map((toast) => (
        <Flash key={toast.id} variant={toast.type}>
          {toast.message}
        </Flash>
      ))}
    </Box>
  )
}
