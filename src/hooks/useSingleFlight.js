import { useCallback, useRef, useState } from 'react'

// Garante UMA execução por chave enquanto a anterior não terminar: o ciclo é
// idle -> loading -> (sucesso | erro) -> idle. O guard é um ref (síncrono) e não só o state,
// porque dois toques no mesmo frame leem o mesmo state "idle" antes do re-render.
// Erros continuam propagando para quem chamou -- aqui só se evita a execução duplicada e se
// libera a chave em qualquer desfecho. Chamadas ignoradas devolvem `undefined`.
export function useSingleFlight() {
  const inFlight = useRef(new Set())
  const [busyKeys, setBusyKeys] = useState(() => new Set())

  const run = useCallback(async (key, task) => {
    if (inFlight.current.has(key)) return undefined
    inFlight.current.add(key)
    setBusyKeys(new Set(inFlight.current))
    try {
      return await task()
    } finally {
      inFlight.current.delete(key)
      setBusyKeys(new Set(inFlight.current))
    }
  }, [])

  const isBusy = useCallback((key) => busyKeys.has(key), [busyKeys])
  return { run, isBusy, busy: busyKeys.size > 0 }
}
