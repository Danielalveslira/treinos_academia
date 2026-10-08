// Realtime não deve ficar tentando abrir WebSocket sem rede: cada tentativa falha, agenda outra com
// backoff e só gasta bateria/dados. Offline desligamos o socket (os canais continuam registrados) e
// impedimos que um novo `subscribe()` o reabra; ao voltar a rede, reconectamos e os canais reentram.
// `target` e `client` são injetáveis para teste.
export function pauseRealtimeWhenOffline(client, target = globalThis) {
  const realtime = client?.realtime
  if (!realtime || realtime.__offlinePause) return () => {}
  realtime.__offlinePause = true
  const isOffline = () => target.navigator?.onLine === false
  const original = realtime.connect
  const connect = original.bind(realtime)
  realtime.connect = () => (isOffline() ? undefined : connect())
  const pause = () => {
    try {
      Promise.resolve(realtime.disconnect()).catch(() => {})
    } catch { /* socket já fechado */ }
  }
  const resume = () => {
    if (realtime.channels?.length) realtime.connect()
  }
  target.addEventListener('offline', pause)
  target.addEventListener('online', resume)
  if (isOffline()) pause()
  return () => {
    target.removeEventListener('offline', pause)
    target.removeEventListener('online', resume)
    realtime.connect = original
    delete realtime.__offlinePause
  }
}
