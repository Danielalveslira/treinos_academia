import { supabase } from '../supabase/config'

// Mesmo teto de statusesService.getStatusPhotoBlob — a evidência é uma cópia do
// mesmo tipo de arquivo (foto de publicação, sempre .webp).
const MAX_EVIDENCE_DOWNLOAD_BYTES = 5 * 1024 * 1024

function toDoc(row) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    message: row.message,
    statusId: row.status_id,
    commentId: row.comment_id,
    communityId: row.community_id,
    decisionId: row.decision_id,
    category: row.category,
    listingId: row.listing_id,
    listingOwnerId: row.listing_owner_id,
    listingKind: row.listing_kind,
    contentSnapshot: row.content_snapshot,
    state: row.state,
    createdAt: row.created_at,
    response: row.response,
    decidedAt: row.decided_at,
  }
}

// Visão do admin já vem com o contexto da vitrine resolvido em lote (nome atual, estado
// atual) pela própria RPC -- nunca uma chamada por linha (ver admin_list_support_requests).
function toAdminDoc(item) {
  return {
    id: item.id,
    userId: item.userId,
    kind: item.kind,
    message: item.message,
    statusId: item.statusId,
    commentId: item.commentId,
    communityId: item.communityId,
    decisionId: item.decisionId,
    category: item.category,
    listingId: item.listingId,
    listingOwnerId: item.listingOwnerId,
    listingKind: item.listingKind,
    listingDisplayName: item.listingDisplayName,
    listingLifecycleState: item.listingLifecycleState,
    contentSnapshot: item.contentSnapshot,
    state: item.state,
    createdAt: item.createdAt,
    response: item.response,
    decidedAt: item.decidedAt,
    isProtectedTeen: item.isProtectedTeen,
  }
}

export async function listSupportRequestsPage(
  userId,
  admin = false,
  { state = '', listingId = null, cursor = null } = {}
) {
  if (admin) {
    const { data, error } = await supabase.rpc('admin_list_support_requests', {
      p_state: state,
      p_listing_id: listingId,
      p_cursor: cursor,
      p_page_size: 25,
    })
    if (error) throw error
    return { items: data.items.map(toAdminDoc), nextCursor: data.nextCursor }
  }
  let q = supabase
    .from('support_requests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(25)
  if (cursor) q = q.lt('created_at', cursor)
  const { data, error } = await q
  if (error) throw error
  return {
    items: data.map(toDoc),
    nextCursor: data.length === 25 ? data.at(-1).created_at : null,
  }
}

export async function listModerationNotices(userId) {
  const { data, error } = await supabase
    .from('notices')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data.map((row) => ({
    id: row.id,
    action: row.action,
    rule: row.rule,
    reason: row.reason,
    communityId: row.community_id,
    until: row.until,
    createdAt: row.created_at,
  }))
}

// AUD-007: se a denúncia é de uma publicação do tipo foto, copia o arquivo pro bucket
// de evidência (fora do ciclo de vida da publicação original — sobrevive à expiração
// de 24h ou exclusão). No main isso roda no servidor (Admin SDK, dentro da própria
// Cloud Function); aqui, sem Edge Function ainda, quem denuncia baixa a foto original
// (já tem permissão de leitura como membro) e reenvia — best-effort, a denúncia já é
// válida mesmo que a cópia falhe.
export async function submitSupportRequest(values) {
  const { data, error } = await supabase.rpc('submit_support_request', {
    payload: {
      kind: values.kind,
      message: values.message,
      statusId: values.statusId || '',
      listingId: values.listingId || '',
      category: values.category || '',
      communityId: values.communityId || '',
      decisionId: values.decisionId || '',
    },
  })
  if (error) throw error
  if (data.sourcePhotoPath) {
    try {
      const objectPath = data.sourcePhotoPath.replace(/^statusPhotos\//, '')
      const { data: blob, error: downloadError } = await supabase.storage
        .from('status-photos')
        .download(objectPath)
      if (downloadError) throw downloadError
      const { error: uploadError } = await supabase.storage
        .from('moderation-evidence')
        .upload(`${data.id}.webp`, blob, { contentType: 'image/webp' })
      if (uploadError) throw uploadError
      await supabase.rpc('record_support_evidence', { p_request_id: data.id })
    } catch (evidenceError) {
      console.error('[Support] evidence copy failed:', evidenceError)
    }
  }
  return { id: data.id }
}

export async function decideSupportRequest(values) {
  const { data, error } = await supabase.rpc('decide_support_request', {
    payload: {
      requestId: values.requestId,
      action: values.action,
      reason: values.reason,
      rule: values.rule,
      evidence: values.evidence,
      targetUserId: values.targetUserId || '',
      communityId: values.communityId || '',
      days: values.days,
    },
  })
  if (error) throw error
  return { id: data }
}

export async function cancelSupportRequest(requestId) {
  const { error } = await supabase.rpc('cancel_support_request', { p_request_id: requestId })
  if (error) throw error
}

export async function getModerationEvidenceBlob(evidencePath) {
  const objectPath = evidencePath.replace(/^moderationEvidence\//, '')
  const { data, error } = await supabase.storage.from('moderation-evidence').download(objectPath)
  if (error) throw error
  if (data.size > MAX_EVIDENCE_DOWNLOAD_BYTES) throw new Error('EVIDENCE_TOO_LARGE')
  return data
}
