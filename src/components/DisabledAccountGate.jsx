import { Link } from 'react-router-dom'
import { PublicLayout } from './PublicLayout'
import { LogoutButton } from './LogoutButton'

// Diferente da restrição temporária (accountRestrictions, tratada em LegalGate) e da
// exclusão de conta (detectada como "sessão fantasma" em AuthContext via
// handlePossibleGhostSession): desativar uma conta (set_account_status, RPC) só grava
// account_status:'disabled' na tabela users -- nunca revoga o token do Auth nem
// desabilita o login. Sem este gate, o usuário continuava "logado" normalmente (a
// leitura do próprio perfil é sempre permitida ao dono) enquanto toda outra leitura do
// app (workouts, comunidades, statuses, sponsoredAds) já falhava via RLS (has_app_access())
// -- uma sequência de erros genéricos em cada tela, sem nunca dizer que a conta foi
// desativada nem por quê, e sem a sessão se encerrar sozinha (achado #2 da auditoria de
// segurança).
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
        <LogoutButton />
      </section>
    </PublicLayout>
  )
}
