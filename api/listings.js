import { readFileSync } from 'node:fs'
import {
  canonicalOrigin,
  escapeHtml as escape,
  jsonLd,
  publicHeaders,
  publicRpc,
  imageUrl,
  stillEligible,
} from './_storefront-public.js'
import {
  CATEGORY_OPTIONS,
  MODALITY_OPTIONS,
  SERVICE_MODE_OPTIONS,
  optionLabel,
} from '../src/constants/professionalListingTaxonomy.js'
const pathFor = (kind) => (kind === 'space' ? '/locais' : '/profissionais')
const card = (item) =>
  `<article>${item.mediaId ? `<img loading="lazy" width="72" height="72" src="${escape(imageUrl(item.mediaId))}" alt="">` : ''}<h2><a href="${pathFor(item.kind)}/${escape(item.id)}">${escape(item.displayName)}</a></h2><p>${escape(optionLabel(CATEGORY_OPTIONS, item.categoryKey))}</p><p>${escape(item.city)}, ${escape(item.uf)} · ${escape(optionLabel(SERVICE_MODE_OPTIONS, item.serviceMode))}</p></article>`
export function renderListingHtml(
  template,
  { content, title, description, canonical, indexable, schema, bootstrap, detail }
) {
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(title)} | Evolutus</title>`)
    .replace(
      /(<meta (?:name="description"|property="og:description"|name="twitter:description") content=")[^"]*(">)/g,
      (_, a, b) => a + escape(description) + b
    )
    .replace(
      /(<meta (?:property="og:title"|name="twitter:title") content=")[^"]*(">)/g,
      (_, a, b) => a + escape(title) + b
    )
    .replace(/(<link rel="canonical" href=")[^"]*(">)/, (_, a, b) => a + canonical + b)
    .replace(/(<meta property="og:url" content=")[^"]*(">)/, (_, a, b) => a + canonical + b)
    .replace(
      /<meta name="robots" content="[^"]*">/,
      `<meta name="robots" content="${indexable ? 'index,follow' : 'noindex,follow'}">`
    )
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
    .replace(
      /<div id="public-listings-root"[^>]*>[\s\S]*?<\/div>/,
      detail
        ? `<div data-public-lease data-expires="${escape(detail.expiresAt)}" data-server-time="${escape(detail.serverTime)}"><h1>${escape(title)}</h1>${content}</div>`
        : `$&`
    )
  if (!detail)
    html = html.replace(
      /(<div id="public-listings-root"[^>]*>)[\s\S]*?<\/div>/,
      (_, opening) => opening + content + '</div>'
    )
  if (detail) html = html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '')
  const styles = html.includes('href="/public-listings.css"') ? '' : '<link rel="stylesheet" href="/public-listings.css">'
  return html
    .replace(
      '</head>',
      `${styles}${schema ? `<script type="application/ld+json">${jsonLd(schema)}</script>` : ''}${detail ? '<script src="/storefront-detail.js" defer></script>' : ''}</head>`
    )
    .replace(
      '</body>',
      `${bootstrap ? `<script id="public-listings-initial" type="application/json">${jsonLd(bootstrap)}</script>` : ''}</body>`
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
  const url = new URL(req.url, 'http://localhost'),
    kind = req.query?.kind || (url.pathname.startsWith('/locais') ? 'space' : 'professional')
  if (!['professional', 'space'].includes(kind)) {
    res.statusCode = 404
    return res.end('Cadastro indisponível')
  }
  const path = pathFor(kind),
    id = req.query?.id || url.pathname.match(/^\/(?:profissionais|locais)\/([^/]+)$/)?.[1]
  try {
    const template = options.html || readFileSync('dist' + path + '.html', 'utf8')
    if (id) {
      if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
        res.statusCode = 404
        return res.end('Cadastro indisponível')
      }
      let row = await publicRpc('public_get_professional', { p_listing_id: id })
      if (row && !stillEligible(row.expiresAt, row.serverTime, started)) row = null
      if (row && row.kind !== kind) {
        res.statusCode = 308
        res.setHeader('Location', `${pathFor(row.kind)}/${row.id}`)
        return res.end()
      }
      const available = Boolean(row)
      res.statusCode = available ? 200 : 404
      res.setHeader('X-Robots-Tag', available ? 'index, follow' : 'noindex, follow')
      const canonical = `${canonicalOrigin}${path}/${String(id).toLowerCase()}`
      const schema = row
        ? {
            '@context': 'https://schema.org',
            '@type':
              row.kind === 'space' && row.address && row.city && row.uf
                ? 'LocalBusiness'
                : row.kind === 'professional'
                  ? 'Person'
                  : 'ProfilePage',
            name: row.displayName,
            description: row.bio,
            url: canonical,
            ...(row.mediaId ? { image: imageUrl(row.mediaId) } : {}),
            ...(row.kind === 'space' && row.address && row.city && row.uf
              ? {
                  address: {
                    '@type': 'PostalAddress',
                    streetAddress: row.address,
                    addressLocality: row.city,
                    addressRegion: row.uf,
                    addressCountry: 'BR',
                  },
                }
              : {}),
          }
        : null
      const contacts = (row?.publicContacts || []).filter((c) => {
        try {
          const u = new URL(c.url)
          return u.protocol === 'https:' && !u.username && !u.password
        } catch {
          return false
        }
      })
      const content = row
        ? `<article>${row.mediaId ? `<img class="listing-main-image" src="${escape(imageUrl(row.mediaId))}" width="160" height="160" alt="${escape(row.displayName)}">` : ''}<p>${escape(optionLabel(CATEGORY_OPTIONS, row.categoryKey))}</p><p>${escape(row.bio)}</p><p>${escape((row.modalityKeys || []).map((k) => optionLabel(MODALITY_OPTIONS, k)).join(' · '))}</p><p>${escape((row.specialties || []).join(' · '))}</p><p>${escape(row.city)}, ${escape(row.uf)} · ${escape(optionLabel(SERVICE_MODE_OPTIONS, row.serviceMode))}</p>${row.address ? `<h2>Localização</h2><p>${escape(row.address)}</p>` : ''}${row.openingHours ? `<h2>Horários</h2><p>${escape(row.openingHours)}</p>` : ''}<h2>Contato público</h2>${contacts.map((c) => `<p><a href="${escape(c.url)}" rel="noopener noreferrer">${escape(c.type === 'website' ? 'Site' : c.type === 'whatsapp' ? 'WhatsApp' : 'Instagram')}</a></p>`).join('')}${row.linkedCommunity ? `<p><a href="/comunidades/${escape(row.linkedCommunity.id)}">Ver comunidade ${escape(row.linkedCommunity.name)}</a></p>` : ''}<p><a href="/atendimento?tipo=report&amp;vitrine=${escape(row.id)}">Denunciar conteúdo</a></p><p><a href="${path}">Voltar ao diretório</a></p></article>`
        : '<p>Este cadastro não está disponível para publicação.</p>'
      const html = renderListingHtml(template, {
        content,
        title: row?.displayName || 'Cadastro indisponível',
        description: row?.bio?.slice(0, 160) || 'Cadastro indisponível',
        canonical,
        indexable: available,
        schema,
        detail: { expiresAt: row?.expiresAt || '', serverTime: row?.serverTime || '' },
      })
      return res.end(req.method === 'HEAD' ? undefined : html)
    }
    const filters = {
      modality: url.searchParams.get('modalidade') || '',
      uf: url.searchParams.get('uf') || '',
      city: (url.searchParams.get('cidade') || '').slice(0, 80),
      serviceMode: url.searchParams.get('atendimento') || '',
    }
    const offset = Number(url.searchParams.get('pagina') || 0)
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000) {
      res.statusCode = 400
      return res.end('Página inválida')
    }
    const page = await publicRpc('public_list_professionals', {
      p_kind: kind,
      p_modality: filters.modality || null,
      p_uf: filters.uf || null,
      p_city: filters.city || null,
      p_service_mode: filters.serviceMode || null,
      p_offset: offset,
      p_limit: 12,
    })
    if (page.items?.length && !stillEligible(page.validUntil, page.serverTime, started)) {
      page.items = []
      page.nextOffset = null
    }
    const indexable =
      Boolean(page.items?.length) &&
      [...url.searchParams.keys()].every((key) => key === 'kind' || key === 'id')
    res.statusCode = 200
    res.setHeader('X-Robots-Tag', indexable ? 'index, follow' : 'noindex, follow')
    const pagination =
      page.nextOffset == null
        ? ''
        : `<p><a href="${path}?${escape(new URLSearchParams({ ...Object.fromEntries(url.searchParams), pagina: String(page.nextOffset) }))}">Próxima página</a></p>`
    const html = renderListingHtml(template, {
      content: page.items?.length
        ? `<div class="listing-public-grid">${page.items.map(card).join('')}</div>${pagination}`
        : '<p>Nenhum cadastro disponível no momento.</p>',
      title: kind === 'space' ? 'Estabelecimentos' : 'Profissionais',
      description:
        kind === 'space'
          ? 'Estabelecimentos e espaços de treino com publicação vigente.'
          : 'Profissionais com publicação aprovada e vigente no Evolutus.',
      canonical: canonicalOrigin + path,
      indexable,
      schema: page.items?.length
        ? {
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            itemListElement: page.items.map((p, i) => ({
              '@type': 'ListItem',
              position: offset + i + 1,
              name: p.displayName,
              url: canonicalOrigin + pathFor(p.kind) + '/' + p.id,
            })),
          }
        : null,
      bootstrap: { kind, filters, offset, page },
    })
    return res.end(req.method === 'HEAD' ? undefined : html)
  } catch {
    res.statusCode = 503
    return res.end('Diretório temporariamente indisponível')
  }
}
