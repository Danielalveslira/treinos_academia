// Toda foto publicada passa por aqui antes de ir para o Storage: nunca enviamos os
// bytes originais do usuário. Decodificar num <canvas> e reexportar como WebP tem um
// efeito colateral de segurança útil — um arquivo renomeado para .jpg que não é
// mesmo uma imagem simplesmente falha ao decodificar (loadBitmap rejeita), então o
// que chega no Storage é sempre um raster de verdade, nunca bytes arbitrários.
export const ALLOWED_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const MAX_INPUT_BYTES = 20 * 1024 * 1024
export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
export const MAX_DIMENSION = 1600
const OUTPUT_TYPE = 'image/webp'

export class UnsupportedImageError extends Error {}

export function fitDimensions(width, height, max = MAX_DIMENSION) {
  if (width <= max && height <= max) return { width, height }
  const scale = max / Math.max(width, height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function validateImageFile(file) {
  if (!file) return 'Selecione uma imagem.'
  if (!ALLOWED_INPUT_TYPES.includes(file.type)) {
    return 'Formato não suportado. Envie uma imagem JPEG, PNG, WebP ou GIF.'
  }
  if (file.size > MAX_INPUT_BYTES) return 'Escolha uma imagem menor (máx. 20MB).'
  return null
}

function encode(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

// Compressão real (decodificação, canvas, toBlob) só existe no navegador — fica de
// fora dos testes unitários de propósito. fitDimensions/validateImageFile acima
// cobrem a parte que dá pra testar sem um DOM completo.
export async function compressImage(file) {
  const invalid = validateImageFile(file)
  if (invalid) throw new UnsupportedImageError(invalid)

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new UnsupportedImageError('Não foi possível ler essa imagem. Escolha outro arquivo.')
  }

  try {
    const { width, height } = fitDimensions(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)

    let blob = await encode(canvas, OUTPUT_TYPE, 0.82)
    if (!blob || blob.type !== OUTPUT_TYPE) {
      throw new UnsupportedImageError(
        'Seu navegador não tem suporte à compressão de imagens. Atualize-o e tente novamente.'
      )
    }
    if (blob.size > MAX_OUTPUT_BYTES) {
      blob = (await encode(canvas, OUTPUT_TYPE, 0.6)) || blob
    }
    if (blob.size > MAX_OUTPUT_BYTES) {
      throw new UnsupportedImageError(
        'Imagem muito grande mesmo após compressão. Escolha outra foto.'
      )
    }
    return blob
  } finally {
    bitmap.close?.()
  }
}
