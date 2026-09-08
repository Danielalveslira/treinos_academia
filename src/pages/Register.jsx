import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerUser } from '../services/authService'
import { translateAuthError } from '../utils/authErrors'
import { FormField } from '../components/FormField'

export default function Register() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await registerUser(email, password)
      navigate('/')
    } catch (err) {
      setError(translateAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Criar conta</h1>
        {error && <p className="form-error">{error}</p>}
        <FormField label="E-mail">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </FormField>
        <FormField label="Senha">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </FormField>
        <button type="submit" className="button button--primary" disabled={submitting}>
          {submitting ? 'Criando...' : 'Criar conta'}
        </button>
        <div className="auth-links">
          <Link to="/login">Já tenho conta</Link>
        </div>
      </form>
    </div>
  )
}
