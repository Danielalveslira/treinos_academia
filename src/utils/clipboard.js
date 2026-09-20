// Mesmo padrão de share.js:shareToInstagram -- nunca silencia uma falha de clipboard,
// quem chama decide o que mostrar na tela quando `copied` vier false.
export async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return { copied: true }
  } catch {
    return { copied: false }
  }
}
