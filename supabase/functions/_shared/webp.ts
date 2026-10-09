// Lê só o cabeçalho RIFF/WEBP pra extrair largura/altura, sem decodificar a imagem
// inteira -- suporta os 3 formatos de chunk possíveis (VP8X: extendido/canvas; VP8:
// lossy; VP8L: lossless). Qualquer formato não reconhecido ou corte inesperado falha
// fechado (retorna null -> rejeitado pelo chamador), nunca assume um tamanho default.
// Compartilhado por profile-avatar-confirm e exercise-visual-confirm.
export function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    if (bytes.length < 30) return null
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...bytes.subarray(offset, offset + length))
    if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') return null

    const fourCC = ascii(12, 4)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    if (fourCC === 'VP8X') {
      const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1
      const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1
      return { width, height }
    }

    if (fourCC === 'VP8 ') {
      // bytes 20-22: frame tag (3 bytes); 23-25: código de sincronismo 0x9d 0x01 0x2a
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
      const rawWidth = view.getUint16(26, true)
      const rawHeight = view.getUint16(28, true)
      return { width: rawWidth & 0x3fff, height: rawHeight & 0x3fff }
    }

    if (fourCC === 'VP8L') {
      if (bytes[20] !== 0x2f) return null
      const bits = view.getUint32(21, true)
      const width = (bits & 0x3fff) + 1
      const height = ((bits >>> 14) & 0x3fff) + 1
      return { width, height }
    }

    return null
  } catch {
    return null
  }
}

// O campo de tamanho do RIFF (bytes 4-7) diz quantos bytes vêm depois dele. Um arquivo cortado no meio
// mantém o cabeçalho válido mas fica menor que isso; bytes extras no fim são tolerados. Usado só pelas
// funções de mídia dos exercícios (o avatar continua só com readWebpDimensions).
export function isWebpComplete(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riffSize = view.getUint32(4, true)
  return riffSize >= 4 && riffSize + 8 <= bytes.length
}
