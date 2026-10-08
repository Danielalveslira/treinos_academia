import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMyEconomyVotesForStatuses } from '../services/economyService'
import { getCached, setCached } from '../utils/pageCache'

// Evita o padrão N+1 de abrir um feed com N publicações e disparar N round-trips só pra saber "eu
// votei em quê": 1 consulta por LOTE de ids (ver getMyEconomyVotesForStatuses). É INCREMENTAL: quando
// o feed ganha uma nova página, só os ids novos são consultados (antes a chave mudava e TODOS os ids
// eram relidos, deixando os botões de reação desabilitados durante a recarga).
//
// O mapa devolvido tem uma entrada por id já consultado: { value } se votei, null se não votei;
// um id ainda não consultado fica undefined, que é o "carregando" que EconomyVoteBar entende.
// Guardado na cache de sessão (memória, por usuário): voltar à comunidade não consulta de novo.
export function useMyEconomyVotes(statusIds, uid) {
  const cacheKey = `myEconomyVotes:${uid}`
  const [store, setStore] = useState(() => getCached(cacheKey) ?? {})
  const requested = useRef(new Set())
  const idsKey = statusIds.join(',')

  useEffect(() => {
    if (!uid || !idsKey) return undefined
    const missing = idsKey.split(',').filter((id) => !(id in store) && !requested.current.has(id))
    if (missing.length === 0) return undefined
    missing.forEach((id) => requested.current.add(id))
    let active = true
    getMyEconomyVotesForStatuses(uid, missing)
      .then((votes) => {
        const loaded = Object.fromEntries(missing.map((id) => [id, votes[id] ?? null]))
        setStore((previous) => {
          const next = { ...previous, ...loaded }
          setCached(cacheKey, next)
          return next
        })
      })
      .catch((error) => {
        // Sem a leitura os botões ficam desabilitados ("carregando"); uma nova página ou um refresh
        // tenta de novo esses ids.
        missing.forEach((id) => requested.current.delete(id))
        if (active) console.error('[useMyEconomyVotes]', error)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, idsKey])

  const setVote = useCallback(
    (statusId, value) => {
      setStore((previous) => {
        const next = { ...previous, [statusId]: value == null ? null : { value } }
        setCached(cacheKey, next)
        return next
      })
    },
    [cacheKey]
  )

  // undefined enquanto nenhum id foi consultado ainda (mesma distinção de antes).
  const votesByStatusId = useMemo(() => (uid && idsKey ? store : undefined), [store, uid, idsKey])
  return { votesByStatusId, setVote }
}
