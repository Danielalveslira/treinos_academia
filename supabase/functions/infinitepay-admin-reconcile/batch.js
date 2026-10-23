import { verifyAndConfirm } from '../_shared/infinitepay.js'

// Sequential and bounded: no new per-user polling or second settlement path.
export async function reconcileBatch({ admin, handle, apiKey, fetcher = fetch, limit = 2 }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new Error('INVALID_BATCH_SIZE')
  const { data, error } = await admin.rpc('claim_infinitepay_reconciliation_batch', { p_limit: limit })
  if (error) throw new Error('RECONCILIATION_CLAIM_FAILED')
  const result = { checked: 0, confirmed: 0, failed: 0 }
  for (const hint of data ?? []) {
    try {
      const outcome = await verifyAndConfirm({ admin, handle, apiKey, hint, fetcher })
      result.checked++
      if (outcome.confirmed) result.confirmed++
    } catch { result.failed++ } // IDs/evidence persist in database, never log payload.
    finally {
      try {
        const { error } = await admin.rpc('finish_infinitepay_reconciliation_item', { p_order_nsu: hint.orderNsu, p_claim_token: hint.claimToken })
        if (error) result.failed++
      } catch { result.failed++ } // lease expiry safely recovers an interrupted finish
    }
  }
  return result
}
