import process from 'node:process'

// This endpoint never reads exercise_catalog or invokes the revision RPC.
// CDN misses read a single precomputed row, with anon SELECT-only permissions.
export function validSnapshot(value) {
  return value && Number.isSafeInteger(value.total_active) && value.total_active >= 0 &&
    typeof value.revision === 'string' && /^\d+$/.test(value.revision) &&
    typeof value.updated_at === 'string' && Number.isFinite(Date.parse(value.updated_at))
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD')
    response.statusCode = 405
    return response.end()
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  try {
    if (!url || !key) throw new Error('SNAPSHOT_CONFIGURATION')
    const result = await fetch(new URL('/rest/v1/public_catalog_snapshot?singleton=eq.true&select=total_active,revision,updated_at', url), {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4000),
    })
    if (!result.ok) throw new Error('SNAPSHOT_UNAVAILABLE')
    const rows = await result.json()
    const snapshot = rows?.length === 1 ? rows[0] : null
    if (!validSnapshot(snapshot)) throw new Error('SNAPSHOT_INVALID')
    const body = JSON.stringify({total_active:snapshot.total_active,revision:snapshot.revision,updated_at:snapshot.updated_at})
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
    response.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=60, must-revalidate')
    response.statusCode = 200
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch {
    // Do not cache failures or reveal origin/configuration/credentials.
    response.statusCode = 503
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(request.method === 'HEAD' ? undefined : '{"unavailable":true}')
  }
}
