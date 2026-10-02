import { Navigate } from 'react-router-dom'
import { Box, Button, Flash, Spinner } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { useAuth } from '../hooks/useAuth'
import { LegalGate } from './LegalGate'
import { EmailVerificationGate } from './EmailVerificationGate'
import { DisabledAccountGate } from './DisabledAccountGate'
import { AccountDeletionBlockedGate } from './AccountDeletionBlockedGate'
import { requiresEmailVerification } from '../utils/emailVerification'

export function ProtectedRoute({ children }) {
  const { user, profile, profileError, loading, verifyingSession, deletionStatus } = useAuth()

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
  // Checado antes do erro genérico de perfil abaixo: uma exclusão bloqueada para revisão
  // financeira NEGA a leitura do próprio perfil (mesma trava de deletionJobs/account_{uid}
  // que uma exclusão em andamento), então profileError/!profile também seriam verdadeiros
  // aqui -- sem este gate, o usuário veria "Não foi possível carregar sua conta" em vez
  // do aviso específico (ver handlePossibleGhostSession em AuthContext.jsx, que só marca
  // deletionStatus depois de confirmar o motivo por um mecanismo confiável do backend).
  // 'pending' só chega aqui com a pendência financeira já separada (AuthContext: sem ela, a
  // sessão é encerrada) -- o titular segue vendo o andamento até o worker concluir.
  if (deletionStatus === 'blocked_financial_review' || deletionStatus === 'pending') {
    return <AccountDeletionBlockedGate />
  }
  if (profileError || !profile) {
    return (
      <PublicLayout>
        <section className="support-page" aria-labelledby="profile-load-title">
          <h1 id="profile-load-title">Não foi possível carregar sua conta</h1>
          <Flash variant="danger" role="alert">
            {profileError || 'Seu perfil não está disponível.'}
          </Flash>
          <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
        </section>
      </PublicLayout>
    )
  }

  // Checado antes de tudo (inclusive verificação de e-mail): uma conta desativada não
  // precisa nem deveria ver "confirme seu e-mail" ou "aceite os documentos" — o próprio
  // motivo de estar aqui é não ter mais acesso, então esse é sempre o primeiro aviso.
  // Ver DisabledAccountGate para por que este gate existe (setAccountStatus não revoga o
  // token do Auth, então não vira uma "sessão fantasma" detectável por
  // handlePossibleGhostSession).
  if (profile?.accountStatus === 'disabled') {
    return <DisabledAccountGate reason={profile.disabledReason} />
  }

  // Só monta o gate (e paga o custo de checar o status de verificação) para contas que
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
