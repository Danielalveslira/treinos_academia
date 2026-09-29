import { supabase } from '../supabase/config'
import { compressImage } from '../utils/imageCompression'

const MAX_AVATAR_BYTES = 1024 * 1024
// Maior uso de avatar na tela é .professional-detail-avatar a 104px (ver app.css) --
// 320px cobre até ~3x de densidade de pixels com folga, contra o teto genérico de
// 1600px (dimensionado para fotos de status/vitrine em cards largos). O servidor
// (Edge Function profile-avatar-confirm) segue validando um teto bem mais alto
// (1600px/2.56MP); isto só evita que o CLIENTE gere e envie algo maior do que qualquer
// avatar do app jamais exibe.
export const AVATAR_MAX_DIMENSION = 320

export async function uploadProfileAvatar(file) {
  const blob = await compressImage(file, { maxDimension: AVATAR_MAX_DIMENSION })
  if (blob.size > MAX_AVATAR_BYTES) {
    throw new Error('AVATAR_TOO_LARGE')
  }
  const { data: allocation, error: allocateErr } = await supabase.rpc('allocate_profile_avatar')
  if (allocateErr) throw allocateErr
  const { mediaId, path } = allocation

  const { error: uploadErr } = await supabase.storage
    .from('profile-avatars')
    .upload(path, blob, { contentType: 'image/webp', upsert: true })
  if (uploadErr) throw uploadErr

  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr) throw sessionErr
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/profile-avatar-confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
    body: JSON.stringify({ mediaId }),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body?.error || 'CONFIRM_FAILED')
  }
  return body
}

export async function removeProfileAvatar() {
  const { data, error } = await supabase.rpc('remove_profile_avatar')
  if (error) throw error
  return data
}

export async function loadAvatarBytes(path) {
  const { data, error } = await supabase.storage.from('profile-avatars').download(path)
  if (error) throw error
  return data
}
