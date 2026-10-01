import { Link } from 'react-router-dom'
import { Button } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { logoutUser } from '../services/authService'

// Terceiro estado possível de uma exclusão solicitada (ao lado de "em processamento",
// tratado como logout direto em AuthContext, e "concluída", já sem sessão nenhuma pra
// mostrar isto) -- a exclusão está bloqueada aguardando revisão financeira (saldo em
// EvoCash ou compra pendente, ver _compute_financial_block_reason na migration do
// deletion worker). Só um administrador resolve isso (confirmar/cancelar a compra
// pendente reabre o job, ver _reactivate_deletion_if_clear) -- nunca automaticamente,
// nunca pelo próprio titular -- por isso nenhuma ação aqui além de sair da conta, e a
// mensagem nunca cita saldo/valor (dado financeiro privado, mesmo que a própria carteira
// continue legível pelo dono via RLS).
export function AccountDeletionBlockedGate() {
  return (
    <PublicLayout>
      <section className="support-page" aria-labelledby="deletion-blocked-title">
        <h1 id="deletion-blocked-title">Exclusão em revisão financeira</h1>
        <p>
          A exclusão da sua conta foi solicitada, mas está temporariamente bloqueada para revisão
          financeira. Nossa equipe entrará em contato para concluir esse processo.
        </p>
        <p>
          Para dúvidas ou para acompanhar essa revisão, entre em contato pelo{' '}
          <Link to="/atendimento">atendimento</Link>.
        </p>
        <Button onClick={logoutUser}>Sair da conta</Button>
      </section>
    </PublicLayout>
  )
}
