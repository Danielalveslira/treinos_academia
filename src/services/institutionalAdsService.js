import { supabase } from '../supabase/config'

const MESSAGES = {
  ADMIN_REQUIRED: 'Apenas superadmins podem administrar anúncios institucionais.',
  SESSION_REVOKED: 'Sua sessão expirou. Entre novamente antes de continuar.',
  INVALID_AD: 'Revise os campos do anúncio e tente novamente.',
  INVALID_AD_TEXT: 'Confira o nome da marca, o título e a descrição.',
  INVALID_AD_IMAGE: 'Use um endereço HTTPS válido para a imagem.',
  INVALID_AD_LINK: 'Confira o texto e o destino do botão.',
  INVALID_AD_EXPIRY: 'Escolha uma data de expiração futura.',
  DUPLICATE_AD_PLACEMENT: 'Um local de exibição foi selecionado mais de uma vez.',
  AD_REVISION_CONFLICT:
    'O anúncio foi alterado em outra sessão. Atualize a lista e tente novamente.',
  AD_EXPIRED: 'A data de expiração já passou.',
  AD_HAS_HISTORY:
    'Este anúncio tem histórico ou está ativo. Suspenda-o; a exclusão preserva as métricas.',
  COMMERCIAL_AD_IMMUTABLE: 'Campanhas comerciais são gerenciadas na aba Anunciantes.',
  INVALID_AD_CONTEXT: 'Selecione uma comunidade ativa para esse posicionamento.',
  INVALID_AD_PLACEMENT: 'Selecione ao menos um local de exibição válido.',
  AD_FEED_FIELDS_UNAVAILABLE: 'Imagem e descrição só podem ser usadas no card do feed.',
}

function explain(error) {
  const key = Object.keys(MESSAGES).find((code) => error?.message === code)
  if (key) return new Error(MESSAGES[key])
  if (error?.message?.startsWith('AD_CAPACITY_REACHED:')) {
    return new Error('Não há capacidade livre para ativar este anúncio no local selecionado.')
  }
  if (error?.message?.startsWith('AD_DELIVERY_DISABLED:')) {
    return new Error(
      'A exibição está desativada neste posicionamento. Ative-a nas configurações antes de publicar.'
    )
  }
  return error
}

export async function listInstitutionalAds() {
  const { data, error } = await supabase.rpc('admin_list_institutional_ads')
  if (error) throw explain(error)
  return (data || []).map((row) => ({
    id: row.id,
    partnerName: row.partner_name,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    ctaLabel: row.cta_label,
    ctaType: row.cta_type,
    ctaTarget: row.cta_target,
    expiresAt: row.expires_at,
    placements: row.placements || [],
    communityIds: row.community_ids || [],
    isGlobal: row.is_global,
    displayMode: row.display_mode,
    commercial: Boolean(row.commercial_resource_id),
    active: row.active,
    deliveryStatus: row.delivery_status,
    deletable: row.deletable,
    revision: row.revision,
    createdAt: row.created_at,
  }))
}

export async function saveInstitutionalAd(ad, values, requestId) {
  const id = ad?.id || requestId || crypto.randomUUID()
  const { error } = await supabase.rpc('admin_save_institutional_ad', {
    p_id: id,
    p_revision: ad?.revision || 0,
    p_payload: values,
  })
  if (error) throw explain(error)
  return id
}

export async function setInstitutionalAdActive(ad, active) {
  const { error } = await supabase.rpc('admin_set_institutional_ad_active', {
    p_id: ad.id,
    p_revision: ad.revision,
    p_active: active,
  })
  if (error) throw explain(error)
}

export async function deleteInstitutionalAd(ad) {
  const { error } = await supabase.rpc('admin_delete_institutional_ad', {
    p_id: ad.id,
    p_revision: ad.revision,
  })
  if (error) throw explain(error)
}
