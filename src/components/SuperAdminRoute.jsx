import { Navigate } from 'react-router-dom'
import { Box, Spinner } from '@primer/react'
import { useAuth } from '../hooks/useAuth'

export function SuperAdminRoute({ children }) {
  const { isSuperAdmin, loading } = useAuth()

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <Spinner />
      </Box>
    )
  }
  if (!isSuperAdmin) return <Navigate to="/comunidades" replace />

  return children
}
