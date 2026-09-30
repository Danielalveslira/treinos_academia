import { useEffect, useState } from 'react'
import { supabase } from '../supabase/config'

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

// public_profiles permite select autenticado pra qualquer linha, mas Realtime ainda
// precisa de um filtro por linha -- um channel por autor visível acompanha troca/remoção
// da foto sem multiplicar leituras por mensagem ou por seção (mesma estratégia de "um
// listener por autor" do onSnapshot original).
export function useCommunityAuthorAvatars(enabled, ...groups) {
  const idsKey = enabled ? JSON.stringify(uniqueCommunityAuthorIds(...groups)) : ''
  const [avatars, setAvatars] = useState({})

  useEffect(() => {
    setAvatars({})
    if (!idsKey) return
    const ids = JSON.parse(idsKey)

    let active = true
    Promise.all(
      ids.map((uid) =>
        supabase.from('public_profiles').select('avatar_path').eq('user_id', uid).maybeSingle()
      )
    ).then((results) => {
      if (!active) return
      setAvatars((current) => {
        const next = { ...current }
        results.forEach(({ data }, index) => {
          next[ids[index]] = data?.avatar_path || null
        })
        return next
      })
    })

    const channels = ids.map((uid) =>
      supabase
        .channel(`public-profiles-avatar-${uid}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'public_profiles', filter: `user_id=eq.${uid}` },
          (payload) => setAvatars((current) => ({ ...current, [uid]: payload.new?.avatar_path || null }))
        )
        .subscribe()
    )
    return () => {
      active = false
      channels.forEach((channel) => supabase.removeChannel(channel))
    }
  }, [idsKey])

  return avatars
}
