import { createContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase/config'
import { ensureUserProfile, updateUserProfile, mapUserRow } from '../services/usersService'
import { logoutUser } from '../services/authService'
import { getMyDeletionReview } from '../services/accountDeletionService'
import { setLogoutReason } from '../utils/logoutReason'
import { clearPageCache } from '../utils/pageCache'
import { clearPhotoCache } from '../utils/photoBlobCache'
import { getLegalAccess } from '../services/legalService'
import { clearCachedLegalAccess } from '../utils/legal'
import { clearCachedWallet } from '../services/economyService'
import { isSameSessionIdentity } from '../utils/authSession'
import { clearActivityPingThrottle } from '../utils/activityPing'
import { clearAllCommentDrafts } from '../features/comments/utils/drafts'
import { purgePrivateData } from '../services/offline/userScope'
import { isOfflineColdStartEnabled } from '../services/offline/database'
import {
  hydrateOfflineRollout,
  refreshRemoteRollout,
  setOfflineRolloutUser,
  setRemoteRolloutSnapshot,
  subscribeOfflineRollout,
} from '../services/offline/rollout'
import { resolveBootState, setBootState } from '../services/offline/bootState'
import { flushOfflineTelemetry, recordOfflineDiagnostic, setOfflineTelemetryContext } from '../services/offline/diagnostics'
import { classifyReadError } from '../services/offline/readError'
import { createProbe } from '../services/offline/connectivity'
import {
  buildBootstrapRecord,
  dropBootstrapsExcept,
  saveBootstrap,
} from '../services/offline/bootstrap'

// Leitura/decisão do cold start: só carregada quando o app abre sem rede (fora do bundle de boot online).
const bootstrapEntry = () => import('../services/offline/bootstrapEntry')
import { resolveLegalGateState } from '../utils/legal'
import { requiresEmailVerification } from '../utils/emailVerification'

export const AuthContext = createContext(null)

// O resto do app lê user.uid, no padrão do Firebase Auth — em vez de tocar cada call
// site, o usuário do Supabase (que só tem .id) ganha um alias .uid aqui.
function toAppUser(supabaseUser) {
  if (!supabaseUser) return null
  return {
    ...supabaseUser,
    uid: supabaseUser.id,
    emailVerified: Boolean(supabaseUser.email_confirmed_at),
  }
}

export const OFFLINE_ENTRY_REQUIRES_INTERNET =
  'Conecte-se à internet para entrar no Evolutus neste aparelho.'

// Sondagem do backend (cache curto, sem polling): `force` porque aqui a pergunta é "dá para perguntar ao
// servidor agora?", e um resultado antigo de "não" não pode prender o usuário offline depois que a rede voltou.
let probe = null
async function backendReachable() {
  if (globalThis.navigator?.onLine === false) return false
  probe ??= createProbe({
    baseUrl: import.meta.env?.VITE_SUPABASE_URL,
    anonKey: import.meta.env?.VITE_SUPABASE_ANON_KEY,
  })
  return probe.probe({ force: true })
}

async function getServerAppAccess() {
  const { data, error } = await supabase.rpc('has_app_access')
  if (error) throw error
  return data === true
}

// Falha por falta de rede (e NÃO erro de auth/permissão: esse nunca vira "modo offline").
function hasConnectivityFailure(...results) {
  const failures = results.filter((r) => r.status === 'rejected')
  return (
    failures.length > 0 && failures.every((r) => classifyReadError(r.reason) === 'connectivity')
  )
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [legalAccess, setLegalAccess] = useState(null)
  const [legalLoading, setLegalLoading] = useState(true)
  const [legalError, setLegalError] = useState('')
  // Terceiro estado de uma exclusão solicitada: bloqueada aguardando revisão
  // financeira. Só um admin resolve isso — a sessão local não é encerrada sozinha,
  // ProtectedRoute mostra um aviso dedicado (AccountDeletionBlockedGate) em vez de
  // deslogar sem explicação.
  //
  // NOTA: ao contrário do Firebase (onde uma "sessão fantasma" — conta já excluída mas
  // token do navegador ainda parecendo válido — precisava ser detectada via um
  // permission-denied reinterpretado, já que o token seguia renovando por até 1h com
  // claims velhas), o worker que de fato apaga a conta (process-deletion-jobs, Edge
  // Function + run_deletion_job, chamado via pg_cron a cada minuto -- ver migration
  // deletion_worker.sql) faz o JWT parar de funcionar imediatamente quando roda
  // (auth.admin.deleteUser) — não há uma janela de "parece válido mas não é" pra
  // replicar aqui. Por isso esta versão consulta getMyDeletionReview() proativamente a
  // cada carga de perfil, em vez de reagir a um erro de permissão específico.
  const [deletionStatus, setDeletionStatus] = useState(null)
  // Detalhes públicos da exclusão (protocolo, se a pendência foi separada) -- ver
  // get_my_deletion_review; nunca saldo/valores.
  const [deletionReview, setDeletionReview] = useState(null)
  // 'online' = sessão confirmada pelo servidor; 'offline-local' = usuário reconhecido por este aparelho (cold
  // start offline), SEM confirmação do servidor até a revalidação.
  const [authMode, setAuthMode] = useState('online')
  const [offlineVerifiedAt, setOfflineVerifiedAt] = useState(null)
  const [serverAccessAllowed, setServerAccessAllowed] = useState(null)
  const [rolloutRevision, setRolloutRevision] = useState(0)
  // Snapshot agregado da Home restaurado do IndexedDB no cold start (saldo, EvoCoins do dia, atividade).
  // SOMENTE EXIBIÇÃO do último valor conhecido: nada aqui autoriza operação alguma.
  const [offlineHome, setOfflineHome] = useState(null)
  // A restauração local já terminou e NÃO havia cold start válido (ver bootState.resolveBootState). Só o
  // cold start aberto (enterOfflineLocal) o desliga: com a rede de volta ele é inofensivo (resolveBootState).
  const [localDenied, setLocalDenied] = useState(false)
  const authModeRef = useRef('online')
  const revalidatingRef = useRef(false)
  const revalidateRef = useRef(null)
  // Só usado DENTRO do efeito abaixo, pra uma chamada de loadSession não pisar no
  // resultado de outra mais nova (duas trocas de sessão em sequência rápida) — nunca
  // compartilhado com refreshProfile/refreshLegalAccess/saveProfile (ver por quê no
  // comentário de refreshProfile mais abaixo).
  const sessionRevisionRef = useRef(0)
  // Identidade (id do usuário, ou null) da sessão já carregada; undefined = ainda nada
  // carregado. Usada para NÃO recarregar tudo quando o Supabase reemite eventos da MESMA
  // sessão (ver onAuthStateChange abaixo).
  const loadedUserIdRef = useRef(undefined)
  const lastSessionUserIdRef = useRef(null)

  useEffect(() => {
    let active = true
    let profileChannel = null

    async function checkDeletionStatus(userId, forRevision) {
      try {
        const review = await getMyDeletionReview()
        if (!active || forRevision !== sessionRevisionRef.current) return
        if (
          review?.state === 'blocked_financial_review' ||
          (review?.state === 'pending' && review.financialCaseSeparated)
        ) {
          // pending COM pendência separada: a exclusão segue sozinha pelo worker, mas o
          // titular ainda vê o andamento (e o protocolo) até a sessão ser encerrada.
          setDeletionReview(review)
          setDeletionStatus(review.state)
        } else if (review?.state === 'pending') {
          setLogoutReason('account-deleting')
          await logoutUser().catch(() => {})
        }
      } catch (error) {
        console.warn('[Auth] getMyDeletionReview:', error)
      }
    }

    // Aplica o resultado da leitura de perfil + termos do SERVIDOR (boot online ou revalidação ao
    // reconectar). `silent`: revalidação em segundo plano -- não liga `loading` (isso desmontaria a tela
    // atual com formulários em andamento).
    function applyAccountResults(
      supabaseUser,
      profileResult,
      legalResult,
      accessResult,
      current,
      { silent }
    ) {
      if (!active || current !== sessionRevisionRef.current) return
      authModeRef.current = 'online'
      setAuthMode('online')
      setOfflineHome(null)
      setOfflineTelemetryContext(supabaseUser.id, accessResult.status === 'fulfilled')
      setServerAccessAllowed(accessResult.status === 'fulfilled' && accessResult.value === true)
      if (silent) {
        setUser(toAppUser(supabaseUser))
        setProfileError('')
        setLegalError('')
      }
      if (profileResult.status === 'fulfilled') {
        setProfile(profileResult.value)
        // Uma ação administrativa (desativar conta, aplicar restrição) grava direto na
        // linha users/{uid} de outra sessão — sem uma subscription aqui, a sessão
        // afetada só veria o efeito num próximo refresh/reload manual, mesmo já
        // bloqueada no servidor (as policies já negam na hora; isto é só a UI refletir
        // o motivo). Sincroniza a linha INTEIRA a cada mudança, não só um subconjunto.
        profileChannel?.unsubscribe()
        profileChannel = supabase
          .channel(`users-changes-${supabaseUser.id}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'users',
              filter: `id=eq.${supabaseUser.id}`,
            },
            (payload) => {
              if (!active || current !== sessionRevisionRef.current) return
              setProfile(mapUserRow(payload.new))
            }
          )
          .subscribe()
        checkDeletionStatus(supabaseUser.id, current)
      } else {
        console.error('[Auth] ensureUserProfile:', profileResult.reason)
        // 23503 (foreign_key_violation): ensure_user_profile() só pode bater nisso se a
        // linha de auth.users/public.users já não existe mais -- ou seja, a conta foi
        // excluída fisicamente (hard delete do worker) e este JWT antigo ainda é
        // assinaturalmente válido. Sem esta checagem, F5 repete esta mesma tela de
        // "tentar novamente" indefinidamente até o JWT expirar (achado P02 da auditoria
        // de segurança) -- 'account-deleted' existe em logoutReason.js desde então mas
        // nunca era usado. Qualquer outro erro (rede, RPC fora do ar) continua mostrando
        // o aviso genérico de "tentar novamente": só este código específico significa
        // "a conta não existe mais", nunca uma falha transitória.
        if (profileResult.reason?.code === '23503') {
          setLogoutReason('account-deleted')
          logoutUser().catch(() => {})
        } else {
          setProfile(null)
          setProfileError(
            'Não foi possível carregar seu perfil. Recarregue a página para tentar novamente.'
          )
        }
      }

      if (legalResult.status === 'fulfilled') {
        setLegalAccess(legalResult.value)
      } else {
        console.error('[Auth] getLegalAccess:', legalResult.reason)
        setLegalAccess(null)
        setLegalError('Não foi possível consultar a policy e as restrições atuais.')
      }
      if (
        accessResult.status === 'rejected' &&
        profileResult.status === 'fulfilled' &&
        legalResult.status === 'fulfilled'
      ) {
        console.error('[Auth] has_app_access:', accessResult.reason)
        setProfileError('Não foi possível confirmar o acesso à sua conta. Tente novamente.')
      }
      setLegalLoading(false)
      setLoading(false)
    }

    // ---- Cold start offline (VITE_OFFLINE_COLD_START_ENABLED) ----------------------------------------
    // "Este aparelho reconhece o último usuário que entrou ONLINE e libera os recursos locais que ele já
    // podia usar" -- NUNCA "o servidor confirmou agora". Nenhum token é guardado aqui (a sessão é do
    // Supabase); o servidor continua decidindo tudo que exige backend, e ao reconectar o estado dele
    // prevalece (revalidate). Falha segura: qualquer dúvida = não entra offline.
    // Entrada local utilizável: bootstrap gravado ONLINE (do mesmo usuário, quando `expectedUserId` existe),
    // cold start autorizado para ele (snapshot de rollout) e o snapshot da Home -- tudo numa ÚNICA leitura do
    // IndexedDB (readOfflineEntry). Nunca consulta a rede. Devolve { record, home } ou null.
    async function localEntryFor(expectedUserId = null) {
      const { readOfflineEntry, evaluateOfflineEntry } = await bootstrapEntry()
      const entry = await readOfflineEntry()
      const userId = expectedUserId ?? entry.record?.user_id
      if (!userId) return null
      setRemoteRolloutSnapshot(userId, entry.rollout, true)
      const allowed =
        evaluateOfflineEntry(entry.record, { userId: expectedUserId }).ok &&
        isOfflineColdStartEnabled(import.meta.env, userId)
      return allowed ? entry : null
    }

    async function resolveOfflineEntry() {
      const { readOfflineEntry, evaluateOfflineEntry } = await bootstrapEntry()
      const entry = await readOfflineEntry()
      const record = entry.record
      setOfflineTelemetryContext(record?.user_id, false)
      if (!evaluateOfflineEntry(record, { userId: lastSessionUserIdRef.current }).ok) {
        recordOfflineDiagnostic('cold_start_denied')
        return null
      }
      setRemoteRolloutSnapshot(record.user_id, entry.rollout, true)
      if (!isOfflineColdStartEnabled(import.meta.env, record.user_id)) {
        recordOfflineDiagnostic('cold_start_denied')
        return null
      }
      // Com o backend alcançável a ausência de sessão é uma resposta real do servidor (sessão expirada ou
      // inválida): vai para o login. Só abre offline quando a rede de fato não permite perguntar.
      if (await backendReachable()) return null
      return entry
    }

    // Abertura SEM rede, antes de qualquer resposta do auth-js: offline com o token vencido ele tenta renovar
    // por dezenas de segundos (retry com backoff) antes de emitir a sessão inicial. O snapshot local não
    // precisa disso: o bootstrap diz quem é o usuário e o rollout/termos já foram validados online.
    async function openFromLocalSnapshot() {
      const current = ++sessionRevisionRef.current
      const entry = await localEntryFor()
      if (!active || current !== sessionRevisionRef.current) return
      if (entry) {
        await enterOfflineLocal(entry, current)
      } else {
        recordOfflineDiagnostic('cold_start_denied')
        setLocalDenied(true)
      }
    }

    async function enterOfflineLocal({ record, home }, current) {
      const { offlineIdentity } = await bootstrapEntry()
      if (!active || current !== sessionRevisionRef.current) return
      const identity = offlineIdentity(record)
      setOfflineTelemetryContext(identity.user.id, false)
      recordOfflineDiagnostic('cold_start_opened')
      setOfflineRolloutUser(identity.user.id)
      loadedUserIdRef.current = identity.user.id
      authModeRef.current = 'offline-local'
      setAuthMode('offline-local')
      setOfflineHome(home)
      setLocalDenied(false)
      setServerAccessAllowed(null)
      setOfflineVerifiedAt(record.last_online_verified_at)
      setUser(identity.user)
      setProfile(identity.profile)
      setProfileError('')
      setDeletionStatus(null)
      setDeletionReview(null)
      setLegalAccess(identity.legalAccess)
      setLegalError('')
      setLegalLoading(false)
      setLoading(false)
    }

    async function loadSession(supabaseUser) {
      const coldStart = isOfflineColdStartEnabled()
      const current = ++sessionRevisionRef.current
      if (supabaseUser) lastSessionUserIdRef.current = supabaseUser.id
      setOfflineRolloutUser(supabaseUser?.id ?? null)
      setOfflineTelemetryContext(supabaseUser?.id ?? null, false)
      // Cold start SEM rede: o navegador já diz que está offline, então perfil/termos/acesso/carteira e
      // Realtime nem são tentados -- o snapshot local validado ONLINE para ESTE usuário abre o app na hora.
      // A leitura começa ANTES da limpeza abaixo (que abre transações de escrita no mesmo banco e a
      // seguraria). Sem snapshot válido (ou feature não autorizada) cai no caminho normal, como antes.
      const earlyEntry =
        coldStart && supabaseUser && globalThis.navigator?.onLine === false
          ? localEntryFor(supabaseUser.id)
          : null
      // Uma troca real de identidade invalida imediatamente o acesso offline da conta anterior,
      // mesmo que o carregamento de perfil/termos da nova conta falhe depois.
      if (coldStart && supabaseUser && !earlyEntry) await dropBootstrapsExcept(supabaseUser.id)
      if (!active || current !== sessionRevisionRef.current) return
      clearPageCache()
      clearPhotoCache()
      clearCachedLegalAccess()
      clearCachedWallet()
      // Banco local (IndexedDB): remove o que não é desta sessão -- só os outros usuários na troca/login (a
      // outbox nunca). Sem sessão e com cold start ligado a limpeza espera a decisão abaixo: ausência de
      // sessão por EXPIRAÇÃO/rede não é logout, e o logout explícito já desligou o bootstrap (authService).
      if (supabaseUser || !coldStart) purgePrivateData(supabaseUser?.id ?? null)
      if (earlyEntry) {
        const entry = await earlyEntry
        if (!active || current !== sessionRevisionRef.current) return
        if (entry) return await enterOfflineLocal(entry, current)
        await dropBootstrapsExcept(supabaseUser.id)
        if (!active || current !== sessionRevisionRef.current) return
      }
      loadedUserIdRef.current = supabaseUser?.id ?? null
      authModeRef.current = 'online'
      setAuthMode('online')
      setOfflineHome(null)
      setServerAccessAllowed(null)
      setOfflineVerifiedAt(null)
      profileChannel?.unsubscribe()
      profileChannel = null
      setUser(toAppUser(supabaseUser))
      setProfile(null)
      setProfileError('')
      setDeletionStatus(null)
      setDeletionReview(null)
      setLegalAccess(null)
      setLegalError('')
      setLegalLoading(Boolean(supabaseUser))
      setLoading(true)
      if (!supabaseUser) {
        if (coldStart) {
          const entry = await resolveOfflineEntry()
          if (!active || current !== sessionRevisionRef.current) return
          if (entry) {
            await enterOfflineLocal(entry, current)
            return
          }
          purgePrivateData(null)
        }
        if (active) {
          setProfile(null)
          setLegalAccess(null)
          setLegalLoading(false)
          setLoading(false)
        }
        return
      }

      const [profileResult, legalResult, accessResult] = await Promise.allSettled([
        ensureUserProfile(supabaseUser.id),
        getLegalAccess(supabaseUser.id),
        getServerAppAccess(),
      ])
      if (!active || current !== sessionRevisionRef.current) return

      if (coldStart && hasConnectivityFailure(profileResult, legalResult, accessResult)) {
        const entry = await localEntryFor(supabaseUser.id)
        if (!active || current !== sessionRevisionRef.current) return
        if (entry) {
          await enterOfflineLocal(entry, current)
        } else {
          setProfileError(OFFLINE_ENTRY_REQUIRES_INTERNET)
          setLegalLoading(false)
          setLoading(false)
        }
        return
      }
      applyAccountResults(supabaseUser, profileResult, legalResult, accessResult, current, {
        silent: false,
      })
    }

    // Reconexão com o app aberto em modo offline local. Ordem SEGURA (nada de sync antes do fim):
    //   1 conectividade real -> 2 sessão Supabase (refresh oficial) -> 3 identidade -> 4 perfil/acesso ->
    //   5 termos vigentes -> 6 bootstrap atualizado (efeito abaixo) -> 7 sync liberado (Layout só liga o
    //   sync em modo online confirmado) -> 8 outbox.
    // Sem renovar a sessão: exige login online, preservando o que está pendente.
    async function revalidate() {
      if (authModeRef.current !== 'offline-local' || revalidatingRef.current) return
      revalidatingRef.current = true
      try {
        if (!(await backendReachable())) return
        const { data, error } = await supabase.auth.getSession()
        if (!active || authModeRef.current !== 'offline-local') return
        const session = data?.session
        if (!session) {
          // Rede instável na renovação: continua offline e tenta de novo depois.
          if (error?.name === 'AuthRetryableFetchError') return
          setLogoutReason('session-expired')
          recordOfflineDiagnostic('revalidation_session_expired')
          await loadSession(null)
          return
        }
        if (session.user.id !== loadedUserIdRef.current) {
          await loadSession(session.user) // identidade diferente: caminho completo (limpa o resto)
          return
        }
        const current = sessionRevisionRef.current
        const [profileResult, legalResult, accessResult] = await Promise.allSettled([
          ensureUserProfile(session.user.id),
          getLegalAccess(session.user.id),
          getServerAppAccess(),
        ])
        if (!active || current !== sessionRevisionRef.current) return
        if (hasConnectivityFailure(profileResult, legalResult, accessResult)) return // a rede caiu de novo: segue offline
        recordOfflineDiagnostic(
          profileResult.status === 'fulfilled' &&
            legalResult.status === 'fulfilled' &&
            accessResult.status === 'fulfilled' &&
            accessResult.value === true
            ? 'revalidation_ok'
            : 'revalidation_denied'
        )
        applyAccountResults(session.user, profileResult, legalResult, accessResult, current, {
          silent: true,
        })
      } finally {
        revalidatingRef.current = false
      }
    }
    revalidateRef.current = revalidate

    // onAuthStateChange já emite INITIAL_SESSION ao assinar: um getSession() separado só
    // duplicava perfil + termos + revisão de exclusão + canal Realtime a cada abertura.
    //
    // O Supabase também reemite eventos da MESMA sessão sem que nada tenha mudado para o app:
    // SIGNED_IN ao voltar para a aba, TOKEN_REFRESHED a cada renovação do token, USER_UPDATED.
    // Tratar cada um como uma nova sessão zerava o estado, mostrava o spinner (desmontando a
    // tela privada inteira, com formulários em andamento) e refazia todas as leituras. Só uma
    // troca real de identidade (login, logout, outro usuário) recarrega a sessão.
    if (isOfflineColdStartEnabled() && globalThis.navigator?.onLine === false) openFromLocalSnapshot()

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user ?? null
      if (event === 'SIGNED_OUT') {
        clearAllCommentDrafts()
        // Um novo login (outra sessão) deve registrar o uso logo, sem esperar os 10 min.
        clearActivityPingThrottle()
      }
      // Aberto offline pelo snapshot local: o auth-js (token vencido, sem rede) acaba entregando uma sessão
      // inicial vazia depois de tentar renovar por dezenas de segundos. Isso NÃO é logout: o app continua
      // aberto e a revalidação, ao reconectar, decide o que fazer com a sessão.
      if (event === 'INITIAL_SESSION' && !nextUser && authModeRef.current === 'offline-local') return
      if (isSameSessionIdentity(loadedUserIdRef.current, nextUser)) {
        // Em modo offline local o usuário exposto é o RECONHECIDO LOCALMENTE; só a revalidação (que confirma
        // sessão, perfil e termos) o promove a sessão confirmada pelo servidor.
        if (nextUser && authModeRef.current !== 'offline-local') {
          // E-mail confirmado/alterado chega por aqui; o resto do objeto não muda a UI.
          setUser((previous) =>
            previous &&
            previous.email === nextUser.email &&
            previous.email_confirmed_at === nextUser.email_confirmed_at
              ? previous
              : toAppUser(nextUser)
          )
        }
        return
      }
      loadSession(nextUser)
    })

    return () => {
      active = false
      revalidateRef.current = null
      profileChannel?.unsubscribe()
      subscription.subscription.unsubscribe()
    }
  }, [])

  // Busca a configuração operacional com a sessão online. Poll lento (só com a aba visível) + foreground + `online` propagam o
  // kill switch sem novo build. A decisão local usa apenas a última resposta válida desta conta.
  useEffect(() => subscribeOfflineRollout(() => setRolloutRevision((value) => value + 1)), [])
  // Máquina de estados do boot (bootState.js): o PwaControls só decide "sem conexão" depois que a
  // restauração local termina de verdade -- nunca no meio dela.
  useEffect(() => {
    // Builds sem cold start não têm o que restaurar: o estado fica em online_ready e nada muda.
    if (!isOfflineColdStartEnabled()) return
    setBootState(
      resolveBootState({ loading, authMode, localDenied, onLine: globalThis.navigator?.onLine })
    )
  }, [loading, authMode, localDenied])
  useEffect(() => {
    let stop
    import('../supabase/realtimeOffline')
      .then((module) => { stop = module.pauseRealtimeWhenOffline(supabase) })
      .catch(() => {})
    return () => stop?.()
  }, [])
  useEffect(() => {
    if (authMode !== 'online' || !user?.uid || serverAccessAllowed !== true) return undefined
    let active = true
    const userId = user.uid
    // Sem polling com a aba oculta: o retorno ao primeiro plano e o evento `online` consultam na hora
    // (chamadas simultâneas se fundem em uma só dentro de refreshRemoteRollout).
    const update = async () => {
      if (globalThis.navigator?.onLine === false) return
      await hydrateOfflineRollout(userId)
      if (active) {
        await refreshRemoteRollout(userId)
        flushOfflineTelemetry().catch(() => {})
      }
    }
    const onVisible = () => document.visibilityState === 'visible' && update()
    window.addEventListener('online', update)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(onVisible, 90_000) // 60-120 s: kill switch sem polling agressivo
    onVisible()
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('online', update)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [authMode, user?.uid, serverAccessAllowed])

  // Modo offline local: tenta revalidar quando a rede volta, ao voltar para a aba e, com o navegador
  // dizendo "online" mas o backend ainda inalcançável (portal cativo), a cada 30 s com a aba visível.
  useEffect(() => {
    if (authMode !== 'offline-local') return undefined
    const attempt = () => revalidateRef.current?.()
    const onVisible = () => {
      if (document.visibilityState === 'visible') attempt()
    }
    window.addEventListener('online', attempt)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) attempt()
    }, 30_000)
    if (navigator.onLine !== false) attempt()
    return () => {
      window.removeEventListener('online', attempt)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [authMode])

  // Bootstrap local: só a partir do que o SERVIDOR confirmou (modo online) e só com o cold start ligado.
  // Estado que NÃO permite acesso (conta desativada/em exclusão/restrita, termos novos pendentes, e-mail por
  // verificar) fica gravado como bloqueado: o aparelho nunca abre offline o que o servidor já barrou.
  useEffect(() => {
    if (
      !isOfflineColdStartEnabled(import.meta.env, user?.uid) ||
      authMode !== 'online' ||
      !user ||
      !profile ||
      !legalAccess ||
      serverAccessAllowed === null
    )
      return
    // SÓ dados confirmados pelo servidor viram bootstrap. Num render intermediário (troca de modo/usuário) o
    // estado pode ainda ser o da identidade OFFLINE ou o de outro usuário: isso nunca é regravado.
    if (
      user.offline ||
      legalAccess.offline ||
      profile.id !== user.uid ||
      loadedUserIdRef.current !== user.uid ||
      authModeRef.current !== 'online'
    )
      return
    const gate = resolveLegalGateState({ profile, access: legalAccess, loading: false, error: '' })
    const emailOk = user.emailVerified || !requiresEmailVerification(profile)
    const allowed =
      serverAccessAllowed &&
      gate === 'allowed' &&
      profile.accountStatus === 'active' &&
      !deletionStatus &&
      emailOk
    const blockedReason = allowed
      ? null
      : !serverAccessAllowed
        ? 'SERVER_ACCESS_DENIED'
        : deletionStatus
          ? 'ACCOUNT_DELETING'
          : profile.accountStatus !== 'active'
            ? 'ACCOUNT_NOT_ACTIVE'
            : !emailOk
              ? 'EMAIL_UNVERIFIED'
              : gate.toUpperCase().replace(/-/g, '_')
    saveBootstrap(
      buildBootstrapRecord({
        userId: user.uid,
        profile,
        emailVerified: user.emailVerified,
        policy: legalAccess.policy,
        allowed,
        blockedReason,
      })
    ).then((saved) => {
      if (saved && allowed) recordOfflineDiagnostic('bootstrap_saved')
      // Aparelho passa a guardar algo que vale proteger: pede armazenamento persistente (uma vez, sem bloquear).
      // Carregado sob demanda (só existe depois de um login ONLINE confirmado): fora do bundle de entrada.
      if (saved && allowed) {
        import('../services/offline/storagePersistence')
          .then((module) => module.requestPersistentStorageOnce())
          .catch(() => {})
      }
    })
  }, [authMode, user, profile, legalAccess, deletionStatus, serverAccessAllowed, rolloutRevision])

  const isSuperAdmin = profile?.role === 'superadmin'

  // saveProfile/refreshProfile/refreshLegalAccess são chamadas diretas (Register.jsx,
  // LegalGate, Profile.jsx), independentes do carregamento automático de sessão acima —
  // de propósito SEM nenhum contador de revisão compartilhado com sessionRevisionRef:
  // essa proteção já foi tentada numa versão anterior e causava o efeito oposto (uma
  // chamada destas, acontecendo enquanto loadSession ainda aguardava
  // ensureUserProfile/getLegalAccess, fazia loadSession descartar seu próprio resultado
  // e nunca zerar `loading`, travando o app num spinner infinito). Cada uma só grava o
  // que ela mesma acabou de buscar, sempre um dado fresco (nunca uma "foto antiga").
  async function saveProfile(changes) {
    const userId = user.uid
    const patch = await updateUserProfile(userId, changes)
    setProfile((prev) => (prev?.id === userId ? { ...prev, ...patch } : prev))
    return patch
  }

  // Aplica ao perfil em memória um campo que o servidor JÁ confirmou (ex.: ACK das boas-vindas), sem reler
  // nada. Só vale para a conta carregada agora: o retorno tardio de uma conta anterior é descartado.
  function patchProfile(userId, patch) {
    if (loadedUserIdRef.current !== userId) return
    setProfile((prev) => (prev?.id === userId ? { ...prev, ...patch } : prev))
  }

  async function refreshProfile(userId) {
    const userProfile = await ensureUserProfile(userId)
    const access = await getServerAppAccess()
    if (loadedUserIdRef.current === userId && authModeRef.current === 'online') {
      setProfile(userProfile)
      setServerAccessAllowed(access)
    }
    return userProfile
  }

  // `silent`: revalidação em segundo plano (voltar para a aba). Não liga legalLoading -- isso
  // faria o LegalGate trocar o app inteiro por um spinner e desmontar a tela atual (formulários
  // em andamento perdidos) -- e uma falha de rede mantém o último acesso conhecido em vez de
  // abrir a tela de erro. As políticas RLS do servidor continuam sendo a barreira real.
  async function refreshLegalAccess(userId = user?.uid, { silent = false } = {}) {
    if (!userId || authModeRef.current === 'offline-local') return
    if (!silent) {
      setLegalLoading(true)
      setLegalError('')
    }
    try {
      const [access, allowed] = await Promise.all([getLegalAccess(userId), getServerAppAccess()])
      if (loadedUserIdRef.current === userId && authModeRef.current === 'online') {
        setLegalAccess(access)
        setServerAccessAllowed(allowed)
      }
      return access
    } catch (error) {
      console.error('[Auth] getLegalAccess:', error)
      if (!silent) setLegalError('Não foi possível consultar a policy e as restrições atuais.')
    } finally {
      if (!silent) setLegalLoading(false)
    }
  }

  // Relê a revisão da própria exclusão (botão "Atualizar situação" da tela de exclusão).
  // Devolve null quando não há mais exclusão em andamento (concluída ou cancelada).
  async function refreshDeletionReview() {
    const review = await getMyDeletionReview()
    setDeletionReview(review)
    setDeletionStatus(review ? review.state : null)
    return review
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        profileError,
        legalAccess,
        legalLoading,
        legalError,
        isSuperAdmin,
        loading,
        verifyingSession: false,
        offlineLocal: authMode === 'offline-local',
        offlineHome,
        serverAccessAllowed,
        offlineVerifiedAt,
        deletionStatus,
        deletionReview,
        refreshDeletionReview,
        refreshProfile,
        refreshLegalAccess,
        saveProfile,
        patchProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
