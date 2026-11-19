// Camada fina de integração com a ExerciseAPI (exerciseapi.dev) -- NUNCA um espelho: só
// autentica, valida, limita e repassa. A chave (EXERCISEAPI_KEY) só existe aqui, como
// secret -- o navegador jamais a vê. O cache de verdade (24h, stale-while-revalidate)
// mora no dispositivo do usuário (IndexedDB, ver src/utils/exerciseCatalogCache.js);
// esta função é chamada só quando o cache local está ausente ou expirado.
//
// Superfície deliberadamente pequena: só os 4 actions abaixo, cada um mapeado pra um
// único endpoint fixo da ExerciseAPI -- nunca um proxy genérico de path/query livre
// (evita SSRF pra endpoints não previstos e abuso de parâmetros não validados).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
// .js puro, sem especificador (Deno resolve caminho relativo nativamente) -- mesmo
// arquivo é importado por node --test (ver validation.test.js), pra que a lógica
// validada seja exatamente a que roda em produção, nunca uma cópia que possa divergir.
import { mapProviderRateLimitCode, parseBudget, validateDetailId, validateSearchParams } from './validation.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXERCISEAPI_KEY = Deno.env.get('EXERCISEAPI_KEY')
const EXERCISEAPI_BASE_URL = 'https://api.exerciseapi.dev/v1'

const UPSTREAM_TIMEOUT_MS = 8000
// Por usuário: protege contra um único cliente com bug/abuso queimando a cota sozinho.
const RATE_LIMIT_PER_MINUTE = 20
const RATE_LIMIT_PER_DAY = 200
// Global (soma de TODOS os usuários): protege a chave real da ExerciseAPI -- vários
// usuários, cada um dentro do próprio teto, ainda podem somar mais que o plano
// contratado permite. Configurável via secret (nunca hardcoded) pra bater com o plano de
// verdade; o fallback é só uma rede de segurança conservadora caso a secret não tenha
// sido configurada, sempre com margem abaixo do teto oficial (Pro: 300/min, 10.000/dia).
const GLOBAL_RATE_LIMIT_PER_MINUTE = parseBudget(Deno.env.get('EXERCISEAPI_MINUTE_BUDGET'), 250)
const GLOBAL_RATE_LIMIT_PER_DAY = parseBudget(Deno.env.get('EXERCISEAPI_DAILY_BUDGET'), 8000)

async function fetchUpstream(path: string, search?: URLSearchParams) {
  if (!EXERCISEAPI_KEY) {
    return { ok: false as const, status: 500, code: 'PROVIDER_MISCONFIGURED' as const }
  }
  const url = `${EXERCISEAPI_BASE_URL}${path}${search ? `?${search.toString()}` : ''}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      headers: { 'X-API-Key': EXERCISEAPI_KEY },
      signal: controller.signal,
    })
    const latencyMs = Date.now() - startedAt
    // Sempre logados (sucesso ou não) -- observabilidade da cota real da ExerciseAPI,
    // nunca usados pra decidir se a chamada acontece (isso é o orçamento GLOBAL nosso,
    // checado antes de chegar aqui) -- só pra acompanhar o quão perto do teto real
    // deles estamos, sem precisar esperar um 429 de verdade pra descobrir.
    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining')
    const rateLimitReset = response.headers.get('X-RateLimit-Reset')

    if (response.status === 401) {
      console.error(
        JSON.stringify({ event: 'exercise_catalog_proxy', path, status: 'provider_misconfigured', latencyMs })
      )
      return { ok: false as const, status: 500, code: 'PROVIDER_MISCONFIGURED' as const }
    }
    if (response.status === 429) {
      // A ExerciseAPI distingue dois 429 diferentes no corpo: RATE_LIMIT_EXCEEDED (teto
      // normal, esperado sob uso pesado) e OVERAGE_CAP_EXCEEDED (10x acima do plano --
      // muito mais grave, alguém está ignorando o rate limit deles de propósito ou o
      // nosso orçamento global está mal configurado). Repassa o código real, nunca um
      // genérico só, pra logs/alertas conseguirem diferenciar os dois casos.
      const providerBody = await response.json().catch(() => null)
      const providerCode = providerBody?.error?.code
      console.log(
        JSON.stringify({
          event: 'exercise_catalog_proxy', path, status: 'provider_rate_limited', providerCode,
          rateLimitRemaining, rateLimitReset, latencyMs,
        })
      )
      return {
        ok: false as const,
        status: 429,
        code: mapProviderRateLimitCode(providerCode) as 'PROVIDER_RATE_LIMITED' | 'PROVIDER_OVERAGE_CAP_EXCEEDED',
        retryAfter: response.headers.get('Retry-After'),
      }
    }
    if (response.status === 404) {
      console.log(JSON.stringify({ event: 'exercise_catalog_proxy', path, status: 'not_found', latencyMs }))
      return { ok: false as const, status: 404, code: 'NOT_FOUND' as const }
    }
    if (!response.ok) {
      console.error(
        JSON.stringify({ event: 'exercise_catalog_proxy', path, status: 'provider_error', upstreamStatus: response.status, latencyMs })
      )
      return { ok: false as const, status: 502, code: 'PROVIDER_ERROR' as const }
    }
    const body = await response.json()
    console.log(
      JSON.stringify({ event: 'exercise_catalog_proxy', path, status: 'ok', rateLimitRemaining, rateLimitReset, latencyMs })
    )
    return { ok: true as const, body }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const timedOut = error instanceof Error && error.name === 'AbortError'
    console.error(
      JSON.stringify({
        event: 'exercise_catalog_proxy', path,
        status: timedOut ? 'upstream_timeout' : 'upstream_unavailable', latencyMs,
      })
    )
    return { ok: false as const, status: timedOut ? 504 : 502, code: timedOut ? ('UPSTREAM_TIMEOUT' as const) : ('UPSTREAM_UNAVAILABLE' as const) }
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('METHOD_NOT_ALLOWED', 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('NOT_AUTHENTICATED', 401)

    const { action, params } = await req.json()
    if (!['search', 'detail', 'muscles', 'equipment'].includes(action)) {
      return jsonError('INVALID_ACTION', 400)
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return jsonError('NOT_AUTHENTICATED', 401)
    const { data: fullSession, error: sessionErr } = await userClient.rpc('is_full_login_session')
    if (sessionErr || fullSession !== true) return jsonError('NOT_AUTHENTICATED', 401)
    const uid = userData.user.id

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    // Usuário + global resolvidos numa única chamada/transação (ver
    // check_exercise_catalog_rate_limit) -- nunca uma segunda consulta ao banco só pra
    // checar o orçamento global.
    const { data: limitResult, error: limitErr } = await adminClient.rpc('check_exercise_catalog_rate_limit', {
      p_user_id: uid,
      p_minute_cap: RATE_LIMIT_PER_MINUTE,
      p_day_cap: RATE_LIMIT_PER_DAY,
      p_global_minute_cap: GLOBAL_RATE_LIMIT_PER_MINUTE,
      p_global_day_cap: GLOBAL_RATE_LIMIT_PER_DAY,
    })
    if (limitErr) {
      console.error('[exercise-catalog-proxy] rate limit check failed:', limitErr)
      return jsonError('INTERNAL_ERROR', 500)
    }
    if (!limitResult.globalAllowed) {
      // Orçamento global esgotado: nunca chama a ExerciseAPI -- devolve um erro
      // controlado, o cliente continua usando cache local stale se tiver (ver
      // exerciseCatalogService.js).
      console.error(JSON.stringify({ event: 'exercise_catalog_proxy', status: 'global_budget_exhausted', limitResult }))
      return jsonError('GLOBAL_RATE_LIMIT_EXCEEDED', 429)
    }
    if (!limitResult.userAllowed) {
      return jsonError('RATE_LIMIT_EXCEEDED', 429)
    }

    let result
    if (action === 'search') {
      const validated = validateSearchParams(params || {})
      if (!validated.search) return jsonError(validated.error, 400)
      result = await fetchUpstream('/exercises', validated.search)
    } else if (action === 'detail') {
      const id = params?.id
      if (!validateDetailId(id)) return jsonError('INVALID_ID', 400)
      result = await fetchUpstream(`/exercises/${encodeURIComponent(id)}`)
    } else if (action === 'muscles') {
      result = await fetchUpstream('/muscles')
    } else {
      result = await fetchUpstream('/equipment')
    }

    if (!result.ok) {
      const headers: Record<string, string> = {}
      if ('retryAfter' in result && result.retryAfter) headers['Retry-After'] = result.retryAfter
      return jsonError(result.code, result.status, headers)
    }
    return jsonOk(result.body)
  } catch (error) {
    console.error('[exercise-catalog-proxy] unexpected error:', error)
    return jsonError('INTERNAL_ERROR', 500)
  }
})

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  })
}

function jsonError(code: string, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { code } }), {
    headers: { ...corsHeaders, ...extraHeaders, 'Content-Type': 'application/json' },
    status,
  })
}
