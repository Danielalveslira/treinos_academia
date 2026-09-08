import { Box, Flash } from '@primer/react'

export function ToastFlash({ toasts }) {
  if (toasts.length === 0) return null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
      {toasts.map((toast) => (
        <Flash key={toast.id} variant={toast.type}>
          {toast.message}
        </Flash>
      ))}
    </Box>
  )
}
