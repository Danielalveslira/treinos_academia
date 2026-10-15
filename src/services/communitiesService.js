import { supabase } from '../supabase/config'
import { COMMUNITY_ICON_NAMES, DEFAULT_COMMUNITY_ICON_NAME } from '../constants/communityIcons'
import { compressImage } from '../utils/imageCompression'

// Maior uso da capa é .community-explore-cover em cards de ~2 colunas (ver app.css) --
// 960px cobre isso com folga de densidade de pixel, bem abaixo do teto genérico de
// 1600px (pensado para fotos de status em largura cheia). file_size_limit do bucket
// community-covers (ver migration) é o mesmo teto de 4MB do status-photos.
export const COMMUNITY_COVER_MAX_DIMENSION = 960
const MAX_COVER_BYTES = 4 * 1024 * 1024

function resolveIconName(iconName) {
  return COMMUNITY_ICON_NAMES.includes(iconName) ? iconName : DEFAULT_COMMUNITY_ICON_NAME
}

// Teto de defesa: comunidades só são criadas pelo superadmin pelo painel (ou via
// privilégio pago, fora do escopo do núcleo), mas sem isso a leitura escala com o
// tamanho da tabela — bem acima de qualquer uso real do app.
const MAX_COMMUNITIES = 200

// Exportado para promotionsService.js (listFeaturedCommunities) reaproveitar a mesma
// forma camelCase, em vez de duplicar o mapeamento.
export function mapCommunityRow(row) {
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
    promoted: row.promoted,
    promotedUntil: row.promoted_until,
    activePromotionId: row.active_promotion_id,
    tier: row.tier,
    postRetentionMode: row.post_retention_mode,
    coverPath: row.cover_path,
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
  return data.map(mapCommunityRow)
}

export async function listCommunitiesPage(cursor = null, pageSize = 25) {
  let q = supabase.from('communities').select('*').order('name').limit(pageSize)
  if (cursor) q = q.gt('name', cursor)
  const { data, error } = await q
  if (error) throw error
  return {
    items: data.map(mapCommunityRow),
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
  return data ? mapCommunityRow(data) : null
}

export async function getCommunitySummary(communityId) {
  const { data, error } = await supabase
    .from('communities')
    .select('id,name,owner_id')
    .eq('id', communityId)
    .maybeSingle()
  if (error) throw error
  return data ? { id: data.id, name: data.name, ownerId: data.owner_id } : null
}

// Fase 5: comunidade OFICIAL criada pelo painel admin nasce DE PROPÓSITO sem owner_id
// — continua administrada globalmente por is_superadmin(), nunca por um uid
// específico. Só o privilégio pago (economia, ainda não portado) grava owner_id.
export async function createCommunity(userId, community) {
  const { data, error } = await supabase
    .from('communities')
    .insert({
      name: community.name.trim(),
      description: community.description?.trim() || '',
      icon_name: resolveIconName(community.iconName),
      is_active: true,
      post_access: community.postAccess === 'admins' ? 'admins' : 'everyone',
      created_by: userId,
    })
    .select('id')
    .single()
  if (error) throw error
  // AdminCommunities.jsx usa o id pra abrir a comunidade recém-criada direto em edição
  // (onde fica o upload de capa -- não dá pra escolher a capa na criação, o caminho no
  // Storage é {communityId}.webp e a comunidade só ganha id depois de inserida).
  return data.id
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

// Caminho determinístico {communityId}.webp -- sempre sobrescrito (upsert), igual
// comentado na migration: o storage policy só libera esse caminho pra quem já poderia
// dar update() na própria comunidade (dono ou superadmin).
export async function uploadCommunityCover(communityId, file) {
  const blob = await compressImage(file, { maxDimension: COMMUNITY_COVER_MAX_DIMENSION })
  if (blob.size > MAX_COVER_BYTES) throw new Error('COVER_TOO_LARGE')
  const path = `${communityId}.webp`
  const { error: uploadErr } = await supabase.storage
    .from('community-covers')
    .upload(path, blob, { contentType: 'image/webp', upsert: true })
  if (uploadErr) throw uploadErr
  const { error } = await supabase.from('communities').update({ cover_path: path }).eq('id', communityId)
  if (error) throw error
  return path
}

export async function getCommunityCoverBlob(coverPath) {
  const { data, error } = await supabase.storage.from('community-covers').download(coverPath)
  if (error) throw error
  return data
}
