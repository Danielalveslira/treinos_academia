import { isOfflineColdStartEnabled } from './database.js'

// Ponto único (leve, no bundle de boot) para gravar o snapshot da Home quando um dado ONLINE chega do
// servidor com sucesso. O módulo que de fato grava (homeSnapshot.js) só é carregado na primeira gravação.
// Fire-and-forget: UI nunca espera o disco e uma falha nunca vira erro de tela. Só com o cold start ligado no
// build -- sem ele o snapshot nunca seria lido.
//   patch: { wallet?, daily_coins?, progress? } (ver homeSnapshot.js)
export function persistHomeSnapshot(userId, patch) {
  if (!userId || !patch || !isOfflineColdStartEnabled()) return
  const at = Date.now()
  import('./homeSnapshot.js')
    .then((module) => module.saveHomeSnapshot(userId, patch, { at }))
    .catch(() => {})
}
