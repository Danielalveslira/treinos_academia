import { setDisplayName } from './authService'
import { ensureUserProfile, setUsername, setBirthInfo } from './usersService'
import { setUsageProfile } from './usageProfileService'

// Compartilhada por Register.jsx (logo após o cadastro) e ProfileCompletionGate.jsx
// (quem já tem sessão mas nunca completou o perfil -- ex.: uma etapa anterior falhou).
//
// ORDEM IMPORTA: setUsername é a ÚLTIMA chamada de propósito. public.users.username é o
// sinal que ProfileCompletionGate usa para considerar as etapas anteriores concluídas
// (ver needsProfileCompletion em utils/profileCompletion.js) -- se username viesse antes
// de setBirthInfo/setDisplayName, uma falha nessas duas depois dele deixaria o perfil
// "aparentemente completo" (username presente) mas sem data de nascimento/display name.
// Não inverta esta ordem sem revisar o gate também.
export async function completeUserProfile(uid, { username, sexo, birthDate, usageProfile }) {
  await ensureUserProfile(uid)
  await setBirthInfo(uid, { sexo, dataNascimento: birthDate })
  await setDisplayName({ uid }, username)
  // Best-effort e recuperável por outro caminho (preenchimento contextual de contas
  // legadas em Meu Perfil/fluxo da Vitrine) -- despachado antes de setUsername, mas sem
  // bloquear nem precisar ter sucesso para o perfil ser considerado completo.
  setUsageProfile(usageProfile).catch((err) => {
    console.error('[Auth] setUsageProfile:', err)
  })
  await setUsername(uid, username)
}
