// Single source of truth for "what should this advertiser see as the status of this
// campaign". Reads only fields already returned by get_advertising_campaigns (RPC) —
// no per-card network calls. `now` is always injectable so tests never depend on the
// real clock (see src/components/FeaturedSpotlight.jsx for the pattern this follows).
//
// Precedence (highest wins):
//   archived > suspended > never-approved draft lifecycle > approved delivery lifecycle
//
// Once a campaign has been approved at least once (moderation_state === 'approved'),
// a later edit never flips it back to "Em análise": the last approved material keeps
// serving while the new revision is reviewed separately (pendingRevision).
export function deriveAdStatus(campaign, { now = Date.now() } = {}) {
  const c = campaign || {}
  const nowMs = now instanceof Date ? now.getTime() : now
  const expiresAt = c.expires_at ? new Date(c.expires_at).getTime() : null
  const startsAt = c.starts_at ? new Date(c.starts_at).getTime() : null
  const hasEntitlement = expiresAt != null
  const expired = hasEntitlement && expiresAt <= nowMs
  const notStartedYet = hasEntitlement && startsAt != null && startsAt > nowMs
  const remainingDays = hasEntitlement && !expired ? Math.ceil((expiresAt - nowMs) / 86400000) : null

  if (c.moderation_state === 'archived' || c.state === 'archived') {
    return {
      key: 'archived',
      label: 'Arquivado',
      detail: null,
      pendingRevision: false,
      pendingRevisionNote: null,
      remainingDays: null,
      primaryAction: null,
    }
  }
  if (c.moderation_state === 'suspended') {
    return {
      key: 'paused',
      label: 'Pausado',
      detail: c.review_reason || 'Veiculação interrompida. Consulte o histórico para o motivo.',
      pendingRevision: false,
      pendingRevisionNote: null,
      remainingDays: null,
      primaryAction: { type: 'view_reason', label: 'Ver motivo' },
    }
  }

  if (c.moderation_state !== 'approved') {
    // Never approved yet: state alone tells the whole story.
    if (c.state === 'rejected') {
      return {
        key: 'rejected',
        label: 'Reprovado',
        detail: c.review_reason || null,
        pendingRevision: false,
        pendingRevisionNote: null,
        remainingDays: null,
        primaryAction: { type: 'edit', label: 'Corrigir anúncio' },
      }
    }
    if (c.state === 'submitted') {
      return {
        key: 'submitted',
        label: 'Em análise',
        detail: 'Aguardando aprovação do Evolutus.',
        pendingRevision: false,
        pendingRevisionNote: null,
        remainingDays: null,
        primaryAction: { type: 'track_review', label: 'Acompanhar aprovação' },
      }
    }
    return {
      key: 'draft',
      label: 'Rascunho',
      detail: null,
      pendingRevision: false,
      pendingRevisionNote: null,
      remainingDays: null,
      primaryAction: { type: 'edit', label: 'Continuar edição' },
    }
  }

  // Approved at least once: the live material's own status is driven by contracting
  // and delivery signals, never by whether a newer revision exists.
  // Whether contracting is even possible right now (salesEnabled) is independent of
  // whether THIS user is allowed to do it (can_pay, checked separately by the caller) —
  // a disabled sales gate must never be hidden behind a "Contratar"/"Renovar" CTA.
  const salesOff = c.tariff?.salesEnabled === false
  let base
  if (!hasEntitlement) {
    base = {
      key: 'approved_unpaid',
      label: 'Aprovado — aguardando contratação',
      detail: salesOff ? 'Contratações ainda indisponíveis.' : null,
      remainingDays: null,
      primaryAction: salesOff
        ? { type: 'wait', label: 'Contratações ainda indisponíveis' }
        : { type: 'contract', label: 'Contratar publicação' },
    }
  } else if (expired) {
    base = {
      key: 'ended',
      label: `Encerrado em ${new Date(expiresAt).toLocaleDateString('pt-BR')}`,
      detail: salesOff ? 'Contratações ainda indisponíveis.' : null,
      remainingDays: null,
      primaryAction: salesOff
        ? { type: 'wait', label: 'Contratações ainda indisponíveis' }
        : { type: 'contract', label: 'Renovar' },
    }
  } else if (notStartedYet) {
    base = {
      key: 'contracted_pending_start',
      label: 'Contratado — aguardando início',
      detail: null,
      remainingDays,
      primaryAction: { type: 'view_schedule', label: 'Consultar período' },
    }
  } else if (c.delivery_state === 'active' && c.placement_delivery_active) {
    base = {
      key: 'live',
      label: 'Apto para exibição',
      detail: null,
      remainingDays,
      primaryAction: { type: 'view', label: 'Ver anúncio' },
    }
  } else if (c.delivery_state === 'active' && c.placement_delivery_active === false) {
    base = {
      key: 'blocked',
      label: 'Contratado — veiculação pausada pela plataforma',
      detail: 'O posicionamento contratado está temporariamente indisponível para entrega.',
      remainingDays,
      primaryAction: { type: 'view_schedule', label: 'Consultar período' },
    }
  } else {
    base = {
      key: 'blocked',
      label: 'Não disponível para exibição',
      detail: 'A contratação é válida, mas a exibição está bloqueada administrativamente.',
      remainingDays,
      primaryAction: { type: 'view_schedule', label: 'Consultar período' },
    }
  }

  const pendingRevision = c.state === 'submitted' || c.state === 'rejected'
  if (!pendingRevision) return { ...base, pendingRevision: false, pendingRevisionNote: null }
  const pendingRevisionNote =
    c.state === 'rejected'
      ? `Revisão enviada foi reprovada${c.review_reason ? `: ${c.review_reason}` : '.'}`
      : 'Uma atualização enviada está em análise. O material em exibição não muda até a aprovação.'
  return {
    ...base,
    label: `${base.label} — ${c.state === 'rejected' ? 'revisão reprovada' : 'atualização em análise'}`,
    pendingRevision: true,
    pendingRevisionNote,
    primaryAction:
      c.state === 'rejected'
        ? { type: 'edit', label: 'Corrigir revisão' }
        : { type: 'track_review', label: 'Acompanhar revisão' },
  }
}
