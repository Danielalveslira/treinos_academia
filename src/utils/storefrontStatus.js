// Single source of truth for "what should the owner see as the status of this storefront",
// mirroring the same philosophy as src/utils/advertisingStatus.js: a pure function over
// fields already returned by private.storefront_json (via list_managed_storefronts), one
// precedence order, `now` always injectable for tests.
//
// Precedence: archived > suspended (editorial OR entitlement-level) > never-approved
// draft lifecycle > approved/published lifecycle.
//
// `hasPublishedVersion` becomes true at the moment of first approval, even before any
// contract exists — that is exactly "Aprovada, aguardando contratação": approval and
// publication are different facts, and this function never conflates them.
export function deriveStorefrontStatus(item, { now = Date.now(), tariff } = {}) {
  const s = item || {}
  const nowMs = now instanceof Date ? now.getTime() : now
  const expiresAt = s.expiresAt ? new Date(s.expiresAt).getTime() : null
  const hasEntitlement = expiresAt != null
  const expired = hasEntitlement && expiresAt <= nowMs
  const remainingDays = hasEntitlement && !expired ? Math.ceil((expiresAt - nowMs) / 86400000) : null
  // Whether contracting is actually possible right now (sales enabled platform-wide, and
  // the backend's own canContract flag) is independent of who is allowed to click it —
  // a closed sales gate must never be hidden behind a "Contratar"/"Renovar" CTA.
  const contractingBlocked = tariff?.salesEnabled !== true || s.canContract !== true

  if (s.editorialState === 'archived') {
    return {
      key: 'archived',
      label: 'Arquivada',
      detail: null,
      pendingRevision: false,
      pendingRevisionNote: null,
      remainingDays: null,
      primaryAction: null,
    }
  }
  if (s.editorialState === 'suspended' || s.publicationState === 'suspended' || s.publicationState === 'revoked') {
    return {
      key: 'suspended',
      label: 'Suspensa',
      detail: s.lastDecision || 'Consulte o histórico para o motivo.',
      pendingRevision: false,
      pendingRevisionNote: null,
      remainingDays: null,
      primaryAction: { type: 'view_reason', label: 'Ver motivo' },
    }
  }

  if (!s.hasPublishedVersion) {
    if (s.draftState === 'rejected') {
      return {
        key: 'rejected',
        label: 'Reprovada',
        detail: s.lastDecision || null,
        pendingRevision: false,
        pendingRevisionNote: null,
        remainingDays: null,
        primaryAction: { type: 'edit', label: 'Corrigir vitrine' },
      }
    }
    if (s.draftState === 'submitted') {
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

  let base
  if (!hasEntitlement) {
    base = {
      key: 'approved_unpaid',
      label: 'Aprovada — aguardando contratação',
      detail: contractingBlocked ? 'Contratações ainda indisponíveis.' : null,
      remainingDays: null,
      primaryAction: contractingBlocked
        ? { type: 'wait', label: 'Contratações ainda indisponíveis' }
        : { type: 'contract', label: 'Contratar publicação' },
    }
  } else if (expired) {
    base = {
      key: 'ended',
      label: `Encerrada em ${new Date(expiresAt).toLocaleDateString('pt-BR')}`,
      detail: contractingBlocked ? 'Contratações ainda indisponíveis.' : null,
      remainingDays: null,
      primaryAction: contractingBlocked
        ? { type: 'wait', label: 'Contratações ainda indisponíveis' }
        : { type: 'contract', label: 'Renovar' },
    }
  } else if (s.publicationState === 'active') {
    base = {
      key: 'live',
      label: 'Publicada',
      detail: null,
      remainingDays,
      primaryAction: { type: 'view', label: 'Ver minha vitrine' },
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

  const pendingRevision = s.draftState === 'submitted' || s.draftState === 'rejected'
  if (!pendingRevision) return { ...base, pendingRevision: false, pendingRevisionNote: null }
  const pendingRevisionNote =
    s.draftState === 'rejected'
      ? `Revisão enviada foi reprovada${s.lastDecision ? `: ${s.lastDecision}` : '.'}`
      : 'Uma atualização enviada está em análise. A vitrine publicada não muda até a aprovação.'
  return {
    ...base,
    label: `${base.label} — ${s.draftState === 'rejected' ? 'revisão reprovada' : 'atualização em análise'}`,
    pendingRevision: true,
    pendingRevisionNote,
    primaryAction:
      s.draftState === 'rejected'
        ? { type: 'edit', label: 'Corrigir revisão' }
        : { type: 'track_review', label: 'Acompanhar revisão' },
  }
}
