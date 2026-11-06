import { UnsupportedImageError } from './imageCompression.js'

export const AVATAR_SIZE = 320
export const AVATAR_MAX_BYTES = 1024 * 1024

export function rotatedSize(width, height, degrees) {
  return degrees % 180 === 0 ? { width, height } : { width: height, height: width }
}

// react-easy-crop reports pixels in the rotated image's bounding box. Draw only
// that rectangle into the small output canvas, avoiding a full-size rotated canvas.
export function drawAvatarCrop(canvas, bitmap, crop, degrees) {
  if (!crop || crop.width <= 0 || crop.height <= 0 || Math.abs(crop.width - crop.height) > 2)
    throw new UnsupportedImageError('Recorte inválido.')
  const rotated = rotatedSize(bitmap.width, bitmap.height, degrees)
  const scale = AVATAR_SIZE / crop.width
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new UnsupportedImageError('Não foi possível processar a imagem.')
  context.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  context.translate(
    -crop.x * scale + (rotated.width * scale) / 2,
    -crop.y * scale + (rotated.height * scale) / 2
  )
  context.rotate((degrees * Math.PI) / 180)
  context.drawImage(
    bitmap,
    (-bitmap.width * scale) / 2,
    (-bitmap.height * scale) / 2,
    bitmap.width * scale,
    bitmap.height * scale
  )
}

export async function encodeAvatarCrop(canvas) {
  for (const quality of [0.84, 0.72, 0.6, 0.46, 0.32]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob || blob.type !== 'image/webp') {
      throw new UnsupportedImageError(
        'Seu navegador não suporta WebP. Atualize-o e tente novamente.'
      )
    }
    if (blob.size <= AVATAR_MAX_BYTES) return blob
  }
  throw new UnsupportedImageError('A imagem compactada ultrapassou 1 MB. Escolha outra foto.')
}
