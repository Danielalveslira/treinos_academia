// SHA-256 (hex minúsculo) dos bytes de uma imagem: identifica arquivo repetido e garante que o rascunho
// publicado é exatamente o que foi validado na confirmação.
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// dHash de 64 bits calculado no navegador (16 dígitos hex). Aviso apenas: nunca confiável o bastante para bloquear.
export const PERCEPTUAL_HASH_PATTERN = /^[0-9a-f]{16}$/
