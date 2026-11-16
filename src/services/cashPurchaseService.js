import { supabase } from '../supabase/config'

const PAGE_SIZE = 25

export function mapPurchaseRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    purchaseLabel: row.quote_id ? `${row.cash_amount} EvoCash` : row.package_label,
    quoteId: row.quote_id,
    checkoutValidUntil: row.checkout_valid_until,
    cashAmount: row.cash_amount,
    amountCentavos: row.amount_centavos,
    currency: row.currency,
    status: row.status,
    paymentProvider: row.payment_provider,
    checkoutUrl: row.checkout_url,
    checkoutUncertain: row.checkout_uncertain,
    checkoutHttpStatus: row.checkout_http_status,
    orderNsu: row.provider_order_nsu,
    transactionNsu: row.provider_transaction_nsu,
    paidAfterCancelAt: row.paid_after_cancel_at,
    captureMethod: row.provider_capture_method,
    createdAt: row.created_at,
    creditedAt: row.credited_at,
    creditedBy: row.credited_by,
    confirmationNote: row.confirmation_note,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
    reviewReason: row.review_reason,
    reviewFlaggedAt: row.review_flagged_at,
    reviewResolvedAt: row.review_resolved_at,
    reviewResolution: row.review_resolution,
    reversedCentavos: row.reversed_centavos ?? 0,
  }
}

// Server-owned current price and public purchasing limits; no package catalog.
export async function getCashPurchaseSettings() {
  const { data, error } = await supabase.rpc('get_evocash_purchase_settings')
  if (error) throw error
  return data
}

async function callPaymentFunction(name, body) {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr) throw sessionErr
  if (!sessionData.session) throw new Error('NOT_AUTHENTICATED')
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(result?.error || 'REQUEST_FAILED')
  }
  return result
}

export function requestCashPurchase({ quoteId, requestId }) {
  return callPaymentFunction('infinitepay-create-checkout', { quoteId, requestId })
}

export function checkInfinitepayPurchase(purchaseId, hints = {}) {
  return callPaymentFunction('infinitepay-check-payment', { purchaseId, ...hints })
}

export async function cancelMyCashPurchase(purchaseId) {
  const { data, error } = await supabase.rpc('cancel_my_cash_purchase', {
    p_purchase_id: purchaseId,
  })
  if (error) throw error
  return data
}

// Fallback administrativo para uma compra InfinitePay pendente sem pagamento confirmado
// (ex.: comprador com conta desativada, que nunca pode voltar ao app pra cancelar sozinho).
// Nunca credita nada -- um pagamento confirmado tardiamente ainda é reconciliado depois.
export async function adminCancelInfinitepayCashPurchase(purchaseId, reason) {
  const { data, error } = await supabase.rpc('admin_cancel_infinitepay_cash_purchase', {
    p_purchase_id: purchaseId,
    p_reason: reason,
  })
  if (error) throw error
  return data
}

// Registra a decisão humana (reembolso/reativação) para uma compra que
// confirm_infinitepay_cash_purchase marcou como needs_review -- pagamento confirmado pelo
// provedor numa conta desativada, nunca creditado automaticamente.
export async function adminResolveCashPurchaseReview(purchaseId, resolution, note) {
  const { data, error } = await supabase.rpc('admin_resolve_cash_purchase_review', {
    p_purchase_id: purchaseId,
    p_resolution: resolution,
    p_note: note,
  })
  if (error) throw error
  return data
}

// Pré-visualização para o diálogo de confirmação: nome e e-mail MASCARADO do destinatário
// (nunca o e-mail real -- a máscara é calculada no servidor). Revalidado de novo, de forma
// autoritativa, dentro de requestCashPurchaseReminder -- esta chamada é só para mostrar ao
// admin antes do clique de confirmação.
export async function getCashPurchaseReminderPreview(purchaseId) {
  const { data, error } = await supabase.rpc('admin_get_cash_purchase_reminder_preview', {
    p_purchase_id: purchaseId,
  })
  if (error) throw error
  return {
    username: data.username,
    maskedEmail: data.maskedEmail,
    lastSentAt: data.lastSentAt,
    cooldownUntil: data.cooldownUntil,
    canSend: data.canSend,
    reason: data.reason,
  }
}

// Só enfileira (fila + worker assíncrono, ver migration 20261105000004) -- nunca envia o
// e-mail de forma síncrona aqui. Revalida tudo no servidor: compra pendente, conta ativa,
// cooldown por compra e limite diário por destinatário.
export async function requestCashPurchaseReminder(purchaseId) {
  const { data, error } = await supabase.rpc('admin_request_cash_purchase_reminder', {
    p_purchase_id: purchaseId,
  })
  if (error) throw error
  return data
}

// Uma consulta para a página inteira (nunca uma por linha) -- reduz a `created_at` mais
// recente por compra, no mesmo espírito de resolveUsernamesByIds.
export async function getLatestCashPurchaseReminders(purchaseIds) {
  const uniqueIds = [...new Set(purchaseIds)].filter(Boolean)
  if (uniqueIds.length === 0) return {}
  const { data, error } = await supabase
    .from('cash_purchase_reminder_emails')
    .select('purchase_id, status, created_at, sent_at')
    .in('purchase_id', uniqueIds)
    .order('created_at', { ascending: false })
  if (error) throw error
  const latestByPurchase = {}
  for (const row of data) {
    if (!latestByPurchase[row.purchase_id]) {
      latestByPurchase[row.purchase_id] = {
        status: row.status,
        createdAt: row.created_at,
        sentAt: row.sent_at,
      }
    }
  }
  return latestByPurchase
}

export async function listMyCashPurchasesPage(userId, { cursor = null } = {}) {
  let q = supabase
    .from('cash_purchases')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)
  if (cursor) q = q.lt('created_at', cursor)
  const { data, error } = await q
  if (error) throw error
  return {
    items: data.map(mapPurchaseRow),
    nextCursor: data.length === PAGE_SIZE ? data.at(-1).created_at : null,
  }
}

// A compra pendente pode estar além da primeira página do histórico.
export async function getMyPendingCashPurchase(userId) {
  const { data, error } = await supabase
    .from('cash_purchases')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data[0] ? mapPurchaseRow(data[0]) : null
}

export async function listCashPurchasesForAdminPage({ status = '', cursor = null } = {}) {
  let q = supabase
    .from('cash_purchases')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)
  if (status === 'paid') q = q.in('status', ['credited', 'held_in_case'])
  else if (status === 'failed') q = q.eq('status', 'checkout_failed')
  else if (status) q = q.eq('status', status)
  if (cursor) q = q.lt('created_at', cursor)
  const { data, error } = await q
  if (error) throw error
  return {
    items: data.map(mapPurchaseRow),
    nextCursor: data.length === PAGE_SIZE ? data.at(-1).created_at : null,
  }
}

const USER_LOOKUP_CHUNK_SIZE = 30 // tamanho de lote arbitrário, mantido por consistência com os outros chunkings do app

// Resolve o username de vários compradores de uma vez só -- nunca uma leitura por card
// na lista do admin (evita N+1).
export async function resolveUsernamesByIds(userIds) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean)
  const usernameById = {}
  for (let i = 0; i < uniqueIds.length; i += USER_LOOKUP_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + USER_LOOKUP_CHUNK_SIZE)
    const { data, error } = await supabase
      .from('public_profiles')
      .select('user_id, username')
      .in('user_id', chunk)
    if (error) throw error
    for (const row of data) usernameById[row.user_id] = row.username || null
  }
  return usernameById
}

export async function getAdminCashReversalEvents(purchaseId) {
  const { data, error } = await supabase.rpc('admin_cash_reversal_events', {
    p_purchase_id: purchaseId,
  })
  if (error) throw error
  return data ?? []
}
