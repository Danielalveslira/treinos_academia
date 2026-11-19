import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Flash } from '@primer/react'
import { PublicLayout } from './PublicLayout'
import { LogoutButton } from './LogoutButton'
import { emailFirstSignupReady, logoutUser } from '../services/authService'

// Esta tela só orienta a retomada. O banco e o hook continuam sendo a autoridade:
// nenhum dado privado é carregado por uma role temporária no AuthContext.
export function RestrictedSessionGate({ scope, email }) {
  const navigate = useNavigate()
  const [resumeReady, setResumeReady] = useState(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  async function startResume() {
    if (starting) return
    setStarting(true)
    setError('')
    try {
      // A busca pública de username e o novo OTP começam sem a sessão auth_setup.
      // O servidor só promove a conta depois de nova prova do e-mail e senha.
      await logoutUser()
      navigate('/cadastro', { replace: true, state: { email } })
    } catch {
      setError('Não foi possível iniciar a retomada. Tente novamente.')
    } finally {
      setStarting(false)
    }
  }

  useEffect(() => {
    if (scope !== 'auth_setup') return undefined
    let active = true
    emailFirstSignupReady()
      .then((ready) => { if (active) setResumeReady(ready) })
      .catch(() => { if (active) setResumeReady(false) })
    return () => { active = false }
  }, [scope])

  return (
    <PublicLayout>
      <section className="support-page" aria-labelledby="restricted-session-title">
        <h1 id="restricted-session-title">
          {scope === 'auth_setup' ? 'Conclua seu cadastro' : 'Continue a verificação da conta'}
        </h1>
        {scope === 'auth_setup' ? (
          <>
            <p>Para proteger sua conta, confirme novamente o acesso ao e-mail e defina uma senha nova antes de completar o perfil.</p>
            {resumeReady === true ? (
              <Button onClick={startResume} disabled={starting} loading={starting} variant="primary">
                Receber código para continuar
              </Button>
            ) : resumeReady === false ? (
              <Flash role="status">A retomada segura está temporariamente indisponível. Tente novamente mais tarde.</Flash>
            ) : (
              <p role="status">Verificando a disponibilidade da retomada…</p>
            )}
          </>
        ) : (
          <p>Esta sessão permite somente confirmar ou recuperar a conta. Volte à etapa iniciada ou solicite um novo código.</p>
        )}
        {error && <Flash variant="danger" role="alert">{error}</Flash>}
        <LogoutButton />
      </section>
    </PublicLayout>
  )
}
