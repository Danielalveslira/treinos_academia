import { useSyncExternalStore } from 'react'

// `navigator.onLine` é só uma dica (ver services/offline/connectivity.js): serve para a UI mostrar o
// aviso discreto e travar o que EXIGE servidor (finalizar treino). A prova de acesso é o envio real.
function subscribe(callback) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

export function useOnlineStatus() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine !== false,
    () => true
  )
}
