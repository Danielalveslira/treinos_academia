// User-facing names for advertising placements. `network` is not a real placement_code
// (see create_advertising_campaign: it expands to the admin-configured bundle at
// creation time) — it is labeled generically on purpose, since the UI must never claim
// a specific set of positions it cannot verify for this account.
export const PLACEMENT_LABELS = {
  home_banner: 'Banner na página inicial',
  community_banner: 'Banner da comunidade',
  community_feed: 'Feed da comunidade',
  progress_banner: 'Banner no Progresso',
  network: 'Vários espaços do Evolutus',
}

export function placementLabel(code) {
  return PLACEMENT_LABELS[code] || 'Posição não identificada'
}

// A campaign's `placements` (from get_advertising_campaigns) are already the expanded,
// real codes — never the literal 'network' — so more than one distinct code means the
// campaign is actually running across several real positions.
export function placementsSummary(placements) {
  const codes = [...new Set((placements || []).map((p) => p.code))]
  if (codes.length === 0) return 'Posição não identificada'
  if (codes.length === 1) return placementLabel(codes[0])
  return PLACEMENT_LABELS.network
}
