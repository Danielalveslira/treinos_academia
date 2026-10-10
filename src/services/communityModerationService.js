import { supabase } from '../supabase/config'

// Fase 5 — caminho DEDICADO para banir/desbanir de UMA comunidade (nunca
// decide_support_request, ver migration community_member_ban.sql). Autorizado por
// superadmin OU community.owner_id===uid; um community_ban aplicado pela moderação
// global (com decision_id) só pode ser desfeito por um superadmin, nunca pelo dono —
// tudo reforçado dentro da própria RPC.
export async function setCommunityMemberBan({ communityId, targetUserId, banned, reason }) {
  const { error } = await supabase.rpc('set_community_member_ban', {
    p_community_id: communityId,
    p_target_user_id: targetUserId,
    p_banned: banned,
    p_reason: reason,
  })
  if (error) throw error
}

// Só quem as policies já deixam (superadmin, ou o dono da própria comunidade) consegue
// listar as restrições dela — usado para saber quem já está banido antes de oferecer
// banir/desbanir na UI.
export async function listCommunityRestrictions(communityId) {
  const { data, error } = await supabase.rpc('list_community_restrictions', {
    p_community_id: communityId,
  })
  if (error) throw error
  return data.map((row) => ({
    id: `${row.community_id}_${row.user_id}`,
    communityId: row.community_id,
    userId: row.user_id,
    decisionId: row.decision_id,
    bannedBy: row.banned_by,
    reason: row.reason,
    createdAt: row.created_at,
  }))
}

// REMOVER (distinto de banir): tira o vínculo agora e não cria restrição -- a pessoa perde o acesso
// interno imediatamente e pode entrar de novo. Autorizado só no servidor (superadmin ou dono).
export async function removeCommunityMember({ communityId, targetUserId }) {
  const { error } = await supabase.rpc('remove_community_member', {
    p_community_id: communityId,
    p_target_user_id: targetUserId,
  })
  if (error) throw error
}
