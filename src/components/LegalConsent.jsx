import { Link } from 'react-router-dom'
import { legalConsentDocumentLinks } from '../utils/legal'
import { HEALTH_CONSENT_CONSEQUENCE, HEALTH_CONSENT_TEXT } from '../utils/privacyConsent'

// Três naturezas distintas, apresentadas separadamente:
// 1. Aceite contratual (obrigatório): Termos de Uso e Regras da Comunidade.
// 2. Ciência da Política de Privacidade (informação, sem caixa de seleção).
// 3. Consentimento específico e opcional para medidas corporais (dado de saúde).
// Nenhuma caixa vem marcada e a conta não depende do item 3.
export function LegalConsent({ value, onChange, disabled, legalBundle }) {
  const version = legalBundle.manifest.version
  const links = Object.fromEntries(
    legalConsentDocumentLinks(legalBundle).map((link) => [link.id, link])
  )
  const docLink = (id) =>
    links[id] ? (
      <Link to={links[id].to} target="_blank" rel="noopener">
        {links[id].label}
      </Link>
    ) : null
  return (
    <div className="legal-consent-groups">
      <fieldset className="legal-consent" disabled={disabled}>
        <legend>Termos (obrigatório)</legend>
        <label>
          <input
            type="checkbox"
            required
            aria-describedby="legal-consent-version"
            checked={value.accepted}
            onChange={(e) => onChange({ ...value, accepted: e.target.checked })}
          />
          <span>
            Li e aceito os {docLink('terms')} e as {docLink('community')}.
          </span>
        </label>
        <p id="legal-consent-version" className="legal-consent-note">
          Versão {version}. Os links abrem em nova aba.
        </p>
      </fieldset>

      <section className="legal-consent legal-consent-info" aria-labelledby="legal-privacy-title">
        <h3 id="legal-privacy-title">Privacidade (informação)</h3>
        <p>
          A {docLink('privacy')} explica quais dados usamos, para quê, por quanto tempo e como
          exercer seus direitos. Ela não pede sua concordância: informa como seus dados são
          tratados.
        </p>
      </section>

      <fieldset className="legal-consent" disabled={disabled}>
        <legend>Medidas corporais (opcional)</legend>
        <label>
          <input
            type="checkbox"
            aria-describedby="legal-health-consequence"
            checked={value.healthDataConsent === true}
            onChange={(e) => onChange({ ...value, healthDataConsent: e.target.checked })}
          />
          <span>{HEALTH_CONSENT_TEXT}</span>
        </label>
        <p id="legal-health-consequence" className="legal-consent-note">
          {HEALTH_CONSENT_CONSEQUENCE}
        </p>
      </fieldset>
    </div>
  )
}
