import process from 'node:process'
export const canonicalOrigin = 'https://www.evolutus.com.br'
export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
export const jsonLd = (value) => JSON.stringify(value).replace(/</g, '\\u003c')
export const stillEligible = (expiresAt, serverTime, started) => {
  const remaining = Date.parse(expiresAt) - Date.parse(serverTime) - (performance.now() - started)
  return Number.isFinite(remaining) && remaining > 0
}
export function publicHeaders(res, type = 'text/html; charset=utf-8') {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store')
  res.setHeader('Content-Type', type)
}
export async function publicRpc(name, args) {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) throw Error('UNCONFIGURED')
  const response = await fetch(base.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    cache: 'no-store',
    signal: AbortSignal.timeout(4000),
  })
  if (!response.ok) throw Error('UNAVAILABLE')
  return response.json()
}
export const imageUrl = (id) =>
  `${(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/storefront-media?id=${encodeURIComponent(id)}`
export function productMarkup(products) {
  return products
    .map(
      (p) =>
        `<article><img loading="lazy" width="240" height="180" src="${escapeHtml(imageUrl(p.media_id))}" alt="${escapeHtml(p.name)}"><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(p.description)}</p><a rel="noopener noreferrer" href="${escapeHtml(p.store_url)}">Ver na loja</a></article>`
    )
    .join('')
}
