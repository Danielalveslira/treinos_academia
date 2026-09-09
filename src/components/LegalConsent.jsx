import { Link } from 'react-router-dom'
import { LEGAL_MANIFEST } from '../utils/legal'

export function LegalConsent({ value, onChange, disabled }) {
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
          <Link to="/termos-de-uso" target="_blank" rel="noopener">
            Termos de Uso
          </Link>{' '}
          e as{' '}
          <Link to="/regras-da-comunidade" target="_blank" rel="noopener">
            Regras da Comunidade
          </Link>{' '}
          e li a{' '}
          <Link to="/politica-de-privacidade" target="_blank" rel="noopener">
            Política de Privacidade
          </Link>{' '}
          (versão {LEGAL_MANIFEST.version}; links abrem em nova aba).
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
      <label>
        <input
          type="checkbox"
          required
          checked={value.ageConfirmed}
          onChange={(e) => onChange({ ...value, ageConfirmed: e.target.checked })}
        />
        <span>Confirmo que tenho {LEGAL_MANIFEST.minimumAge} anos ou mais.</span>
      </label>
    </fieldset>
  )
}
