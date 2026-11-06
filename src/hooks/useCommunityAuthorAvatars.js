import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase/config'
import { createBatchLoader } from '../utils/batchLoader'
import { onPageCacheClear } from '../utils/pageCache'

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

// Quantos autores por consulta: mantém a URL curta sem limitar quantos autores o feed pode ter.
const AVATAR_BATCH_SIZE = 40
// Os autores do feed, dos treinos futuros e dos destaques chegam em momentos diferentes (3 leituras em
// paralelo): uma janela curta junta tudo numa consulta só em vez de uma por chegada.
const AVATAR_COALESCE_MS = 40

// Avatar público do autor (public_profiles é legível por qualquer usuário autenticado): memorizado
// por autor pela SESSÃO inteira (compartilhado entre comunidades e páginas do feed) e buscado só para
// os autores que ainda não se conhecem, em lote (.in), em vez de 1 consulta + 1 canal Realtime por
// autor. Autor sem foto fica registrado como null: nunca é consultado de novo. Uma foto trocada
// aparece na próxima abertura da tela (não há mais um canal por autor só para isso).
const avatarPaths = new Map()
const avatarOverrides = new Map()
const avatarListeners = new Set()
// Trocou de conta/encerrou a sessão: nada da sessão anterior fica em memória.
onPageCacheClear(() => {
  avatarPaths.clear()
  avatarOverrides.clear()
})

export function setCommunityAuthorAvatar(userId, path) {
  avatarOverrides.set(userId, path || null)
  avatarPaths.set(userId, path || null)
  for (const listener of avatarListeners) listener()
}

const avatarLoader = createBatchLoader(
  async (ids) => {
    const { data, error } = await supabase
      .from('public_profiles')
      .select('user_id,avatar_path')
      .in('user_id', ids)
    if (error) throw error
    ids.forEach((id) =>
      avatarPaths.set(id, avatarOverrides.has(id) ? avatarOverrides.get(id) : null)
    )
    data.forEach((row) =>
      avatarPaths.set(
        row.user_id,
        avatarOverrides.has(row.user_id)
          ? avatarOverrides.get(row.user_id)
          : row.avatar_path || null
      )
    )
    return new Map(ids.map((id) => [id, avatarPaths.get(id)]))
  },
  { maxBatch: AVATAR_BATCH_SIZE, delayMs: AVATAR_COALESCE_MS }
)

function fetchMissingAvatars(ids) {
  return Promise.all(ids.filter((id) => !avatarPaths.has(id)).map((id) => avatarLoader.load(id)))
}

export function useCommunityAuthorAvatars(enabled, ...groups) {
  const idsKey = enabled ? JSON.stringify(uniqueCommunityAuthorIds(...groups)) : ''
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const listener = () => setVersion((value) => value + 1)
    avatarListeners.add(listener)
    return () => avatarListeners.delete(listener)
  }, [])

  useEffect(() => {
    if (!idsKey) return undefined
    const missing = JSON.parse(idsKey).filter((id) => !avatarPaths.has(id))
    if (missing.length === 0) return undefined
    let active = true
    fetchMissingAvatars(missing)
      .then(() => active && setVersion((value) => value + 1))
      .catch((error) => console.error('[useCommunityAuthorAvatars]', error))
    return () => {
      active = false
    }
  }, [idsKey])

  return useMemo(() => {
    const result = {}
    if (idsKey)
      for (const id of JSON.parse(idsKey)) if (avatarPaths.has(id)) result[id] = avatarPaths.get(id)
    return result
    // version: o Map muda por fora do React; o contador avisa que há avatares novos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, version])
}

// Só para testes.
export function resetAuthorAvatarCache() {
  avatarPaths.clear()
  avatarOverrides.clear()
}
