import { supabase } from '../supabase/config'
import { compressImage } from '../utils/imageCompression'
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}
export const listStorefronts = (admin = false, before = null) =>
  rpc('list_managed_storefronts', { p_admin: admin, p_before: before, p_limit: 10 })
export const createStorefront = (name, requestId) =>
  rpc('create_product_storefront', { p_name: name, p_request_id: requestId })
export const saveStorefront = (item, form) =>
  rpc('save_product_storefront', {
    p_id: item.id,
    p_revision: item.revision,
    p_name: form.name,
    p_description: form.description,
    p_contact: form.contact,
    p_logo_media_id: form.logoMediaId || null,
  })
export const saveStorefrontProduct = (item, product) =>
  rpc('save_storefront_product', {
    p_storefront_id: item.id,
    p_revision: item.revision,
    p_product_id: product.id || null,
    p_data: Object.fromEntries(
      [
        'name',
        'brand',
        'description',
        'category',
        'storeUrl',
        'mediaId',
        'priceCentavos',
        'displayOrder',
      ].map((key) => [key, product[key] ?? (key === 'displayOrder' ? 0 : '')])
    ),
  })
export const archiveStorefrontProduct = (item, productId) =>
  rpc('archive_storefront_product', {
    p_storefront_id: item.id,
    p_revision: item.revision,
    p_product_id: productId,
  })
export const setStorefrontEditorial = (item, state, reason = '') =>
  rpc('set_storefront_editorial', {
    p_id: item.id,
    p_revision: item.revision,
    p_state: state,
    p_reason: reason,
  })
export const listStorefrontOrders = (id, before = null) =>
  rpc('list_storefront_orders', { p_id: id, p_before: before })
export const listStorefrontProducts = (id, offset) =>
  rpc('list_storefront_products', { p_id: id, p_offset: offset })
export const setStorefrontLimits = (limits, revision, reason, confirm) =>
  rpc('admin_set_storefront_limits', {
    p_max_products: Number(limits.maxProducts),
    p_max_storefronts: Number(limits.maxStorefronts),
    p_revision: revision,
    p_reason: reason,
    p_confirm: confirm,
  })
export const storefrontMediaUrl = (id) =>
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storefront-media?id=${encodeURIComponent(id)}`
export async function uploadStorefrontImage(id, file) {
  const image = await compressImage(file, { maxDimension: 1000 })
  if (image.size > 1048576) throw new Error('IMAGE_TOO_LARGE')
  const body = new FormData()
  body.set('storefrontId', id)
  body.set('image', image, 'image.webp')
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('APP_ACCESS_DENIED')
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storefront-media`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body,
    }
  )
  const result = await response.json()
  if (!response.ok) throw new Error(result.error)
  return result.mediaId
}
export async function loadStorefrontImage(id, signal) {
  const { data } = await supabase.auth.getSession()
  const response = await fetch(storefrontMediaUrl(id), {
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
    },
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error('IMAGE_UNAVAILABLE')
  return response.blob()
}

export async function discardStorefrontImage(id) {
  if (!id) return
  const { data } = await supabase.auth.getSession()
  if (!data.session) return
  await fetch(storefrontMediaUrl(id), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
  })
}
