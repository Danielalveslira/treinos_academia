import { publicCommercialRpc } from '../publicProducts/publicProductCatalogService.js'
export const directoryPath = (kind) => (kind === 'space' ? '/locais' : '/profissionais')
export function remainingLeaseMs(data, elapsed = 0) {
  const remaining =
    Date.parse(data?.validUntil || data?.expiresAt) - Date.parse(data?.serverTime) - elapsed
  return Number.isFinite(remaining) ? remaining : 0
}
export async function fetchListingPage(kind, filters = {}, offset = 0, signal) {
  const initial = globalThis.document?.getElementById('public-listings-initial')
  if (initial) {
    initial.remove()
    try {
      const data = JSON.parse(initial.textContent)
      if (
        data.kind === kind &&
        data.offset === offset &&
        JSON.stringify(data.filters) === JSON.stringify(filters)
      ) {
        return {
          ...data.page,
          items: (data.page.items || []).map((item) => ({
            ...item,
            remainingMs: remainingLeaseMs(
              { ...item, serverTime: data.page.serverTime },
              performance.now()
            ),
          })),
          receivedAt: performance.now(),
          remainingMs: remainingLeaseMs(data.page, performance.now()),
        }
      }
    } catch {
      /* Fetch current public data if bootstrap is malformed. */
    }
  }
  const started = performance.now()
  const page = await publicCommercialRpc(
    'public_list_professionals',
    {
      p_kind: kind,
      p_modality: filters.modality || null,
      p_uf: filters.uf || null,
      p_city: filters.city || null,
      p_service_mode: filters.serviceMode || null,
      p_offset: offset,
      p_limit: 12,
    },
    signal
  )
  return {
    ...page,
    items: (page.items || []).map((item) => ({
      ...item,
      remainingMs: remainingLeaseMs(
        { ...item, serverTime: page.serverTime },
        performance.now() - started
      ),
    })),
    receivedAt: performance.now(),
    remainingMs: remainingLeaseMs(page, performance.now() - started),
  }
}
export async function fetchListingDetail(id, signal) {
  const started = performance.now()
  const data = await publicCommercialRpc('public_get_professional', { p_listing_id: id }, signal)
  return data
    ? {
        ...data,
        receivedAt: performance.now(),
        remainingMs: remainingLeaseMs(data, performance.now() - started),
      }
    : null
}
