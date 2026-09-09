import { Link } from 'react-router-dom'
import { LEGAL_DOCUMENTS } from '../utils/legal'

export function LegalLinks({ children }) {
  return (
    <nav className="legal-links" aria-label="Documentos e atendimento">
      {LEGAL_DOCUMENTS.map((document) => (
        <Link key={document.id} to={document.path}>
          {document.title}
        </Link>
      ))}
      <Link to="/atendimento">Atendimento</Link>
      {children}
    </nav>
  )
}
