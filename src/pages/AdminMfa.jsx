import { useEffect, useState } from 'react'
import { Button, Flash, FormControl, TextInput } from '@primer/react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../supabase/config'
import AdminNav from '../components/AdminNav'

// GoTrue owns the factor, challenge, verification and AAL claim. Nothing here is
// stored locally; the server's is_superadmin() remains the authorization gate.
export default function AdminMfa() {
  const { isSuperAdmin, loading } = useAuth()
  const [factors, setFactors] = useState([])
  const [level, setLevel] = useState(null)
  const [enrollment, setEnrollment] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isSuperAdmin) return undefined
    let active = true
    Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]).then(([listed, assurance]) => {
      if (!active) return
      if (listed.error || assurance.error) throw listed.error || assurance.error
      setFactors(listed.data?.totp || [])
      setLevel(assurance.data?.currentLevel || 'aal1')
    }).catch(() => { if (active) setError('Não foi possível consultar seus fatores. Tente novamente.') })
    return () => { active = false }
  }, [isSuperAdmin])

  async function enroll() {
    setBusy(true)
    setError('')
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp', friendlyName: 'Evolutus administração',
      })
      if (enrollError || !data?.id || !data?.totp?.secret) throw enrollError || new Error('MFA_ENROLL_FAILED')
      setEnrollment({ id: data.id, secret: data.totp.secret })
      setCode('')
    } catch {
      setError('Não foi possível iniciar o cadastro do autenticador. Tente novamente.')
    } finally { setBusy(false) }
  }

  async function verify(event) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code) || busy) return
    setBusy(true)
    setError('')
    try {
      const factorId = enrollment?.id || factors[0]?.id
      if (!factorId) throw new Error('MFA_FACTOR_MISSING')
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
      if (verifyError) throw verifyError
      const [listed, assurance] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ])
      if (listed.error || assurance.error || assurance.data?.currentLevel !== 'aal2')
        throw listed.error || assurance.error || new Error('MFA_AAL2_MISSING')
      setFactors(listed.data?.totp || [])
      setLevel('aal2')
      setEnrollment(null)
      setCode('')
    } catch {
      setError('Código inválido ou verificação indisponível. Confira o autenticador e tente novamente.')
    } finally { setBusy(false) }
  }

  if (loading) return <p>Verificando acesso…</p>
  if (!isSuperAdmin) return <Navigate to="/comunidades" replace />

  return (
    <main className="support-page">
      <AdminNav current="/admin/mfa" currentLabel="Autenticador" />
      <h1>Autenticador da administração</h1>
      <p>Use um aplicativo autenticador para confirmar o acesso administrativo. Guarde um segundo fator em um dispositivo separado antes da ativação obrigatória.</p>
      {level === 'aal2' ? <Flash variant="success">Esta sessão foi confirmada com o autenticador.</Flash> : null}
      {enrollment ? (
        <p>Cadastre este segredo no aplicativo autenticador: <code>{enrollment.secret}</code>. Ele será ocultado após a confirmação.</p>
      ) : null}
      {!enrollment && factors.length === 0 && level !== null ? (
        <Button onClick={enroll} disabled={busy}>Cadastrar autenticador</Button>
      ) : null}
      {!enrollment && factors.length > 0 && level === 'aal2' ? (
        <Button onClick={enroll} disabled={busy}>Cadastrar fator de reserva</Button>
      ) : null}
      {(enrollment || factors.length > 0 && level !== 'aal2') ? (
        <form onSubmit={verify}>
          <FormControl required>
            <FormControl.Label>Código de seis dígitos</FormControl.Label>
            <TextInput type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
              maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
          </FormControl>
          <Button type="submit" variant="primary" disabled={busy || !/^\d{6}$/.test(code)}>Confirmar código</Button>
        </form>
      ) : null}
      {error ? <Flash variant="danger" role="alert">{error}</Flash> : null}
    </main>
  )
}
