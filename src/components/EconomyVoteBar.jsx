import { useEffect, useRef, useState } from 'react'
import { Box, Button, Text } from '@primer/react'
import { ThumbsupIcon, ThumbsdownIcon } from '@primer/octicons-react'
import { castVote } from '../services/economyService'
import { PostSupportersDialog } from './PostSupportersDialog'
import { economyVoteCountDelta } from '../utils/economyVoteCountDelta'

// Voto econômico (Fase 2) -- deliberadamente distinto do voto de ENQUETE (PollStatus,
// mais acima neste mesmo arquivo/StatusCard.jsx): custa EvoCoins, vive em
// statuses/{id}/economyVotes/{uid}, nunca em statuses/{id}/votes/{uid}.
//
// Reações da publicação: "Apoiar · X" e "Não apoiar · Y". Os totais (positiveVoteCount/
// negativeVoteCount) vêm denormalizados em statuses -- chegam de graça junto com o status, sem
// leitura extra por card. SÓ "Apoiar · X" abre a lista de pessoas (PostSupportersDialog, buscada
// apenas quando o modal abre); "Não apoiar · Y" é contador + ação, sem nenhuma lista -- a
// identidade de quem não apoiou não é exposta na UI nem no backend. Os votos individuais nunca
// são lidos direto (RLS em status_economy_votes só libera o próprio voto).
//
// myVote vem de fora (useMyEconomyVotes.js, 1 consulta para o feed inteiro) -- este
// componente nunca busca o próprio voto sozinho, exatamente pra não reintroduzir 1
// leitura por card (o padrão N+1 que useMyEconomyVotes existe pra evitar).
// undefined = ainda carregando o lote; null = carregado, sem voto; {value} = votou.
export function EconomyVoteBar({
  status,
  currentUserId,
  showToast,
  myVote,
  onVoted,
  onActionSuccess,
  interactionActive = true,
}) {
  const [myValue, setMyValue] = useState(myVote?.value ?? null)
  const [voting, setVoting] = useState(false)
  const [supportersOpen, setSupportersOpen] = useState(false)
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
      onActionSuccess?.()
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

  // Autor não vota na própria publicação (ver sem-auto-voto em vote-service.js) -- os botões de
  // reagir somem para ele, mas os totais continuam visíveis e o de apoios continua abrindo a lista.
  const isAuthor = status.authorId === currentUserId
  const loading = myVote === undefined
  const positiveCount = status.positiveVoteCount ?? 0
  const negativeCount = status.negativeVoteCount ?? 0
  const disabled = loading || voting || !interactionActive

  const supportersButton = (
    <Button
      variant="invisible"
      size="small"
      sx={{ color: 'fg.muted', px: 1 }}
      aria-label={`Ver quem apoiou (${positiveCount})`}
      onClick={() => setSupportersOpen(true)}
    >
      {isAuthor ? `Apoios · ${positiveCount}` : `· ${positiveCount}`}
    </Button>
  )

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      {!isAuthor && (
        <Button
          leadingVisual={ThumbsupIcon}
          aria-label="Apoiar"
          aria-pressed={myValue === 1}
          size="small"
          variant={myValue === 1 ? 'primary' : 'invisible'}
          disabled={disabled}
          onClick={() => vote(1)}
        >
          Apoiar
        </Button>
      )}
      {supportersButton}
      {!isAuthor && (
        <Button
          leadingVisual={ThumbsdownIcon}
          aria-label="Não apoiar"
          aria-pressed={myValue === -1}
          size="small"
          variant={myValue === -1 ? 'danger' : 'invisible'}
          disabled={disabled}
          onClick={() => vote(-1)}
        >
          Não apoiar
        </Button>
      )}
      {/* Só contador: sem botão, sem link, sem lista de pessoas. */}
      <Text sx={{ fontSize: 0, color: 'fg.muted', px: 1 }} data-testid="non-support-count">
        {isAuthor ? `Não apoiar · ${negativeCount}` : `· ${negativeCount}`}
      </Text>
      {!isAuthor && myValue != null && (
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
          {myValue === 1 ? 'Você apoiou' : 'Você não apoiou'}
        </Text>
      )}
      {supportersOpen && (
        <PostSupportersDialog
          statusId={status.id}
          supportCount={positiveCount}
          onClose={() => setSupportersOpen(false)}
        />
      )}
    </Box>
  )
}
