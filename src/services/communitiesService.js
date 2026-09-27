import { supabase } from '../supabase/config'
import { COMMUNITY_ICON_NAMES, DEFAULT_COMMUNITY_ICON_NAME } from '../constants/communityIcons'

function resolveIconName(iconName) {
  return COMMUNITY_ICON_NAMES.includes(iconName) ? iconName : DEFAULT_COMMUNITY_ICON_NAME
}

// Teto de defesa: comunidades só são criadas pelo superadmin pelo painel (ou via
// privilégio pago, fora do escopo do núcleo), mas sem isso a leitura escala com o
// tamanho da tabela — bem acima de qualquer uso real do app.
const MAX_COMMUNITIES = 200

function toDoc(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    iconName: row.icon_name,
    isActive: row.is_active,
    postAccess: row.post_access,
    memberCount: row.member_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
    ownerId: row.owner_id,
    deletionStatus: row.deletion_status,
  }
}

export async function listActiveCommunities() {
  const { data, error } = await supabase
    .from('communities')
    .select('*')
    .eq('is_active', true)
    .order('name')
    .limit(MAX_COMMUNITIES)
  if (error) throw error
  return data.map(toDoc)
}

export async function listCommunitiesPage(cursor = null, pageSize = 25) {
  let q = supabase.from('communities').select('*').order('name').limit(pageSize)
  if (cursor) q = q.gt('name', cursor)
  const { data, error } = await q
  if (error) throw error
  return {
    items: data.map(toDoc),
    nextCursor: data.length === pageSize ? data.at(-1).name : null,
  }
}

export async function getCommunity(communityId) {
  const { data, error } = await supabase
    .from('communities')
    .select('*')
    .eq('id', communityId)
    .maybeSingle()
  if (error) throw error
  return data ? toDoc(data) : null
}

// Fase 5: comunidade OFICIAL criada pelo painel admin nasce DE PROPÓSITO sem owner_id
// — continua administrada globalmente por is_superadmin(), nunca por um uid
// específico. Só o privilégio pago (economia, ainda não portado) grava owner_id.
export async function createCommunity(userId, community) {
  const { error } = await supabase.from('communities').insert({
    name: community.name.trim(),
    description: community.description?.trim() || '',
    icon_name: resolveIconName(community.iconName),
    is_active: true,
    post_access: community.postAccess === 'admins' ? 'admins' : 'everyone',
    created_by: userId,
  })
  if (error) throw error
}

export async function updateCommunity(communityId, community) {
  const { error } = await supabase
    .from('communities')
    .update({
      name: community.name.trim(),
      description: community.description?.trim() || '',
      icon_name: resolveIconName(community.iconName),
      is_active: community.isActive,
      post_access: community.postAccess === 'admins' ? 'admins' : 'everyone',
    })
    .eq('id', communityId)
  if (error) throw error
}

export async function setCommunityActive(communityId, isActive) {
  const { error } = await supabase.from('communities').update({ is_active: isActive }).eq('id', communityId)
  if (error) throw error
}

export async function deleteCommunity(communityId) {
  const { error } = await supabase.rpc('queue_deletion', { p_kind: 'community', p_target_id: communityId })
  if (error) throw error
}
