import { setDisplayName } from './authService'
import {
  ensureUserProfile,
  setUsername,
  setBirthInfo,
  setResidenceMunicipality,
} from './usersService'
import { setUsageProfile } from './usageProfileService'

// Compartilhada por Register.jsx (logo após o cadastro) e ProfileCompletionGate.jsx
// (quem já tem sessão mas nunca completou o perfil -- ex.: uma etapa anterior falhou).
//
// ORDEM IMPORTA: setUsername é a ÚLTIMA chamada de propósito. public.users.username é o
// sinal que ProfileCompletionGate usa para considerar as etapas anteriores concluídas
// (ver needsProfileCompletion em utils/profileCompletion.js) -- se username viesse antes
// de setBirthInfo/setResidenceMunicipality/setDisplayName/setUsageProfile, uma falha
// nessas depois dele deixaria o perfil aparentemente completo sem dados obrigatórios.
// Não inverta esta ordem sem revisar o gate também.
//
// Toda etapa é idempotente (repetir com os mesmos dados não duplica nada): uma retomada depois de
// falha de rede, recarga da página ou confirmação de e-mail em outro momento simplesmente refaz a
// sequência inteira.
export async function completeUserProfile(
  uid,
  { username, sexo, birthDate, usageProfile, residenceMunicipalityCode }
) {
  await ensureUserProfile(uid)
  await setBirthInfo(uid, { sexo, dataNascimento: birthDate })
  // Obrigatória para concluir o cadastro: o servidor valida o código contra o catálogo do IBGE
  // (INVALID_MUNICIPALITY) e, falhando, o username não é gravado -- o perfil continua incompleto.
  await setResidenceMunicipality(residenceMunicipalityCode)
  await setDisplayName({ uid }, username)
  await setUsageProfile(usageProfile)
  await setUsername(uid, username)
}
