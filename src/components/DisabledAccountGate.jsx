import { Link } from 'react-router-dom'
import { Button } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { logoutUser } from '../services/authService'

// Diferente da restrição temporária (accountRestrictions, tratada em LegalGate) e da
// exclusão de conta (detectada como "sessão fantasma" em AuthContext via
// handlePossibleGhostSession): desativar uma conta (setAccountStatus, Cloud Function) só
// grava accountStatus:'disabled' no Firestore -- nunca revoga o token do Firebase Auth
// nem chama auth.updateUser(disabled:true). Sem este gate, o usuário continuava
// "logado" normalmente (a leitura do próprio perfil é sempre permitida ao dono) enquanto
// toda outra leitura do app (workouts, comunidades, statuses, sponsoredAds) já falhava
// com permission-denied via hasAppAccess() -- uma sequência de erros genéricos em cada
// tela, sem nunca dizer que a conta foi desativada nem por quê, e sem a sessão se
// encerrar sozinha (achado #2 da auditoria de segurança).
export function DisabledAccountGate({ reason }) {
  return (
    <PublicLayout>
      <section className="support-page" aria-labelledby="disabled-account-title">
        <h1 id="disabled-account-title">Conta desativada</h1>
        <p>
          Sua conta foi desativada por um administrador
          {reason ? (
            <>
              : <strong>{reason}</strong>
            </>
          ) : (
            '.'
          )}
        </p>
        <p>
          Se acredita que isso é um engano, entre em contato pelo{' '}
          <Link to="/atendimento">atendimento</Link>.
        </p>
        <Button onClick={logoutUser}>Sair da conta</Button>
      </section>
    </PublicLayout>
  )
}
