import {
  canonicalOrigin,
  escapeHtml as escape,
  jsonLd,
  publicHeaders,
  publicRpc,
  productMarkup,
  imageUrl,
  stillEligible,
} from './_storefront-public.js'
export default async function handler(req, res) {
  const started = performance.now()
  publicHeaders(res)
  res.setHeader('X-Robots-Tag', 'noindex, follow')
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.statusCode = 405
    return res.end()
  }
  const id = String(
    req.query?.id || new URL(req.url, 'http://localhost').pathname.split('/').at(-1)
  ).toLowerCase()
  let serverTime,
    store,
    products = []
  try {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) {
      res.statusCode = 404
      return res.end('Vitrine indisponível')
    }
    const result = await publicRpc('public_product_catalog', {
      p_mode: 'detail',
      p_brand: id,
      p_limit: 20,
    })
    serverTime = result.serverTime
    store = result.groups?.find((s) => s.key === id)
    products = result.items || []
    if (store && !stillEligible(store.expiresAt, serverTime, started)) {
      store = undefined
      products = []
    }
  } catch {
    res.statusCode = 503
    return res.end('Vitrine temporariamente indisponível')
  }
  const available = Boolean(store && products.length)
  res.statusCode = available ? 200 : 404
  res.setHeader('X-Robots-Tag', available ? 'index, follow' : 'noindex, follow')
  const title = available ? store.brand : 'Vitrine indisponível',
    canonical = `${canonicalOrigin}/vitrine/${id}`
  const schema = available
    ? {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: store.brand,
        description: store.description,
        url: canonical,
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: products.map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: {
              '@type': 'Product',
              name: p.name,
              description: p.description,
              brand: { '@type': 'Brand', name: p.brand },
              image: imageUrl(p.media_id),
              url: p.store_url,
            },
          })),
        },
      }
    : null
  const body = available
    ? `<p>${escape(store.description)}</p><p>${escape(store.contact)}</p><div class="storefront-products">${productMarkup(products)}</div><p><a href="/vitrine?loja=${id}">Ver todos os produtos no catálogo</a></p>`
    : '<p>Esta vitrine não está disponível para publicação.</p>'
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${available ? 'index,follow' : 'noindex,follow'}"><title>${escape(title)} | Evolutus</title><meta name="description" content="${escape(store?.description?.slice(0, 160) || 'Vitrine indisponível')}"><link rel="canonical" href="${canonical}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(store?.description?.slice(0, 160) || 'Vitrine indisponível')}"><meta property="og:url" content="${canonical}"><link rel="stylesheet" href="/public-pages.css"><link rel="stylesheet" href="/storefront-detail.css"><script src="/boot-public-theme.js"></script><script src="/storefront-detail.js" defer></script>${schema ? `<script type="application/ld+json">${jsonLd(schema)}</script>` : ''}</head><body class="storefront-detail"><header><a href="/vitrine">Evolutus · Vitrine</a></header><main id="storefront-content" data-expires="${escape(store?.expiresAt)}" data-server-time="${escape(serverTime)}"><h1>${escape(title)}</h1>${body}</main></body></html>`
  return res.end(req.method === 'HEAD' ? undefined : html)
}
