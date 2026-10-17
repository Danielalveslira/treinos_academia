import { Navigate } from 'react-router-dom'
import { Box, Button, Flash, Spinner } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { useAuth } from '../hooks/useAuth'
import { LegalGate } from './LegalGate'
import { EmailVerificationGate } from './EmailVerificationGate'
import { AccountBlockedGate } from './AccountBlockedGate'
import { AccountDeletionBlockedGate } from './AccountDeletionBlockedGate'
import { requiresEmailVerification } from '../utils/emailVerification'
import { resolveAccountBlockState, resolveLegalGateState } from '../utils/legal'

export function ProtectedRoute({ children }) {
  const {
    user,
    profile,
    profileError,
    loading,
    verifyingSession,
    deletionStatus,
    serverAccessAllowed,
    legalAccess,
    offlineLocal,
  } = useAuth()

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

  // Checado antes de tudo (inclusive verificação de e-mail): uma conta desativada, em
  // exclusão, suspensa ou banida não precisa nem deveria ver "confirme seu e-mail" ou
  // "aceite os documentos" — o próprio motivo de estar aqui é não ter mais acesso, então
  // esse é sempre o primeiro aviso. setAccountStatus/aplicar uma restrição não revogam o
  // token do Auth, então nunca viram uma "sessão fantasma" detectável por
  // handlePossibleGhostSession — sem este gate a pessoa continuaria "logada" normalmente
  // enquanto toda outra leitura/escrita do app já falha via RLS/has_app_access(), sem
  // nunca dizer o motivo (ver AccountBlockedGate.jsx).
  const blockState = resolveAccountBlockState({ profile, restriction: legalAccess?.restriction })
  if (blockState) {
    return (
      <AccountBlockedGate
        state={blockState}
        reason={profile.disabledReason}
        until={legalAccess?.restriction?.until}
      />
    )
  }

  // Um perfil legível não concede acesso: a RPC do servidor é a última autoridade. Pendência de
  // termos segue para o LegalGate; qualquer outra negativa não monta as telas protegidas.
  // Na prática, com blockState acima já cobrindo deleting/disabled/restrição, o servidor só
  // devolveria false aqui por um motivo que o cliente ainda não detectou (email/termos já
  // tratados antes de chegar aqui, ou um desalinhamento momentâneo cliente/servidor) —
  // mantido como última linha de defesa,
  // nunca removido, pelo mesmo motivo de has_app_access() ficar como fallback em
  // create_promotion no backend (defesa em profundidade, não um caminho esperado).
  if (
    !offlineLocal &&
    serverAccessAllowed === false &&
    resolveLegalGateState({ profile, access: legalAccess, loading: false, error: '' }) === 'allowed'
  ) {
    return (
      <PublicLayout>
        <section className="support-page">
          <h1>Acesso indisponível</h1>
          <Flash variant="danger" role="alert">
            O servidor não autorizou o acesso a esta conta.
          </Flash>
        </section>
      </PublicLayout>
    )
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
