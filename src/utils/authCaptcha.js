// O Supabase valida o token. Esta configuração só controla a interface e impede
// chamadas sem token quando a proteção deve estar ativa no cliente.
// O preview brasileiro pode desativar o widget enquanto o Supabase Auth brasileiro
// estiver com security_captcha_enabled=false. Sem override, produção mantém o fluxo atual.
export const authCaptchaRequired =
  import.meta.env?.VITE_HCAPTCHA_ENABLED === 'true' ||
  (Boolean(import.meta.env?.PROD) && import.meta.env?.VITE_HCAPTCHA_ENABLED !== 'false')

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
