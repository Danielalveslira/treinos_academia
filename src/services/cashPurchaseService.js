import { supabase } from '../supabase/config'

const PAGE_SIZE = 25

export function mapPurchaseRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    packageId: row.package_id,
    packageLabel: row.package_label,
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
  }
}

// Preço/quantidade sempre vêm daqui (economy_config), nunca de um valor digitado -- o
// cliente só manda o packageId escolhido (ver requestCashPurchase). Lido direto via
// client SDK (RLS já libera leitura de economy_config a qualquer autenticado), sem RPC
// própria -- é só exibição; reserve_infinitepay_cash_purchase revalida no servidor.
export async function getCashPurchaseSettings() {
  const { data, error } = await supabase.from('economy_config').select('config').eq('id', true).maybeSingle()
  if (error) throw error
  const cashPackages = data?.config?.cashPackages || {}
  const packages = Object.entries(cashPackages)
    .filter(([, pkg]) => pkg?.active === true)
    .map(([packageId, pkg]) => ({ packageId, ...pkg }))
  return { packages }
}

// A função reserva a compra e gera order_nsu no servidor; o cliente envia só packageId.
async function callPaymentFunction(name, body) {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr) throw sessionErr
  if (!sessionData.session) throw new Error('NOT_AUTHENTICATED')
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
    body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(result?.error || 'REQUEST_FAILED')
  }
  return result
}

export function requestCashPurchase({ packageId }) {
  return callPaymentFunction('infinitepay-create-checkout', { packageId })
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

export async function listMyCashPurchasesPage(userId, { cursor = null } = {}) {
  let q = supabase.from('cash_purchases').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(PAGE_SIZE)
  if (cursor) q = q.lt('created_at', cursor)
  const { data, error } = await q
  if (error) throw error
  return {
    items: data.map(mapPurchaseRow),
    nextCursor: data.length === PAGE_SIZE ? data.at(-1).created_at : null,
  }
}

export async function listCashPurchasesForAdminPage({ status = '', cursor = null } = {}) {
  let q = supabase.from('cash_purchases').select('*').order('created_at', { ascending: false }).limit(PAGE_SIZE)
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
    const { data, error } = await supabase.from('public_profiles').select('user_id, username').in('user_id', chunk)
    if (error) throw error
    for (const row of data) usernameById[row.user_id] = row.username || null
  }
  return usernameById
}
