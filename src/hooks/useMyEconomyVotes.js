import { useCallback } from 'react'
import { getMyEconomyVotesForStatuses } from '../services/economyService'
import { useCachedQuery } from './useCachedQuery'

// Evita o padrão N+1 de abrir um feed com N publicações e disparar N round-trips (um
// getDoc por card) só pra saber "eu votei em quê": 1 única consulta/round-trip para todo
// o conjunto de statusIds atualmente carregado (ver getMyEconomyVotesForStatuses),
// reaproveitando o mesmo cache de sessão (fetchCached) já usado por
// useSponsoredAds/useCommunityFeed. O custo em DOCUMENT READS dessa consulta escala com
// quantos posts da página o usuário realmente votou, não com N -- ver o comentário
// detalhado em getMyEconomyVotesForStatuses (economyService.js) sobre esse ponto.
// setVote faz a atualização otimista local depois de um voto, sem refazer a consulta.
export function useMyEconomyVotes(statusIds, uid) {
  const key = `myEconomyVotes:${uid}:${statusIds.join(',')}`
  const fetchVotes = useCallback(
    () => getMyEconomyVotesForStatuses(uid, statusIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid, statusIds.join(',')]
  )
  const {
    data: votesByStatusId,
    loading,
    setData,
  } = useCachedQuery(key, fetchVotes, {
    enabled: Boolean(uid) && statusIds.length > 0,
    context: 'useMyEconomyVotes',
  })

  function setVote(statusId, value) {
    const next = { ...votesByStatusId }
    if (value == null) delete next[statusId]
    else next[statusId] = { value }
    setData(next)
  }

  // votesByStatusId fica undefined enquanto o lote ainda não chegou -- de propósito,
  // não um {} vazio: EconomyVoteBar usa essa distinção para saber se já pode mostrar
  // "sem voto" ou se ainda deveria aguardar (ver loading ali).
  return { votesByStatusId, loading, setVote }
}
