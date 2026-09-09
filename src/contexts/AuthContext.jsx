import { createContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/config'
import { ensureUserProfile } from '../services/usersService'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (!firebaseUser) {
        if (active) {
          setProfile(null)
          setLoading(false)
        }
        return
      }
      try {
        const userProfile = await ensureUserProfile(firebaseUser.uid)
        if (active) setProfile(userProfile)
      } catch (err) {
        console.error('[Auth] ensureUserProfile:', err)
      } finally {
        if (active) setLoading(false)
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const isSuperAdmin = profile?.role === 'superadmin'

  return (
    <AuthContext.Provider value={{ user, profile, isSuperAdmin, loading }}>
      {children}
    </AuthContext.Provider>
  )
}
