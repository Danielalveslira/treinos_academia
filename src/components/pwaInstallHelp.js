// Detecção de plataforma para as instruções de instalação manual (PwaControls), separada em
// funções puras para poder ser testada sem DOM. A instalação por beforeinstallprompt (Chrome/Edge/
// Android) não passa por aqui -- isto só decide o texto do "Como instalar" quando o navegador não
// oferece o prompt nativo.

export function isIosDevice(userAgent, platform, maxTouchPoints) {
  return (
    /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
  )
}

// Exclui Chrome/Chromium/Edge/Opera e os navegadores de terceiros no iOS (que usam a engine da
// Apple mas reportam "Safari" na UA) para só identificar o Safari de verdade no macOS.
function isRealSafari(userAgent) {
  return (
    /Safari\//.test(userAgent) &&
    !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|Edg\/|OPR\//.test(userAgent)
  )
}

export function isMacSafari(userAgent, platform, maxTouchPoints) {
  if (isIosDevice(userAgent, platform, maxTouchPoints)) return false
  const isMac = platform === 'MacIntel' || /Macintosh/.test(userAgent)
  return isMac && isRealSafari(userAgent)
}

export function isFirefoxDesktop(userAgent, platform, maxTouchPoints) {
  if (isIosDevice(userAgent, platform, maxTouchPoints)) return false
  return /Firefox\//.test(userAgent) && !/FxiOS\//.test(userAgent)
}

// Safari 17 (macOS Sonoma) introduziu "Adicionar ao Dock" para sites quaisquer; versões
// anteriores não têm esse caminho, então a instrução cai no texto genérico e conservador.
export function supportsSafariAddToDock(userAgent) {
  const match = /Version\/(\d+)/.exec(userAgent)
  return match !== null && Number(match[1]) >= 17
}

export function getInstallPlatform(userAgent, platform, maxTouchPoints) {
  if (isIosDevice(userAgent, platform, maxTouchPoints)) return 'ios'
  if (isMacSafari(userAgent, platform, maxTouchPoints)) return 'mac-safari'
  if (isFirefoxDesktop(userAgent, platform, maxTouchPoints)) return 'firefox'
  return 'generic'
}
