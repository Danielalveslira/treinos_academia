import { Navigate } from 'react-router-dom'
import { Box, Spinner } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { LegalGate } from './LegalGate'
import { EmailVerificationGate } from './EmailVerificationGate'
import { DisabledAccountGate } from './DisabledAccountGate'
import { requiresEmailVerification } from '../utils/emailVerification'

export function ProtectedRoute({ children }) {
  const { user, profile, loading, verifyingSession } = useAuth()

  // Enquanto o AuthContext confirma se um permission-denied significa conta excluída
  // (getIdToken(true), ver handlePossibleGhostSession), nenhuma tela protegida deve
  // renderizar — nem LegalGate, que trataria o perfil ainda ausente como "falta aceitar
  // os termos" e mostraria "Antes de continuar" pra uma conta que o servidor já
  // considera inexistente.
  if (loading || verifyingSession) {
    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}
      >
        <Spinner />
      </Box>
    )
  }
  if (!user) return <Navigate to="/login" replace />

  // Checado antes de tudo (inclusive verificação de e-mail): uma conta desativada não
  // precisa nem deveria ver "confirme seu e-mail" ou "aceite os documentos" — o próprio
  // motivo de estar aqui é não ter mais acesso, então esse é sempre o primeiro aviso.
  // Ver DisabledAccountGate para por que este gate existe (setAccountStatus não revoga o
  // token do Auth, então não vira uma "sessão fantasma" detectável por
  // handlePossibleGhostSession).
  if (profile?.accountStatus === 'disabled') {
    return <DisabledAccountGate reason={profile.disabledReason} />
  }

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
