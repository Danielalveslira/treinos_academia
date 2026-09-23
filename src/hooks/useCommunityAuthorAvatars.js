import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'

export function uniqueCommunityAuthorIds(...groups) {
  return [
    ...new Set(
      groups
        .flat()
        .map((status) => status?.authorId)
        .filter(Boolean)
    ),
  ].sort()
}

// publicProfiles permite get autenticado, mas não list. Um listener por autor visível
// acompanha troca/remoção da foto sem multiplicar leituras por mensagem ou por seção.
export function useCommunityAuthorAvatars(enabled, ...groups) {
  const idsKey = enabled ? JSON.stringify(uniqueCommunityAuthorIds(...groups)) : ''
  const [avatars, setAvatars] = useState({})

  useEffect(() => {
    setAvatars({})
    if (!idsKey) return
    const unsubscribers = JSON.parse(idsKey).map((uid) =>
      onSnapshot(
        doc(db, 'publicProfiles', uid),
        (snapshot) =>
          setAvatars((current) => ({ ...current, [uid]: snapshot.data()?.avatarPath || null })),
        () => setAvatars((current) => ({ ...current, [uid]: null }))
      )
    )
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [idsKey])

  return avatars
}
