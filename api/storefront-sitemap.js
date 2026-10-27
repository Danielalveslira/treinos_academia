import { readFileSync } from 'node:fs'
import {
  canonicalOrigin,
  escapeHtml as escape,
  publicHeaders,
  publicRpc,
} from './_storefront-public.js'
export default async function handler(req, res, options = {}) {
  publicHeaders(res, 'application/xml; charset=utf-8')
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.statusCode = 405
    return res.end()
  }
  try {
    const records = [],
      started = performance.now()
    let before = null,
      serverStart = null,
      complete = false
    for (let page = 0; page < 100; page++) {
      const data = await publicRpc('public_storefront_sitemap', { p_before: before, p_limit: 500 })
      serverStart ??= Date.parse(data.serverTime)
      if (!Number.isFinite(serverStart)) throw Error('INVALID_TIME')
      records.push(...data.items)
      if (data.items.length < 500) {
        complete = true
        break
      }
      before = data.items.at(-1).id
    }
    if (!complete) throw Error('SITEMAP_PARTITION_REQUIRED')
    // Conservative monotonic adjustment; no device clock or cache extends a DB deadline.
    const now = serverStart + (performance.now() - started)
    const eligible = records.filter((r) => Date.parse(r.expiresAt) > now)
    const xml = options.staticXml || readFileSync('dist/sitemap.xml', 'utf8')
    const urls =
      (eligible.length ? `<url><loc>${canonicalOrigin}/vitrine</loc></url>` : '') +
      eligible
        .map(
          (r) =>
            `<url><loc>${canonicalOrigin}/vitrine/${escape(r.id)}</loc><lastmod>${escape(r.updatedAt)}</lastmod></url>`
        )
        .join('')
    res.statusCode = 200
    return res.end(req.method === 'HEAD' ? undefined : xml.replace('</urlset>', urls + '</urlset>'))
  } catch {
    res.statusCode = 503
    return res.end('<?xml version="1.0"?><error>Sitemap temporariamente indisponível</error>')
  }
}
