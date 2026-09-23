import { httpsCallable } from 'firebase/functions'
import { getBytes, ref, uploadBytes } from 'firebase/storage'
import { functions, storage } from '../firebase/config'
import { compressImage } from '../utils/imageCompression'

const MAX_AVATAR_BYTES = 1024 * 1024

export async function uploadProfileAvatar(file) {
  const blob = await compressImage(file)
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
