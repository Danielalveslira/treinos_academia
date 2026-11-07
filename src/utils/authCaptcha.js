// A configuração do cliente controla apenas o widget. A validação do token
// continua no Supabase Auth. Uma URL não local exige CAPTCHA inclusive em vite dev.
export function resolveAuthCaptchaConfig(env) {
  let localSupabase = false
  try {
    const hostname = new URL(env.VITE_SUPABASE_URL).hostname
    localSupabase = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  } catch {
    // URL ausente/inválida nunca autoriza uma chamada de Auth sem CAPTCHA.
  }

  const setting = env.VITE_HCAPTCHA_ENABLED
  const required = !localSupabase || (setting !== undefined && setting !== 'false')
  const siteKey = (env.VITE_HCAPTCHA_SITE_KEY || '').trim()
  const error =
    (setting !== undefined && setting !== 'true' && setting !== 'false') ||
    (!localSupabase && setting === 'false')
      ? 'CAPTCHA_CONFIGURATION_CONFLICT'
      : required && !siteKey
        ? 'CAPTCHA_CONFIGURATION_MISSING'
        : null

  return { required, siteKey, error }
}

const config = resolveAuthCaptchaConfig({
  VITE_SUPABASE_URL: import.meta.env?.VITE_SUPABASE_URL,
  VITE_HCAPTCHA_ENABLED: import.meta.env?.VITE_HCAPTCHA_ENABLED,
  VITE_HCAPTCHA_SITE_KEY: import.meta.env?.VITE_HCAPTCHA_SITE_KEY,
})
export const authCaptchaRequired = config.required
export const authCaptchaSiteKey = config.siteKey
export const authCaptchaConfigurationError = config.error

if (import.meta.env?.DEV && config.error) {
  console.error(
    `[Auth CAPTCHA] ${config.error}: confira VITE_SUPABASE_URL, VITE_HCAPTCHA_ENABLED e VITE_HCAPTCHA_SITE_KEY.`
  )
}

export function authCaptchaError(code) {
  return Object.assign(new Error(code), { code })
}

function ensureCaptchaConfig() {
  if (authCaptchaConfigurationError) throw authCaptchaError(authCaptchaConfigurationError)
}

export function captchaOptions(captchaToken) {
  ensureCaptchaConfig()
  if (!authCaptchaRequired) return undefined
  if (typeof captchaToken !== 'string' || !captchaToken.trim())
    throw authCaptchaError('CAPTCHA_REQUIRED')
  return { captchaToken }
}

export function takeCaptchaToken(captchaRef) {
  ensureCaptchaConfig()
  if (!authCaptchaRequired) return undefined
  const token = captchaRef.current?.takeToken()
  if (!token) throw authCaptchaError('CAPTCHA_REQUIRED')
  return token
}
