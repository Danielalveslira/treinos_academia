import { isOfflineColdStartEnabled } from './database.js'

// Máquina de estados do BOOT, fora do React: o PwaControls fica FORA do AuthProvider (main.jsx) e precisa
// saber se a restauração local já terminou antes de decidir mostrar "Você está sem conexão".
//
//   initializing        -> o AuthContext ainda está hidratando (IndexedDB: bootstrap, snapshot, rollout)
//   online_ready        -> sessão resolvida com rede (ou build sem cold start: nada a esperar)
//   offline_ready       -> aberto offline a partir do bootstrap local válido (cold start)
//   offline_unavailable -> resolvido SEM rede e SEM cold start válido (aí sim o bloqueio é legítimo)
//
// Sem rótulo de tempo: quem muda o estado é o fim real da restauração, nunca um timeout.
export const BOOT_STATE = Object.freeze({
  initializing: 'initializing',
  onlineReady: 'online_ready',
  offlineReady: 'offline_ready',
  offlineUnavailable: 'offline_unavailable',
})

// Builds sem cold start não têm o que restaurar: o comportamento anterior (decidir na hora) é preservado.
let state = isOfflineColdStartEnabled() ? BOOT_STATE.initializing : BOOT_STATE.onlineReady
const listeners = new Set()

export function getBootState() {
  return state
}

export function setBootState(next) {
  if (next === state) return
  state = next
  for (const listener of listeners) listener()
}

export function subscribeBootState(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Estado final a partir do que o AuthContext sabe. `localDenied`: a restauração local já terminou e NÃO
// havia cold start válido (não precisa esperar o auth-js, que offline com token vencido insiste em
// renovar por dezenas de segundos).
export function resolveBootState({ loading, authMode, localDenied = false, onLine = true }) {
  if (authMode === 'offline-local' && !loading) return BOOT_STATE.offlineReady
  if (loading && !localDenied) return BOOT_STATE.initializing
  return onLine === false ? BOOT_STATE.offlineUnavailable : BOOT_STATE.onlineReady
}
