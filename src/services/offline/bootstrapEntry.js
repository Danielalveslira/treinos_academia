import { APPROVED_LEGAL_DIGESTS } from '../../utils/legal.js'
import { attempt, request, withTransaction } from './database.js'
import { ROLLOUT_META, STORES, userMetaKey } from './schema.js'
import { ACTIVE_KEY, BOOTSTRAP_SCHEMA_VERSION } from './bootstrap.js'
import { homeSnapshotKey, validateHomeSnapshot } from './homeSnapshot.js'

// Leitura/decisão do COLD START OFFLINE. Fica em módulo à parte (carregado sob demanda, só quando o app abre
// sem rede) para não pesar no bundle de boot de quem está online; as regras e o formato do registro
// continuam em bootstrap.js. Entra no precache offline do Service Worker (scripts/pwa-plugin.js).

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

const EMPTY_ENTRY = Object.freeze({ record: null, home: null, rollout: null })

// TUDO que o cold start precisa do disco, numa ÚNICA transação (sem várias leituras separadas no boot):
//  - record:  o bootstrap do usuário ativo (identidade mínima + aceite legal);
//  - home:    o snapshot agregado da Home DESTE usuário (saldo, EvoCoins do dia, atividade) já validado;
//  - rollout: a última resposta válida do rollout do servidor para este usuário (decide se pode abrir).
// Nunca lança: falha de IndexedDB = sem entrada (não entra offline).
export function readOfflineEntry() {
  return attempt(
    'bootstrap:read',
    () =>
      withTransaction(
        [STORES.offlineBootstrap, STORES.syncMeta],
        'readonly',
        async ({ offlineBootstrap, syncMeta }) => {
          const active = await request(syncMeta.get(ACTIVE_KEY))
          if (!active?.value) return EMPTY_ENTRY
          const userId = active.value
          const [record, home, rollout] = await Promise.all([
            request(offlineBootstrap.get(userId)),
            request(syncMeta.get(homeSnapshotKey(userId))),
            request(syncMeta.get(userMetaKey(userId, ROLLOUT_META))),
          ])
          return {
            record: record ?? null,
            home: validateHomeSnapshot(home?.value, userId),
            rollout: rollout?.value ?? null,
          }
        }
      ),
    EMPTY_ENTRY
  )
}

export async function readActiveBootstrap() {
  return (await readOfflineEntry()).record
}
