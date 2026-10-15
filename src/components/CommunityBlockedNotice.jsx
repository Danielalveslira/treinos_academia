import { Ban } from 'lucide-react'
import '../styles/community-access.css'

// Aviso contextual compacto, direto no cartão que disparou a ação (nunca um toast
// flutuando no topo da página -- ver Communities.jsx): borda discreta, fundo vinho no
// tema escuro, ícone pequeno. `icon` deixa o mesmo visual servir tanto o estado de
// autorização (banimento, ícone padrão Ban) quanto um erro técnico genérico (entrar/sair
// que falhou, chamador passa icon={AlertIcon}). `role="status"` anuncia a mudança sem
// interromper.
export function CommunityBlockedNotice({ title, text, children, className = '', icon }) {
  const Icon = icon || Ban
  return (
    <div className={`community-blocked-notice ${className}`.trim()} role="status">
      <span className="community-blocked-notice-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <div className="community-blocked-notice-body">
        <p className="community-blocked-notice-title">{title}</p>
        {text && <p className="community-blocked-notice-text">{text}</p>}
        {children}
      </div>
    </div>
  )
}
