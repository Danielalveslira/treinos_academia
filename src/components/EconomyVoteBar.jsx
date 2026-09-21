import { useEffect, useRef, useState } from 'react'
import { Box, Button, IconButton, Text } from '@primer/react'
import { ThumbsupIcon, ThumbsdownIcon } from '@primer/octicons-react'
import { castVote } from '../services/economyService'
import { EconomyVotersDialog } from './EconomyVotersDialog'
import { economyVoteCountDelta } from '../utils/economyVoteCountDelta'

// Voto econômico (Fase 2) -- deliberadamente distinto do voto de ENQUETE (PollStatus,
// mais acima neste mesmo arquivo/StatusCard.jsx): custa EvoCoins, vive em
// statuses/{id}/economyVotes/{uid}, nunca em statuses/{id}/votes/{uid}.
//
// "Ver quem votou": os totais (positiveVoteCount/negativeVoteCount) são denormalizados
// em statuses/{id} por um gatilho (ver vote-count-service.js/functions/index.js) --
// chegam de graça junto com o resto do status, sem nenhuma leitura extra por card. Os
// votos individuais continuam nunca expostos direto (a regra só libera leitura do
// próprio voto, ver firestore.rules); clicar num total abre EconomyVotersDialog, que
// busca a lista sanitizada via a callable dedicada listPostEconomyVoters.
//
// myVote vem de fora (useMyEconomyVotes.js, 1 consulta para o feed inteiro) -- este
// componente nunca busca o próprio voto sozinho, exatamente pra não reintroduzir 1
// leitura de Firestore por card (o padrão N+1 que useMyEconomyVotes existe pra evitar).
// undefined = ainda carregando o lote; null = carregado, sem voto; {value} = votou.
export function EconomyVoteBar({ status, currentUserId, showToast, myVote, onVoted }) {
  const [myValue, setMyValue] = useState(myVote?.value ?? null)
  const [voting, setVoting] = useState(false)
  const [openVotersDialog, setOpenVotersDialog] = useState(null) // null | 'positive' | 'negative'
  // Só sincroniza com a prop ENQUANTO o lote ainda não chegou -- depois que o próprio
  // usuário vota nesta publicação, o estado local passa a mandar (a prop só volta a
  // mudar numa refetch do lote inteiro, que não deveria sobrescrever um voto já aplicado
  // localmente).
  const initializedRef = useRef(myVote !== undefined)

  useEffect(() => {
    if (initializedRef.current || myVote === undefined) return
    initializedRef.current = true
    setMyValue(myVote?.value ?? null)
  }, [myVote])

  async function vote(value) {
    if (voting) return
    // Clicar de novo no mesmo botão remove o voto; o outro botão troca/cria.
    const nextValue = myValue === value ? null : value
    setVoting(true)
    try {
      await castVote(status.id, nextValue)
      // Delta calculado só DEPOIS do backend confirmar sucesso -- nunca antes (sem
      // optimistic update, ver auditoria: o backend é quem decide se a ação realmente
      // aconteceu). myValue (ainda o valor ANTERIOR aqui) é a transição real aplicada.
      const delta = economyVoteCountDelta(myValue, nextValue)
      setMyValue(nextValue)
      onVoted?.(nextValue, delta)
    } catch (error) {
      console.error('[EconomyVoteBar] castVote:', error)
      showToast?.(
        error?.message || 'Não foi possível registrar seu voto. Tente novamente.',
        'danger'
      )
    } finally {
      setVoting(false)
    }
  }

  // Autor não vota na própria publicação (ver sem-auto-voto em vote-service.js) -- os
  // botões de votar somem para ele, mas os totais continuam visíveis e clicáveis (é
  // o dono do post quem mais tem motivo de querer ver quem apoiou/discordou).
  const isAuthor = status.authorId === currentUserId
  const loading = myVote === undefined
  const positiveCount = status.positiveVoteCount ?? 0
  const negativeCount = status.negativeVoteCount ?? 0

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      {!isAuthor && (
        <>
          <IconButton
            icon={ThumbsupIcon}
            aria-label="Voto positivo"
            aria-pressed={myValue === 1}
            size="small"
            variant={myValue === 1 ? 'primary' : 'invisible'}
            disabled={loading || voting}
            onClick={() => vote(1)}
          />
          <IconButton
            icon={ThumbsdownIcon}
            aria-label="Voto negativo"
            aria-pressed={myValue === -1}
            size="small"
            variant={myValue === -1 ? 'danger' : 'invisible'}
            disabled={loading || voting}
            onClick={() => vote(-1)}
          />
        </>
      )}
      <Button
        variant="invisible"
        size="small"
        sx={{ color: 'fg.muted', px: 1 }}
        onClick={() => setOpenVotersDialog('positive')}
      >
        👍 {positiveCount} {positiveCount === 1 ? 'apoio' : 'apoios'}
      </Button>
      <Button
        variant="invisible"
        size="small"
        sx={{ color: 'fg.muted', px: 1 }}
        onClick={() => setOpenVotersDialog('negative')}
      >
        👎 {negativeCount} {negativeCount === 1 ? 'negativo' : 'negativos'}
      </Button>
      {!isAuthor && myValue != null && (
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
          {myValue === 1 ? 'Você apoiou' : 'Você discordou'}
        </Text>
      )}
      {openVotersDialog && (
        <EconomyVotersDialog
          statusId={status.id}
          initialDirection={openVotersDialog}
          positiveCount={positiveCount}
          negativeCount={negativeCount}
          onClose={() => setOpenVotersDialog(null)}
        />
      )}
    </Box>
  )
}
