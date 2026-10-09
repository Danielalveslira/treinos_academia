// Roteador do Edge Runtime local (equivalente ao `main` do supabase functions serve / self-hosted):
// /functions/v1/<nome> -> worker isolado de /home/deno/functions/<nome>, com verify_jwt = true emulado.
const JWT_SECRET = Deno.env.get('JWT_SECRET')!
const enc = new TextEncoder()
const key = await crypto.subtle.importKey('raw', enc.encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function validJwt(token: string) {
  const [h, p, s] = token.split('.')
  if (!h || !p || !s) return false
  const ok = await crypto.subtle.verify('HMAC', key, b64(s), enc.encode(`${h}.${p}`))
  if (!ok) return false
  const payload = JSON.parse(new TextDecoder().decode(b64(p)))
  return !payload.exp || payload.exp > Date.now() / 1000
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const name = url.pathname.split('/')[1]
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ') || !(await validJwt(auth.slice(7)))) {
    return new Response(JSON.stringify({ code: 401, message: 'Invalid JWT' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  if (!/^[a-z0-9-]+$/.test(name || '')) return new Response('not found', { status: 404 })
  try {
    const worker = await (globalThis as any).EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${name}`,
      memoryLimitMb: 256,
      workerTimeoutMs: 60_000,
      noModuleCache: false,
      importMapPath: null,
      envVars: Object.entries(Deno.env.toObject()),
      forceCreate: false,
      netAccessDisabled: false,
      cpuTimeSoftLimitMs: 10_000,
      cpuTimeHardLimitMs: 20_000,
    })
    return await worker.fetch(req)
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
