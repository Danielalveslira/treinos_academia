// Runs only after GoTrue has issued a restricted signup OTP session. Passwords
// pass straight to GoTrue and are never written to application storage or logs.
const baseUrl = Deno.env.get('SUPABASE_URL')
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function reply(status: number, code: string) {
  return new Response(JSON.stringify({ code }), { status, headers })
}

function claimsFromVerifiedToken(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

async function authRequest(path: string, method: string, token: string, body?: unknown) {
  return fetch(`${baseUrl}/auth/v1/${path}`, {
    method,
    headers: { apikey: anonKey!, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  })
}

async function rpc(name: string, body: unknown) {
  return fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply(405, 'METHOD_NOT_ALLOWED')
  if (!baseUrl || !anonKey || !serviceKey) return reply(503, 'AUTH_SERVICE_UNAVAILABLE')
  const bearer = request.headers.get('authorization') || ''
  if (!bearer.startsWith('Bearer ')) return reply(401, 'AUTH_REQUIRED')
  const token = bearer.slice(7)
  let payload: { password?: unknown }
  try {
    const raw = await request.text()
    if (raw.length > 4096) return reply(413, 'REQUEST_TOO_LARGE')
    payload = JSON.parse(raw)
  } catch {
    return reply(400, 'INVALID_REQUEST')
  }
  if (typeof payload?.password !== 'string' || payload.password.length < 8)
    return reply(400, 'INVALID_PASSWORD')

  try {
    // GoTrue validates the signature, expiry, user and session. Only afterwards
    // are the JWT fields below used to select the restricted flow.
    const userResponse = await authRequest('user', 'GET', token)
    if (!userResponse.ok) return reply(401, 'AUTH_REQUIRED')
    const user = await userResponse.json()
    const claims = claimsFromVerifiedToken(token)
    const sessionId = claims?.session_id
    if (claims?.role !== 'auth_signup' || claims.sub !== user.id
        || typeof sessionId !== 'string'
        || !Array.isArray(claims.amr)
        || !claims.amr.some((item: { method?: string }) => item?.method === 'otp'))
      return reply(403, 'SIGNUP_SESSION_REQUIRED')

    const identity = { p_user_id: user.id, p_session_id: sessionId }
    const progressResponse = await rpc('get_signup_password_progress', identity)
    if (!progressResponse.ok) return reply(503, 'AUTH_STATE_UNAVAILABLE')
    const progress = await progressResponse.json()
    if (progress.completed) return reply(409, 'ONBOARDING_ALREADY_COMPLETED')

    if (!progress.passwordUpdated) {
      const update = await authRequest('user', 'PUT', token, { password: payload.password })
      if (!update.ok) return reply(422, 'PASSWORD_NOT_ACCEPTED')
      const recorded = await rpc('record_signup_password_progress', { ...identity, p_step: 'password_updated' })
      if (!recorded.ok) return reply(503, 'AUTH_STATE_UNAVAILABLE')
    }
    if (!progress.othersRevoked) {
      const revoked = await authRequest('logout?scope=others', 'POST', token, {})
      if (!revoked.ok) return reply(503, 'SESSION_REVOCATION_PENDING')
      const recorded = await rpc('record_signup_password_progress', { ...identity, p_step: 'others_revoked' })
      if (!recorded.ok) return reply(503, 'AUTH_STATE_UNAVAILABLE')
    }
    return reply(200, 'PASSWORD_READY')
  } catch {
    return reply(503, 'AUTH_SERVICE_UNAVAILABLE')
  }
})
