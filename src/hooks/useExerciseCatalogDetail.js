import { useEffect, useRef, useState } from 'react'
import { getExerciseDetail } from '../services/exerciseCatalogService.js'

// Detalhe de UM exercício (imagens/instruções/músculos) do nosso catálogo -- usado por
// WorkoutExerciseGuide.jsx (execução durante o treino) e ExerciseDetail.jsx (histórico).
// Nunca carrega o catálogo inteiro só pra mostrar um exercício. Prefere catalogId (PK
// direta); cai pra provider+providerExerciseId quando o item foi salvo antes do FK
// existir ou a linha do catálogo foi recriada.
//
// Se o catálogo não tiver mais o item (removido/desativado numa reimportação), a
// tela nunca trava: o treino/histórico continua utilizável com o snapshot básico
// (nome/grupo muscular/equipamento, já salvos em public.exercises) -- só o conteúdo
// rico (instruções) fica ausente, com um estado amigável.
export function useExerciseCatalogDetail(
  { catalogId, provider, providerExerciseId } = {},
  { enabled = true } = {}
) {
  const hasReference = Boolean(catalogId || (provider && providerExerciseId))
  const [state, setState] = useState({ data: null, loading: enabled && hasReference, unavailable: false })
  const revision = useRef(0)

  useEffect(() => {
    if (!enabled || !hasReference) {
      setState({ data: null, loading: false, unavailable: false })
      return
    }
    const request = ++revision.current
    setState((previous) => ({ ...previous, loading: true }))

    getExerciseDetail({ catalogId, provider, providerExerciseId })
      .then((data) => {
        if (request !== revision.current) return
        setState({ data, loading: false, unavailable: !data })
      })
      .catch((error) => {
        if (request !== revision.current) return
        console.error('[useExerciseCatalogDetail]', catalogId || providerExerciseId, error)
        setState({ data: null, loading: false, unavailable: true })
      })

    return () => {
      revision.current += 1
    }
  }, [enabled, hasReference, catalogId, provider, providerExerciseId])

  return state
}
