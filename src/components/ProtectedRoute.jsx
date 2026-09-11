import { Navigate } from 'react-router-dom'
import { Box, Spinner } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { LegalGate } from './LegalGate'
import { EmailVerificationGate } from './EmailVerificationGate'
import { requiresEmailVerification } from '../utils/emailVerification'

export function ProtectedRoute({ children }) {
  const { user, profile, loading } = useAuth()

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

  // Só monta o gate (e paga o custo de checar o status com o Firebase) para contas que
  // realmente precisam disso — contas anteriores à mudança nunca entram aqui, mesmo que
  // emailVerified esteja false (ver requiresEmailVerification/EMAIL_VERIFICATION_CUTOFF).
  if (!user.emailVerified && requiresEmailVerification(profile)) {
    return (
      <EmailVerificationGate>
        <LegalGate>{children}</LegalGate>
      </EmailVerificationGate>
    )
  }

  return <LegalGate>{children}</LegalGate>
}
