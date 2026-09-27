import { createContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase/config'
import { ensureUserProfile, updateUserProfile, mapUserRow } from '../services/usersService'
import { logoutUser } from '../services/authService'
import { getMyDeletionStatus } from '../services/accountDeletionService'
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
  return { ...supabaseUser, uid: supabaseUser.id }
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
  // claims velhas), o worker que de fato apaga a conta no Supabase (fase de economia/
  // limpeza, ainda não portado) faz o JWT parar de funcionar imediatamente quando
  // roda — não há uma janela de "parece válido mas não é" pra replicar aqui. Por isso
  // esta versão consulta getMyDeletionStatus() proativamente a cada carga de perfil,
  // em vez de reagir a um erro de permissão específico.
  const [deletionStatus, setDeletionStatus] = useState(null)
  // Compartilhado entre a carga automática (onAuthStateChange) e refreshProfile/
  // refreshLegalAccess (chamados direto por Register.jsx/LegalGate) — sem isso, os
  // dois lados corriam separado: uma carga automática disparada no instante do
  // cadastro podia responder DEPOIS de um refresh mais novo e sobrescrever o estado
  // completo com uma "foto" antiga de antes dos passos seguintes do cadastro.
  const revisionRef = useRef(0)

  useEffect(() => {
    let active = true
    let profileChannel = null

    async function checkDeletionStatus(userId, forRevision) {
      try {
        const { state } = await getMyDeletionStatus()
        if (!active || forRevision !== revisionRef.current) return
        if (state === 'blocked_financial_review') {
          setDeletionStatus('blocked_financial_review')
        } else if (state === 'pending') {
          setLogoutReason('account-deleting')
          await logoutUser().catch(() => {})
        }
      } catch (error) {
        console.warn('[Auth] getMyDeletionStatus:', error)
      }
    }

    async function loadSession(supabaseUser) {
      clearPageCache()
      clearPhotoCache()
      clearCachedLegalAccess()
      clearCachedWallet()
      const current = ++revisionRef.current
      profileChannel?.unsubscribe()
      profileChannel = null
      setUser(toAppUser(supabaseUser))
      setProfile(null)
      setProfileError('')
      setDeletionStatus(null)
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
      if (!active || current !== revisionRef.current) return

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
            { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${supabaseUser.id}` },
            (payload) => {
              if (!active || current !== revisionRef.current) return
              setProfile(mapUserRow(payload.new))
            }
          )
          .subscribe()
        checkDeletionStatus(supabaseUser.id, current)
      } else {
        console.error('[Auth] ensureUserProfile:', profileResult.reason)
        setProfileError('Não foi possível carregar seu perfil. Recarregue a página para tentar novamente.')
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

  async function saveProfile(changes) {
    const userId = user.uid
    const current = ++revisionRef.current
    const patch = await updateUserProfile(userId, changes)
    if (current === revisionRef.current) {
      setProfile((prev) => (prev?.id === userId ? { ...prev, ...patch } : prev))
    }
    return patch
  }

  // Usado logo após o cadastro: nesse momento o listener de onAuthStateChange já pode
  // ter buscado o perfil (ainda sem @usuário, criado uma fração de segundo antes),
  // então essa função relê a linha e sincroniza o estado do contexto sem depender
  // dessa corrida. Bumps revisionRef antes do fetch para descartar qualquer carga
  // automática mais antiga que ainda esteja em voo.
  async function refreshProfile(userId) {
    const current = ++revisionRef.current
    const userProfile = await ensureUserProfile(userId)
    if (current === revisionRef.current) setProfile(userProfile)
    return userProfile
  }

  async function refreshLegalAccess(userId = user?.uid) {
    if (!userId) return
    const current = ++revisionRef.current
    setLegalLoading(true)
    setLegalError('')
    try {
      const access = await getLegalAccess(userId)
      if (current === revisionRef.current) setLegalAccess(access)
      return access
    } catch (error) {
      console.error('[Auth] getLegalAccess:', error)
      if (current === revisionRef.current) {
        setLegalError('Não foi possível consultar a policy e as restrições atuais.')
      }
    } finally {
      if (current === revisionRef.current) setLegalLoading(false)
    }
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
        refreshProfile,
        refreshLegalAccess,
        saveProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
