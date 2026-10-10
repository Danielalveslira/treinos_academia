// Configuração de BUILD (nada consulta o servidor para decidir). Desligado = o Dashboard continua com a
// saudação anterior (utils/greeting.js) e não executa nenhuma RPC nova.
export const GREETING_V2_ENABLED = import.meta.env?.VITE_GREETING_V2_ENABLED === 'true'

// Corte das boas-vindas: só contas criadas A PARTIR deste instante recebem a primeira recepção. Valor FIXO
// da release (ISO-8601 com fuso, ex.: 2026-10-24T00:00:00-03:00), nunca "agora" calculado no carregamento.
// Ausente ou inválido => ninguém é elegível (falha segura: não dá "bem-vindo" a membros antigos).
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

export function parseWelcomeCutoff(value) {
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value.trim())) return null
  const ms = Date.parse(value.trim())
  return Number.isFinite(ms) ? ms : null
}

export const GREETING_WELCOME_FROM_MS = parseWelcomeCutoff(
  import.meta.env?.VITE_GREETING_WELCOME_FROM
)
