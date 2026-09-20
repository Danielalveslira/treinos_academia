import { useEffect, useRef, useState } from 'react'
import { resolveUsernamesByIds } from '../services/cashPurchaseService'

// Cache cumulativo -- só busca IDs ainda não resolvidos, mesmo depois de "carregar mais
// compras" ou trocar de filtro (nunca perde o que já foi resolvido antes, nunca refaz a
// mesma leitura duas vezes). A dependência do efeito é a lista de IDs serializada, não o
// array em si -- o array muda de referência a cada render de `purchases`, mas o
// CONTEÚDO só muda quando a página realmente carrega compradores novos.
export function useUsernamesByIds(userIds) {
  const key = userIds.join(',')
  const [usernameById, setUsernameById] = useState({})
  const resolvedRef = useRef(new Set())

  useEffect(() => {
    const pending = [...new Set(userIds)].filter((id) => id && !resolvedRef.current.has(id))
    if (pending.length === 0) return
    pending.forEach((id) => resolvedRef.current.add(id))
    let active = true
    resolveUsernamesByIds(pending).then((result) => {
      if (active) setUsernameById((previous) => ({ ...previous, ...result }))
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` já resume o array
  }, [key])

  return usernameById
}
