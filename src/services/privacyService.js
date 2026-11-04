import { supabase } from '../supabase/config'
import { HEALTH_CONSENT_TEXT_VERSION, mapPrivacyConsents } from '../utils/privacyConsent'
import { invalidateCache } from '../utils/pageCache'

export async function getMyPrivacyConsents() {
  const { data, error } = await supabase.rpc('get_my_privacy_consents')
  if (error) throw error
  return mapPrivacyConsents(data)
}

// source: 'settings' (Perfil/LegalGate) ou 'feature_prompt' (pedido no momento do uso).
export async function setHealthDataConsent(granted, source = 'settings') {
  const { data, error } = await supabase.rpc('set_privacy_consent', {
    p_purpose: 'health_data',
    p_granted: granted === true,
    p_text_version: granted === true ? HEALTH_CONSENT_TEXT_VERSION : null,
    p_source: source,
  })
  if (error) throw error
  // Revogar elimina as medidas já registradas no servidor (20261212000005) -- a lista
  // em cache fica desatualizada e precisa ser buscada de novo, não só a autorização.
  if (granted !== true) invalidateCache('bodyMeasurements:')
  return data
}
