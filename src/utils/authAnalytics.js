import { track } from '@vercel/analytics'

// Eventos do fluxo de Auth (P7 do prompt de reestruturação). Nomes fixos para manter os
// painéis estáveis; nenhuma propriedade aqui pode carregar e-mail, senha, token, código,
// URL de recuperação ou qualquer identificador correlacionável -- só o nome do evento e,
// quando necessário, um motivo/estado curto e genérico (ex.: código de erro, nome do fluxo).
const AUTH_EVENTS = new Set([
  'signup_requested',
  'verification_required',
  'otp_verified',
  'onboarding_completed',
  'recovery_requested',
  'password_changed',
  'session_revocation_pending',
  'auth_access_denied',
  'captcha_failed',
  'auth_rate_limited',
])

export function trackAuthEvent(name, properties) {
  if (!AUTH_EVENTS.has(name)) throw new Error(`Evento de auth desconhecido: ${name}`)
  track(name, properties)
}

const RATE_LIMIT_CODES = new Set(['over_request_rate_limit', 'over_email_send_rate_limit'])
// Negações estruturais de autorização (P1): gate de sessão restrita, prova de senha do
// signup-password-sync, ou "permission denied" do Postgres (42501) por trás de qualquer RPC.
const ACCESS_DENIED_CODES = new Set([
  'SIGNUP_UNEXPECTED_SESSION',
  'AUTH_SCOPE_UNAVAILABLE',
  'PASSWORD_SYNC_FAILED',
  'PASSWORD_PROOF_REQUIRED',
  'SESSION_REVOCATION_REQUIRED',
  'ONBOARDING_SESSION_REQUIRED',
  'SESSION_REVOKED',
  '42501',
])

// Chamado nos mesmos pontos onde translateAuthError(err) já roda -- não duplica o
// tratamento de erro, só observa o código (nunca a mensagem, nunca dado do usuário).
export function reportAuthOutcome(err) {
  const code = err?.code
  if (typeof code !== 'string') return
  if (RATE_LIMIT_CODES.has(code)) trackAuthEvent('auth_rate_limited', { code })
  else if (ACCESS_DENIED_CODES.has(code)) trackAuthEvent('auth_access_denied', { code })
}
