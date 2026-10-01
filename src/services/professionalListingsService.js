import { supabase } from '../supabase/config'

export const LISTING_KIND_VALUES = ['professional', 'space']

export function createProfessionalListing(kind) {
  return supabase.rpc('create_professional_listing', { p_kind: kind }).then(unwrap)
}

export function saveProfessionalListing(listingId, draft) {
  return supabase.rpc('save_professional_listing_draft', { p_listing_id: listingId, p_draft: draft }).then(unwrap)
}

// Fase 1 apenas (ver migration 20260929000005_professional_listings.sql, atualizada por
// 20261001000002_showcase_terms_acknowledgement.sql): a fase 2 (copiar o avatar
// autorizado, exigida só quando useProfileAvatar=true) depende de uma Edge Function que
// ainda não existe -- isso continua pendente independente dos Termos da Vitrine (ver
// nota na migration). Publicar não depende mais de aceite/ciência de termos nenhuma.
export function publishProfessionalListing(listingId, operationId) {
  return supabase
    .rpc('prepare_professional_listing_publish', {
      p_listing_id: listingId,
      p_operation_id: operationId,
    })
    .then(unwrap)
}

export function unpublishProfessionalListing(listingId) {
  return supabase.rpc('unpublish_professional_listing', { p_listing_id: listingId }).then(unwrap)
}

export function suspendProfessionalListing(listingId, reason) {
  return supabase.rpc('suspend_professional_listing', { p_listing_id: listingId, p_reason: reason }).then(unwrap)
}

export function deleteProfessionalListing(listingId) {
  return supabase.rpc('delete_professional_listing', { p_listing_id: listingId }).then(unwrap)
}

export function getMyProfessionalListing() {
  return supabase.rpc('get_my_professional_listing').then(unwrap)
}

// Histórico do antigo fluxo (aceite = pré-condição de publicar) -- preservado, nunca
// mais escrito. Nenhuma tela ativa chama isto hoje; fica só pra leitura/auditoria.
export async function getShowcaseLegalAcceptance(userId, version) {
  const { data, error } = await supabase
    .from('showcase_legal_acceptances')
    .select('*')
    .eq('user_id', userId)
    .eq('version', version)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    userId: data.user_id,
    listingId: data.listing_id,
    operationId: data.operation_id,
    documentId: data.document_id,
    version: data.version,
    digest: data.digest,
    acceptedAt: data.accepted_at,
  }
}

// Versão hoje publicada dos Termos da Vitrine, segundo o servidor -- nunca o manifesto
// estático do bundle, que pode estar desatualizado numa aba aberta há tempo. Sempre
// exatamente 1 linha (id boolean primary key default true).
export async function getActiveShowcasePolicy() {
  const { data, error } = await supabase.from('showcase_legal_policy').select('*').single()
  if (error) throw error
  return {
    documentId: data.document_id,
    version: data.version,
    digest: data.digest,
    published: data.published,
    publishedAt: data.published_at,
  }
}

// Ciência (não aceite) da versão vigente -- ver acknowledge_showcase_terms(). Nunca é
// condição de publicar; só decide se o aviso de "Termos atualizados" aparece.
export async function getShowcaseLegalAcknowledgement(userId, version) {
  const { data, error } = await supabase
    .from('showcase_legal_acknowledgements')
    .select('*')
    .eq('user_id', userId)
    .eq('version', version)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    userId: data.user_id,
    documentId: data.document_id,
    version: data.version,
    digest: data.digest,
    acknowledgedAt: data.acknowledged_at,
  }
}

export function acknowledgeShowcaseTerms() {
  return supabase.rpc('acknowledge_showcase_terms').then(unwrap)
}

function mapPublishedRow(row) {
  if (!row) return null
  return {
    id: row.listing_id,
    kind: row.kind,
    displayName: row.display_name,
    sortKey: row.sort_key,
    categoryKey: row.category_key,
    modalityKeys: row.modality_keys,
    specialties: row.specialties,
    bio: row.bio,
    city: row.city,
    cityKey: row.city_key,
    uf: row.uf,
    serviceMode: row.service_mode,
    publicContacts: row.public_contacts,
    linkedCommunityId: row.linked_community_id,
    linkedCommunity: row.linked_community_id
      ? { id: row.linked_community_id, name: row.linked_community_name }
      : null,
    avatarPath: row.avatar_path,
    avatarSourceMediaId: row.avatar_source_media_id,
    publishedVersion: row.published_version,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  }
}

export async function getPublishedProfessionalListing(listingId) {
  const { data, error } = await supabase
    .from('published_professional_listings')
    .select('*')
    .eq('listing_id', listingId)
    .maybeSingle()
  if (error) throw error
  return mapPublishedRow(data)
}

// filters usa '*' como "qualquer" (mesma convenção das outras telas de busca do app) --
// aqui vira null pra RPC tratar como filtro ausente.
const orNull = (value) => (value && value !== '*' ? value : null)

export async function listPublishedProfessionalListings(filters, cursor = null, pageSize = 20) {
  const { data, error } = await supabase.rpc('list_published_professional_listings', {
    p_kind: filters.kind,
    p_modality: orNull(filters.modality),
    p_uf: orNull(filters.uf),
    p_city: orNull(filters.city),
    p_service_mode: orNull(filters.serviceMode),
    p_cursor: cursor,
    p_limit: pageSize,
  })
  if (error) throw error
  return { items: data.items, nextCursor: data.nextCursor }
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}
