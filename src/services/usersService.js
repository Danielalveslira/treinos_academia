import { supabase } from '../supabase/config'
import { deleteCurrentAccount } from './authService'
import {
  dayKeyInTimezone,
  getDeviceTimezone,
  normalizeTrainingPreferences,
} from '../utils/trainingPlan'

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/
export const BIO_MAX_LENGTH = 300

// A tabela users é snake_case; o resto do app lê o perfil em camelCase.
export function mapUserRow(row) {
  if (!row) return null
  return {
    id: row.id,
    role: row.role,
    createdAt: row.created_at,
    username: row.username,
    bio: row.bio,
    shareStatistics: row.share_statistics,
    publicProfileVersion: row.public_profile_version,
    sexo: row.sexo,
    dataNascimento: row.data_nascimento,
    heightCm: row.height_cm,
    avatarMediaId: row.avatar_media_id,
    avatarPath: row.avatar_path,
    usageProfile: row.usage_profile,
    accountStatus: row.account_status,
    trainingPreferences: normalizeTrainingPreferences(row.training_preferences),
    // Mensagens da Home. greetingWelcomeSeenAt: null = ainda não confirmada; undefined = coluna ausente (nunca
    // tratado como "não vista"). A voz padrão é 'auto'.
    greetingVoice: row.greeting_voice ?? 'auto',
    greetingWelcomeSeenAt: row.greeting_welcome_seen_at,
    disabledAt: row.disabled_at,
    disabledBy: row.disabled_by,
    disabledReason: row.disabled_reason,
    legalAcceptance: row.legal_acceptance_version
      ? {
          version: row.legal_acceptance_version,
          digest: row.legal_acceptance_digest,
          acceptedAt: row.legal_acceptance_accepted_at,
        }
      : null,
  }
}

export async function saveTrainingPreferences(preferences) {
  const timezone = preferences.timezone || getDeviceTimezone()
  const payload = {
    plannedTrainingDays: preferences.plannedTrainingDays,
    reminderEnabled: Boolean(preferences.reminderEnabled),
    reminderTime: preferences.reminderEnabled ? preferences.reminderTime : null,
    timezone,
    effectiveFrom: dayKeyInTimezone(new Date(), timezone),
  }
  const { data, error } = await supabase.rpc('set_training_preferences', { payload })
  if (error) throw error
  return normalizeTrainingPreferences(data)
}

// userId é mantido nas assinaturas abaixo só por compatibilidade com os call sites
// existentes — as RPCs sempre operam sobre auth.uid() (o próprio usuário logado).

export async function setBirthInfo(userId, { sexo, dataNascimento } = {}) {
  const payload = {}
  if (sexo !== undefined) payload.sexo = sexo || ''
  if (dataNascimento !== undefined) payload.dataNascimento = dataNascimento || ''
  if (!Object.keys(payload).length) return
  const { error } = await supabase.rpc('set_birth_info', { payload })
  if (error) throw error
}

// AUD-010: a troca de username é sempre atômica (reserva + users + publicProfiles numa
// única transação SQL dentro de update_user_profile) — o Postgres já garante isso por
// natureza de função, sem precisar de uma Edge Function/RPC separada só pra isso.
export async function updateUserProfile(userId, changes) {
  const payload = {}
  if (Object.hasOwn(changes, 'bio')) payload.bio = changes.bio || ''
  if (Object.hasOwn(changes, 'username')) payload.username = changes.username
  if (Object.hasOwn(changes, 'shareStatistics')) payload.shareStatistics = changes.shareStatistics
  if (Object.hasOwn(changes, 'heightCm')) payload.heightCm = changes.heightCm ?? ''
  if (!Object.keys(payload).length) return {}
  const { data, error } = await supabase.rpc('update_user_profile', { payload })
  if (error) {
    const KNOWN = [
      'BIO_TOO_LONG',
      'INVALID_USERNAME',
      'USERNAME_TAKEN',
      'INVALID_PRIVACY',
      'INVALID_HEIGHT',
    ]
    throw new Error(KNOWN.find((code) => error.message?.includes(code)) || error.message)
  }
  return mapUserRow(data)
}

// Desfaz um cadastro que falhou depois de ensureUserProfile()/setUsername() já terem
// escrito algo (ver Register.jsx). Apaga primeiro os registros de perfil (permitido só
// nos minutos seguintes à criação, via RLS) e por fim a própria conta no Auth — nessa
// ordem porque a exclusão da conta cascateia e apagaria os mesmos registros de qualquer
// forma, mas fazer os dois passos deixa claro qual falhou se algo der errado no meio.
export async function deleteFreshProfile(userId, username) {
  const attempts = [
    supabase.from('public_profiles').delete().eq('user_id', userId),
    supabase.from('users').delete().eq('id', userId),
  ]
  if (username) attempts.push(supabase.from('usernames').delete().eq('username', username))
  await Promise.allSettled(attempts)
  await deleteCurrentAccount().catch((err) => {
    console.error('[Auth] register rollback failed (account):', err)
  })
}

export async function isUsernameAvailable(username) {
  const { data, error } = await supabase
    .from('usernames')
    .select('username')
    .eq('username', username.trim().toLowerCase())
    .maybeSingle()
  if (error) throw error
  return !data
}

export async function ensureUserProfile(userId) {
  const { data, error } = await supabase.rpc('ensure_user_profile')
  if (error) throw error
  return mapUserRow(data)
}

export async function setUsername(userId, rawUsername) {
  const username = rawUsername.trim().toLowerCase()
  if (!USERNAME_PATTERN.test(username)) throw new Error('INVALID_USERNAME')
  const { data, error } = await supabase.rpc('set_username', { p_username: username })
  if (error)
    throw new Error(error.message?.includes('USERNAME_TAKEN') ? 'USERNAME_TAKEN' : error.message)
  return data
}
