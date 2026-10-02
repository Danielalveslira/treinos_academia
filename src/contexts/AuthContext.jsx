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
  // Só usado DENTRO do efeito abaixo, pra uma chamada de loadSession não pisar no
  // resultado de outra mais nova (duas trocas de sessão em sequência rápida) — nunca
  // compartilhado com refreshProfile/refreshLegalAccess/saveProfile (ver por quê no
  // comentário de refreshProfile mais abaixo).
  const sessionRevisionRef = useRef(0)

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

    async function loadSession(supabaseUser) {
      clearPageCache()
      clearPhotoCache()
      clearCachedLegalAccess()
      clearCachedWallet()
      const current = ++sessionRevisionRef.current
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
        if (active) {
          setProfile(null)
          setLegalAccess(null)
          setLegalLoading(false)
          setLoading(false)
        }
        return
      }

      const [profileResult, legalResult] = await Promise.allSettled([
        ensureUserProfile(supabaseUser.id),
        getLegalAccess(supabaseUser.id),
      ])
      if (!active || current !== sessionRevisionRef.current) return

      if (profileResult.status === 'fulfilled') {
        setProfile(profileResult.value)
        // Uma ação administrativa (desativar conta, aplicar restrição) grava direto na
        // linha users/{uid} de outra sessão — sem uma subscription aqui, a sessão
        // afetada só veria o efeito num próximo refresh/reload manual, mesmo já
        // bloqueada no servidor (as policies já negam na hora; isto é só a UI refletir
        // o motivo). Sincroniza a linha INTEIRA a cada mudança, não só um subconjunto.
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
        setProfileError(
          'Não foi possível carregar seu perfil. Recarregue a página para tentar novamente.'
        )
      }

      if (legalResult.status === 'fulfilled') {
        setLegalAccess(legalResult.value)
      } else {
        console.error('[Auth] getLegalAccess:', legalResult.reason)
        setLegalError('Não foi possível consultar a policy e as restrições atuais.')
      }
      setLegalLoading(false)
      setLoading(false)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active) loadSession(session?.user ?? null)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      loadSession(session?.user ?? null)
    })

    return () => {
      active = false
      profileChannel?.unsubscribe()
      subscription.subscription.unsubscribe()
    }
  }, [])

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

  async function refreshProfile(userId) {
    const userProfile = await ensureUserProfile(userId)
    setProfile(userProfile)
    return userProfile
  }

  async function refreshLegalAccess(userId = user?.uid) {
    if (!userId) return
    setLegalLoading(true)
    setLegalError('')
    try {
      const access = await getLegalAccess(userId)
      setLegalAccess(access)
      return access
    } catch (error) {
      console.error('[Auth] getLegalAccess:', error)
      setLegalError('Não foi possível consultar a policy e as restrições atuais.')
    } finally {
      setLegalLoading(false)
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
        deletionStatus,
        deletionReview,
        refreshDeletionReview,
        refreshProfile,
        refreshLegalAccess,
        saveProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
