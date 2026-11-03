// Texto do consentimento específico para medidas corporais (dado de saúde). É o mesmo
// texto gravado em public.privacy_consent_texts (migration 20261212000001) -- o teste
// privacyConsent.test.js compara os dois. Texto novo = nova versão no banco, nunca edição.
export const HEALTH_CONSENT_TEXT_VERSION = 'health-data-1'
export const HEALTH_CONSENT_TEXT =
  'Autorizo o Evolutus a armazenar e usar as medidas corporais que eu registrar (como peso, percentual de gordura, circunferências, massa magra e massa gorda) para manter meu histórico privado e calcular meus indicadores. Posso revogar esta autorização a qualquer momento no Perfil. Ela não autoriza divulgação na comunidade nem uso em publicidade.'

export const HEALTH_CONSENT_CONSEQUENCE =
  'Sem esta autorização você usa normalmente o Evolutus; apenas o registro de novas medidas corporais fica indisponível. Revogar não apaga as medidas já registradas: você continua podendo consultá-las e excluí-las.'

export function isHealthConsentRequiredError(error) {
  return String(error?.message || '').includes('HEALTH_CONSENT_REQUIRED')
}

export function mapPrivacyConsents(data) {
  const health = data?.healthData || {}
  return {
    healthData: {
      granted: health.granted === true,
      textVersion: health.textVersion || null,
      occurredAt: health.occurredAt || null,
      activeTextVersion: health.activeTextVersion || null,
      outdated: Boolean(
        health.granted &&
        health.activeTextVersion &&
        health.textVersion !== health.activeTextVersion
      ),
    },
  }
}
