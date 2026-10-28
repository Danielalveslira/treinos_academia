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
    const listingRecords = []
    let listingBefore = null,
      listingComplete = false
    for (let page = 0; page < 100; page++) {
      const data = await publicRpc('public_listing_sitemap', {
        p_before: listingBefore,
        p_limit: 500,
      })
      const elapsed = performance.now() - started
      const fresh = data.items.filter(
        (row) =>
          ['professional', 'space'].includes(row.kind) &&
          Date.parse(row.expiresAt) > Date.parse(data.serverTime) + elapsed
      )
      listingRecords.push(...fresh)
      if (data.items.length < 500) {
        listingComplete = true
        break
      }
      listingBefore = data.items.at(-1).id
    }
    if (!listingComplete) throw Error('SITEMAP_PARTITION_REQUIRED')
    const finalNow = serverStart + (performance.now() - started)
    const eligible = records.filter((r) => Date.parse(r.expiresAt) > finalNow)
    const liveListings = listingRecords.filter((r) => Date.parse(r.expiresAt) > finalNow)
    const xml = options.staticXml || readFileSync('dist/sitemap.xml', 'utf8')
    const listingUrls =
      [...new Set(liveListings.map((r) => (r.kind === 'space' ? '/locais' : '/profissionais')))]
        .map((path) => `<url><loc>${canonicalOrigin}${path}</loc></url>`)
        .join('') +
      liveListings
        .map(
          (r) =>
            `<url><loc>${canonicalOrigin}${r.kind === 'space' ? '/locais' : '/profissionais'}/${escape(r.id)}</loc><lastmod>${escape(r.updatedAt)}</lastmod></url>`
        )
        .join('')
    const urls =
      listingUrls +
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
