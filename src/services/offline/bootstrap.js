import { attempt, request, withTransaction } from './database.js'
import { HOME_SNAPSHOT_META, STORES, userMetaKey } from './schema.js'

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
export const ACTIVE_KEY = 'bootstrap:active-user' // syncMeta pública: ponteiro, sem dado da conta
export const LOGOUT_KEY = 'bootstrap:last-explicit-logout'

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
    // Só decide quais atalhos o menu mostra (ex.: "Minha vitrine"); não é dado pessoal sensível.
    usageProfile: profile.usageProfile ?? null,
    // Preferência de estilo das mensagens da Home (texto); sem ela o offline cairia em "neutro" mesmo com
    // escolha explícita. O sexo NÃO é guardado: com 'auto' offline a frase é neutra.
    greetingVoice: profile.greetingVoice ?? 'auto',
    // Descanso padrão entre séries: o cronômetro offline usa a mesma preferência da conta.
    defaultRestSeconds: profile.defaultRestSeconds ?? null,
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
          // Os dados da conta que saiu (saldo, atividade) vão embora junto com o bootstrap, na mesma transação.
          if (active?.value) syncMeta.delete(userMetaKey(active.value, HOME_SNAPSHOT_META))
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
            if (key !== keepUserId) {
              offlineBootstrap.delete(key)
              syncMeta.delete(userMetaKey(key, HOME_SNAPSHOT_META))
            }
          const active = await request(syncMeta.get(ACTIVE_KEY))
          if (active?.value && active.value !== keepUserId) syncMeta.delete(ACTIVE_KEY)
        }
      ),
    undefined
  )
}
