import { useEffect, useState } from 'react'
import { Button, Flash, Spinner, Text } from '@primer/react'
import { getMyPrivacyConsents, setHealthDataConsent } from '../services/privacyService'
import { HEALTH_CONSENT_CONSEQUENCE, HEALTH_CONSENT_TEXT } from '../utils/privacyConsent'
import { commercialDate } from '../utils/commercial'

// Controle do consentimento específico para medidas corporais. Revogar é sempre possível
// (mesmo com termos desatualizados); conceder registra a versão exata do texto exibido.
export function HealthConsentSettings({ source = 'settings', onChange, compact = false }) {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getMyPrivacyConsents()
      .then((data) => active && setState(data.healthData))
      .catch(
        () => active && setError('Não foi possível carregar sua autorização. Tente novamente.')
      )
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  async function save(granted) {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await setHealthDataConsent(granted, source)
      const fresh = await getMyPrivacyConsents()
      setState(fresh.healthData)
      setConfirmRevoke(false)
      onChange?.(fresh.healthData)
    } catch {
      setError('Não foi possível salvar sua escolha. Nada foi alterado; tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner size="small" aria-label="Carregando autorização" />
  const granted = state?.granted === true

  return (
    <section aria-labelledby="health-consent-title" className="health-consent-settings">
      <Text as="h3" id="health-consent-title" sx={{ fontSize: compact ? 1 : 2, m: 0 }}>
        Medidas corporais (dado de saúde)
      </Text>
      <Text as="p" sx={{ color: 'fg.muted', fontSize: 1 }} aria-live="polite">
        {granted
          ? `Autorização concedida${state.occurredAt ? ` em ${commercialDate(state.occurredAt)}` : ''}.`
          : 'Sem autorização. O registro de novas medidas corporais está desativado.'}
      </Text>
      {state?.outdated && (
        <Flash variant="attention" sx={{ mb: 2 }}>
          O texto desta autorização foi atualizado. Revise e autorize novamente para continuar
          registrando medidas.
        </Flash>
      )}
      {error && (
        <Flash variant="danger" role="alert" sx={{ mb: 2 }}>
          {error}
        </Flash>
      )}
      {!granted || state?.outdated ? (
        <>
          <Text as="p" sx={{ fontSize: 1 }}>
            {HEALTH_CONSENT_TEXT}
          </Text>
          <Text as="p" sx={{ fontSize: 1, color: 'fg.muted' }}>
            {HEALTH_CONSENT_CONSEQUENCE}
          </Text>
          <Button onClick={() => save(true)} disabled={saving} loading={saving}>
            Autorizar medidas corporais
          </Button>
        </>
      ) : confirmRevoke ? (
        <div role="group" aria-label="Confirmar revogação">
          <Text as="p" sx={{ fontSize: 1 }}>
            Ao revogar, novas medidas deixam de ser registradas e as medidas corporais já salvas
            são eliminadas. Esta ação não pode ser desfeita.
          </Text>
          <Button variant="danger" onClick={() => save(false)} disabled={saving} loading={saving}>
            Confirmar revogação
          </Button>{' '}
          <Button onClick={() => setConfirmRevoke(false)} disabled={saving}>
            Manter autorização
          </Button>
        </div>
      ) : (
        <Button onClick={() => setConfirmRevoke(true)}>Revogar autorização</Button>
      )}
    </section>
  )
}
