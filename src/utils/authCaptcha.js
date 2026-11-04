// O Supabase valida o token. Esta configuração só controla a interface e impede
// chamadas sem token quando a proteção deve estar ativa no cliente.
export const authCaptchaRequired =
  Boolean(import.meta.env?.PROD) || import.meta.env?.VITE_HCAPTCHA_ENABLED === 'true'

export const authCaptchaSiteKey = (import.meta.env?.VITE_HCAPTCHA_SITE_KEY || '').trim()

export function authCaptchaError(code) {
  return Object.assign(new Error(code), { code })
}

export function captchaOptions(captchaToken) {
  if (!authCaptchaRequired) return undefined
  if (!authCaptchaSiteKey) throw authCaptchaError('CAPTCHA_CONFIGURATION_MISSING')
  if (typeof captchaToken !== 'string' || !captchaToken.trim())
    throw authCaptchaError('CAPTCHA_REQUIRED')
  return { captchaToken }
}

export function takeCaptchaToken(captchaRef) {
  if (!authCaptchaRequired) return undefined
  if (!authCaptchaSiteKey) throw authCaptchaError('CAPTCHA_CONFIGURATION_MISSING')
  const token = captchaRef.current?.takeToken()
  if (!token) throw authCaptchaError('CAPTCHA_REQUIRED')
  return token
}
