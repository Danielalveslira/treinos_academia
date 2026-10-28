import { supabase } from '../supabase/config'

export function createProfessionalListing(kind) {
  return supabase.rpc('create_professional_listing', { p_kind: kind }).then(unwrap)
}

const EDITABLE_FIELDS = [
  'kind',
  'displayName',
  'categoryKey',
  'modalityKeys',
  'specialties',
  'bio',
  'city',
  'uf',
  'serviceMode',
  'contacts',
  'linkedCommunityId',
  'mediaId',
  'address',
  'openingHours',
]
export function saveProfessionalListing(listingId, draft, revision) {
  return supabase
    .rpc('save_professional_listing_draft', {
      p_listing_id: listingId,
      p_revision: revision,
      p_draft: Object.fromEntries(
        EDITABLE_FIELDS.filter((key) => draft[key] !== undefined).map((key) => [key, draft[key]])
      ),
    })
    .then(unwrap)
}
export function setProfessionalListingEditorial(id, revision, state, reason = '') {
  return supabase
    .rpc('set_professional_listing_editorial', {
      p_id: id,
      p_revision: revision,
      p_state: state,
      p_reason: reason,
    })
    .then(unwrap)
}
export function listListingCommercialOrders(id, before = null) {
  return supabase.rpc('list_listing_commercial_orders', { p_id: id, p_before: before }).then(unwrap)
}

export function getMyProfessionalListing() {
  return supabase.rpc('get_my_professional_listing').then(unwrap)
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

// Resumo das mudanças ("Ler o que mudou") vem daqui -- nunca hardcoded no frontend --
// showcase_legal_versions é o arquivo imutável por versão (manifest.changes é o mesmo
// array já usado em legal/showcase-manifest.json, só que a cópia que realmente foi
// ativada no servidor).
export async function getShowcaseLegalVersion(version) {
  const { data, error } = await supabase
    .from('showcase_legal_versions')
    .select('*')
    .eq('version', version)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    version: data.version,
    manifest: data.manifest,
    document: data.document,
    digest: data.digest,
    createdAt: data.created_at,
  }
}

export async function getPublishedProfessionalListing(listingId) {
  const { data, error } = await supabase.rpc('public_get_professional', { p_listing_id: listingId })
  if (error) throw error
  return data
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// Admin de Vitrines -- paginação por cursor no servidor (mesmo padrão de
// admin_list_accounts), nunca carrega todas as vitrines no cliente.
function toAdminListingRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    ownerEmail: row.owner_email,
    kind: row.kind,
    lifecycleState: row.lifecycle_state,
    displayName: row.display_name,
    publishedVersion: row.published_version,
    suspendedReason: row.suspended_reason,
    suspendedBy: row.suspended_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function adminListProfessionalListings({
  search = '',
  lifecycleState = '',
  cursor = null,
  pageSize = 50,
} = {}) {
  const { data, error } = await supabase.rpc('admin_list_professional_listings', {
    p_search: search,
    p_lifecycle_state: lifecycleState,
    p_cursor: cursor,
    p_page_size: pageSize,
  })
  if (error) throw error
  return {
    listings: data.map(toAdminListingRow),
    nextCursor: data.length === pageSize ? data.at(-1).id : null,
  }
}

export function adminGetProfessionalListing(listingId) {
  return supabase.rpc('admin_get_professional_listing', { p_listing_id: listingId }).then(unwrap)
}
