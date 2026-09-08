import { useState } from 'react'
import { Link } from 'react-router-dom'
import { resetPassword } from '../services/authService'
import { translateAuthError } from '../utils/authErrors'
import { FormField } from '../components/FormField'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await resetPassword(email)
      setSent(true)
    } catch (err) {
      setError(translateAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Recuperar senha</h1>
        {error && <p className="form-error">{error}</p>}
        {sent ? (
          <p>Se o e-mail existir, enviamos um link de recuperação.</p>
        ) : (
          <>
            <FormField label="E-mail">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </FormField>
            <button type="submit" className="button button--primary" disabled={submitting}>
              {submitting ? 'Enviando...' : 'Enviar link'}
            </button>
          </>
        )}
        <div className="auth-links">
          <Link to="/login">Voltar ao login</Link>
        </div>
      </form>
    </div>
  )
}
