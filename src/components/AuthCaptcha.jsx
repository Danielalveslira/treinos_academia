import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Button, Flash, useTheme } from '@primer/react'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { authCaptchaError, authCaptchaRequired, authCaptchaSiteKey } from '../utils/authCaptcha'

const TOKEN_MAX_AGE_MS = 100_000
const LOAD_TIMEOUT_MS = 15_000

// O widget e o token só existem enquanto a tela que precisa de Auth está montada.
export const AuthCaptcha = forwardRef(function AuthCaptcha({ onVerifiedChange }, ref) {
  const { resolvedColorMode } = useTheme()
  const widget = useRef(null)
  const token = useRef(null)
  const expiryTimer = useRef(null)
  const loadTimer = useRef(null)
  const [instance, setInstance] = useState(0)
  const [status, setStatus] = useState('loading')

  function clearExpiry() {
    clearTimeout(expiryTimer.current)
    expiryTimer.current = null
  }

  function invalidate(nextStatus) {
    token.current = null
    clearExpiry()
    setStatus(nextStatus)
    onVerifiedChange?.(false)
  }

  useImperativeHandle(ref, () => ({
    takeToken() {
      if (!authCaptchaRequired) return undefined
      if (!authCaptchaSiteKey) throw authCaptchaError('CAPTCHA_CONFIGURATION_MISSING')
      const current = token.current
      if (!current || current.expiresAt <= Date.now()) {
        invalidate(current ? 'expired' : status)
        throw authCaptchaError(current ? 'CAPTCHA_EXPIRED' : 'CAPTCHA_REQUIRED')
      }
      token.current = null
      clearExpiry()
      setStatus('used')
      onVerifiedChange?.(false)
      return current.value
    },
    reset() {
      invalidate('ready')
      widget.current?.resetCaptcha()
    },
  }))

  useEffect(() => {
    if (!authCaptchaRequired || !authCaptchaSiteKey) return undefined
    loadTimer.current = setTimeout(
      () => setStatus((value) => (value === 'loading' ? 'error' : value)),
      LOAD_TIMEOUT_MS
    )
    return () => {
      clearTimeout(loadTimer.current)
      clearExpiry()
      token.current = null
    }
  }, [instance])

  if (!authCaptchaRequired) return null
  if (!authCaptchaSiteKey)
    return (
      <Flash variant="danger" role="alert">
        A verificação de segurança não está configurada neste ambiente. Tente novamente mais tarde.
      </Flash>
    )

  const retry = () => {
    invalidate('loading')
    widget.current = null
    setInstance((value) => value + 1)
  }
  const message = {
    loading: 'Carregando verificação de segurança…',
    ready: 'Conclua a verificação de segurança para continuar.',
    verified: 'Verificação concluída.',
    expired: 'A verificação expirou. Conclua-a novamente.',
    error: 'Não foi possível carregar a verificação. Verifique sua conexão e tente novamente.',
    used: 'Conclua uma nova verificação para tentar novamente.',
  }[status]

  return (
    <div className="auth-captcha" role="group" aria-label="Verificação de segurança">
      <HCaptcha
        key={instance}
        ref={widget}
        sitekey={authCaptchaSiteKey}
        size="compact"
        theme={resolvedColorMode === 'night' ? 'dark' : 'light'}
        onLoad={() => {
          clearTimeout(loadTimer.current)
          setStatus('ready')
        }}
        onVerify={(value) => {
          if (!value) {
            invalidate('error')
            return
          }
          clearExpiry()
          token.current = { value, expiresAt: Date.now() + TOKEN_MAX_AGE_MS }
          expiryTimer.current = setTimeout(() => invalidate('expired'), TOKEN_MAX_AGE_MS)
          setStatus('verified')
          onVerifiedChange?.(true)
        }}
        onExpire={() => invalidate('expired')}
        onChalExpired={() => invalidate('expired')}
        onError={() => invalidate('error')}
      />
      <p role={status === 'error' ? 'alert' : 'status'}>{message}</p>
      {status === 'error' && (
        <Button type="button" onClick={retry}>
          Tentar novamente
        </Button>
      )}
    </div>
  )
})
