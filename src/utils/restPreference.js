import { configuredRestSeconds, formatRestDuration, resolveRestSeconds } from './restTimer.js'

// Resumo para o cabeçalho da seção no Perfil: "1min30s (padrão)", "1min", "Sem descanso".
export function restPreferenceSummary(defaultRestSeconds) {
  const stored = configuredRestSeconds(defaultRestSeconds)
  const label = formatRestDuration(resolveRestSeconds(null, stored))
  return stored === null ? `${label} (padrão)` : label
}

// Recurso ausente no servidor (migration ainda não aplicada no banco): função ou coluna inexistente.
const MISSING_ON_SERVER = new Set(['PGRST202', 'PGRST204', '42883', '42703'])

// Mensagem fiel à causa — "tente novamente" só quando tentar de novo pode resolver.
export function restSaveErrorText(error) {
  if (globalThis.navigator?.onLine === false) return 'Sem conexão. A preferência não foi salva.'
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  if (MISSING_ON_SERVER.has(code))
    return 'Esta configuração ainda não está disponível no servidor. Nada foi salvo.'
  if (message.includes('INVALID_REST_SECONDS')) return 'Valor recusado: use de 0 a 900 segundos.'
  if (/NOT_AUTHENTICATED|FORBIDDEN|JWT/.test(message) || ['401', '403', '42501'].includes(code))
    return 'Sua sessão não permite salvar agora. Entre novamente.'
  return 'Não foi possível salvar. Tente novamente.'
}
