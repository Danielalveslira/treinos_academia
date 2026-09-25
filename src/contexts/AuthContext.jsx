import { createContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { ensureUserProfile, updateUserProfile } from '../services/usersService'
import { logoutUser } from '../services/authService'
import { getMyDeletionStatus } from '../services/accountDeletionService'
import { isAccountGoneError } from '../utils/authErrors'
import { setLogoutReason } from '../utils/logoutReason'
import { clearPageCache } from '../utils/pageCache'
import { clearPhotoCache } from '../utils/photoBlobCache'
import { getLegalAccess } from '../services/legalService'
import { clearCachedLegalAccess } from '../utils/legal'
import { clearCachedWallet } from '../services/economyService'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [legalAccess, setLegalAccess] = useState(null)
  const [legalLoading, setLegalLoading] = useState(true)
  const [legalError, setLegalError] = useState('')
  // Só true durante a checagem de "sessão fantasma" abaixo — cobre o intervalo entre
  // perceber o permission-denied e confirmar (via getIdToken(true)) que a conta já não
  // existe mais. ProtectedRoute mostra um spinner nesse meio-tempo em vez de qualquer
  // tela protegida (LegalGate incluso), pra nunca chegar a renderizar "Documentos para
  // continuar" pra uma conta que o servidor já sabe que não existe.
  const [verifyingSession, setVerifyingSession] = useState(false)
  // Terceiro estado de uma exclusão solicitada, distinto de "sessão fantasma" (logout
  // direto): bloqueada aguardando revisão financeira (ver getOwnStatus em
  // deletion-service.js). Só um admin resolve isso -- a sessão local não é encerrada
  // sozinha, ProtectedRoute mostra um aviso dedicado (AccountDeletionBlockedGate) em vez
  // de deslogar sem explicação.
  const [deletionStatus, setDeletionStatus] = useState(null)

  useEffect(() => {
    let active = true
    let revision = 0
    let unsubscribeProfile = null

    // Um permission-denied na leitura do próprio perfil só acontece, na prática, quando
    // deletionJobs/account_{uid} existe (a "lápide" permanente em firestore.rules que
    // bloqueia esse uid pra sempre, criada no INSTANTE em que a exclusão é solicitada) —
    // nunca em uso normal. Mas essa trava liga antes da conta do Firebase Auth em si ser
    // desativada (isso só acontece num estágio posterior do job de exclusão, minutos
    // depois): getIdToken(true) sozinho não basta, porque o token continua renovando
    // normalmente enquanto a conta do Auth ainda não foi tocada, mesmo com a exclusão já
    // bloqueando tudo no Firestore. Por isso, depois de renovar, refaz a MESMA leitura
    // negada com o token novo — só um permission-denied que sobrevive à renovação prova
    // que a trava (não só o token) é o problema, e aí sim a sessão local precisa encerrar.
    //
    // Bug "exclusão bloqueada para revisão financeira": um job pode ficar parado
    // indefinidamente em state:'blocked_financial_review' (só um admin resolve, ver
    // reactivateDeletionIfClear em economy/cash-purchase-service.js) sem NUNCA avançar
    // para desativar o Auth de novo nem para excluir a conta -- mas a trava do Firestore
    // já bloqueia a leitura do perfil desde a solicitação original. Tratar isso como
    // "conta excluída" (deslogando com essa mensagem) seria enganoso e, pior, tratar
    // QUALQUER permission-denied como exclusão sem confirmar por um mecanismo confiável
    // do backend arrisca deslogar por um motivo não relacionado. getMyDeletionStatus é
    // esse mecanismo: uma Cloud Function (Admin SDK, nunca as regras do Firestore) que
    // devolve só o state do job da própria uid, nunca blockReason nem saldo. Consultada
    // ANTES do getIdToken(true) abaixo porque continua funcionando mesmo depois do Auth
    // já ter sido desativado nesta sessão (o token em cache, ainda não expirado
    // naturalmente, já basta pra chamar uma Function -- só getIdToken(true), que força
    // uma renovação de verdade, falha nesse caso).
    async function handlePossibleGhostSession(firebaseUser, error, forRevision) {
      if (error?.code !== 'permission-denied') return
      setVerifyingSession(true)
      try {
        let status = null
        try {
          status = await getMyDeletionStatus()
        } catch (statusError) {
          console.warn('[Auth] getMyDeletionStatus:', statusError)
        }
        if (!active || revision !== forRevision) return
        if (status?.state === 'blocked_financial_review') {
          setDeletionStatus('blocked_financial_review')
          return
        }
        if (status?.state === 'pending') {
          console.warn('[Auth] exclusão em processamento, encerrando sessão local.')
          setLogoutReason('account-deleting')
          await logoutUser().catch(() => {})
          return
        }
        try {
          await firebaseUser.getIdToken(true)
        } catch (refreshError) {
          if (isAccountGoneError(refreshError)) {
            console.warn(
              '[Auth] conta não existe mais no Auth, encerrando sessão local:',
              refreshError
            )
            if (active && revision === forRevision) {
              setLogoutReason('account-deleted')
              await logoutUser().catch(() => {})
            }
          }
          return
        }
        try {
          await getDoc(doc(db, 'users', firebaseUser.uid))
          // Releu com sucesso já com o token novo — não era uma sessão fantasma, foi
          // outra causa transitória. Não desloga; deixa a tela atual lidar com esse erro
          // do jeito que já faz hoje (mensagem genérica, botão de tentar de novo).
        } catch (retryError) {
          if (retryError?.code === 'permission-denied') {
            console.warn(
              '[Auth] perfil segue inacessível mesmo com token renovado -- exclusão em andamento, encerrando sessão local.'
            )
            if (active && revision === forRevision) {
              setLogoutReason('account-deleted')
              await logoutUser().catch(() => {})
            }
          }
        }
      } finally {
        if (active && revision === forRevision) setVerifyingSession(false)
      }
    }

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      clearPageCache()
      // AUD-018: mesmo motivo do clearPageCache acima -- sem isso, as object URLs de
      // fotos baixadas pela sessão anterior ficavam vivas em memória até o teto de
      // MAX_ENTRIES ou um reload, mesmo depois do logout/troca de usuário.
      clearPhotoCache()
      clearCachedLegalAccess()
      clearCachedWallet()
      const current = ++revision
      unsubscribeProfile?.()
      unsubscribeProfile = null
      setUser(firebaseUser)
      setProfile(null)
      setProfileError('')
      setDeletionStatus(null)
      setLegalAccess(null)
      setLegalError('')
      setLegalLoading(Boolean(firebaseUser))
      setLoading(true)
      if (!firebaseUser) {
        if (active) {
          setProfile(null)
          setLegalAccess(null)
          setLegalLoading(false)
          setLoading(false)
        }
        return
      }
      const [profileResult, legalResult] = await Promise.allSettled([
        ensureUserProfile(firebaseUser.uid),
        getLegalAccess(firebaseUser.uid),
      ])
      if (active && current === revision) {
        if (profileResult.status === 'fulfilled') {
          const userProfile = profileResult.value
          setProfile(userProfile)
          // Uma ação administrativa (desativar conta, aplicar restrição) grava direto em
          // users/{uid} de outra sessão — sem um listener aqui, a sessão afetada só veria
          // o efeito num próximo refreshProfile/reload manual, mesmo já bloqueada no
          // servidor (as regras já negam na hora; isto é só a UI refletir o motivo).
          unsubscribeProfile = onSnapshot(
            doc(db, 'users', firebaseUser.uid),
            (snapshot) => {
              if (!active || current !== revision || !snapshot.exists()) return
              setProfile((prev) => ({ ...prev, ...snapshot.data(), id: firebaseUser.uid }))
            },
            (error) => {
              if (active && current === revision)
                handlePossibleGhostSession(firebaseUser, error, current)
            }
          )
        } else {
          console.error('[Auth] ensureUserProfile:', profileResult.reason)
          setProfileError(
            'Não foi possível carregar seu perfil. Recarregue a página para tentar novamente.'
          )
          await handlePossibleGhostSession(firebaseUser, profileResult.reason, current)
          if (!active || current !== revision) return
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
    })
    return () => {
      active = false
      unsubscribeProfile?.()
      unsubscribeAuth()
    }
  }, [])

  const isSuperAdmin = profile?.role === 'superadmin'

  async function saveProfile(changes) {
    const userId = user.uid
    const patch = await updateUserProfile(userId, changes)
    setProfile((prev) => (prev?.id === userId ? { ...prev, ...patch } : prev))
    return patch
  }

  // Usado logo após o cadastro: nesse momento o listener de onAuthStateChanged já pode ter
  // buscado o perfil (ainda sem @usuário, criado uma fração de segundo antes), então essa
  // função relê o documento e sincroniza o estado do contexto sem depender dessa corrida.
  async function refreshProfile(userId) {
    const userProfile = await ensureUserProfile(userId)
    if (auth.currentUser?.uid === userId) setProfile(userProfile)
    return userProfile
  }

  async function refreshLegalAccess(userId = user?.uid) {
    if (!userId || auth.currentUser?.uid !== userId) return
    setLegalLoading(true)
    setLegalError('')
    try {
      const access = await getLegalAccess(userId)
      if (auth.currentUser?.uid === userId) setLegalAccess(access)
      return access
    } catch (error) {
      console.error('[Auth] getLegalAccess:', error)
      if (auth.currentUser?.uid === userId) {
        setLegalError('Não foi possível consultar a policy e as restrições atuais.')
      }
    } finally {
      if (auth.currentUser?.uid === userId) setLegalLoading(false)
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
        verifyingSession,
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
