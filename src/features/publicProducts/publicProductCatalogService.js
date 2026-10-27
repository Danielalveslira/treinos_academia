// Único ponto de contato com a RPC pública `public_product_catalog` (ver
// supabase/migrations/20261201000001_product_storefronts.sql). Usa fetch direto com a
// chave anon, não o cliente @supabase/supabase-js: a Vitrine não autentica ninguém e
// evita puxar esse pacote para o chunk sob demanda da página.
export const CATALOG_PAGE_SIZE = 20
export const CATALOG_GROUP_SIZE = 5

const endpoint = (() => {
  const raw =
    typeof import.meta.env?.VITE_SUPABASE_URL === 'string'
      ? import.meta.env.VITE_SUPABASE_URL.trim()
      : ''
  return /^https:\/\/[^/]+(?:\/_finance_local)?$/.test(raw) ? raw.replace(/\/+$/, '') : ''
})()
const anonKey =
  typeof import.meta.env?.VITE_SUPABASE_ANON_KEY === 'string'
    ? import.meta.env.VITE_SUPABASE_ANON_KEY.trim()
    : ''

export class CatalogError extends Error {
  constructor(code, status) {
    super(code)
    this.name = 'CatalogError'
    this.code = code
    this.status = status
  }
}

// Só aceita https com host real (nunca IP, nunca credenciais na URL): usado tanto para a
// link da loja. A mídia usa exclusivamente o gateway autorizado por identificador.
export function safeHttpsUrl(raw) {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      /\.[a-z]{2,}$/i.test(url.hostname) &&
      !/^[\d.]+$/.test(url.hostname)
      ? url.href
      : null
  } catch {
    return null
  }
}

export async function fetchProductCatalog(
  { mode, search = '', category = '', brand = '', offset = 0, limit = CATALOG_PAGE_SIZE },
  signal
) {
  if (!endpoint || !anonKey) throw new CatalogError('UNCONFIGURED')
  const response = await fetch(`${endpoint}/rest/v1/rpc/public_product_catalog`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_mode: mode,
      p_search: search,
      p_category: category,
      p_brand: brand,
      p_offset: offset,
      p_limit: limit,
    }),
    signal,
    cache: 'no-store',
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}))
    throw new CatalogError(failure.code || 'HTTP_ERROR', response.status)
  }
  return response.json()
}

export function publicProductMediaUrl(product) {
  if (!product.media_id || !endpoint) return null
  return `${endpoint}/functions/v1/storefront-media?id=${encodeURIComponent(product.media_id)}`
}

export function formatProductPrice(value) {
  if (!/^[0-9]{1,12}$/.test(String(value ?? ''))) return null
  const amount = BigInt(value)
  return `R$ ${amount / 100n},${(amount % 100n).toString().padStart(2, '0')}`
}
