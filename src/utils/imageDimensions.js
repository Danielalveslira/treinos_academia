// Header-only probe before decoding large phone photos. The browser still does the
// actual decoding and EXIF orientation; these dimensions are only a resize hint.
function jpegOrientation(view, start, end) {
  if (end - start < 14 || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0)
    return 1
  const tiff = start + 6
  const order = view.getUint16(tiff)
  if (order !== 0x4949 && order !== 0x4d4d) return 1
  const little = order === 0x4949
  if (view.getUint16(tiff + 2, little) !== 42) return 1
  const directory = tiff + view.getUint32(tiff + 4, little)
  if (directory + 2 > end) return 1
  const count = view.getUint16(directory, little)
  for (let index = 0; index < count; index += 1) {
    const entry = directory + 2 + index * 12
    if (entry + 12 > end) break
    if (view.getUint16(entry, little) === 0x0112 && view.getUint16(entry + 2, little) === 3)
      return view.getUint16(entry + 8, little)
  }
  return 1
}

export async function readImageDimensions(file) {
  const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const view = new DataView(bytes.buffer)
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (bytes.length >= 10 && String.fromCharCode(...bytes.subarray(0, 3)) === 'GIF') {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  if (
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    const kind = String.fromCharCode(...bytes.subarray(12, 16))
    if (kind === 'VP8X')
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      }
    if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a)
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2
    let width = 0
    let height = 0
    let orientation = 1
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) break
      const marker = bytes[at + 1]
      if (marker === 0xd9 || marker === 0xda) break
      const length = view.getUint16(at + 2)
      if (length < 2 || at + 2 + length > bytes.length) break
      if (marker === 0xe1) orientation = jpegOrientation(view, at + 4, at + 2 + length)
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker
        )
      ) {
        width = view.getUint16(at + 7)
        height = view.getUint16(at + 5)
      }
      at += 2 + length
    }
    if (width && height)
      return orientation >= 5 && orientation <= 8
        ? { width: height, height: width }
        : { width, height }
  }
  return null
}
