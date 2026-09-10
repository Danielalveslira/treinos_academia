import { Navigate } from 'react-router-dom'
import { Box, Spinner } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { LegalGate } from './LegalGate'

export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}
      >
        <Spinner />
      </Box>
    )
  }
  if (!user) return <Navigate to="/login" replace />

  return <LegalGate>{children}</LegalGate>
}
