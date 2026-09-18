import { useEffect, useRef, useState } from 'react'
import { Box, IconButton, Text } from '@primer/react'
import { ThumbsupIcon, ThumbsdownIcon } from '@primer/octicons-react'
import { castVote } from '../services/economyService'

// Voto econômico (Fase 2) -- deliberadamente distinto do voto de ENQUETE (PollStatus,
// mais acima neste mesmo arquivo/StatusCard.jsx): custa EvoCoins, vive em
// statuses/{id}/economyVotes/{uid}, nunca em statuses/{id}/votes/{uid}. Sem exibir
// contagem agregada (quem votou o quê): a regra só libera leitura do próprio voto (ver
// firestore.rules), então esta barra só mostra "o que EU votei", não um placar público.
//
// myVote vem de fora (useMyEconomyVotes.js, 1 consulta para o feed inteiro) -- este
// componente nunca busca o próprio voto sozinho, exatamente pra não reintroduzir 1
// leitura de Firestore por card (o padrão N+1 que useMyEconomyVotes existe pra evitar).
// undefined = ainda carregando o lote; null = carregado, sem voto; {value} = votou.
export function EconomyVoteBar({ status, currentUserId, showToast, myVote, onVoted }) {
  const [myValue, setMyValue] = useState(myVote?.value ?? null)
  const [voting, setVoting] = useState(false)
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
      await castVote(currentUserId, status.id, nextValue)
      setMyValue(nextValue)
      onVoted?.(nextValue)
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

  // Autor não vota na própria publicação (ver sem-auto-voto em vote-service.js) -- nem
  // vale a pena mostrar os botões, já que a Function sempre recusaria.
  if (status.authorId === currentUserId) return null

  const loading = myVote === undefined
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
      {myValue != null && (
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
          {myValue === 1 ? 'Você apoiou' : 'Você discordou'}
        </Text>
      )}
    </Box>
  )
}
