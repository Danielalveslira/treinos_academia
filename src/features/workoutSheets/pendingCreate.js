import { getWorkoutSheetByRequestId } from './workoutSheetsService.js'

// Reload-sem-duplicar (P0, auditoria 2026-11-10): se o usuário confirmar "saída sem salvar" do
// aviso do navegador enquanto uma criação está em voo, o requestId.current em memória se perde e
// um reload ingênuo mintaria um novo request_id -- duplicando a ficha quando a 1ª tentativa, na
// verdade, já tinha sido aceita no servidor. Guardamos o request_id pendente da ficha NOVA (nunca
// de uma edição existente, que não usa idempotency key) só para o MESMO uid+aba retomar a MESMA
// tentativa; create_workout_sheet() agora reconcilia o retry com o conteúdo atual do formulário
// em vez de descartá-lo (20261215000002), então retomar é seguro mesmo que o conteúdo tenha mudado.
const pendingCreateKey = (uid) => `evolutus:sheet:pendingCreate:${uid}`
export function readPendingCreateRequestId(uid) {
  try {
    return sessionStorage.getItem(pendingCreateKey(uid)) || null
  } catch {
    return null
  }
}
export function writePendingCreateRequestId(uid, value) {
  try {
    if (value) sessionStorage.setItem(pendingCreateKey(uid), value)
    else sessionStorage.removeItem(pendingCreateKey(uid))
  } catch {
    /* Best-effort only: losing this never duplicates a save, it only loses reload resumption. */
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// Confirma SHEET_NOT_FOUND com uma pequena tolerância -- nunca polling contínuo: um número fixo e
// pequeno de tentativas extras (~1,3s no total, por padrão). Um reload pode acontecer entre o
// servidor confirmar a criação original (INSERT já comitado) e o cliente sequer receber a
// resposta; uma única consulta imediata depois do reload não prova que a tentativa nunca
// aconteceu, só que ainda não tinha comitado NAQUELE instante (P0, continuação da auditoria
// 2026-11-10). Qualquer outro erro (rede, sessão) nunca é tratado como prova de inexistência --
// devolve 'check-failed' imediatamente, sem repetir. `fetchSheet`/`delays` são parâmetros só para
// o teste injetar um dublê e tempos zerados; produção sempre usa os padrões.
export async function resolvePendingCreate(
  requestId,
  { fetchSheet = getWorkoutSheetByRequestId, delays = [400, 900] } = {},
  attempt = 0
) {
  try {
    return { status: 'found', sheet: await fetchSheet(requestId) }
  } catch (error) {
    if (String(error?.message || '').includes('SHEET_NOT_FOUND')) {
      if (attempt < delays.length) {
        await sleep(delays[attempt])
        return resolvePendingCreate(requestId, { fetchSheet, delays }, attempt + 1)
      }
      return { status: 'confirmed-missing' }
    }
    return { status: 'check-failed', error }
  }
}
