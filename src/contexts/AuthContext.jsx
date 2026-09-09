import { createContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/config'
import { ensureUserProfile, setUsername, updateUserProfile } from '../services/usersService'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    let revision = 0
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const current = ++revision
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
        if (active && current === revision) setProfile(userProfile)
      } catch (err) {
        console.error('[Auth] ensureUserProfile:', err)
      } finally {
        if (active && current === revision) setLoading(false)
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const isSuperAdmin = profile?.role === 'superadmin'

  async function saveProfile(changes) {
    const userId = user.uid
    const patch = await updateUserProfile(userId, changes)
    setProfile((prev) => (prev?.id === userId ? { ...prev, ...patch } : prev))
    return patch
  }

  async function claimUsername(rawUsername) {
    const userId = user.uid
    const username = await setUsername(userId, rawUsername)
    setProfile((prev) => (prev?.id === userId ? { ...prev, username } : prev))
    return username
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
      value={{ user, profile, isSuperAdmin, loading, claimUsername, refreshProfile, saveProfile }}
    >
      {children}
    </AuthContext.Provider>
  )
}
