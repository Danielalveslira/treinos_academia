import { Ban } from 'lucide-react'
import '../styles/community-access.css'

// Aviso contextual compacto para acesso bloqueado: borda discreta, fundo vinho no tema escuro, ícone pequeno.
// Banimento é um estado de autorização, não um erro técnico -- por isso NÃO usa o alerta vermelho de erro.
// `role="status"` anuncia a mudança de estado (ex.: tentativa de entrada recusada) sem interromper.
export function CommunityBlockedNotice({ title, text, children, className = '' }) {
  return (
    <div className={`community-blocked-notice ${className}`.trim()} role="status">
      <span className="community-blocked-notice-icon" aria-hidden="true">
        <Ban size={16} />
      </span>
      <div className="community-blocked-notice-body">
        <p className="community-blocked-notice-title">{title}</p>
        {text && <p className="community-blocked-notice-text">{text}</p>}
        {children}
      </div>
    </div>
  )
}
