import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createRest,
  extendRest,
  loadStoredRest,
  REST_DONE_DISPLAY_MS,
  saveStoredRest,
} from '../utils/restTimer.js'

// Um único descanso ativo por sessão de treino. O estado só muda ao iniciar, acrescentar, pular ou
// expirar — nunca a cada segundo (o tique visual fica isolado em RestTimer.jsx). `scope` identifica a
// sessão (usuário + ficha + dia); sem scope (edição de histórico) o cronômetro fica desligado.
// `persist: false` mantém a mesma contagem apenas em memória para a demonstração pública.
//
// Nenhuma função daqui lança: uma falha do cronômetro nunca pode atrapalhar o registro da série.
export function useRestTimer(scope, { persist = true } = {}) {
  const [rest, setRest] = useState(() => (scope && persist ? loadStoredRest(scope) : null))
  const restRef = useRef(rest)

  const commit = useCallback((next) => {
    restRef.current = next
    setRest(next)
    if (persist) saveStoredRest(next)
  }, [persist])

  const start = useCallback(
    ({ exerciseId, setKey, restSeconds }) => {
      try {
        // Concluir qualquer série encerra o descanso anterior; o novo só existe se estiver ativado.
        commit(createRest({ scope, exerciseId, setKey, restSeconds }))
      } catch {
        // Cronômetro é auxiliar.
      }
    },
    [scope, commit]
  )

  const extend = useCallback(() => {
    if (restRef.current) commit(extendRest(restRef.current))
  }, [commit])

  const stop = useCallback(() => {
    if (restRef.current) commit(null)
  }, [commit])

  // Retira o indicador depois de exibir "Descanso concluído". Um único timeout, rearmado só quando a
  // contagem muda; se o navegador o atrasar (aba suspensa), o visual já mostra o estado certo.
  useEffect(() => {
    if (!rest) return undefined
    const timeout = setTimeout(
      () => {
        if (restRef.current === rest) commit(null)
      },
      Math.max(0, rest.endsAt - Date.now()) + REST_DONE_DISPLAY_MS
    )
    return () => clearTimeout(timeout)
  }, [rest, commit])

  return { rest, start, extend, stop }
}
