import { readFileSync } from 'node:fs'
import {
  canonicalOrigin,
  escapeHtml as escape,
  jsonLd,
  publicHeaders,
  publicRpc,
  productMarkup,
  stillEligible,
} from './_storefront-public.js'
export function renderApprovedCatalog(html, page, { filtered = false } = {}) {
  const groups = page.groups || [],
    indexable = groups.length > 0 && !filtered
  const content = groups.length
    ? groups
        .map(
          (g) =>
            `<section><h2><a href="/vitrine/${escape(g.key)}">${escape(g.brand)}</a></h2><p>${escape(g.description)}</p><div class="storefront-products">${productMarkup(g.items || [])}</div></section>`
        )
        .join('')
    : '<p>Nenhuma vitrine disponível no momento.</p>'
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: groups.map((g, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: g.brand,
      url: `${canonicalOrigin}/vitrine/${g.key}`,
    })),
  }
  return html
    .replace(
      /<meta name="robots" content="[^"]*">/,
      `<meta name="robots" content="${indexable ? 'index,follow' : 'noindex,follow'}">`
    )
    .replace(
      /<div id="vitrine-root">[\s\S]*?<\/div><\/section>/,
      `<div id="vitrine-root">${content}</div></section>`
    )
    .replace(
      '</head>',
      `<link rel="stylesheet" href="/storefront-detail.css">${groups.length ? `<script type="application/ld+json">${jsonLd(schema)}</script>` : ''}</head>`
    )
    .replace(
      '</body>',
      `<script type="application/json" id="storefront-catalog-initial">${jsonLd(page)}</script></body>`
    )
}
export default async function handler(req, res, options = {}) {
  const started = performance.now()
  publicHeaders(res)
  res.setHeader('X-Robots-Tag', 'noindex, follow')
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.statusCode = 405
    return res.end()
  }
  try {
    const page = await publicRpc('public_product_catalog', { p_mode: 'groups', p_limit: 5 })
    // A lease can end during upstream IO. Do not ship its content in HTML/bootstrap/schema.
    if (page.groups?.length && !stillEligible(page.validUntil, page.serverTime, started)) {
      page.groups = []
      page.items = []
      page.totalBrands = 0
      page.totalProducts = 0
    }
    const filtered = new URL(req.url, 'http://localhost').search.length > 0
    const useful = page.groups?.length > 0 && !filtered
    res.setHeader('X-Robots-Tag', useful ? 'index, follow' : 'noindex, follow')
    res.statusCode = 200
    const html = options.html || readFileSync('dist/vitrine.html', 'utf8')
    return res.end(
      req.method === 'HEAD' ? undefined : renderApprovedCatalog(html, page, { filtered })
    )
  } catch {
    res.statusCode = 503
    return res.end('Vitrine temporariamente indisponível')
  }
}
