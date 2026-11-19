import {
  ensureUserProfile,
  setUsername,
  setBirthInfo,
  setResidenceMunicipality,
} from './usersService'
import { setUsageProfile } from './usageProfileService'
import { supabase } from '../supabase/config'
import { buildLegalAcceptancePayload } from '../utils/legal'
import { HEALTH_CONSENT_TEXT_VERSION } from '../utils/privacyConsent'

// Legacy profile completion for accounts created by the conventional signup flow.
// Keep username last for compatibility with the legacy profile gate. New email-first
// accounts use the transactional completeEmailFirstOnboarding RPC below instead.
export async function completeUserProfile(
  uid,
  { username, sexo, birthDate, usageProfile, residenceMunicipalityCode }
) {
  await ensureUserProfile(uid)
  await setBirthInfo(uid, { sexo, dataNascimento: birthDate })
  // Obrigatória para concluir o cadastro: o servidor valida o código contra o catálogo do IBGE
  // (INVALID_MUNICIPALITY) e, falhando, o username não é gravado -- o perfil continua incompleto.
  await setResidenceMunicipality(residenceMunicipalityCode)
  await setUsageProfile(usageProfile)
  await setUsername(uid, username)
}

export async function completeEmailFirstOnboarding(profile, legalBundle, confirmed) {
  const { error } = await supabase.rpc('complete_user_onboarding', {
    p_profile: profile,
    p_legal: buildLegalAcceptancePayload({
      bundle: legalBundle,
      confirmed,
      source: 'signup',
      healthTextVersion: HEALTH_CONSENT_TEXT_VERSION,
    }),
  })
  if (error) throw error
}
