import { APPROVED_LEGAL_DIGESTS } from '../../utils/legal.js'
import { attempt, request, withTransaction } from './database.js'
import { STORES } from './schema.js'

// Bootstrap local para COLD START OFFLINE: a fotografia mínima da conta que permite abrir o app sem
// internet no aparelho onde o usuário já entrou online.
//
// O QUE ISTO É: "este aparelho reconhece o último usuário autenticado e libera os recursos locais que ele já
// estava autorizado a usar". O QUE NÃO É: confirmação do servidor de que a conta continua válida. Nada aqui
// concede privilégio, autoriza chamada ao backend ou substitui sessão/RLS/auth.uid()/has_app_access()/termos.
// Qualquer operação que fale com o servidor continua sujeita a tudo isso e, quando a rede volta, o estado do
// servidor prevalece (AuthContext revalida antes de qualquer sync).
//
// NÃO guarda: tokens (a sessão é do Supabase, no mecanismo oficial dele), senha, e-mail, role/permissões
// administrativas, saldo/EvoCoins/financeiro, data de nascimento, nem nada além do necessário para desenhar o
// app e identificar o usuário. Registros são por user_id; só existe UM usuário "ativo" por aparelho.

export const BOOTSTRAP_SCHEMA_VERSION = 1
const ACTIVE_KEY = 'bootstrap:active-user' // syncMeta pública: ponteiro, sem dado da conta
const LOGOUT_KEY = 'bootstrap:last-explicit-logout'

// Campos do perfil que o shell offline realmente usa (identificar o usuário, gates, rotina planejada).
// role NÃO entra: offline ninguém ganha papel de admin por cache (as telas admin exigem servidor).
export function minimalProfile(profile) {
  if (!profile || typeof profile !== 'object') return null
  return {
    id: profile.id,
    username: profile.username ?? null,
    createdAt: profile.createdAt ?? null,
    accountStatus: profile.accountStatus ?? null,
    trainingPreferences: profile.trainingPreferences ?? null,
  }
}

// Monta o registro a partir do que o SERVIDOR acabou de confirmar. `allowed`: o estado verificado online
// permite acesso (conta ativa, sem restrição, termos aceitos e vigentes, sem exclusão em curso). Se não
// permite, o registro fica `enabled:false` com o motivo: nunca abre offline algo que o servidor já barrou.
export function buildBootstrapRecord({
  userId,
  profile,
  emailVerified,
  policy,
  allowed,
  blockedReason = null,
  now = Date.now(),
}) {
  const acceptance = profile?.legalAcceptance
  return {
    user_id: userId,
    schema_version: BOOTSTRAP_SCHEMA_VERSION,
    profile: minimalProfile(profile),
    email_verified: Boolean(emailVerified),
    last_online_verified_at: now,
    legal: {
      accepted_version: acceptance?.version ?? null,
      accepted_digest: acceptance?.digest ?? null,
      accepted_at: acceptance?.acceptedAt ?? null,
      // Política vigente que o servidor informou na última verificação (só informativo para o aviso).
      last_seen_policy_version: policy?.version ?? null,
      last_verified_at: now,
    },
    offline_access: {
      enabled: Boolean(allowed),
      blocked_reason: allowed ? null : blockedReason || 'NOT_ALLOWED',
      revoked_locally_at: null,
    },
    updated_at: now,
  }
}

// Decide se este registro permite abrir offline. Falha SEGURA: qualquer dúvida = não entra.
export function evaluateOfflineEntry(record, { userId = null } = {}) {
  if (!record || typeof record !== 'object') return { ok: false, reason: 'NO_BOOTSTRAP' }
  if (record.schema_version !== BOOTSTRAP_SCHEMA_VERSION)
    return { ok: false, reason: 'SCHEMA_MISMATCH' }
  if (typeof record.user_id !== 'string' || !record.user_id)
    return { ok: false, reason: 'CORRUPTED' }
  if (userId && record.user_id !== userId) return { ok: false, reason: 'DIFFERENT_USER' }
  const access = record.offline_access
  if (!access || typeof access !== 'object') return { ok: false, reason: 'CORRUPTED' }
  if (access.revoked_locally_at) return { ok: false, reason: 'REVOKED' }
  if (access.enabled !== true) return { ok: false, reason: access.blocked_reason || 'BLOCKED' }
  const profile = record.profile
  if (!profile || profile.id !== record.user_id) return { ok: false, reason: 'CORRUPTED' }
  if (profile.accountStatus !== 'active') return { ok: false, reason: 'ACCOUNT_NOT_ACTIVE' }
  const legal = record.legal
  // O aceite local só vale para uma versão/digest que ESTE app conhece e aprovou: nada é inventado.
  if (
    !legal?.accepted_version ||
    !legal.accepted_digest ||
    !legal.accepted_at ||
    !Object.hasOwn(APPROVED_LEGAL_DIGESTS, legal.accepted_version) ||
    APPROVED_LEGAL_DIGESTS[legal.accepted_version] !== legal.accepted_digest
  ) {
    return { ok: false, reason: 'LEGAL_NOT_CONFIRMED' }
  }
  if (!Number.isFinite(record.last_online_verified_at)) return { ok: false, reason: 'CORRUPTED' }
  return { ok: true, reason: null }
}

// Identidade "local": o que o AuthContext expõe no modo offline. user NÃO é uma sessão do servidor.
export function offlineIdentity(record) {
  const { legal } = record
  const profile = {
    ...record.profile,
    role: 'user', // nunca privilégio por cache
    legalAcceptance: {
      version: legal.accepted_version,
      digest: legal.accepted_digest,
      acceptedAt: legal.accepted_at,
    },
  }
  const policy = {
    version: legal.accepted_version,
    digest: legal.accepted_digest,
    published: true,
    publishedAt: null,
  }
  return {
    user: {
      id: record.user_id,
      uid: record.user_id,
      emailVerified: record.email_verified,
      offline: true,
    },
    profile,
    // Último bundle aceito e confirmado ONLINE (só para o gate liberar a casca offline; os documentos em
    // si só existem com o servidor, e uma versão nova só é descoberta ao reconectar).
    legalAccess: {
      policy,
      restriction: null,
      legalBundle: {
        manifest: { version: legal.accepted_version, published: true },
        documents: [],
        digest: legal.accepted_digest,
      },
      offline: true,
    },
  }
}

// ---- Persistência (nunca lança: falha vira "sem bootstrap" = não entra offline) ------------------------------

export function saveBootstrap(record) {
  return attempt(
    'bootstrap:save',
    async () => {
      await withTransaction(
        [STORES.offlineBootstrap, STORES.syncMeta],
        'readwrite',
        async ({ offlineBootstrap, syncMeta }) => {
          // Um único usuário ativo: o registro de OUTRA conta deste aparelho deixa de valer como entrada offline.
          const active = await request(syncMeta.get(ACTIVE_KEY))
          const logout = await request(syncMeta.get(LOGOUT_KEY))
          // Uma gravação iniciada antes do logout pode terminar depois dele. O tombstone fica na MESMA
          // transação do ponteiro: só uma confirmação online posterior ao logout reabre o cold start.
          if (
            logout?.value?.userId === record.user_id &&
            logout.value.at >= record.last_online_verified_at
          )
            return
          const previous = await request(offlineBootstrap.get(record.user_id))
          if (previous?.updated_at > record.updated_at) return
          if (active?.value && active.value !== record.user_id)
            offlineBootstrap.delete(active.value)
          offlineBootstrap.put(record)
          syncMeta.put({ key: ACTIVE_KEY, value: record.user_id })
        }
      )
      return true
    },
    false
  )
}

export function readActiveBootstrap() {
  return attempt(
    'bootstrap:read',
    () =>
      withTransaction(
        [STORES.offlineBootstrap, STORES.syncMeta],
        'readonly',
        async ({ offlineBootstrap, syncMeta }) => {
          const active = await request(syncMeta.get(ACTIVE_KEY))
          if (!active?.value) return null
          return (await request(offlineBootstrap.get(active.value))) ?? null
        }
      ),
    null
  )
}

// O servidor (online) disse que esta conta não deve abrir offline agora (restrita, desativada, em exclusão,
// termos novos pendentes...): o registro fica, mas desabilitado, até uma verificação online voltar a liberar.
export function markBootstrapBlocked(userId, reason, now = Date.now()) {
  if (!userId) return Promise.resolve(false)
  return attempt(
    'bootstrap:block',
    () =>
      withTransaction([STORES.offlineBootstrap], 'readwrite', async ({ offlineBootstrap }) => {
        const record = await request(offlineBootstrap.get(userId))
        if (!record) return false
        offlineBootstrap.put({
          ...record,
          offline_access: {
            ...record.offline_access,
            enabled: false,
            blocked_reason: reason || 'BLOCKED',
          },
          updated_at: now,
        })
        return true
      }),
    false
  )
}

// LOGOUT EXPLÍCITO: remove a autorização local de abrir a conta offline (e os dados da conta que serviam
// para isso). NÃO toca a outbox (trabalho não sincronizado), que volta a pertencer à sessão do mesmo
// usuário quando ele entrar de novo online. Sem internet, depois disto, só o cache NÃO reabre a conta.
export function disableOfflineAccess() {
  return attempt(
    'bootstrap:disable',
    () =>
      withTransaction(
        [STORES.offlineBootstrap, STORES.syncMeta],
        'readwrite',
        async ({ offlineBootstrap, syncMeta }) => {
          const active = await request(syncMeta.get(ACTIVE_KEY))
          offlineBootstrap.clear()
          syncMeta.delete(ACTIVE_KEY)
          syncMeta.put({
            key: LOGOUT_KEY,
            value: { at: Date.now(), userId: active?.value ?? null },
          })
          return true
        }
      ),
    false
  )
}

// Troca de identidade: só o registro do usuário que fica (se houver) sobrevive.
export function dropBootstrapsExcept(keepUserId) {
  return attempt(
    'bootstrap:drop-others',
    () =>
      withTransaction(
        [STORES.offlineBootstrap, STORES.syncMeta],
        'readwrite',
        async ({ offlineBootstrap, syncMeta }) => {
          for (const key of await request(offlineBootstrap.getAllKeys()))
            if (key !== keepUserId) offlineBootstrap.delete(key)
          const active = await request(syncMeta.get(ACTIVE_KEY))
          if (active?.value && active.value !== keepUserId) syncMeta.delete(ACTIVE_KEY)
        }
      ),
    undefined
  )
}
