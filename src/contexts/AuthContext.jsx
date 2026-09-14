import { createContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { ensureUserProfile, updateUserProfile } from '../services/usersService'
import { logoutUser } from '../services/authService'
import { isAccountGoneError } from '../utils/authErrors'
import { clearPageCache } from '../utils/pageCache'
import { clearPhotoCache } from '../utils/photoBlobCache'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // Só true durante a checagem de "sessão fantasma" abaixo — cobre o intervalo entre
  // perceber o permission-denied e confirmar (via getIdToken(true)) que a conta já não
  // existe mais. ProtectedRoute mostra um spinner nesse meio-tempo em vez de qualquer
  // tela protegida (LegalGate incluso), pra nunca chegar a renderizar "Documentos para
  // continuar" pra uma conta que o servidor já sabe que não existe.
  const [verifyingSession, setVerifyingSession] = useState(false)

  useEffect(() => {
    let active = true
    let revision = 0
    let unsubscribeProfile = null

    // Perfil e regras negam a própria leitura (permission-denied) só acontece, na
    // prática, quando a conta foi excluída/desabilitada por um admin em outra sessão
    // (ver deletionJobs/account_{uid}, a "lápide" permanente em firestore.rules que
    // bloqueia esse uid pra sempre) — nunca em uso normal, já que as regras sempre
    // permitem ler o próprio perfil. getIdToken(true) confirma isso do jeito que o
    // próprio Firebase recomenda: se o token não renovar, a conta é mesmo inexistente/
    // desabilitada no servidor, e a sessão local precisa encerrar — sem isso, o app
    // ficava "logado" (token em cache ainda parece válido) só descobrindo aos poucos,
    // tela por tela, que cada leitura é negada.
    async function handlePossibleGhostSession(firebaseUser, error, forRevision) {
      if (error?.code !== 'permission-denied') return
      setVerifyingSession(true)
      try {
        await firebaseUser.getIdToken(true)
        // Token renovou normalmente — não era uma conta excluída, foi outra causa
        // (ex.: uma restrição temporária). Não desloga; deixa a tela atual lidar com
        // esse erro do jeito que já faz hoje (mensagem genérica, botão de tentar de novo).
      } catch (refreshError) {
        if (isAccountGoneError(refreshError)) {
          console.warn('[Auth] conta não existe mais no servidor, encerrando sessão local:', refreshError)
          if (active && revision === forRevision) await logoutUser().catch(() => {})
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
      const current = ++revision
      unsubscribeProfile?.()
      unsubscribeProfile = null
      setUser(firebaseUser)
      setProfile(null)
      setLoading(true)
      if (!firebaseUser) {
        if (active) {
          setProfile(null)
          setLoading(false)
        }
        return
      }
      try {
        const userProfile = await ensureUserProfile(firebaseUser.uid)
        if (active && current === revision) {
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
              if (active && current === revision) handlePossibleGhostSession(firebaseUser, error, current)
            }
          )
        }
      } catch (err) {
        console.error('[Auth] ensureUserProfile:', err)
        if (active && current === revision) await handlePossibleGhostSession(firebaseUser, err, current)
      } finally {
        if (active && current === revision) setLoading(false)
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

  return (
    <AuthContext.Provider
      value={{ user, profile, isSuperAdmin, loading, verifyingSession, refreshProfile, saveProfile }}
    >
      {children}
    </AuthContext.Provider>
  )
}
