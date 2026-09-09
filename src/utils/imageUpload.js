import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { storage } from '../firebase/config'

const MAX_DIMENSION = 1280
const WEBP_QUALITY = 0.8

async function compressToWebp(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao processar a imagem'))),
      'image/webp',
      WEBP_QUALITY
    )
  })
}

export async function uploadStatusImage(communityId, statusId, file) {
  const blob = await compressToWebp(file)
  const imageRef = ref(storage, `communities/${communityId}/statuses/${statusId}/image.webp`)
  await uploadBytes(imageRef, blob, { contentType: 'image/webp' })
  return getDownloadURL(imageRef)
}

export function deleteStatusImage(communityId, statusId) {
  return deleteObject(ref(storage, `communities/${communityId}/statuses/${statusId}/image.webp`))
}

export async function uploadCommunityCoverImage(communityId, file) {
  const blob = await compressToWebp(file)
  const imageRef = ref(storage, `communities/${communityId}/statuses/cover/image.webp`)
  await uploadBytes(imageRef, blob, { contentType: 'image/webp' })
  return getDownloadURL(imageRef)
}
