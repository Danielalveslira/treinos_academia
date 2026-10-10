// Hash perceptual (dHash de 64 bits) das imagens de exercício. Serve SÓ para avisar o revisor quando a posição
// inicial e a final são praticamente a mesma imagem; calculado no navegador (o servidor não decodifica pixels) e
// por isso nunca usado para bloquear nada. Resultado: 16 dígitos hex, ou null se algo falhar.
const HASH_COLUMNS = 9
const HASH_ROWS = 8

// `gray`: 72 valores (9 colunas x 8 linhas, linha a linha). Bit = pixel mais claro que o vizinho da direita.
export function dHashFromGrayscale(gray) {
  if (!gray || gray.length !== HASH_COLUMNS * HASH_ROWS) throw new Error('INVALID_GRAYSCALE')
  let bits = ''
  for (let row = 0; row < HASH_ROWS; row++) {
    for (let column = 0; column < HASH_COLUMNS - 1; column++) {
      const index = row * HASH_COLUMNS + column
      bits += gray[index] > gray[index + 1] ? '1' : '0'
    }
  }
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

export function hammingDistanceHex(a, b) {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) throw new Error('INVALID_HASH')
  let distance = 0
  for (let i = 0; i < 16; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (xor) {
      distance += xor & 1
      xor >>= 1
    }
  }
  return distance
}

// Reduz a imagem a 9x8 sobre fundo branco (o fundo transparente das ilustrações não vira "preto") e converte
// para tons de cinza.
export async function perceptualHashOfBlob(blob) {
  let bitmap
  try {
    bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = HASH_COLUMNS
    canvas.height = HASH_ROWS
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, HASH_COLUMNS, HASH_ROWS)
    context.drawImage(bitmap, 0, 0, HASH_COLUMNS, HASH_ROWS)
    const { data } = context.getImageData(0, 0, HASH_COLUMNS, HASH_ROWS)
    const gray = []
    for (let i = 0; i < data.length; i += 4) {
      gray.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]))
    }
    return dHashFromGrayscale(gray)
  } catch {
    return null
  } finally {
    bitmap?.close?.()
  }
}
