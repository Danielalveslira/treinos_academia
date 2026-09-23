import { Link } from 'react-router-dom'
import { legalConsentDocumentLinks } from '../utils/legal'

export function LegalConsent({ value, onChange, disabled, legalBundle }) {
  const version = legalBundle.manifest.version
  const links = legalConsentDocumentLinks(legalBundle)
  return (
    <fieldset className="legal-consent" disabled={disabled}>
      <legend>Documentos e autorizações</legend>
      <label>
        <input
          type="checkbox"
          required
          checked={value.accepted}
          onChange={(e) => onChange({ ...value, accepted: e.target.checked })}
        />
        <span>
          Li e aceito os{' '}
          {links.map((link, index) => (
            <span key={link.to}>
              {index > 0 ? (index === links.length - 1 ? ' e ' : ', ') : ''}
              <Link to={link.to} target="_blank" rel="noopener">
                {link.label}
              </Link>
            </span>
          ))}{' '}
          (versão {version}; links abrem em nova aba).
        </span>
      </label>
      <label>
        <input
          type="checkbox"
          required
          checked={value.healthDataConsent}
          onChange={(e) => onChange({ ...value, healthDataConsent: e.target.checked })}
        />
        <span>
          Autorizo especificamente o armazenamento e a análise dos dados de saúde que eu inserir nos
          meus registros de treino, para manter meu diário privado e calcular meus indicadores.
          Posso revogar esta autorização pelo atendimento. Ela não autoriza divulgação na comunidade
          ou publicidade.
        </span>
      </label>
    </fieldset>
  )
}
