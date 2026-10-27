import process from 'node:process'
const escape = (value) =>
  String(value || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, follow')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.statusCode = 405
    return res.end()
  }
  const id = String(
    req.query?.id || new URL(req.url, 'http://localhost').pathname.split('/').at(-1)
  )
  let store,
    products = []
  try {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      res.statusCode = 404
      return res.end('Vitrine indisponível')
    }
    const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
      key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
    if (!base || !key) throw Error('unconfigured')
    const response = await fetch(base.replace(/\/$/, '') + '/rest/v1/rpc/public_product_catalog', {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_mode: 'detail', p_brand: id, p_limit: 20 }),
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) throw Error('unavailable')
    const result = await response.json()
    store = result.groups?.find((s) => s.key === id)
    products = result.items || []
  } catch {
    res.statusCode = 503
    return res.end('Vitrine temporariamente indisponível')
  }
  res.statusCode = store ? 200 : 404
  const title = store ? store.brand : 'Vitrine indisponível'
  const mediaBase = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(
    /\/$/,
    ''
  )
  const body = store
    ? `<p>${escape(store.description)}</p><p>${escape(store.contact)}</p><div class="storefront-products">${products.map((p) => `<article><img loading="lazy" width="240" height="180" src="${escape(mediaBase)}/functions/v1/storefront-media?id=${escape(p.media_id)}" alt=""><h2>${escape(p.name)}</h2><p>${escape(p.description)}</p><a rel="noopener noreferrer" href="${escape(p.store_url)}">Ver na loja</a></article>`).join('')}</div><p><a href="/vitrine?loja=${id}">Ver todos os produtos no catálogo</a></p>`
    : '<p>Esta vitrine não está disponível para publicação.</p>'
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${escape(title)} | Evolutus</title><meta name="description" content="${escape(store?.description?.slice(0, 160) || 'Vitrine indisponível')}"><link rel="canonical" href="https://www.evolutus.com.br/vitrine/${id}"><link rel="stylesheet" href="/public-pages.css"><link rel="stylesheet" href="/storefront-detail.css"><script src="/boot-public-theme.js"></script><script src="/storefront-detail.js" defer></script></head><body><header><a href="/vitrine">Evolutus · Vitrine</a></header><main id="storefront-content" data-expires="${escape(store?.expiresAt)}"><h1>${escape(title)}</h1>${body}</main></body></html>`
  return res.end(req.method === 'HEAD' ? undefined : html)
}
