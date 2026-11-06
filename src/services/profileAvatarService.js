import { supabase } from '../supabase/config'
const MAX_AVATAR_BYTES = 1024 * 1024
// 320px cobre até ~3x de densidade de pixels no maior avatar exibido (~104px).
export const AVATAR_MAX_DIMENSION = 320

export async function uploadProfileAvatar(blob) {
  if (blob.type !== 'image/webp' || blob.size < 1 || blob.size > MAX_AVATAR_BYTES) {
    throw new Error('AVATAR_TOO_LARGE')
  }
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr) throw sessionErr
  if (!sessionData?.session?.access_token || !sessionData.session.user?.id)
    throw new Error('NOT_AUTHENTICATED')
  const { data: allocation, error: allocateErr } = await supabase.rpc('allocate_profile_avatar')
  if (allocateErr) throw allocateErr
  const { mediaId, path } = allocation

  const { error: uploadErr } = await supabase.storage
    .from('profile-avatars')
    .upload(path, blob, { contentType: 'image/webp', upsert: false })
  if (uploadErr) throw uploadErr

  const { data: currentSession, error: currentSessionErr } = await supabase.auth.getSession()
  if (currentSessionErr) throw currentSessionErr
  if (
    !currentSession?.session?.access_token ||
    !currentSession.session.user?.id ||
    currentSession.session.user.id !== sessionData.session.user.id
  )
    throw new Error('NOT_AUTHENTICATED')
  const request = () => fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/profile-avatar-confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${currentSession.session.access_token}`,
    },
    body: JSON.stringify({ mediaId }),
  })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response
    try {
      response = await request()
    } catch (error) {
      if (attempt === 1) throw error
      continue
    }
    let body
    try { body = await response.json() } catch {
      if (attempt === 1) throw new Error('CONFIRM_FAILED')
      continue
    }
    if (response.ok) return body
    if (response.status < 500 || attempt === 1) throw new Error(body?.error || 'CONFIRM_FAILED')
  }
  throw new Error('CONFIRM_FAILED')
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
