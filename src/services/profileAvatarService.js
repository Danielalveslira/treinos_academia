import { httpsCallable } from 'firebase/functions'
import { getBytes, ref, uploadBytes } from 'firebase/storage'
import { functions, storage } from '../firebase/config'
import { compressImage } from '../utils/imageCompression'

const MAX_AVATAR_BYTES = 1024 * 1024
// Maior uso de avatar na tela é .professional-detail-avatar a 104px (ver app.css) --
// 320px cobre até ~3x de densidade de pixels com folga, contra o teto genérico de
// 1600px (dimensionado para fotos de status/vitrine em cards largos). O servidor
// (profile-avatar-service.js) segue validando um teto bem mais alto (1600px/2.56MP);
// isto só evita que o CLIENTE gere e envie algo maior do que qualquer avatar do app
// jamais exibe.
export const AVATAR_MAX_DIMENSION = 320

export async function uploadProfileAvatar(file) {
  const blob = await compressImage(file, { maxDimension: AVATAR_MAX_DIMENSION })
  if (blob.size > MAX_AVATAR_BYTES) {
    throw new Error('AVATAR_TOO_LARGE')
  }
  const allocation = await httpsCallable(functions, 'allocateProfileAvatar')()
  const { mediaId, path } = allocation.data
  await uploadBytes(ref(storage, path), blob, { contentType: 'image/webp' })
  const confirmation = await httpsCallable(functions, 'confirmProfileAvatar')({ mediaId })
  return confirmation.data
}

export async function removeProfileAvatar() {
  const result = await httpsCallable(functions, 'removeProfileAvatar')()
  return result.data
}

export async function loadAvatarBytes(path) {
  return getBytes(ref(storage, path), 2 * 1024 * 1024)
}
